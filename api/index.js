const { db, nextId } = require('./db');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
}

function json(res, status, data) {
  cors(res);
  res.status(status).json(data);
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url.split('?')[0];
  const method = req.method;

  if (url === '/api/healthz' && method === 'GET') return json(res, 200, { ok: true });

  // Businesses
  if (url === '/api/businesses' && method === 'GET') return json(res, 200, db.businesses);
  if (url === '/api/businesses' && method === 'POST') {
    const b = req.body || {};
    if (!b.name || !b.phone) return json(res, 400, { error: 'name & phone required' });
    const biz = {
      id: nextId(),
      name: b.name, nameEn: b.nameEn || '',
      category: b.category || 'other',
      phone: b.phone, whatsapp: b.whatsapp || b.phone,
      address: b.address || '', addressEn: b.addressEn || '',
      description: b.description || '', descriptionEn: b.descriptionEn || '',
      image: b.image || '', images: Array.isArray(b.images) ? b.images.slice(0,3) : [], featured: false, rating: 5.0,
      createdAt: new Date().toISOString()
    };
    db.businesses.push(biz);
    return json(res, 201, biz);
  }
  const bDel = url.match(/^\/api\/businesses\/(.+)$/);
  if (bDel && method === 'DELETE') {
    db.businesses = db.businesses.filter(x => String(x.id) !== String(bDel[1]));
    return json(res, 200, { ok: true });
  }

  // Inquiries
  if (url === '/api/inquiries' && method === 'GET') {
    const items = db.inquiries.map(q => {
      const biz = db.businesses.find(x => String(x.id) === String(q.businessId)) || null;
      return { ...q, businessName: biz ? biz.name : '' };
    }).reverse();
    return json(res, 200, items);
  }
  if (url === '/api/inquiries' && method === 'POST') {
    const b = req.body || {};
    if (!b.businessId || !b.name || !b.message) return json(res, 400, { error: 'businessId, name & message required' });
    const q = { id: nextId(), businessId: b.businessId, name: b.name, phone: b.phone || '', message: b.message, createdAt: new Date().toISOString(), read: false };
    db.inquiries.push(q);
    return json(res, 201, q);
  }
  const qRead = url.match(/^\/api\/inquiries\/(.+)\/read$/);
  if (qRead && method === 'POST') {
    const q = db.inquiries.find(x => String(x.id) === String(qRead[1]));
    if (!q) return json(res, 404, { error: 'not found' });
    q.read = true;
    return json(res, 200, q);
  }

  json(res, 404, { error: 'Not found' });
};
