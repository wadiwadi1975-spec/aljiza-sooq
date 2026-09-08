const bcrypt = require('bcryptjs');
const db = require('./db');

function run() {
  const userCount = db.prepare('SELECT COUNT(*) c FROM User').get().c;
  if (userCount > 0) {
    console.log('DB already seeded, skipping.');
    return;
  }

  const categories = [
    ['سيارات ومركبات', 'cars', '🚗'],
    ['عقارات', 'realestate', '🏠'],
    ['إلكترونيات', 'electronics', '💻'],
    ['موبايلات', 'mobiles', '📱'],
    ['أثاث', 'furniture', '🛋️'],
    ['ملابس وأزياء', 'fashion', '👗'],
    ['أحذية وحقائب', 'shoes-bags', '👜'],
    ['مجوهرات وذهب', 'jewelry', '💍'],
    ['عطور ومستحضرات', 'perfumes', '🧴'],
    ['سيراميك ومواد بناء', 'building', '🧱'],
    ['أدوات منزلية', 'home-tools', '🧰'],
    ['أجهزة كهربائية', 'appliances', '🔌'],
    ['أغذية ومشروبات', 'food', '🍽️'],
    ['خدمات', 'services', '🛠️'],
    ['مصانع وموردون', 'factories', '🏭'],
    ['أخرى', 'other', '📦'],
  ];
  const insCat = db.prepare('INSERT INTO Category (name, slug, icon) VALUES (?,?,?)');
  const catIds = {};
  for (const [name, slug, icon] of categories) {
    const r = insCat.run(name, slug, icon);
    catIds[slug] = r.lastInsertRowid;
  }

  const locations = [
    ['الجيزة', 'الدقي'],
    ['الجيزة', 'المهندسين'],
    ['الجيزة', '6 أكتوبر'],
    ['الجيزة', 'فيصل'],
    ['القاهرة', 'مدينة نصر'],
  ];
  const insLoc = db.prepare('INSERT INTO Location (city, area) VALUES (?,?)');
  const locIds = locations.map(([city, area]) => insLoc.run(city, area).lastInsertRowid);

  const insUser = db.prepare('INSERT INTO User (name, email, phone, password, role) VALUES (?,?,?,?,?)');
  const hash = (p) => bcrypt.hashSync(p, 10);

  const adminId = insUser.run('مدير المنصة', 'admin@aljeeza.com', '01000000000', hash('Admin@123'), 'admin').lastInsertRowid;

  const vendorUsers = [
    ['أحمد المصري', 'ahmed@example.com', '01011111111'],
    ['سارة عبد الله', 'sara@example.com', '01022222222'],
    ['محمد الجيزاوي', 'mohamed@example.com', '01033333333'],
  ];
  const insVendor = db.prepare('INSERT INTO Vendor (userId, status) VALUES (?, ?)');
  const insSub = db.prepare('INSERT INTO Subscription (vendorId, plan) VALUES (?, ?)');
  const vendorIds = vendorUsers.map(([name, email, phone]) => {
    const uid = insUser.run(name, email, phone, hash('Vendor@123'), 'vendor').lastInsertRowid;
    const vid = insVendor.run(uid, 'approved').lastInsertRowid;
    insSub.run(vid, 'free');
    return { uid, vid };
  });

  const buyerId = insUser.run('كريم سامي', 'karim@example.com', '01044444444', hash('Buyer@123'), 'buyer').lastInsertRowid;

  const insStore = db.prepare(`INSERT INTO Store (vendorId, name, description, coverImage, logoImage, locationId, phone, whatsapp, workHours, status)
    VALUES (?,?,?,?,?,?,?,?,?,?)`);

  const stores = [
    {
      vendorId: vendorIds[0].vid,
      name: 'معرض الأهرام للسيارات',
      description: 'معرض متخصص في بيع السيارات الجديدة والمستعملة بأفضل الأسعار وضمان شامل.',
      cover: 'https://images.unsplash.com/photo-1494905998402-395d579af36f?w=1200',
      logo: 'https://images.unsplash.com/photo-1449965408869-eaa3f722e40d?w=200',
      locationId: locIds[2],
      phone: '01011111111', whatsapp: '01011111111', hours: 'يوميًا 10ص - 10م',
    },
    {
      vendorId: vendorIds[1].vid,
      name: 'بيت الذهب والمجوهرات',
      description: 'أفخم تشكيلات الذهب والمجوهرات العيار 18 و21 بأسعار البورصة اليومية.',
      cover: 'https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?w=1200',
      logo: 'https://images.unsplash.com/photo-1611652022419-a9419f74343d?w=200',
      locationId: locIds[0],
      phone: '01022222222', whatsapp: '01022222222', hours: 'يوميًا 11ص - 11م',
    },
    {
      vendorId: vendorIds[2].vid,
      name: 'مصنع النيل للأثاث',
      description: 'تصنيع وتوريد الأثاث المنزلي والمكتبي بالجملة والقطاعي.',
      cover: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200',
      logo: 'https://images.unsplash.com/photo-1567016432779-094069958ea5?w=200',
      locationId: locIds[3],
      phone: '01033333333', whatsapp: '01033333333', hours: 'السبت-الخميس 9ص - 6م',
    },
  ];
  const storeIds = stores.map(s => insStore.run(s.vendorId, s.name, s.description, s.cover, s.logo, s.locationId, s.phone, s.whatsapp, s.hours, 'approved').lastInsertRowid);

  const insProduct = db.prepare(`INSERT INTO Product (storeId, categoryId, title, description, price, locationId, featured)
    VALUES (?,?,?,?,?,?,?)`);
  const insImg = db.prepare('INSERT INTO ProductImage (productId, url, sortOrder) VALUES (?,?,?)');

  const products = [
    { storeId: storeIds[0], cat: 'cars', title: 'تويوتا كورولا 2022', desc: 'سيارة بحالة ممتازة، فبريكة بالكامل، فل كامل.', price: 850000, loc: locIds[2], featured: 1,
      img: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800' },
    { storeId: storeIds[0], cat: 'cars', title: 'هيونداي إلنترا 2021', desc: 'وارد أوروبي، صيانة دورية بالوكيل.', price: 620000, loc: locIds[2], featured: 0,
      img: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?w=800' },
    { storeId: storeIds[1], cat: 'jewelry', title: 'طقم ذهب عيار 21', desc: 'طقم عروسة فاخر يشمل غردان وأسورة وحلق.', price: 145000, loc: locIds[0], featured: 1,
      img: 'https://images.unsplash.com/photo-1600721391776-b5cd0e0048f9?w=800' },
    { storeId: storeIds[1], cat: 'jewelry', title: 'خاتم ذهب أبيض عيار 18', desc: 'تصميم إيطالي أنيق مرصع بالزركون.', price: 12500, loc: locIds[0], featured: 0,
      img: 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?w=800' },
    { storeId: storeIds[2], cat: 'furniture', title: 'غرفة معيشة كلاسيك', desc: 'خشب زان طبيعي مع تنجيد فاخر، تفصيل حسب الطلب.', price: 45000, loc: locIds[3], featured: 1,
      img: 'https://images.unsplash.com/photo-1567538096630-e0c55bd6374c?w=800' },
    { storeId: storeIds[2], cat: 'furniture', title: 'مكتب إداري خشبي', desc: 'مناسب للمكاتب والشركات، مقاس كبير.', price: 8500, loc: locIds[3], featured: 0,
      img: 'https://images.unsplash.com/photo-1518455027359-f3f8164ba6bd?w=800' },
  ];
  const productIds = [];
  for (const p of products) {
    const pid = insProduct.run(p.storeId, catIds[p.cat], p.title, p.desc, p.price, p.loc, p.featured).lastInsertRowid;
    insImg.run(pid, p.img, 0);
    productIds.push(pid);
  }

  db.prepare('INSERT INTO Review (storeId, userId, rating, comment) VALUES (?,?,?,?)')
    .run(storeIds[0], buyerId, 5, 'تعامل ممتاز وسيارة مطابقة للمواصفات، شكرًا لكم.');
  db.prepare('INSERT INTO Review (storeId, userId, rating, comment) VALUES (?,?,?,?)')
    .run(storeIds[1], buyerId, 4, 'جودة الذهب ممتازة لكن الأسعار مرتفعة قليلًا.');

  db.prepare('INSERT INTO Favorite (userId, productId) VALUES (?,?)').run(buyerId, productIds[2]);
  db.prepare('INSERT INTO Follow (userId, storeId) VALUES (?,?)').run(buyerId, storeIds[0]);

  db.prepare('INSERT INTO Inquiry (productId, userId, message) VALUES (?,?,?)')
    .run(productIds[0], buyerId, 'هل السعر قابل للتفاوض؟ وهل يوجد فحص شامل؟');

  db.prepare('INSERT INTO Advertisement (type, targetType, targetId, status) VALUES (?,?,?,?)')
    .run('featured_product', 'product', productIds[0], 'active');
  db.prepare('INSERT INTO Advertisement (type, targetType, targetId, status) VALUES (?,?,?,?)')
    .run('featured_store', 'store', storeIds[1], 'active');

  console.log('Seed complete.');
  console.log('Admin login: admin@aljeeza.com / Admin@123');
  console.log('Vendor login example: ahmed@example.com / Vendor@123');
  console.log('Buyer login: karim@example.com / Buyer@123');
}

run();
