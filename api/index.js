const { db, nextId, hashPw, checkPw, newToken, storeKey } = require('./db');

const ALLOWED_ORIGINS = ['https://aljiza-sooq.vercel.app'];
function isAllowedOrigin(o) {
  if (!o) return false;
  try {
    const u = new URL(o);
    if (ALLOWED_ORIGINS.includes(u.origin)) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    if (u.hostname.endsWith('.vercel.app')) return true; // preview deployments
    return false;
  } catch (e) { return false; }
}
function cors(req, res) {
  const o = (req.headers && (req.headers.origin || req.headers.Origin)) || null;
  if (o && isAllowedOrigin(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  // same-origin / non-browser (no Origin): no header needed
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
}

function json(res, status, data) {
  res.status(status).json(data);
}

// ---------- auth helpers (server-side sessions, roles enforced here) ----------
function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}
function authUser(req) {
  const t = bearer(req);
  if (!t) return null;
  const s = db.sessions[t];
  if (!s) return null;
  return db.users.find(u => u.id === s.userId) || null;
}
function safeUser(u) {
  if (!u) return null;
  const { passHash, salt, ...safe } = u;
  return safe;
}
function needAuth(req, res) {
  const u = authUser(req);
  if (!u) { json(res, 401, { error: 'auth required' }); return null; }
  return u;
}
function needRole(req, res, roles) {
  const u = needAuth(req, res);
  if (!u) return null;
  if (!roles.includes(u.role)) { json(res, 403, { error: 'forbidden' }); return null; }
  return u;
}
function ownsBusiness(u, b) {
  if (!u || !b) return false;
  if (u.role === 'admin') return true;
  return b.ownerId && String(b.ownerId) === String(u.id);
}
// NOTE: all money math below runs synchronously in one tick (atomic, single-threaded).
// Amounts ALWAYS come from db.settings — never from client input.

module.exports = async (req, res) => {
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url.split('?')[0];
  const method = req.method;
  const body = req.body || {};

  // Health
  if (url === '/api/healthz' && method === 'GET') return json(res, 200, { ok: true });

  // ---------- 1) Customer accounts ----------
  // Register (first time only): fullName + phone + password
  if (url === '/api/auth/register' && method === 'POST') {
    const fullName = String(body.fullName || '').trim();
    const phone = String(body.phone || '').replace(/\D/g, '');
    const password = String(body.password || '');
    const role = body.role === 'vendor' ? 'vendor' : 'customer';
    if (fullName.length < 3 || phone.length < 7 || password.length < 4)
      return json(res, 400, { error: 'fullName, phone & password required' });
    if (db.users.find(u => u.phone === phone))
      return json(res, 409, { error: 'phone registered' });
    const user = { id: 'u' + nextId(), fullName, phone, passHash: hashPw(password), algo: 'bcrypt', role, createdAt: new Date().toISOString() };
    db.users.push(user);
    const token = newToken();
    db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
    return json(res, 201, { accessToken: token, user: safeUser(user) });
  }
  // Login (phone + password only — name/phone NOT asked again)
  if (url === '/api/auth/login' && method === 'POST') {
    const phone = String(body.phone || '').replace(/\D/g, '');
    const password = String(body.password || '');
    const user = db.users.find(u => u.phone === phone);
    if (!user || !checkPw(password, user.passHash))
      return json(res, 401, { error: 'bad credentials' });
    const token = newToken();
    db.sessions[token] = { userId: user.id, createdAt: new Date().toISOString() };
    return json(res, 200, { accessToken: token, user: safeUser(user) });
  }
  if (url === '/api/auth/me' && method === 'GET') {
    const u = authUser(req);
    if (!u) return json(res, 401, { error: 'auth required' });
    return json(res, 200, safeUser(u));
  }
  if (url === '/api/auth/logout' && method === 'POST') {
    const t = bearer(req);
    if (t) delete db.sessions[t];
    return json(res, 200, { ok: true });
  }
  // Edit own profile (name/phone)
  if (url === '/api/users/me' && method === 'PATCH') {
    const u = needAuth(req, res);
    if (!u) return;
    if (body.fullName && String(body.fullName).trim().length >= 3) u.fullName = String(body.fullName).trim();
    if (body.phone) {
      const ph = String(body.phone).replace(/\D/g, '');
      if (ph.length >= 7 && !db.users.find(x => x.id !== u.id && x.phone === ph)) u.phone = ph;
    }
    return json(res, 200, safeUser(u));
  }

  // ---------- payment methods catalog (Syria, incl. cash) ----------
  if (url === '/api/pay-methods' && method === 'GET') return json(res, 200, db.payMethods);

  // ---------- businesses ----------
  if (url === '/api/businesses' && method === 'GET') {
    const me = authUser(req);
    return json(res, 200, db.businesses.map(v => {
      const pub = { ...v };
      if (!me || !(me.role === 'admin' || ownsBusiness(me, v))) delete pub.billing;
      return pub;
    }));
  }
  if (url === '/api/businesses' && method === 'POST') {
    if (!body.name || !body.phone) return json(res, 400, { error: 'name & phone required' });
    const me = authUser(req);
    const biz = {
      id: nextId(),
      ownerId: me && me.role === 'vendor' ? me.id : null,
      name: body.name, nameEn: body.nameEn || '',
      category: body.category || 'other',
      phone: body.phone, whatsapp: body.whatsapp || body.phone,
      address: body.address || '', addressEn: body.addressEn || '',
      description: body.description || '', descriptionEn: body.descriptionEn || '',
      image: body.image || '', images: Array.isArray(body.images) ? body.images.slice(0, 3) : [],
      featured: false, rating: 5.0,
      paySetup: { accepted: ['cash'], details: {}, link: '' },
      billing: { model: null, status: 'none', start: null, end: null, free_trial_used: false, free_trial_start: null, free_trial_end: null, opsCount: 0, opsDue: 0 },
      createdAt: new Date().toISOString()
    };
    db.businesses.push(biz);
    // Billable op: listing creation (per-op model only, server-priced)
    if (biz.ownerId) chargeOp(biz.ownerId, biz.id, 'listing');
    return json(res, 201, biz);
  }
  const bPayGet = url.match(/^\/api\/businesses\/(.+)\/pay$/);
  if (bPayGet && method === 'GET') {
    const b = db.businesses.find(x => String(x.id) === String(bPayGet[1]));
    if (!b) return json(res, 404, { error: 'not found' });
    return json(res, 200, b.paySetup || { accepted: ['cash'], details: {}, link: '' });
  }
  if (bPayGet && method === 'PATCH') {
    const me = needRole(req, res, ['vendor', 'admin']);
    if (!me) return;
    const b = db.businesses.find(x => String(x.id) === String(bPayGet[1]));
    if (!b) return json(res, 404, { error: 'not found' });
    if (!b.ownerId && me.role === 'vendor') b.ownerId = me.id; // claim unowned legacy listing
    if (!ownsBusiness(me, b)) return json(res, 403, { error: 'not your store' });
    const valid = db.payMethods.map(m => m.id);
    const acc = Array.isArray(body.accepted) ? body.accepted.filter(a => valid.includes(a)) : b.paySetup.accepted;
    // NOTE: no card/bank sensitive data is stored — only vendor-published details/link text.
    b.paySetup = {
      accepted: acc.length ? acc : ['cash'],
      details: (body.details && typeof body.details === 'object') ? body.details : (b.paySetup.details || {}),
      link: typeof body.link === 'string' ? body.link.slice(0, 500) : (b.paySetup.link || '')
    };
    return json(res, 200, b.paySetup);
  }
  const bImg = url.match(/^\/api\/businesses\/(.+)\/images$/);
  if (bImg && method === 'POST') {
    const me = needRole(req, res, ['vendor', 'admin']);
    if (!me) return;
    const b = db.businesses.find(x => String(x.id) === String(bImg[1]));
    if (!b) return json(res, 404, { error: 'not found' });
    if (!ownsBusiness(me, b)) return json(res, 403, { error: 'not your store' });
    const imgs = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
    b.images = imgs;
    if (imgs.length) b.image = imgs[0];
    if (me.role === 'vendor') chargeOp(me.id, b.id, 'images');
    return json(res, 200, { images: b.images });
  }
  const bDel = url.match(/^\/api\/businesses\/(.+)$/);
  if (bDel && method === 'DELETE') {
    const me = needAuth(req, res);
    if (!me) return;
    const b = db.businesses.find(x => String(x.id) === String(bDel[1]));
    if (!b) return json(res, 404, { error: 'not found' });
    if (!ownsBusiness(me, b)) return json(res, 403, { error: 'forbidden' });
    db.businesses = db.businesses.filter(x => String(x.id) !== String(bDel[1]));
    return json(res, 200, { ok: true });
  }

  // ---------- 5/6/7) vendor billing: trial-once + subscriptions + per-op ----------
  if (url === '/api/billing/mine' && method === 'GET') {
    const me = needRole(req, res, ['vendor', 'admin']);
    if (!me) return;
    const mine = db.businesses.filter(b => me.role === 'admin' || ownsBusiness(me, b));
    return json(res, 200, { settings: publicSettings(), businesses: mine.map(b => ({ id: b.id, name: b.name, phone: b.phone, billing: b.billing || null })) });
  }
  if (url === '/api/billing/subscribe' && method === 'POST') {
    const me = needRole(req, res, ['vendor']);
    if (!me) return;
    const b = db.businesses.find(x => String(x.id) === String(body.businessId));
    if (!b) return json(res, 404, { error: 'not found' });
    if (!b.ownerId) b.ownerId = me.id;
    if (!ownsBusiness(me, b)) return json(res, 403, { error: 'not your store' });
    const model = body.model;
    if (!['perOp', 'monthly', 'yearly'].includes(model)) return json(res, 400, { error: 'bad model' });
    if (!db.settings.models[{ perOp: 'perOp', monthly: 'monthly', yearly: 'yearly' }[model]])
      return json(res, 400, { error: 'model disabled' });
    const now = new Date();
    b.billing = b.billing || freshBilling();
    if (model === 'perOp') {
      b.billing.model = 'perOp';
      b.billing.status = 'active';
      chargeOp(me.id, b.id, 'listing'); // listing fee, server-priced
      return json(res, 200, { billing: b.billing });
    }
    // monthly / yearly with once-only free trial per STORE (registry survives account delete/recreate)
    const key = storeKey(b.name, b.phone);
    const trialUsed = b.billing.free_trial_used || db.trials.find(t => t.key === key);
    const days = db.settings.trialDays;
    if (!trialUsed && days > 0) {
      const start = now.toISOString();
      const end = new Date(now.getTime() + days * 86400000).toISOString();
      b.billing.model = model === 'monthly' ? 'monthly' : 'yearly';
      b.billing.status = 'trial';
      b.billing.start = start;
      b.billing.free_trial_used = true;
      b.billing.free_trial_start = start;
      b.billing.free_trial_end = end;
      db.trials.push({ key, businessId: b.id, usedAt: start });
      const sub = { id: nextId(), businessId: b.id, vendorId: me.id, model: b.billing.model, status: 'trial', start, end, amount: 0, createdAt: start };
      db.subscriptions.push(sub);
      return json(res, 200, { billing: b.billing, trial: true });
    }
    const price = model === 'monthly' ? db.settings.monthlyPrice : db.settings.yearlyPrice;
    const start = now.toISOString();
    const end = new Date(now.getTime() + (model === 'monthly' ? 30 : 365) * 86400000).toISOString();
    b.billing.model = model;
    b.billing.status = 'active';
    b.billing.start = start;
    b.billing.end = end;
    const sub = { id: nextId(), businessId: b.id, vendorId: me.id, model, status: 'active', start, end, amount: price, createdAt: start };
    db.subscriptions.push(sub);
    addLedger({ vendorId: me.id, businessId: b.id, transaction_type: model === 'monthly' ? 'monthly_subscription' : 'yearly_subscription', amount: price, subscriptionId: sub.id });
    return json(res, 200, { billing: b.billing, trial: false });
  }

  // ---------- 8/10) admin: platform revenue ONLY (vendor -> platform) ----------
  if (url === '/api/admin/revenue' && method === 'GET') {
    const me = needRole(req, res, ['admin']);
    if (!me) return;
    return json(res, 200, revenueReport());
  }
  if (url === '/api/admin/settings' && (method === 'GET' || method === 'PATCH')) {
    const me = needRole(req, res, ['admin']);
    if (!me) return;
    if (method === 'GET') return json(res, 200, db.settings);
    const s = db.settings;
    if (body.perOpPrice !== undefined && Number(body.perOpPrice) >= 0) s.perOpPrice = Math.floor(Number(body.perOpPrice));
    if (body.monthlyPrice !== undefined && Number(body.monthlyPrice) >= 0) s.monthlyPrice = Math.floor(Number(body.monthlyPrice));
    if (body.yearlyPrice !== undefined && Number(body.yearlyPrice) >= 0) s.yearlyPrice = Math.floor(Number(body.yearlyPrice));
    if (body.trialDays !== undefined && Number(body.trialDays) >= 0) s.trialDays = Math.floor(Number(body.trialDays));
    if (body.models && typeof body.models === 'object') {
      ['perOp', 'monthly', 'yearly'].forEach(k => { if (typeof body.models[k] === 'boolean') s.models[k] = body.models[k]; });
    }
    return json(res, 200, s);
  }
  if (url === '/api/admin/ledger' && method === 'GET') {
    const me = needRole(req, res, ['admin']);
    if (!me) return;
    return json(res, 200, db.ledger.slice().reverse());
  }
  if (url === '/api/admin/vendors' && method === 'GET') {
    const me = needRole(req, res, ['admin']);
    if (!me) return;
    const vendors = db.users.filter(u => u.role === 'vendor').map(u => {
      const stores = db.businesses.filter(b => String(b.ownerId) === String(u.id));
      return { ...safeUser(u), stores: stores.map(s => ({ id: s.id, name: s.name, billing: s.billing || null })) };
    });
    return json(res, 200, vendors);
  }

  // ---------- orders: DIRECT customer <-> vendor. Admin is NEVER involved. ----------
  if (url === '/api/orders' && method === 'GET') {
    const me = authUser(req);
    let list = db.orders;
    if (!me) return json(res, 200, []);
    if (me.role === 'admin') return json(res, 403, { error: 'admin is not a party to customer payments' });
    if (me.role === 'vendor') {
      const mine = new Set(db.businesses.filter(b => ownsBusiness(me, b)).map(b => String(b.id)));
      list = list.filter(o => mine.has(String(o.businessId)));
    } else {
      list = list.filter(o => (o.userId && String(o.userId) === String(me.id)) || (!o.userId && o.phone === me.phone));
    }
    return json(res, 200, list.map(o => {
      const biz = db.businesses.find(x => String(x.id) === String(o.businessId)) || null;
      return { ...o, businessName: biz ? biz.name : '', businessPhone: biz ? biz.phone : '' };
    }).reverse());
  }
  if (url === '/api/orders' && method === 'POST') {
    if (!body.businessId || !body.customerName || !body.phone)
      return json(res, 400, { error: 'businessId, customerName & phone required' });
    const me = authUser(req);
    const id = nextId();
    const o = {
      id, code: 'JZQ-' + (1000 + id), businessId: body.businessId,
      customerName: body.customerName, userId: me ? me.id : null,
      phone: String(body.phone), address: body.address || '', notes: body.notes || '',
      // Amount integrity: client value is ONLY a customer-declared estimate.
      // Final amount is set by the VENDOR (price authority) on confirm. Never in ledger.
      method: body.method || 'cash', amount: Math.max(0, Math.floor(Number(body.amount)) || 0),
      declaredAmount: Math.max(0, Math.floor(Number(body.amount)) || 0), confirmedAmount: null,
      status: 'pending', createdAt: new Date().toISOString()
    };
    db.orders.push(o);
    return json(res, 201, o);
  }
  const oSt = url.match(/^\/api\/orders\/(.+)\/status$/);
  if (oSt && method === 'PATCH') {
    const me = needAuth(req, res);
    if (!me) return;
    const o = db.orders.find(x => String(x.id) === String(oSt[1]));
    if (!o) return json(res, 404, { error: 'not found' });
    const st = (body || {}).status;
    const biz = db.businesses.find(x => String(x.id) === String(o.businessId));
    const isVendor = biz && ownsBusiness(me, biz);
    const isCustomer = (o.userId && String(o.userId) === String(me.id)) || (!o.userId && o.phone === me.phone);
    if (me.role === 'admin') return json(res, 403, { error: 'admin is not a party to customer payments' });
    if (isVendor && ['confirmed', 'paid', 'done', 'rejected'].includes(st)) {
      o.status = st;
      if (st === 'confirmed') {
        const ca = Math.floor(Number((body || {}).confirmedAmount));
        o.confirmedAmount = (ca >= 0 && isFinite(ca)) ? ca : (o.declaredAmount || o.amount || 0);
      }
      return json(res, 200, o);
    }
    if (isCustomer && st === 'cancelled' && o.status === 'pending') { o.status = 'cancelled'; return json(res, 200, o); }
    return json(res, 403, { error: 'forbidden' });
  }

  // ---------- inquiries: scoped by ownership (vendor: own stores; customer: own; admin: all) ----------
  if (url === '/api/inquiries' && method === 'GET') {
    const me = authUser(req);
    if (!me) return json(res, 403, { error: 'auth required' });
    let list = db.inquiries;
    if (me.role === 'vendor') {
      const mine = new Set(db.businesses.filter(b => ownsBusiness(me, b)).map(b => String(b.id)));
      list = list.filter(q => mine.has(String(q.businessId)));
    } else if (me.role === 'customer') {
      list = list.filter(q => (q.userId && String(q.userId) === String(me.id)) || (!q.userId && q.phone === me.phone));
    }
    const items = list.map(q => {
      const biz = db.businesses.find(x => String(x.id) === String(q.businessId)) || null;
      return { ...q, businessName: biz ? biz.name : '' };
    }).reverse();
    return json(res, 200, items);
  }
  if (url === '/api/inquiries' && method === 'POST') {
    if (!body.businessId || !body.name || !body.message) return json(res, 400, { error: 'businessId, name & message required' });
    const me = authUser(req);
    const q = { id: nextId(), businessId: body.businessId, name: body.name, phone: body.phone || '', userId: me ? me.id : null, message: body.message, createdAt: new Date().toISOString(), read: false };
    db.inquiries.push(q);
    return json(res, 201, q);
  }
  const qRead = url.match(/^\/api\/inquiries\/(.+)\/read$/);
  if (qRead && method === 'POST') {
    const me = needAuth(req, res);
    if (!me) return;
    const q = db.inquiries.find(x => String(x.id) === String(qRead[1]));
    if (!q) return json(res, 404, { error: 'not found' });
    const biz = db.businesses.find(x => String(x.id) === String(q.businessId));
    const mine = me.role === 'admin' || (biz && ownsBusiness(me, biz)) || (q.userId && String(q.userId) === String(me.id));
    if (!mine) return json(res, 403, { error: 'forbidden' });
    q.read = true;
    return json(res, 200, q);
  }

  json(res, 404, { error: 'Not found' });
};

// ---------- platform money helpers (server-side only) ----------
function publicSettings() {
  const s = db.settings;
  return { currency: s.currency, perOpPrice: s.perOpPrice, monthlyPrice: s.monthlyPrice, yearlyPrice: s.yearlyPrice, trialDays: s.trialDays, models: { ...s.models } };
}
function freshBilling() {
  return { model: null, status: 'none', start: null, end: null, free_trial_used: false, free_trial_start: null, free_trial_end: null, opsCount: 0, opsDue: 0 };
}
function addLedger(e) {
  const t = {
    id: nextId(),
    vendor_id: e.vendorId,
    business_id: e.businessId || null,
    transaction_type: e.transaction_type, // per_download | monthly_subscription | yearly_subscription
    amount: Math.floor(Number(e.amount)) || 0,
    currency: db.settings.currency,
    payment_method: e.payment_method || 'platform',
    status: e.status || 'completed',
    reference: e.reference || ('TX-' + Date.now()),
    subscription_id: e.subscriptionId || null,
    created_at: new Date().toISOString()
  };
  db.ledger.push(t);
  return t;
}
// Billable vendor operation (listing / images). Runs synchronously = atomic.
function chargeOp(vendorId, businessId, kind) {
  const b = db.businesses.find(x => String(x.id) === String(businessId));
  if (!b) return null;
  b.billing = b.billing || freshBilling();
  if (b.billing.model !== 'perOp') return null; // subscriptions cover ops
  if (!db.settings.models.perOp) return null;
  const amount = db.settings.perOpPrice; // server-priced, never client input
  b.billing.opsCount += 1;
  b.billing.opsDue += amount;
  return addLedger({ vendorId, businessId, transaction_type: 'per_download', amount, reference: 'OP-' + kind + '-' + businessId + '-' + b.billing.opsCount });
}
function activeSub(b, now) {
  if (!b || !b.billing) return false;
  if (b.billing.model === 'perOp') return b.billing.status === 'active';
  if (!b.billing.end) return false;
  return new Date(b.billing.end).getTime() > now && ['active', 'trial'].includes(b.billing.status);
}
function revenueReport() {
  const now = Date.now();
  const vendors = db.users.filter(u => u.role === 'vendor');
  const stores = db.businesses.filter(b => b.ownerId);
  const subs = db.subscriptions;
  const sum = arr => arr.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const inMonth = db.ledger.filter(t => (Date.now() - new Date(t.created_at).getTime()) < 30 * 86400000);
  const trialStores = stores.filter(b => b.billing && b.billing.status === 'trial' && activeSub(b, now));
  const expiring = subs
    .filter(s => s.status !== 'trial' && s.end && (new Date(s.end).getTime() - now) < 7 * 86400000 && (new Date(s.end).getTime() > now))
    .map(s => {
      const b = db.businesses.find(x => String(x.id) === String(s.businessId));
      return { id: s.id, business: b ? b.name : '', model: s.model, end: s.end };
    });
  return {
    currency: db.settings.currency,
    totalVendors: vendors.length,
    activeStores: stores.filter(b => activeSub(b, now)).length,
    trialStores: trialStores.length,
    monthlySubs: subs.filter(s => s.model === 'monthly' && s.status === 'active').length,
    yearlySubs: subs.filter(s => s.model === 'yearly' && s.status === 'active').length,
    paidOps: db.ledger.filter(t => t.transaction_type === 'per_download').length,
    totalRevenue: sum(db.ledger),
    monthlyRevenue: sum(inMonth),
    yearlyRevenue: sum(db.ledger),
    perOpRevenue: sum(db.ledger.filter(t => t.transaction_type === 'per_download')),
    expiringSoon: expiring,
    ledgerCount: db.ledger.length
  };
}
