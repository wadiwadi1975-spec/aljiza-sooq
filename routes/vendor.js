const express = require('express');

module.exports = function (db, { requireApprovedVendor, upload }) {
  const router = express.Router();
  router.use(requireApprovedVendor);

  function getStore(vendorId) {
    return db.prepare('SELECT * FROM Store WHERE vendorId = ?').get(vendorId);
  }

  router.get('/', (req, res) => {
    const store = getStore(req.vendor.id);
    let stats = { products: 0, views: 0, inquiries: 0, messages: 0, followers: 0, rating: null, featured: 0 };
    let recentInquiries = [];
    if (store) {
      stats.products = db.prepare('SELECT COUNT(*) c FROM Product WHERE storeId=?').get(store.id).c;
      stats.views = db.prepare('SELECT COALESCE(SUM(views),0) v FROM Product WHERE storeId=?').get(store.id).v;
      stats.inquiries = db.prepare(`SELECT COUNT(*) c FROM Inquiry i JOIN Product p ON p.id=i.productId WHERE p.storeId=?`).get(store.id).c;
      stats.messages = db.prepare('SELECT COUNT(*) c FROM Message WHERE toUserId=?').get(req.user.id).c;
      stats.followers = db.prepare('SELECT COUNT(*) c FROM Follow WHERE storeId=?').get(store.id).c;
      stats.featured = db.prepare('SELECT COUNT(*) c FROM Product WHERE storeId=? AND featured=1').get(store.id).c;
      const rv = db.prepare("SELECT AVG(rating) a, COUNT(*) c FROM Review WHERE storeId=? AND status='visible'").get(store.id);
      stats.rating = rv.c ? rv.a.toFixed(1) : null;
      recentInquiries = db.prepare(`
        SELECT i.*, p.title as productTitle, u.name as userName FROM Inquiry i
        JOIN Product p ON p.id = i.productId JOIN User u ON u.id = i.userId
        WHERE p.storeId = ? ORDER BY i.createdAt DESC LIMIT 5`).all(store.id);
    }
    res.render('vendor/dashboard', { store, stats, recentInquiries, vendor: req.vendor });
  });

  router.get('/store', (req, res) => {
    const store = getStore(req.vendor.id);
    const locations = db.prepare('SELECT * FROM Location ORDER BY city, area').all();
    res.render('vendor/store-form', { store, locations, error: null });
  });

  router.post('/store', upload.fields([{ name: 'cover', maxCount: 1 }, { name: 'logo', maxCount: 1 }]), (req, res) => {
    const { name, description, locationId, phone, whatsapp, workHours } = req.body;
    const existing = getStore(req.vendor.id);
    const coverPath = req.files && req.files.cover ? '/public/uploads/' + req.files.cover[0].filename : (existing ? existing.coverImage : null);
    const logoPath = req.files && req.files.logo ? '/public/uploads/' + req.files.logo[0].filename : (existing ? existing.logoImage : null);

    if (existing) {
      db.prepare(`UPDATE Store SET name=?, description=?, coverImage=?, logoImage=?, locationId=?, phone=?, whatsapp=?, workHours=? WHERE id=?`)
        .run(name, description, coverPath, logoPath, locationId || null, phone, whatsapp, workHours, existing.id);
    } else {
      db.prepare(`INSERT INTO Store (vendorId, name, description, coverImage, logoImage, locationId, phone, whatsapp, workHours, status)
        VALUES (?,?,?,?,?,?,?,?,?, 'pending')`)
        .run(req.vendor.id, name, description, coverPath, logoPath, locationId || null, phone, whatsapp, workHours);
    }
    res.redirect('/vendor');
  });

  router.get('/products', (req, res) => {
    const store = getStore(req.vendor.id);
    if (!store) return res.redirect('/vendor/store');
    const products = db.prepare(`
      SELECT p.*, c.name as categoryName, (SELECT url FROM ProductImage WHERE productId=p.id LIMIT 1) as image
      FROM Product p LEFT JOIN Category c ON c.id = p.categoryId
      WHERE p.storeId = ? ORDER BY p.createdAt DESC`).all(store.id);
    res.render('vendor/products', { products, store });
  });

  router.get('/products/new', (req, res) => {
    const store = getStore(req.vendor.id);
    if (!store) return res.redirect('/vendor/store');
    const categories = db.prepare('SELECT * FROM Category ORDER BY name').all();
    const locations = db.prepare('SELECT * FROM Location ORDER BY city, area').all();
    res.render('vendor/product-form', { product: null, categories, locations, images: [] });
  });

  router.post('/products/new', upload.array('images', 6), (req, res) => {
    const store = getStore(req.vendor.id);
    if (!store) return res.redirect('/vendor/store');
    const { title, description, price, categoryId, locationId } = req.body;
    const info = db.prepare(`INSERT INTO Product (storeId, categoryId, title, description, price, locationId) VALUES (?,?,?,?,?,?)`)
      .run(store.id, categoryId || null, title, description, price || null, locationId || null);
    (req.files || []).forEach((f, idx) => {
      db.prepare('INSERT INTO ProductImage (productId, url, sortOrder) VALUES (?,?,?)')
        .run(info.lastInsertRowid, '/public/uploads/' + f.filename, idx);
    });
    res.redirect('/vendor/products');
  });

  function ownsProduct(req, res, next) {
    const store = getStore(req.vendor.id);
    const product = store && db.prepare('SELECT * FROM Product WHERE id=? AND storeId=?').get(req.params.id, store.id);
    if (!product) return res.status(403).render('error', { message: 'لا تملك صلاحية تعديل هذا المنتج' });
    req.product = product;
    req.store = store;
    next();
  }

  router.get('/products/:id/edit', ownsProduct, (req, res) => {
    const categories = db.prepare('SELECT * FROM Category ORDER BY name').all();
    const locations = db.prepare('SELECT * FROM Location ORDER BY city, area').all();
    const images = db.prepare('SELECT * FROM ProductImage WHERE productId=? ORDER BY sortOrder').all(req.product.id);
    res.render('vendor/product-form', { product: req.product, categories, locations, images });
  });

  router.post('/products/:id/edit', ownsProduct, upload.array('images', 6), (req, res) => {
    const { title, description, price, categoryId, locationId, status } = req.body;
    db.prepare(`UPDATE Product SET title=?, description=?, price=?, categoryId=?, locationId=?, status=? WHERE id=?`)
      .run(title, description, price || null, categoryId || null, locationId || null, status || 'active', req.product.id);
    (req.files || []).forEach((f, idx) => {
      db.prepare('INSERT INTO ProductImage (productId, url, sortOrder) VALUES (?,?,?)')
        .run(req.product.id, '/public/uploads/' + f.filename, idx + 100);
    });
    res.redirect('/vendor/products');
  });

  router.post('/products/:id/delete', ownsProduct, (req, res) => {
    db.prepare('DELETE FROM ProductImage WHERE productId=?').run(req.product.id);
    db.prepare('DELETE FROM Favorite WHERE productId=?').run(req.product.id);
    db.prepare('DELETE FROM Product WHERE id=?').run(req.product.id);
    res.redirect('/vendor/products');
  });

  router.get('/inquiries', (req, res) => {
    const store = getStore(req.vendor.id);
    const inquiries = store ? db.prepare(`
      SELECT i.*, p.title as productTitle, u.name as userName, u.phone as userPhone
      FROM Inquiry i JOIN Product p ON p.id = i.productId JOIN User u ON u.id = i.userId
      WHERE p.storeId = ? ORDER BY i.createdAt DESC`).all(store.id) : [];
    res.render('vendor/inquiries', { inquiries });
  });

  return router;
};
