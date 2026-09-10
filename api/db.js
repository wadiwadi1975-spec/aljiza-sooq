const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

// ---- PostgreSQL connection ----
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ---- crypto helpers ----
function hashPw(password) { return bcrypt.hashSync(String(password), 10); }
function checkPw(password, h) {
  try { return bcrypt.compareSync(String(password), h); } catch (e) { return false; }
}
function genSalt() { return crypto.randomBytes(8).toString('hex'); }
function newToken() { return 'sooq_' + crypto.randomBytes(16).toString('hex'); }
function storeKey(name, phone) {
  return crypto.createHash('sha256').update(String(name || '').trim() + '||' + String(phone || '').replace(/\D/g, '')).digest('hex');
}

// ---- schema ----
async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      phone TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      algo TEXT DEFAULT 'bcrypt',
      role TEXT DEFAULT 'customer',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value JSONB
    );

    CREATE TABLE IF NOT EXISTS businesses (
      id SERIAL PRIMARY KEY,
      owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      name_en TEXT DEFAULT '',
      category TEXT DEFAULT 'other',
      phone TEXT NOT NULL,
      whatsapp TEXT DEFAULT '',
      address TEXT DEFAULT '',
      address_en TEXT DEFAULT '',
      description TEXT DEFAULT '',
      description_en TEXT DEFAULT '',
      image TEXT DEFAULT '',
      images JSONB DEFAULT '[]',
      featured BOOLEAN DEFAULT false,
      rating NUMERIC DEFAULT 5.0,
      price_syp INTEGER DEFAULT 0,
      price_usd NUMERIC DEFAULT 0,
      pay_setup JSONB DEFAULT '{"accepted":["cash"],"details":{},"link":""}',
      billing JSONB DEFAULT '{"model":null,"status":"none","start":null,"end":null,"free_trial_used":false,"free_trial_start":null,"free_trial_end":null,"opsCount":0,"opsDue":0}',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id SERIAL PRIMARY KEY,
      vendor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
      transaction_type TEXT NOT NULL,
      amount INTEGER DEFAULT 0,
      currency TEXT DEFAULT 'SYP',
      payment_method TEXT DEFAULT 'platform',
      status TEXT DEFAULT 'completed',
      reference TEXT,
      subscription_id INTEGER,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS trials (
      key TEXT PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      used_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS subscriptions (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      vendor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      start TIMESTAMPTZ,
      "end" TIMESTAMPTZ,
      amount INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS inquiries (
      id SERIAL PRIMARY KEY,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      phone TEXT DEFAULT '',
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      message TEXT NOT NULL,
      read BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      code TEXT NOT NULL,
      business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
      customer_name TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      phone TEXT NOT NULL,
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      method TEXT DEFAULT 'cash',
      amount INTEGER DEFAULT 0,
      declared_amount INTEGER DEFAULT 0,
      confirmed_amount INTEGER,
      status TEXT DEFAULT 'pending',
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS pay_methods (
      id TEXT PRIMARY KEY,
      ar TEXT NOT NULL,
      en TEXT NOT NULL
    );

    ALTER TABLE businesses ADD COLUMN IF NOT EXISTS price_syp INTEGER DEFAULT 0;
    ALTER TABLE businesses ADD COLUMN IF NOT EXISTS price_usd NUMERIC DEFAULT 0;
  `);
}

// ---- seed ----
async function seedAll() {
  const { rows: existing } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (existing[0].n > 0) return; // already seeded

  const _adminPhone = process.env.ADMIN_PHONE || '0999999999';
  const _adminPass = process.env.ADMIN_PASSWORD || ('Tmp-' + crypto.randomBytes(6).toString('hex') + '!');
  if (!process.env.ADMIN_PASSWORD) console.log('[sooq] ADMIN_PASSWORD not set - using random bootstrap password for ' + _adminPhone);

  const now = new Date();
  const iso = ms => new Date(now.getTime() + ms).toISOString();
  function daysAgo(d) { return iso(-d * 86400000); }
  function daysFrom(d) { return iso(d * 86400000); }

  // Insert users
  const adminR = await pool.query(
    `INSERT INTO users (full_name, phone, pass_hash, role, created_at)
     VALUES ($1, $2, $3, 'admin', $4) RETURNING id`,
    ['مدير المنصة', _adminPhone, hashPw(_adminPass), daysAgo(40)]
  );
  const v1R = await pool.query(
    `INSERT INTO users (full_name, phone, pass_hash, role, created_at)
     VALUES ($1, $2, $3, 'vendor', $4) RETURNING id`,
    ['تاجر دمشقي', '0911111111', hashPw('vendor123'), daysAgo(40)]
  );
  const v2R = await pool.query(
    `INSERT INTO users (full_name, phone, pass_hash, role, created_at)
     VALUES ($1, $2, $3, 'vendor', $4) RETURNING id`,
    ['تاجرة حلبية', '0922222222', hashPw('vendor123'), daysAgo(40)]
  );
  const c1R = await pool.query(
    `INSERT INTO users (full_name, phone, pass_hash, role, created_at)
     VALUES ($1, $2, $3, 'customer', $4) RETURNING id`,
    ['زبون دمشقي', '0933333333', hashPw('customer123'), daysAgo(40)]
  );
  const c2R = await pool.query(
    `INSERT INTO users (full_name, phone, pass_hash, role, created_at)
     VALUES ($1, $2, $3, 'customer', $4) RETURNING id`,
    ['زبونة حمصية', '0944444444', hashPw('customer123'), daysAgo(40)]
  );

  const v1 = v1R.rows[0].id, v2 = v2R.rows[0].id;
  const c1 = c1R.rows[0].id, c2 = c2R.rows[0].id;

  // Insert businesses (with owners)
  const businesses = [
    { name: 'مطعم البيت الدمشقي', nameEn: 'Damascus House Restaurant', cat: 'food', phone: '01001234567', addr: 'شارع الهرم، الجيزة', addrEn: 'Haram St, Giza', desc: 'أشهى المأكولات الشامية والمشويات على الفحم', descEn: 'Tasty levantine dishes & charcoal grills', featured: true, rating: 4.8, ownerId: v1 },
    { name: 'صيدلية الشفاء', nameEn: 'Al-Shifa Pharmacy', cat: 'health', phone: '01007654321', addr: 'ميدان الجيزة', addrEn: 'Giza Square', desc: 'توصيل الأدوية للمنازل على مدار الساعة', descEn: '24/7 home medicine delivery', featured: true, rating: 4.9, ownerId: v1 },
    { name: 'ورشة النور لصيانة السيارات', nameEn: 'Al-Noor Car Service', cat: 'cars', phone: '01009876543', addr: 'فيصل، الجيزة', addrEn: 'Faisal, Giza', desc: 'صيانة شاملة وكشف كمبيوتر وقطع غيار أصلية', descEn: 'Full service, computer check & original parts', featured: true, rating: 4.7, ownerId: v2 },
    { name: 'سنتر النخبة التعليمي', nameEn: 'Elite Learning Center', cat: 'education', phone: '01001112233', addr: 'الدقي، الجيزة', addrEn: 'Dokki, Giza', desc: 'دروس تقوية لجميع المراحل ونخبة من المدرسين', descEn: 'Tutoring for all grades by elite teachers', featured: false, rating: 4.6, ownerId: null },
    { name: 'معرض الأناقة للأزياء', nameEn: 'Elegance Fashion Store', cat: 'fashion', phone: '01003334455', addr: 'المهندسين، الجيزة', addrEn: 'Mohandessin, Giza', desc: 'أحدث صيحات الموضة بأسعار منافسة', descEn: 'Latest fashion trends at fair prices', featured: false, rating: 4.5, ownerId: null },
    { name: 'شركة الأهرام للعقارات', nameEn: 'Al-Ahram Real Estate', cat: 'realestate', phone: '01005556677', addr: '6 أكتوبر، الجيزة', addrEn: '6th October, Giza', desc: 'شقق وفيلات للبيع والإيجار في كل الجيزة', descEn: 'Flats & villas for sale and rent across Giza', featured: true, rating: 4.8, ownerId: null },
    { name: 'مؤسسة البناء الحديث', nameEn: 'Modern Building Materials', cat: 'building', phone: '01006667788', addr: 'المنيب، الجيزة', addrEn: 'Moneeb, Giza', desc: 'أسمنت وحديد وطوب بأسعار الجملة وتوصيل للموقع', descEn: 'Wholesale cement, steel & bricks with site delivery', featured: false, rating: 4.6, ownerId: null },
    { name: 'الصفا للأدوات الصحية', nameEn: 'Al-Safa Sanitary Ware', cat: 'sanitary', phone: '01007778899', addr: 'فيصل، الجيزة', addrEn: 'Faisal, Giza', desc: 'أطقم حمامات وخلاطات وسيراميك بأحدث الموديلات', descEn: 'Bathroom sets, mixers & ceramics, latest models', featured: false, rating: 4.5, ownerId: null },
    { name: 'النور للأدوات الكهربائية', nameEn: 'Al-Noor Electrical Tools', cat: 'electrical', phone: '01008889900', addr: 'العتبة، الجيزة', addrEn: 'Ataba, Giza', desc: 'أسلاك ومفاتيح ولوحات وكشافات بضمان معتمد', descEn: 'Wires, switches, panels & lights with warranty', featured: false, rating: 4.7, ownerId: null },
    { name: 'مقاولات أبو العز', nameEn: 'Abu El-Ezz Contracting', cat: 'workshop', phone: '01009990011', addr: 'الهرم، الجيزة', addrEn: 'Haram, Giza', desc: 'تشطيبات وترميمات ودهانات بأيدي محترفة', descEn: 'Finishing, restoration & painting by pros', featured: false, rating: 4.6, ownerId: null },
    { name: 'عمالة اليوم الواحد', nameEn: 'Daily Labor Services', cat: 'labor', phone: '01000001111', addr: 'الجيزة', addrEn: 'Giza', desc: 'عمال بناء ونظافة وتحميل باليومية مع ضمان الالتزام', descEn: 'Construction, cleaning & loading day labor', featured: false, rating: 4.4, ownerId: null },
    { name: 'بولمان الجيزة للسفريات', nameEn: 'Giza Coach Travel', cat: 'bus', phone: '01000002222', addr: 'ميدان الجيزة', addrEn: 'Giza Square', desc: 'حجز أتوبيسات لجميع المحافظات يومياً', descEn: 'Daily coach booking to all governorates', featured: false, rating: 4.5, ownerId: null },
    { name: 'تاكسي الميدان', nameEn: 'Al-Midan Taxi', cat: 'taxi', phone: '01000003333', addr: 'الجيزة', addrEn: 'Giza', desc: 'تاكسي بالعداد وتوصيل للمطار على مدار الساعة', descEn: 'Metered taxi & airport transfers 24/7', featured: false, rating: 4.6, ownerId: null },
    { name: 'مكتبة المعرفة', nameEn: 'Knowledge Bookstore', cat: 'books', phone: '01000004444', addr: 'الدقي، الجيزة', addrEn: 'Dokki, Giza', desc: 'كتب مدرسية وقرطاسية وأدوات مكتبية', descEn: 'School books, stationery & office supplies', featured: false, rating: 4.7, ownerId: null },
    { name: 'صرافة النيل', nameEn: 'Nile Exchange', cat: 'exchange', phone: '01000005555', addr: 'المهندسين، الجيزة', addrEn: 'Mohandessin, Giza', desc: 'تحويل عملات بأفضل الأسعار وحوالات فورية', descEn: 'Best-rate currency exchange & instant transfers', featured: false, rating: 4.8, ownerId: null },
    { name: 'ديليفري السرعة', nameEn: 'Speed Delivery', cat: 'delivery', phone: '01000006666', addr: 'الجيزة', addrEn: 'Giza', desc: 'توصيل طلبات ومشاوير داخل الجيزة والقاهرة', descEn: 'Errands & order delivery across Giza & Cairo', featured: false, rating: 4.5, ownerId: null },
    { name: 'بقالة أولاد البلد', nameEn: 'Awlad El-Balad Grocery', cat: 'grocery', phone: '01000007777', addr: 'فيصل، الجيزة', addrEn: 'Faisal, Giza', desc: 'مواد غذائية ومنظفات وتوصيل للمنازل', descEn: 'Groceries & detergents with home delivery', featured: false, rating: 4.6, ownerId: null },
    { name: 'معامل الدقة للتحاليل', nameEn: 'Accuracy Labs', cat: 'lab', phone: '01000008888', addr: 'الدقي، الجيزة', addrEn: 'Dokki, Giza', desc: 'تحاليل طبية شاملة وسحب منزلي ونتائج واتساب', descEn: 'Full lab tests, home sampling, WhatsApp results', featured: false, rating: 4.9, ownerId: null },
    { name: 'عيادات الشفاء التخصصية', nameEn: 'Al-Shifa Clinics', cat: 'clinic', phone: '01000009999', addr: 'المهندسين، الجيزة', addrEn: 'Mohandessin, Giza', desc: 'باطنة وأطفال ونساء وحجز مسبق بدون انتظار', descEn: 'Internal, peds & gynae with prior booking', featured: false, rating: 4.7, ownerId: null },
    { name: 'مركز الابتسامة للأسنان', nameEn: 'Smile Dental Center', cat: 'dental', phone: '01000000001', addr: '6 أكتوبر، الجيزة', addrEn: '6th October, Giza', desc: 'تقويم وزراعة وتجميل أسنان بأحدث الأجهزة', descEn: 'Ortho, implants & cosmetic dentistry', featured: false, rating: 4.8, ownerId: null },
    { name: 'سوبر ماركت التوفير', nameEn: 'Saving Supermarket', cat: 'supermarket', phone: '01000000002', addr: 'الهرم، الجيزة', addrEn: 'Haram, Giza', desc: 'كل احتياجات البيت بأسعار الجملة وعروض أسبوعية', descEn: 'Everything home needs at wholesale prices', featured: false, rating: 4.6, ownerId: null },
    { name: 'خضار وفواكه الطازج', nameEn: 'Fresh Produce', cat: 'produce', phone: '01000000003', addr: 'فيصل، الجيزة', addrEn: 'Faisal, Giza', desc: 'خضار وفواكه طازجة يومياً من المزرعة', descEn: 'Daily fresh vegetables & fruits from farms', featured: false, rating: 4.7, ownerId: null },
    { name: 'النور للموبايلات والإنترنت', nameEn: 'Al-Noor Mobiles & Internet', cat: 'mobiles', phone: '01000000004', addr: 'فيصل، الجيزة', addrEn: 'Faisal, Giza', desc: 'موبايلات جديدة ومستعملة وراوترات وخطوط إنترنت وصيانة', descEn: 'New & used phones, routers, internet lines & repair', featured: false, rating: 4.6, ownerId: null }
  ];

  const bizIds = [];
  for (const b of businesses) {
    const r = await pool.query(
      `INSERT INTO businesses (owner_id, name, name_en, category, phone, whatsapp, address, address_en, description, description_en, featured, rating, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [b.ownerId, b.name, b.nameEn, b.cat, b.phone, b.phone, b.addr, b.addrEn, b.desc, b.descEn, b.featured, b.rating, daysAgo(40)]
    );
    bizIds.push(r.rows[0].id);
  }

  // Billing: store1 monthly active, store2 trial, store3 perOp
  const s1 = bizIds[0], s2 = bizIds[1], s3 = bizIds[2];
  const billingMonthly = (start, end, status) => JSON.stringify({ model: 'monthly', status, start, end, free_trial_used: true, free_trial_start: start, free_trial_end: end, opsCount: 0, opsDue: 0 });
  const billingPerOp = (opsCount, opsDue) => JSON.stringify({ model: 'perOp', status: 'active', start: daysAgo(12), end: null, free_trial_used: false, free_trial_start: null, free_trial_end: null, opsCount, opsDue });

  await pool.query(`UPDATE businesses SET billing = $1 WHERE id = $2`, [billingMonthly(daysAgo(10), daysFrom(20), 'active'), s1]);
  await pool.query(`UPDATE businesses SET billing = $1 WHERE id = $2`, [billingMonthly(daysAgo(5), daysFrom(25), 'trial'), s2]);
  await pool.query(`UPDATE businesses SET billing = $1 WHERE id = $2`, [billingPerOp(2, 10000), s3]);

  // Trials
  await pool.query(`INSERT INTO trials (key, business_id, used_at) VALUES ($1, $2, $3)`, [storeKey('مطعم البيت الدمشقي', '01001234567'), s1, daysAgo(40)]);
  await pool.query(`INSERT INTO trials (key, business_id, used_at) VALUES ($1, $2, $3)`, [storeKey('صيدلية الشفاء', '01007654321'), s2, daysAgo(5)]);

  // Subscriptions
  const sub1R = await pool.query(
    `INSERT INTO subscriptions (business_id, vendor_id, model, status, start, "end", amount, created_at)
     VALUES ($1,$2,'monthly','active',$3,$4,50000,$3) RETURNING id`,
    [s1, v1, daysAgo(10), daysFrom(20)]
  );
  await pool.query(
    `INSERT INTO subscriptions (business_id, vendor_id, model, status, start, "end", amount, created_at)
     VALUES ($1,$2,'monthly','trial',$3,$4,0,$3)`,
    [s2, v1, daysAgo(5), daysFrom(25)]
  );

  // Ledger: platform money (vendor -> platform)
  const sub1Id = sub1R.rows[0].id;
  await pool.query(
    `INSERT INTO ledger (vendor_id, business_id, transaction_type, amount, currency, payment_method, status, reference, subscription_id, created_at)
     VALUES ($1,$2,'monthly_subscription',50000,'SYP','platform','completed','TX-SEED-M1',$3,$4)`,
    [v1, s1, sub1Id, daysAgo(10)]
  );
  await pool.query(
    `INSERT INTO ledger (vendor_id, business_id, transaction_type, amount, currency, payment_method, status, reference, created_at)
     VALUES ($1,$2,'per_download',5000,'SYP','platform','completed','TX-SEED-P1',$3)`,
    [v2, s3, daysAgo(12)]
  );
  await pool.query(
    `INSERT INTO ledger (vendor_id, business_id, transaction_type, amount, currency, payment_method, status, reference, created_at)
     VALUES ($1,$2,'per_download',5000,'SYP','platform','completed','TX-SEED-P2',$3)`,
    [v2, s3, daysAgo(9)]
  );

  // Orders: customer -> vendor (NEVER platform money)
  await pool.query(
    `INSERT INTO orders (code, business_id, customer_name, user_id, phone, address, notes, method, amount, declared_amount, confirmed_amount, status, created_at)
     VALUES ('JZQ-9001',$1,'زبون دمشقي',$2,'0933333333','دمشق - المزة','وجبتان مشكل','cash',150000,150000,150000,'paid',$3)`,
    [s1, c1, daysAgo(2)]
  );
  await pool.query(
    `INSERT INTO orders (code, business_id, customer_name, user_id, phone, address, notes, method, amount, declared_amount, confirmed_amount, status, created_at)
     VALUES ('JZQ-9002',$1,'زبونة حمصية',$2,'0944444444','حلب - الفرقان','صيانة مكيف','sham',75000,75000,75000,'confirmed',$3)`,
    [s3, c2, daysAgo(1)]
  );
  await pool.query(
    `INSERT INTO orders (code, business_id, customer_name, user_id, phone, address, notes, method, amount, declared_amount, status, created_at)
     VALUES ('JZQ-9003',$1,'زبون دمشقي',$2,'0933333333','','توصيل دواء','syriatel',30000,30000,'pending',$3)`,
    [s2, c1, daysAgo(0)]
  );

  // Pay methods
  const payMethods = [
    ['cash', 'كاش (نقدي)', 'Cash'],
    ['sham', 'شام كاش', 'Sham Cash'],
    ['syriatel', 'سيريتل كاش', 'Syriatel Cash'],
    ['mtn', 'MTN كاش', 'MTN Cash'],
    ['bank', 'تحويل بنكي', 'Bank Transfer'],
    ['hawala', 'حوالة', 'Hawala']
  ];
  for (const [id, ar, en] of payMethods) {
    await pool.query(`INSERT INTO pay_methods (id, ar, en) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [id, ar, en]);
  }

  // Settings
  const defaultSettings = {
    currency: 'SYP', perOpPrice: 5000, monthlyPrice: 50000, yearlyPrice: 500000, trialDays: 30,
    models: { perOp: true, monthly: true, yearly: true }
  };
  await pool.query(`INSERT INTO settings (key, value) VALUES ('platform', $1) ON CONFLICT (key) DO NOTHING`, [JSON.stringify(defaultSettings)]);

  console.log('[sooq] Database seeded successfully');
}

// ---- init (runs once per cold start) ----
let _ready = null;
async function getDb() {
  if (!_ready) {
    _ready = ensureSchema().then(() => seedAll());
  }
  await _ready;
  return pool;
}

module.exports = { pool, getDb, hashPw, checkPw, genSalt, newToken, storeKey };
