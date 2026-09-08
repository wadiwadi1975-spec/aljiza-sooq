const express = require('express');

module.exports = function (db, { requireRole }) {
  const router = express.Router();
  router.use(requireRole('admin'));

  router.get('/', (req, res) => {
    const stats = {
      users: db.prepare("SELECT COUNT(*) c FROM User WHERE role='buyer'").get().c,
      vendors: db.prepare('SELECT COUNT(*) c FROM Vendor').get().c,
      stores: db.prepare('SELECT COUNT(*) c FROM Store').get().c,
      products: db.prepare('SELECT COUNT(*) c FROM Product').get().c,
      newProducts: db.prepare("SELECT COUNT(*) c FROM Product WHERE createdAt >= datetime('now','-7 day')").get().c,
      pendingStores: db.prepare("SELECT COUNT(*) c FROM Store WHERE status='pending'").get().c,
      openReports: db.prepare("SELECT COUNT(*) c FROM Report WHERE status='open'").get().c,
      activeAds: db.prepare("SELECT COUNT(*) c FROM Advertisement WHERE status='active'").get().c,
    };
    const dailyActivity = db.prepare(`
      SELECT date(createdAt) as day, COUNT(*) as count FROM Product
      GROUP BY day ORDER BY day DESC LIMIT 7`).all();
    res.render('admin/dashboard', { stats, dailyActivity });
  });

  router.get('/users', (req, res) => {
    const users = db.prepare('SELECT * FROM User ORDER BY createdAt DESC').all();
    res.render('admin/users', { users });
  });

  router.post('/users/:id/role', (req, res) => {
    const { role } = req.body;
    db.prepare('UPDATE User SET role=? WHERE id=?').run(role, req.params.id);
    if (role === 'vendor' && !db.prepare('SELECT id FROM Vendor WHERE userId=?').get(req.params.id)) {
      db.prepare('INSERT INTO Vendor (userId, status) VALUES (?, ?)').run(req.params.id, 'pending');
    }
    res.redirect('/admin/users');
  });

  router.post('/users/:id/delete', (req, res) => {
    db.prepare('DELETE FROM User WHERE id=?').run(req.params.id);
    res.redirect('/admin/users');
  });

  router.get('/stores', (req, res) => {
    const stores = db.prepare(`
      SELECT s.*, u.name as ownerName, u.email as ownerEmail FROM Store s
      JOIN Vendor v ON v.id = s.vendorId JOIN User u ON u.id = v.userId
      ORDER BY s.createdAt DESC`).all();
    res.render('admin/stores', { stores });
  });

  router.post('/stores/:id/status', (req, res) => {
    const { status } = req.body;
    db.prepare('UPDATE Store SET status=? WHERE id=?').run(status, req.params.id);
    res.redirect('/admin/stores');
  });

  router.get('/products', (req, res) => {
    const products = db.prepare(`
      SELECT p.*, s.name as storeName FROM Product p JOIN Store s ON s.id = p.storeId
      ORDER BY p.createdAt DESC`).all();
    res.render('admin/products', { products });
  });

  router.post('/products/:id/status', (req, res) => {
    const { status, featured } = req.body;
    if (status) db.prepare('UPDATE Product SET status=? WHERE id=?').run(status, req.params.id);
    if (featured !== undefined) db.prepare('UPDATE Product SET featured=? WHERE id=?').run(featured === 'on' ? 1 : 0, req.params.id);
    res.redirect('/admin/products');
  });

  router.get('/categories', (req, res) => {
    const categories = db.prepare('SELECT * FROM Category ORDER BY name').all();
    res.render('admin/categories', { categories });
  });

  router.post('/categories', (req, res) => {
    const { name, slug, icon } = req.body;
    db.prepare('INSERT INTO Category (name, slug, icon) VALUES (?,?,?)').run(name, slug, icon || '📦');
    res.redirect('/admin/categories');
  });

  router.post('/categories/:id/delete', (req, res) => {
    db.prepare('DELETE FROM Category WHERE id=?').run(req.params.id);
    res.redirect('/admin/categories');
  });

  router.get('/reports', (req, res) => {
    const reports = db.prepare(`
      SELECT r.*, u.name as reporterName FROM Report r JOIN User u ON u.id = r.reporterId
      ORDER BY r.createdAt DESC`).all();
    res.render('admin/reports', { reports });
  });

  router.post('/reports/:id/status', (req, res) => {
    const { status } = req.body;
    db.prepare('UPDATE Report SET status=? WHERE id=?').run(status, req.params.id);
    res.redirect('/admin/reports');
  });

  router.get('/reviews', (req, res) => {
    const reviews = db.prepare(`
      SELECT r.*, u.name as userName, s.name as storeName FROM Review r
      JOIN User u ON u.id = r.userId JOIN Store s ON s.id = r.storeId
      ORDER BY r.createdAt DESC`).all();
    res.render('admin/reviews', { reviews });
  });

  router.post('/reviews/:id/status', (req, res) => {
    const { status } = req.body;
    db.prepare('UPDATE Review SET status=? WHERE id=?').run(status, req.params.id);
    res.redirect('/admin/reviews');
  });

  router.get('/ads', (req, res) => {
    const ads = db.prepare('SELECT * FROM Advertisement ORDER BY createdAt DESC').all();
    res.render('admin/ads', { ads });
  });

  router.post('/ads', (req, res) => {
    const { type, targetType, targetId, startDate, endDate } = req.body;
    db.prepare('INSERT INTO Advertisement (type, targetType, targetId, startDate, endDate) VALUES (?,?,?,?,?)')
      .run(type, targetType, targetId, startDate || null, endDate || null);
    if (type === 'featured_product' && targetType === 'product') {
      db.prepare('UPDATE Product SET featured=1 WHERE id=?').run(targetId);
    }
    res.redirect('/admin/ads');
  });

  router.post('/ads/:id/status', (req, res) => {
    const { status } = req.body;
    db.prepare('UPDATE Advertisement SET status=? WHERE id=?').run(status, req.params.id);
    res.redirect('/admin/ads');
  });

  return router;
};
