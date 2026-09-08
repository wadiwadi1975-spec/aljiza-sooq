const express = require('express');

module.exports = function (db) {
  const router = express.Router();

  router.get('/', (req, res) => {
    const featuredProducts = db.prepare(`
      SELECT p.*, s.name as storeName, (SELECT url FROM ProductImage WHERE productId = p.id ORDER BY sortOrder LIMIT 1) as image
      FROM Product p JOIN Store s ON s.id = p.storeId
      WHERE p.status = 'active' AND p.featured = 1
      ORDER BY p.createdAt DESC LIMIT 8`).all();

    const latestProducts = db.prepare(`
      SELECT p.*, s.name as storeName, (SELECT url FROM ProductImage WHERE productId = p.id ORDER BY sortOrder LIMIT 1) as image
      FROM Product p JOIN Store s ON s.id = p.storeId
      WHERE p.status = 'active'
      ORDER BY p.createdAt DESC LIMIT 12`).all();

    const featuredStores = db.prepare(`
      SELECT st.*, (SELECT AVG(rating) FROM Review WHERE storeId = st.id AND status='visible') as avgRating,
      (SELECT COUNT(*) FROM Review WHERE storeId = st.id AND status='visible') as reviewCount
      FROM Store st WHERE st.status = 'approved'
      ORDER BY st.createdAt DESC LIMIT 6`).all();

    const categories = res.locals.categories;
    res.render('home', { featuredProducts, latestProducts, featuredStores, categories });
  });

  router.get('/search', (req, res) => {
    const { q, category, city, priceMin, priceMax, sort } = req.query;
    let sql = `
      SELECT p.*, s.name as storeName, l.city, l.area,
      (SELECT url FROM ProductImage WHERE productId = p.id ORDER BY sortOrder LIMIT 1) as image
      FROM Product p
      JOIN Store s ON s.id = p.storeId
      LEFT JOIN Location l ON l.id = p.locationId
      WHERE p.status = 'active'`;
    const params = [];
    if (q) { sql += ` AND (p.title LIKE ? OR p.description LIKE ?)`; params.push(`%${q}%`, `%${q}%`); }
    if (category) { sql += ` AND p.categoryId = (SELECT id FROM Category WHERE slug = ?)`; params.push(category); }
    if (city) { sql += ` AND l.city LIKE ?`; params.push(`%${city}%`); }
    if (priceMin) { sql += ` AND p.price >= ?`; params.push(Number(priceMin)); }
    if (priceMax) { sql += ` AND p.price <= ?`; params.push(Number(priceMax)); }
    sql += sort === 'price_asc' ? ` ORDER BY p.price ASC` :
           sort === 'price_desc' ? ` ORDER BY p.price DESC` :
           sort === 'featured' ? ` ORDER BY p.featured DESC, p.createdAt DESC` :
           ` ORDER BY p.createdAt DESC`;

    const results = db.prepare(sql).all(...params);
    res.render('search', { results, query: req.query });
  });

  router.get('/product/:id', (req, res) => {
    const product = db.prepare(`
      SELECT p.*, s.id as storeId, s.name as storeName, s.phone as storePhone, s.whatsapp as storeWhatsapp,
      s.logoImage as storeLogo, l.city, l.area, c.name as categoryName
      FROM Product p
      JOIN Store s ON s.id = p.storeId
      LEFT JOIN Location l ON l.id = p.locationId
      LEFT JOIN Category c ON c.id = p.categoryId
      WHERE p.id = ?`).get(req.params.id);
    if (!product) return res.status(404).render('error', { message: 'المنتج غير موجود' });

    db.prepare('UPDATE Product SET views = views + 1 WHERE id = ?').run(product.id);
    const images = db.prepare('SELECT * FROM ProductImage WHERE productId = ? ORDER BY sortOrder').all(product.id);
    const similar = db.prepare(`
      SELECT p.*, (SELECT url FROM ProductImage WHERE productId = p.id LIMIT 1) as image
      FROM Product p WHERE p.categoryId = ? AND p.id != ? AND p.status='active' LIMIT 4`)
      .all(product.categoryId, product.id);
    const reviews = db.prepare(`
      SELECT r.*, u.name as userName FROM Review r JOIN User u ON u.id = r.userId
      WHERE r.storeId = ? AND r.status = 'visible' ORDER BY r.createdAt DESC`).all(product.storeId);
    const avgRating = reviews.length ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1) : null;

    let isFavorite = false;
    if (req.user) {
      isFavorite = !!db.prepare('SELECT 1 FROM Favorite WHERE userId=? AND productId=?').get(req.user.id, product.id);
    }

    res.render('product', { product, images, similar, reviews, avgRating, isFavorite });
  });

  router.get('/store/:id', (req, res) => {
    const store = db.prepare(`
      SELECT s.*, l.city, l.area FROM Store s LEFT JOIN Location l ON l.id = s.locationId WHERE s.id = ?`)
      .get(req.params.id);
    if (!store) return res.status(404).render('error', { message: 'المتجر غير موجود' });

    const products = db.prepare(`
      SELECT p.*, (SELECT url FROM ProductImage WHERE productId = p.id ORDER BY sortOrder LIMIT 1) as image
      FROM Product p WHERE p.storeId = ? AND p.status='active' ORDER BY p.createdAt DESC`).all(store.id);
    const reviews = db.prepare(`
      SELECT r.*, u.name as userName FROM Review r JOIN User u ON u.id = r.userId
      WHERE r.storeId = ? AND r.status = 'visible' ORDER BY r.createdAt DESC`).all(store.id);
    const avgRating = reviews.length ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1) : null;

    let isFollowing = false;
    if (req.user) {
      isFollowing = !!db.prepare('SELECT 1 FROM Follow WHERE userId=? AND storeId=?').get(req.user.id, store.id);
    }

    res.render('store', { store, products, reviews, avgRating, isFollowing });
  });

  return router;
};
