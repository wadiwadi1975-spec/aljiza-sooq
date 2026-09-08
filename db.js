const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'data', 'aljeeza.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS User (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'buyer', -- buyer | vendor | admin
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Location (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  city TEXT NOT NULL,
  area TEXT
);

CREATE TABLE IF NOT EXISTS Category (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  icon TEXT
);

CREATE TABLE IF NOT EXISTS Vendor (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES User(id),
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | suspended
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Store (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendorId INTEGER NOT NULL REFERENCES Vendor(id),
  name TEXT NOT NULL,
  description TEXT,
  coverImage TEXT,
  logoImage TEXT,
  locationId INTEGER REFERENCES Location(id),
  phone TEXT,
  whatsapp TEXT,
  workHours TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storeId INTEGER NOT NULL REFERENCES Store(id),
  categoryId INTEGER REFERENCES Category(id),
  title TEXT NOT NULL,
  description TEXT,
  price REAL,
  locationId INTEGER REFERENCES Location(id),
  status TEXT NOT NULL DEFAULT 'active', -- active | hidden | sold
  featured INTEGER NOT NULL DEFAULT 0,
  views INTEGER NOT NULL DEFAULT 0,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ProductImage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  productId INTEGER NOT NULL REFERENCES Product(id),
  url TEXT NOT NULL,
  sortOrder INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS Favorite (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES User(id),
  productId INTEGER NOT NULL REFERENCES Product(id),
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, productId)
);

CREATE TABLE IF NOT EXISTS Follow (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES User(id),
  storeId INTEGER NOT NULL REFERENCES Store(id),
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(userId, storeId)
);

CREATE TABLE IF NOT EXISTS Inquiry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  productId INTEGER NOT NULL REFERENCES Product(id),
  userId INTEGER NOT NULL REFERENCES User(id),
  message TEXT NOT NULL,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Message (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fromUserId INTEGER NOT NULL REFERENCES User(id),
  toUserId INTEGER NOT NULL REFERENCES User(id),
  storeId INTEGER REFERENCES Store(id),
  productId INTEGER REFERENCES Product(id),
  body TEXT NOT NULL,
  readAt TEXT,
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Review (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  storeId INTEGER NOT NULL REFERENCES Store(id),
  userId INTEGER NOT NULL REFERENCES User(id),
  rating INTEGER NOT NULL,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'visible', -- visible | reported | removed
  createdAt TEXT DEFAULT (datetime('now')),
  UNIQUE(storeId, userId)
);

CREATE TABLE IF NOT EXISTS Report (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reporterId INTEGER NOT NULL REFERENCES User(id),
  targetType TEXT NOT NULL, -- product | store | review
  targetId INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open', -- open | resolved | dismissed
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Advertisement (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, -- featured_product | sponsored_product | featured_store | banner
  targetType TEXT NOT NULL, -- product | store
  targetId INTEGER NOT NULL,
  startDate TEXT,
  endDate TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Subscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendorId INTEGER NOT NULL REFERENCES Vendor(id),
  plan TEXT NOT NULL DEFAULT 'free', -- free | plus | pro
  startDate TEXT DEFAULT (datetime('now')),
  endDate TEXT,
  status TEXT NOT NULL DEFAULT 'active'
);
`);

module.exports = db;
