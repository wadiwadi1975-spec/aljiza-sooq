const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const path = require('path');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

app.use(session({
  store: new SQLiteStore({ db: 'sessions.db', dir: path.join(__dirname, 'data') }),
  secret: process.env.SESSION_SECRET || 'aljeeza-sooq-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 },
}));

// current user + shared locals
app.use((req, res, next) => {
  if (req.session.userId) {
    const user = db.prepare('SELECT * FROM User WHERE id = ?').get(req.session.userId);
    req.user = user;
  }
  res.locals.currentUser = req.user || null;
  res.locals.categories = db.prepare('SELECT * FROM Category ORDER BY name').all();
  next();
});

function requireAuth(req, res, next) {
  if (!req.user) return res.redirect('/login?next=' + encodeURIComponent(req.originalUrl));
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return res.status(403).render('error', { message: 'ليس لديك صلاحية الوصول لهذه الصفحة' });
    next();
  };
}
function requireApprovedVendor(req, res, next) {
  if (!req.user || req.user.role !== 'vendor') return res.status(403).render('error', { message: 'يجب أن تكون عارضًا للوصول لهذه الصفحة' });
  const vendor = db.prepare('SELECT * FROM Vendor WHERE userId = ?').get(req.user.id);
  if (!vendor) return res.status(403).render('error', { message: 'حساب العارض غير موجود' });
  req.vendor = vendor;
  next();
}

const upload = multer({ dest: path.join(__dirname, 'public', 'uploads'), limits: { fileSize: 5 * 1024 * 1024 } });

app.locals.upload = upload;
app.locals.requireAuth = requireAuth;
app.locals.requireRole = requireRole;
app.locals.requireApprovedVendor = requireApprovedVendor;

app.use('/', require('./routes/public')(db));
app.use('/', require('./routes/auth')(db));
app.use('/', require('./routes/buyer')(db, { requireAuth }));
app.use('/vendor', require('./routes/vendor')(db, { requireApprovedVendor, upload }));
app.use('/admin', require('./routes/admin')(db, { requireRole }));

app.use((req, res) => res.status(404).render('error', { message: 'الصفحة غير موجودة' }));

app.listen(PORT, () => {
  console.log(`AlJeeza Sooq يعمل على المنفذ ${PORT}`);
});
