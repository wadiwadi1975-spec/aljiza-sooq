const express = require('express');
const bcrypt = require('bcryptjs');

module.exports = function (db) {
  const router = express.Router();

  router.get('/register', (req, res) => {
    res.render('register', { error: null, next: req.query.next || '/' });
  });

  router.post('/register', (req, res) => {
    const { name, email, phone, password, role, next } = req.body;
    if (!name || !email || !password) {
      return res.render('register', { error: 'الرجاء ملء جميع الحقول المطلوبة', next });
    }
    const existing = db.prepare('SELECT id FROM User WHERE email = ?').get(email);
    if (existing) {
      return res.render('register', { error: 'البريد الإلكتروني مستخدم بالفعل', next });
    }
    const hash = bcrypt.hashSync(password, 10);
    const finalRole = role === 'vendor' ? 'vendor' : 'buyer';
    const info = db.prepare('INSERT INTO User (name, email, phone, password, role) VALUES (?,?,?,?,?)')
      .run(name, email, phone || null, hash, finalRole);
    if (finalRole === 'vendor') {
      db.prepare('INSERT INTO Vendor (userId, status) VALUES (?, ?)').run(info.lastInsertRowid, 'pending');
    }
    req.session.userId = info.lastInsertRowid;
    res.redirect(next && next !== 'undefined' ? next : (finalRole === 'vendor' ? '/vendor' : '/'));
  });

  router.get('/login', (req, res) => {
    res.render('login', { error: null, next: req.query.next || '/' });
  });

  router.post('/login', (req, res) => {
    const { email, password, next } = req.body;
    const user = db.prepare('SELECT * FROM User WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.render('login', { error: 'البريد الإلكتروني أو كلمة المرور غير صحيحة', next });
    }
    req.session.userId = user.id;
    const dest = next && next !== 'undefined' ? next : (user.role === 'admin' ? '/admin' : user.role === 'vendor' ? '/vendor' : '/');
    res.redirect(dest);
  });

  router.post('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
  });

  return router;
};
