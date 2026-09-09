const crypto = require('crypto');
let _idSeq = 100;
function nextId() { return ++_idSeq; }
function genSalt() { return crypto.randomBytes(8).toString('hex'); }
function hashPw(password, salt) { return crypto.createHash('sha256').update(salt + '::' + password).digest('hex'); }
function newToken() { return 'sooq_' + crypto.randomBytes(16).toString('hex'); }
// Store identity key for once-only free trial (survives account delete/recreate)
function storeKey(name, phone) {
  return crypto.createHash('sha256').update(String(name || '').trim() + '||' + String(phone || '').replace(/\D/g, '')).digest('hex');
}

const _adminSalt = genSalt();
const db = {
  users: [
    { id: 'u-admin', fullName: 'مدير المنصة', phone: '0999999999', salt: _adminSalt, passHash: hashPw('admin123', _adminSalt), role: 'admin', createdAt: new Date().toISOString() }
  ],
  sessions: {}, // token -> { userId, createdAt }
  settings: {
    currency: 'SYP',
    perOpPrice: 5000,
    monthlyPrice: 50000,
    yearlyPrice: 500000,
    trialDays: 30,
    models: { perOp: true, monthly: true, yearly: true }
  },
  ledger: [], // platform money ONLY (vendor -> platform). NEVER customer order amounts.
  trials: [], // { key, businessId, usedAt } — once-only free trial registry
  subscriptions: [],
  businesses: [
    { id: 1, name: 'مطعم البيت الدمشقي', nameEn: 'Damascus House Restaurant', category: 'food', phone: '01001234567', whatsapp: '01001234567', address: 'شارع الهرم، الجيزة', addressEn: 'Haram St, Giza', description: 'أشهى المأكولات الشامية والمشويات على الفحم', descriptionEn: 'Tasty levantine dishes & charcoal grills', image: '', featured: true, rating: 4.8, createdAt: new Date().toISOString() },
    { id: 2, name: 'صيدلية الشفاء', nameEn: 'Al-Shifa Pharmacy', category: 'health', phone: '01007654321', whatsapp: '01007654321', address: 'ميدان الجيزة', addressEn: 'Giza Square', description: 'توصيل الأدوية للمنازل على مدار الساعة', descriptionEn: '24/7 home medicine delivery', image: '', featured: true, rating: 4.9, createdAt: new Date().toISOString() },
    { id: 3, name: 'ورشة النور لصيانة السيارات', nameEn: 'Al-Noor Car Service', category: 'cars', phone: '01009876543', whatsapp: '01009876543', address: 'فيصل، الجيزة', addressEn: 'Faisal, Giza', description: 'صيانة شاملة وكشف كمبيوتر وقطع غيار أصلية', descriptionEn: 'Full service, computer check & original parts', image: '', featured: true, rating: 4.7, createdAt: new Date().toISOString() },
    { id: 4, name: 'سنتر النخبة التعليمي', nameEn: 'Elite Learning Center', category: 'education', phone: '01001112233', whatsapp: '01001112233', address: 'الدقي، الجيزة', addressEn: 'Dokki, Giza', description: 'دروس تقوية لجميع المراحل ونخبة من المدرسين', descriptionEn: 'Tutoring for all grades by elite teachers', image: '', featured: false, rating: 4.6, createdAt: new Date().toISOString() },
    { id: 5, name: 'معرض الأناقة للأزياء', nameEn: 'Elegance Fashion Store', category: 'fashion', phone: '01003334455', whatsapp: '01003334455', address: 'المهندسين، الجيزة', addressEn: 'Mohandessin, Giza', description: 'أحدث صيحات الموضة بأسعار منافسة', descriptionEn: 'Latest fashion trends at fair prices', image: '', featured: false, rating: 4.5, createdAt: new Date().toISOString() },
    { id: 6, name: 'شركة الأهرام للعقارات', nameEn: 'Al-Ahram Real Estate', category: 'realestate', phone: '01005556677', whatsapp: '01005556677', address: '6 أكتوبر، الجيزة', addressEn: '6th October, Giza', description: 'شقق وفيلات للبيع والإيجار في كل الجيزة', descriptionEn: 'Flats & villas for sale and rent across Giza', image: '', featured: true, rating: 4.8, createdAt: new Date().toISOString() },
    { id: 7, name: 'مؤسسة البناء الحديث', nameEn: 'Modern Building Materials', category: 'building', phone: '01006667788', whatsapp: '01006667788', address: 'المنيب، الجيزة', addressEn: 'Moneeb, Giza', description: 'أسمنت وحديد وطوب بأسعار الجملة وتوصيل للموقع', descriptionEn: 'Wholesale cement, steel & bricks with site delivery', image: '', featured: false, rating: 4.6, createdAt: new Date().toISOString() },
    { id: 8, name: 'الصفا للأدوات الصحية', nameEn: 'Al-Safa Sanitary Ware', category: 'sanitary', phone: '01007778899', whatsapp: '01007778899', address: 'فيصل، الجيزة', addressEn: 'Faisal, Giza', description: 'أطقم حمامات وخلاطات وسيراميك بأحدث الموديلات', descriptionEn: 'Bathroom sets, mixers & ceramics, latest models', image: '', featured: false, rating: 4.5, createdAt: new Date().toISOString() },
    { id: 9, name: 'النور للأدوات الكهربائية', nameEn: 'Al-Noor Electrical Tools', category: 'electrical', phone: '01008889900', whatsapp: '01008889900', address: 'العتبة، الجيزة', addressEn: 'Ataba, Giza', description: 'أسلاك ومفاتيح ولوحات وكشافات بضمان معتمد', descriptionEn: 'Wires, switches, panels & lights with warranty', image: '', featured: false, rating: 4.7, createdAt: new Date().toISOString() },
    { id: 10, name: 'مقاولات أبو العز', nameEn: 'Abu El-Ezz Contracting', category: 'workshop', phone: '01009990011', whatsapp: '01009990011', address: 'الهرم، الجيزة', addressEn: 'Haram, Giza', description: 'تشطيبات وترميمات ودهانات بأيدي محترفة', descriptionEn: 'Finishing, restoration & painting by pros', image: '', featured: false, rating: 4.6, createdAt: new Date().toISOString() },
    { id: 11, name: 'عمالة اليوم الواحد', nameEn: 'Daily Labor Services', category: 'labor', phone: '01000001111', whatsapp: '01000001111', address: 'الجيزة', addressEn: 'Giza', description: 'عمال بناء ونظافة وتحميل باليومية مع ضمان الالتزام', descriptionEn: 'Construction, cleaning & loading day labor', image: '', featured: false, rating: 4.4, createdAt: new Date().toISOString() },
    { id: 12, name: 'بولمان الجيزة للسفريات', nameEn: 'Giza Coach Travel', category: 'bus', phone: '01000002222', whatsapp: '01000002222', address: 'ميدان الجيزة', addressEn: 'Giza Square', description: 'حجز أتوبيسات لجميع المحافظات يومياً', descriptionEn: 'Daily coach booking to all governorates', image: '', featured: false, rating: 4.5, createdAt: new Date().toISOString() },
    { id: 13, name: 'تاكسي الميدان', nameEn: 'Al-Midan Taxi', category: 'taxi', phone: '01000003333', whatsapp: '01000003333', address: 'الجيزة', addressEn: 'Giza', description: 'تاكسي بالعداد وتوصيل للمطار على مدار الساعة', descriptionEn: 'Metered taxi & airport transfers 24/7', image: '', featured: false, rating: 4.6, createdAt: new Date().toISOString() },
    { id: 14, name: 'مكتبة المعرفة', nameEn: 'Knowledge Bookstore', category: 'books', phone: '01000004444', whatsapp: '01000004444', address: 'الدقي، الجيزة', addressEn: 'Dokki, Giza', description: 'كتب مدرسية وقرطاسية وأدوات مكتبية', descriptionEn: 'School books, stationery & office supplies', image: '', featured: false, rating: 4.7, createdAt: new Date().toISOString() },
    { id: 15, name: 'صرافة النيل', nameEn: 'Nile Exchange', category: 'exchange', phone: '01000005555', whatsapp: '01000005555', address: 'المهندسين، الجيزة', addressEn: 'Mohandessin, Giza', description: 'تحويل عملات بأفضل الأسعار وحوالات فورية', descriptionEn: 'Best-rate currency exchange & instant transfers', image: '', featured: false, rating: 4.8, createdAt: new Date().toISOString() },
    { id: 16, name: 'ديليفري السرعة', nameEn: 'Speed Delivery', category: 'delivery', phone: '01000006666', whatsapp: '01000006666', address: 'الجيزة', addressEn: 'Giza', description: 'توصيل طلبات ومشاوير داخل الجيزة والقاهرة', descriptionEn: 'Errands & order delivery across Giza & Cairo', image: '', featured: false, rating: 4.5, createdAt: new Date().toISOString() },
    { id: 17, name: 'بقالة أولاد البلد', nameEn: 'Awlad El-Balad Grocery', category: 'grocery', phone: '01000007777', whatsapp: '01000007777', address: 'فيصل، الجيزة', addressEn: 'Faisal, Giza', description: 'مواد غذائية ومنظفات وتوصيل للمنازل', descriptionEn: 'Groceries & detergents with home delivery', image: '', featured: false, rating: 4.6, createdAt: new Date().toISOString() },
    { id: 18, name: 'معامل الدقة للتحاليل', nameEn: 'Accuracy Labs', category: 'lab', phone: '01000008888', whatsapp: '01000008888', address: 'الدقي، الجيزة', addressEn: 'Dokki, Giza', description: 'تحاليل طبية شاملة وسحب منزلي ونتائج واتساب', descriptionEn: 'Full lab tests, home sampling, WhatsApp results', image: '', featured: false, rating: 4.9, createdAt: new Date().toISOString() },
    { id: 19, name: 'عيادات الشفاء التخصصية', nameEn: 'Al-Shifa Clinics', category: 'clinic', phone: '01000009999', whatsapp: '01000009999', address: 'المهندسين، الجيزة', addressEn: 'Mohandessin, Giza', description: 'باطنة وأطفال ونساء وحجز مسبق بدون انتظار', descriptionEn: 'Internal, peds & gynae with prior booking', image: '', featured: false, rating: 4.7, createdAt: new Date().toISOString() },
    { id: 20, name: 'مركز الابتسامة للأسنان', nameEn: 'Smile Dental Center', category: 'dental', phone: '01000000001', whatsapp: '01000000001', address: '6 أكتوبر، الجيزة', addressEn: '6th October, Giza', description: 'تقويم وزراعة وتجميل أسنان بأحدث الأجهزة', descriptionEn: 'Ortho, implants & cosmetic dentistry', image: '', featured: false, rating: 4.8, createdAt: new Date().toISOString() },
    { id: 21, name: 'سوبر ماركت التوفير', nameEn: 'Saving Supermarket', category: 'supermarket', phone: '01000000002', whatsapp: '01000000002', address: 'الهرم، الجيزة', addressEn: 'Haram, Giza', description: 'كل احتياجات البيت بأسعار الجملة وعروض أسبوعية', descriptionEn: 'Everything home needs at wholesale prices', image: '', featured: false, rating: 4.6, createdAt: new Date().toISOString() },
    { id: 22, name: 'خضار وفواكه الطازج', nameEn: 'Fresh Produce', category: 'produce', phone: '01000000003', whatsapp: '01000000003', address: 'فيصل، الجيزة', addressEn: 'Faisal, Giza', description: 'خضار وفواكه طازجة يومياً من المزرعة', descriptionEn: 'Daily fresh vegetables & fruits from farms', image: '', featured: false, rating: 4.7, createdAt: new Date().toISOString() },
    { id: 23, name: 'النور للموبايلات والإنترنت', nameEn: 'Al-Noor Mobiles & Internet', category: 'mobiles', phone: '01000000004', whatsapp: '01000000004', address: 'فيصل، الجيزة', addressEn: 'Faisal, Giza', description: 'موبايلات جديدة ومستعملة وراوترات وخطوط إنترنت وصيانة', descriptionEn: 'New & used phones, routers, internet lines & repair', image: '', featured: false, rating: 4.6, createdAt: new Date().toISOString() }
  ],
  inquiries: [
    { id: 1, businessId: 1, name: 'زائر تجريبي', phone: '01000000000', message: 'هل يوجد توصيل للمهندسين؟', createdAt: new Date().toISOString(), read: false }
  ],
  orders: [
    { id: 1, code: 'JZQ-1001', businessId: 1, customerName: 'زبون تجريبي', phone: '0955000000', address: 'دمشق - المزة', notes: 'وجبتان مشكل', method: 'cash', amount: 150000, status: 'pending', createdAt: new Date().toISOString() }
  ],
  payMethods: [
    { id: 'cash', ar: '💵 كاش (نقدي)', en: '💵 Cash' },
    { id: 'sham', ar: '💠 شام كاش', en: '💠 Sham Cash' },
    { id: 'syriatel', ar: '📱 سيريتل كاش', en: '📱 Syriatel Cash' },
    { id: 'mtn', ar: '📱 MTN كاش', en: '📱 MTN Cash' },
    { id: 'bank', ar: '🏦 تحويل بنكي', en: '🏦 Bank Transfer' },
    { id: 'hawala', ar: '💸 حوالة', en: '💸 Hawala' }
  ]
};

module.exports = { db, nextId, genSalt, hashPw, newToken, storeKey };
