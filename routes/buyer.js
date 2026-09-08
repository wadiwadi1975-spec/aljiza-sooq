const express = require('express');

module.exports = function (db, { requireAuth }) {
  const router = express.Router();

  router.post('/favorite/:productId', requireAuth, (req, res) => {
    const { productId } = req.params;
    const existing = db.prepare('SELECT id FROM Favorite WHERE userId=? AND productId=?').get(req.user.id, productId);
    if (existing) {
      db.prepare('DELETE FROM Favorite WHERE id=?').run(existing.id);
    } else {
      db.prepare('INSERT INTO Favorite (userId, productId) VALUES (?,?)').run(req.user.id, productId);
    }
    res.redirect('back');
  });

  router.post('/follow/:storeId', requireAuth, (req, res) => {
    const { storeId } = req.params;
    const existing = db.prepare('SELECT id FROM Follow WHERE userId=? AND storeId=?').get(req.user.id, storeId);
    if (existing) {
      db.prepare('DELETE FROM Follow WHERE id=?').run(existing.id);
    } else {
      db.prepare('INSERT INTO Follow (userId, storeId) VALUES (?,?)').run(req.user.id, storeId);
    }
    res.redirect('back');
  });

  router.get('/favorites', requireAuth, (req, res) => {
    const favorites = db.prepare(`
      SELECT p.*, s.name as storeName, (SELECT url FROM ProductImage WHERE productId=p.id LIMIT 1) as image
      FROM Favorite f JOIN Product p ON p.id = f.productId JOIN Store s ON s.id = p.storeId
      WHERE f.userId = ? ORDER BY f.createdAt DESC`).all(req.user.id);
    res.render('favorites', { favorites });
  });

  router.post('/inquiry/:productId', requireAuth, (req, res) => {
    const { productId } = req.params;
    const { message } = req.body;
    const product = db.prepare('SELECT * FROM Product WHERE id=?').get(productId);
    if (product && message) {
      db.prepare('INSERT INTO Inquiry (productId, userId, message) VALUES (?,?,?)').run(productId, req.user.id, message);
      const store = db.prepare('SELECT s.*, v.userId as vendorUserId FROM Store s JOIN Vendor v ON v.id = s.vendorId WHERE s.id=?').get(product.storeId);
      if (store) {
        db.prepare('INSERT INTO Message (fromUserId, toUserId, storeId, productId, body) VALUES (?,?,?,?,?)')
          .run(req.user.id, store.vendorUserId, store.id, productId, message);
      }
    }
    res.redirect('/product/' + productId);
  });

  router.get('/messages', requireAuth, (req, res) => {
    const threads = db.prepare(`
      SELECT DISTINCT CASE WHEN fromUserId = ? THEN toUserId ELSE fromUserId END as otherUserId,
      storeId, productId
      FROM Message WHERE fromUserId = ? OR toUserId = ?
      ORDER BY id DESC`).all(req.user.id, req.user.id, req.user.id);

    const enriched = threads.map(t => {
      const other = db.prepare('SELECT id, name FROM User WHERE id=?').get(t.otherUserId);
      const lastMsg = db.prepare(`
        SELECT * FROM Message WHERE (fromUserId=? AND toUserId=?) OR (fromUserId=? AND toUserId=?)
        ORDER BY id DESC LIMIT 1`).get(req.user.id, t.otherUserId, t.otherUserId, req.user.id);
      return { ...t, other, lastMsg };
    });
    res.render('messages', { threads: enriched });
  });

  router.get('/messages/:userId', requireAuth, (req, res) => {
    const otherId = req.params.userId;
    const other = db.prepare('SELECT id, name FROM User WHERE id=?').get(otherId);
    if (!other) return res.status(404).render('error', { message: 'المستخدم غير موجود' });
    const msgs = db.prepare(`
      SELECT m.*, u.name as fromName FROM Message m JOIN User u ON u.id = m.fromUserId
      WHERE (fromUserId=? AND toUserId=?) OR (fromUserId=? AND toUserId=?)
      ORDER BY m.id ASC`).all(req.user.id, otherId, otherId, req.user.id);
    res.render('conversation', { other, msgs });
  });

  router.post('/messages/:userId', requireAuth, (req, res) => {
    const otherId = req.params.userId;
    const { body, storeId, productId } = req.body;
    if (body && body.trim()) {
      db.prepare('INSERT INTO Message (fromUserId, toUserId, storeId, productId, body) VALUES (?,?,?,?,?)')
        .run(req.user.id, otherId, storeId || null, productId || null, body.trim());
    }
    res.redirect('/messages/' + otherId);
  });

  router.post('/review/:storeId', requireAuth, (req, res) => {
    const { storeId } = req.params;
    const { rating, comment } = req.body;
    const existing = db.prepare('SELECT id FROM Review WHERE storeId=? AND userId=?').get(storeId, req.user.id);
    if (existing) {
      db.prepare('UPDATE Review SET rating=?, comment=?, createdAt=datetime(\'now\') WHERE id=?')
        .run(rating, comment, existing.id);
    } else {
      db.prepare('INSERT INTO Review (storeId, userId, rating, comment) VALUES (?,?,?,?)')
        .run(storeId, req.user.id, rating, comment);
    }
    res.redirect('/store/' + storeId);
  });

  router.post('/report', requireAuth, (req, res) => {
    const { targetType, targetId, reason, back } = req.body;
    db.prepare('INSERT INTO Report (reporterId, targetType, targetId, reason) VALUES (?,?,?,?)')
      .run(req.user.id, targetType, targetId, reason);
    res.redirect(back || '/');
  });

  return router;
};
