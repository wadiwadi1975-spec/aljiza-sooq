const { pool, getDb, hashPw, checkPw, newToken, storeKey } = require('./db');

const ALLOWED_ORIGINS = ['https://aljiza-sooq.vercel.app'];
function isAllowedOrigin(o) {
  if (!o) return false;
  try {
    const u = new URL(o);
    if (ALLOWED_ORIGINS.includes(u.origin)) return true;
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return true;
    if (u.hostname.endsWith('.vercel.app')) return true;
    return false;
  } catch (e) { return false; }
}
function cors(req, res) {
  const o = (req.headers && (req.headers.origin || req.headers.Origin)) || null;
  if (o && isAllowedOrigin(o)) {
    res.setHeader('Access-Control-Allow-Origin', o);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
}

function json(res, status, data) { res.status(status).json(data); }

// ---- auth helpers ----
function bearer(req) {
  const h = req.headers.authorization || req.headers.Authorization;
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}
function safeUser(u) {
  if (!u) return null;
  const { pass_hash, salt, ...safe } = u;
  safe.fullName = safe.full_name || safe.fullName;
  delete safe.full_name;
  return safe;
}
async function authUser(req) {
  const t = bearer(req);
  if (!t) return null;
  const { rows } = await pool.query('SELECT u.* FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token = $1', [t]);
  return rows[0] || null;
}
async function needAuth(req, res) {
  const u = await authUser(req);
  if (!u) { json(res, 401, { error: 'auth required' }); return null; }
  return u;
}
async function needRole(req, res, roles) {
  const u = await needAuth(req, res);
  if (!u) return null;
  if (!roles.includes(u.role)) { json(res, 403, { error: 'forbidden' }); return null; }
  return u;
}
async function ownsBusiness(u, b) {
  if (!u || !b) return false;
  if (u.role === 'admin') return true;
  return b.owner_id && String(b.owner_id) === String(u.id);
}

module.exports = async (req, res) => {
  try {
  await getDb(); // ensure schema + seed
  } catch (e) {
    console.error('[sooq] DB init error:', e.message);
    return json(res, 500, { error: 'db init failed', detail: e.message });
  }
  cors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = req.url.split('?')[0];
  const method = req.method;
  const body = req.body || {};

  // Health
  if (url === '/api/healthz' && method === 'GET') return json(res, 200, { ok: true });

  // ---- auth: register ----
  if (url === '/api/auth/register' && method === 'POST') {
    const fullName = String(body.fullName || '').trim();
    const phone = String(body.phone || '').replace(/\D/g, '');
    const password = String(body.password || '');
    const role = body.role === 'vendor' ? 'vendor' : 'customer';
    if (fullName.length < 3 || phone.length < 7 || password.length < 4)
      return json(res, 400, { error: 'fullName, phone & password required' });
    const { rows: existing } = await pool.query('SELECT id FROM users WHERE phone = $1', [phone]);
    if (existing.length) return json(res, 409, { error: 'phone registered' });
    const { rows: [user] } = await pool.query(
      'INSERT INTO users (full_name, phone, pass_hash, role) VALUES ($1,$2,$3,$4) RETURNING *',
      [fullName, phone, hashPw(password), role]
    );
    const token = newToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, user.id]);
    return json(res, 201, { accessToken: token, user: safeUser(user) });
  }

  // ---- auth: login ----
  if (url === '/api/auth/login' && method === 'POST') {
    const phone = String(body.phone || '').replace(/\D/g, '');
    const password = String(body.password || '');
    const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
    const user = rows[0];
    if (!user || !checkPw(password, user.pass_hash))
      return json(res, 401, { error: 'bad credentials' });
    const token = newToken();
    await pool.query('INSERT INTO sessions (token, user_id) VALUES ($1,$2)', [token, user.id]);
    return json(res, 200, { accessToken: token, user: safeUser(user) });
  }

  // ---- auth: me ----
  if (url === '/api/auth/me' && method === 'GET') {
    const u = await authUser(req);
    if (!u) return json(res, 401, { error: 'auth required' });
    return json(res, 200, safeUser(u));
  }

  // ---- auth: logout ----
  if (url === '/api/auth/logout' && method === 'POST') {
    const t = bearer(req);
    if (t) await pool.query('DELETE FROM sessions WHERE token = $1', [t]);
    return json(res, 200, { ok: true });
  }

  // ---- edit profile ----
  if (url === '/api/users/me' && method === 'PATCH') {
    const u = await needAuth(req, res);
    if (!u) return;
    const updates = [], params = [];
    let i = 1;
    if (body.fullName && String(body.fullName).trim().length >= 3) {
      updates.push(`full_name = $${i++}`); params.push(String(body.fullName).trim());
    }
    if (body.phone) {
      const ph = String(body.phone).replace(/\D/g, '');
      if (ph.length >= 7) {
        const { rows: dup } = await pool.query('SELECT id FROM users WHERE phone = $1 AND id != $2', [ph, u.id]);
        if (!dup.length) { updates.push(`phone = $${i++}`); params.push(ph); }
      }
    }
    if (updates.length) {
      params.push(u.id);
      const { rows: [updated] } = await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, params);
      return json(res, 200, safeUser(updated));
    }
    return json(res, 200, safeUser(u));
  }

  // ---- pay methods ----
  if (url === '/api/pay-methods' && method === 'GET') {
    const { rows } = await pool.query('SELECT * FROM pay_methods');
    return json(res, 200, rows);
  }

  // ---- businesses ----
  if (url === '/api/businesses' && method === 'GET') {
    const me = await authUser(req);
    const { rows } = await pool.query('SELECT * FROM businesses ORDER BY featured DESC, rating DESC');
    const result = [];
    for (const v of rows) {
      const pub = { ...v };
      if (!me || !(me.role === 'admin' || await ownsBusiness(me, v))) delete pub.billing;
      result.push(pub);
    }
    return json(res, 200, result);
  }

  if (url === '/api/businesses' && method === 'POST') {
    if (!body.name || !body.phone) return json(res, 400, { error: 'name & phone required' });
    const me = await authUser(req);
    const ownerId = me && me.role === 'vendor' ? me.id : null;
    const { rows: [biz] } = await pool.query(
      `INSERT INTO businesses (owner_id, name, name_en, category, phone, whatsapp, address, address_en, description, description_en, image, images, price_syp, price_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [ownerId, body.name, body.nameEn || '', body.category || 'other', body.phone, body.whatsapp || body.phone,
       body.address || '', body.addressEn || '', body.description || '', body.descriptionEn || '',
       body.image || '', JSON.stringify(Array.isArray(body.images) ? body.images.slice(0, 3) : []),
       Math.max(0, Math.floor(Number(body.price_syp)) || 0), Math.max(0, Number(body.price_usd) || 0)]
    );
    if (ownerId) await chargeOp(ownerId, biz.id, 'listing');
    return json(res, 201, biz);
  }

  // ---- business pay ----
  const bPayGet = url.match(/^\/api\/businesses\/(.+)\/pay$/);
  if (bPayGet && method === 'GET') {
    const { rows } = await pool.query('SELECT pay_setup FROM businesses WHERE id = $1', [bPayGet[1]]);
    if (!rows.length) return json(res, 404, { error: 'not found' });
    return json(res, 200, rows[0].pay_setup || { accepted: ['cash'], details: {}, link: '' });
  }
  // ---- business update (PATCH /api/businesses/:id) ----
  const bPatch = url.match(/^\/api\/businesses\/(.+)$/);
  if (bPatch && method === 'PATCH') {
    const me = await needRole(req, res, ['vendor', 'admin']);
    if (!me) return;
    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [bPatch[1]]);
    if (!rows.length) return json(res, 404, { error: 'not found' });
    const b = rows[0];
    if (!b.owner_id && me.role === 'vendor') {
      await pool.query('UPDATE businesses SET owner_id = $1 WHERE id = $2', [me.id, b.id]);
      b.owner_id = me.id;
    }
    if (!await ownsBusiness(me, b)) return json(res, 403, { error: 'not your store' });
    const updates = [], params = [];
    let i = 1;
    if (body.name !== undefined) { updates.push(`name = $${i++}`); params.push(body.name); }
    if (body.description !== undefined) { updates.push(`description = $${i++}`); params.push(body.description); }
    if (body.address !== undefined) { updates.push(`address = $${i++}`); params.push(body.address); }
    if (body.phone !== undefined) { updates.push(`phone = $${i++}`); params.push(body.phone); }
    if (body.whatsapp !== undefined) { updates.push(`whatsapp = $${i++}`); params.push(body.whatsapp); }
    if (body.price_syp !== undefined) { updates.push(`price_syp = $${i++}`); params.push(Math.max(0, Math.floor(Number(body.price_syp)) || 0)); }
    if (body.price_usd !== undefined) { updates.push(`price_usd = $${i++}`); params.push(Math.max(0, Number(body.price_usd) || 0)); }
    if (body.category !== undefined) { updates.push(`category = $${i++}`); params.push(body.category); }
    if (updates.length) {
      params.push(b.id);
      const { rows: [updated] } = await pool.query(`UPDATE businesses SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`, params);
      return json(res, 200, updated);
    }
    return json(res, 200, b);
  }
  if (bPayGet && method === 'PATCH') {
    const me = await needRole(req, res, ['vendor', 'admin']);
    if (!me) return;
    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [bPayGet[1]]);
    if (!rows.length) return json(res, 404, { error: 'not found' });
    const b = rows[0];
    if (!b.owner_id && me.role === 'vendor') {
      await pool.query('UPDATE businesses SET owner_id = $1 WHERE id = $2', [me.id, b.id]);
      b.owner_id = me.id;
    }
    if (!await ownsBusiness(me, b)) return json(res, 403, { error: 'not your store' });
    const { rows: pmRows } = await pool.query('SELECT id FROM pay_methods');
    const valid = pmRows.map(m => m.id);
    const acc = Array.isArray(body.accepted) ? body.accepted.filter(a => valid.includes(a)) : (b.pay_setup?.accepted || ['cash']);
    const newSetup = {
      accepted: acc.length ? acc : ['cash'],
      details: (body.details && typeof body.details === 'object') ? body.details : (b.pay_setup?.details || {}),
      link: typeof body.link === 'string' ? body.link.slice(0, 500) : (b.pay_setup?.link || '')
    };
    await pool.query('UPDATE businesses SET pay_setup = $1 WHERE id = $2', [JSON.stringify(newSetup), b.id]);
    return json(res, 200, newSetup);
  }

  // ---- business images ----
  const bImg = url.match(/^\/api\/businesses\/(.+)\/images$/);
  if (bImg && method === 'POST') {
    const me = await needRole(req, res, ['vendor', 'admin']);
    if (!me) return;
    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [bImg[1]]);
    if (!rows.length) return json(res, 404, { error: 'not found' });
    const b = rows[0];
    if (!await ownsBusiness(me, b)) return json(res, 403, { error: 'not your store' });
    const imgs = Array.isArray(body.images) ? body.images.slice(0, 3) : [];
    await pool.query('UPDATE businesses SET images = $1, image = $2 WHERE id = $3', [JSON.stringify(imgs), imgs[0] || '', b.id]);
    if (me.role === 'vendor') await chargeOp(me.id, b.id, 'images');
    return json(res, 200, { images: imgs });
  }

  // ---- business delete ----
  const bDel = url.match(/^\/api\/businesses\/(.+)$/);
  if (bDel && method === 'DELETE') {
    const me = await needAuth(req, res);
    if (!me) return;
    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [bDel[1]]);
    if (!rows.length) return json(res, 404, { error: 'not found' });
    if (!await ownsBusiness(me, rows[0])) return json(res, 403, { error: 'forbidden' });
    await pool.query('DELETE FROM businesses WHERE id = $1', [bDel[1]]);
    return json(res, 200, { ok: true });
  }

  // ---- billing ----
  if (url === '/api/billing/mine' && method === 'GET') {
    const me = await needRole(req, res, ['vendor', 'admin']);
    if (!me) return;
    const { rows: s } = await pool.query('SELECT value FROM settings WHERE key = $1', ['platform']);
    const settings = s[0]?.value || {};
    const where = me.role === 'admin' ? '' : 'WHERE owner_id = $1';
    const params = me.role === 'admin' ? [] : [me.id];
    const { rows: mine } = await pool.query(`SELECT id, name, phone, billing FROM businesses ${where}`, params);
    return json(res, 200, { settings, businesses: mine });
  }

  if (url === '/api/billing/subscribe' && method === 'POST') {
    const me = await needRole(req, res, ['vendor']);
    if (!me) return;
    const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [body.businessId]);
    if (!rows.length) return json(res, 404, { error: 'not found' });
    const b = rows[0];
    if (!b.owner_id) { await pool.query('UPDATE businesses SET owner_id = $1 WHERE id = $2', [me.id, b.id]); b.owner_id = me.id; }
    if (!await ownsBusiness(me, b)) return json(res, 403, { error: 'not your store' });
    const model = body.model;
    if (!['perOp', 'monthly', 'yearly'].includes(model)) return json(res, 400, { error: 'bad model' });
    const { rows: s } = await pool.query('SELECT value FROM settings WHERE key = $1', ['platform']);
    const settings = s[0]?.value || {};
    if (!settings.models?.[model]) return json(res, 400, { error: 'model disabled' });

    const now = new Date();
    let billing = b.billing || { model: null, status: 'none', start: null, end: null, free_trial_used: false, free_trial_start: null, free_trial_end: null, opsCount: 0, opsDue: 0 };

    if (model === 'perOp') {
      billing.model = 'perOp'; billing.status = 'active';
      await pool.query('UPDATE businesses SET billing = $1 WHERE id = $2', [JSON.stringify(billing), b.id]);
      await chargeOp(me.id, b.id, 'listing');
      return json(res, 200, { billing });
    }

    // monthly / yearly with once-only free trial per STORE
    const key = storeKey(b.name, b.phone);
    const { rows: trialRows } = await pool.query('SELECT key FROM trials WHERE key = $1', [key]);
    const trialUsed = billing.free_trial_used || trialRows.length > 0;
    const days = settings.trialDays || 30;
    if (!trialUsed && days > 0) {
      const start = now.toISOString();
      const end = new Date(now.getTime() + days * 86400000).toISOString();
      billing.model = model; billing.status = 'trial'; billing.start = start;
      billing.free_trial_used = true; billing.free_trial_start = start; billing.free_trial_end = end;
      await pool.query('UPDATE businesses SET billing = $1 WHERE id = $2', [JSON.stringify(billing), b.id]);
      await pool.query('INSERT INTO trials (key, business_id, used_at) VALUES ($1,$2,$3)', [key, b.id, start]);
      await pool.query(
        `INSERT INTO subscriptions (business_id, vendor_id, model, status, start, "end", amount) VALUES ($1,$2,$3,'trial',$4,$5,0)`,
        [b.id, me.id, model, start, end]
      );
      return json(res, 200, { billing, trial: true });
    }

    const price = model === 'monthly' ? (settings.monthlyPrice || 50000) : (settings.yearlyPrice || 500000);
    const start = now.toISOString();
    const end = new Date(now.getTime() + (model === 'monthly' ? 30 : 365) * 86400000).toISOString();
    billing.model = model; billing.status = 'active'; billing.start = start; billing.end = end;
    await pool.query('UPDATE businesses SET billing = $1 WHERE id = $2', [JSON.stringify(billing), b.id]);
    const { rows: subRows } = await pool.query(
      `INSERT INTO subscriptions (business_id, vendor_id, model, status, start, "end", amount) VALUES ($1,$2,$3,'active',$4,$5,$6) RETURNING id`,
      [b.id, me.id, model, start, end, price]
    );
    await pool.query(
      `INSERT INTO ledger (vendor_id, business_id, transaction_type, amount, currency, payment_method, status, reference, subscription_id)
       VALUES ($1,$2,$3,$4,'SYP','platform','completed',$5,$6)`,
      [me.id, b.id, model === 'monthly' ? 'monthly_subscription' : 'yearly_subscription', price, 'TX-' + Date.now(), subRows[0].id]
    );
    return json(res, 200, { billing, trial: false });
  }

  // ---- admin: revenue ----
  if (url === '/api/admin/revenue' && method === 'GET') {
    const me = await needRole(req, res, ['admin']);
    if (!me) return;
    return json(res, 200, await revenueReport());
  }

  // ---- admin: settings ----
  if (url === '/api/admin/settings' && (method === 'GET' || method === 'PATCH')) {
    const me = await needRole(req, res, ['admin']);
    if (!me) return;
    const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', ['platform']);
    let s = rows[0]?.value || {};
    if (method === 'GET') return json(res, 200, s);
    if (body.perOpPrice !== undefined && Number(body.perOpPrice) >= 0) s.perOpPrice = Math.floor(Number(body.perOpPrice));
    if (body.monthlyPrice !== undefined && Number(body.monthlyPrice) >= 0) s.monthlyPrice = Math.floor(Number(body.monthlyPrice));
    if (body.yearlyPrice !== undefined && Number(body.yearlyPrice) >= 0) s.yearlyPrice = Math.floor(Number(body.yearlyPrice));
    if (body.trialDays !== undefined && Number(body.trialDays) >= 0) s.trialDays = Math.floor(Number(body.trialDays));
    if (body.models && typeof body.models === 'object') {
      ['perOp', 'monthly', 'yearly'].forEach(k => { if (typeof body.models[k] === 'boolean') s.models[k] = body.models[k]; });
    }
    await pool.query('UPDATE settings SET value = $1 WHERE key = $2', [JSON.stringify(s), 'platform']);
    return json(res, 200, s);
  }

  // ---- admin: ledger ----
  if (url === '/api/admin/ledger' && method === 'GET') {
    const me = await needRole(req, res, ['admin']);
    if (!me) return;
    const { rows } = await pool.query('SELECT * FROM ledger ORDER BY created_at DESC');
    return json(res, 200, rows);
  }

  // ---- admin: vendors ----
  if (url === '/api/admin/vendors' && method === 'GET') {
    const me = await needRole(req, res, ['admin']);
    if (!me) return;
    const { rows: vendors } = await pool.query(`SELECT id, full_name, phone, role, created_at FROM users WHERE role = 'vendor'`);
    const result = [];
    for (const u of vendors) {
      const { rows: stores } = await pool.query('SELECT id, name, billing FROM businesses WHERE owner_id = $1', [u.id]);
      result.push({ ...safeUser(u), stores });
    }
    return json(res, 200, result);
  }

  // ---- orders ----
  if (url === '/api/orders' && method === 'GET') {
    const me = await authUser(req);
    if (!me) return json(res, 200, []);
    if (me.role === 'admin') return json(res, 403, { error: 'admin is not a party to customer payments' });
    let q, params;
    if (me.role === 'vendor') {
      const { rows: ownBiz } = await pool.query('SELECT id FROM businesses WHERE owner_id = $1', [me.id]);
      const ids = ownBiz.map(b => b.id);
      if (!ids.length) return json(res, 200, []);
      q = `SELECT o.*, b.name AS business_name, b.phone AS business_phone FROM orders o LEFT JOIN businesses b ON o.business_id = b.id WHERE o.business_id = ANY($1) ORDER BY o.created_at DESC`;
      params = [ids];
    } else {
      q = `SELECT o.*, b.name AS business_name, b.phone AS business_phone FROM orders o LEFT JOIN businesses b ON o.business_id = b.id WHERE o.user_id = $1 OR (o.user_id IS NULL AND o.phone = $2) ORDER BY o.created_at DESC`;
      params = [me.id, me.phone];
    }
    const { rows } = await pool.query(q, params);
    return json(res, 200, rows);
  }

  if (url === '/api/orders' && method === 'POST') {
    if (!body.businessId || !body.customerName || !body.phone)
      return json(res, 400, { error: 'businessId, customerName & phone required' });
    const me = await authUser(req);
    const { rows: [o] } = await pool.query(
      `INSERT INTO orders (code, business_id, customer_name, user_id, phone, address, notes, method, amount, declared_amount, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending') RETURNING *`,
      ['JZQ-' + (1000 + Math.floor(Math.random() * 9000) + 1000), body.businessId, body.customerName,
       me ? me.id : null, String(body.phone), body.address || '', body.notes || '',
       body.method || 'cash', Math.max(0, Math.floor(Number(body.amount)) || 0), Math.max(0, Math.floor(Number(body.amount)) || 0)]
    );
    return json(res, 201, o);
  }

  const oSt = url.match(/^\/api\/orders\/(.+)\/status$/);
  if (oSt && method === 'PATCH') {
    const me = await needAuth(req, res);
    if (!me) return;
    const { rows } = await pool.query('SELECT * FROM orders WHERE id = $1', [oSt[1]]);
    if (!rows.length) return json(res, 404, { error: 'not found' });
    const o = rows[0];
    const { rows: bizRows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [o.business_id]);
    const biz = bizRows[0];
    const isVendor = biz && await ownsBusiness(me, biz);
    const isCustomer = (o.user_id && String(o.user_id) === String(me.id)) || (!o.user_id && o.phone === me.phone);
    if (me.role === 'admin') return json(res, 403, { error: 'admin is not a party to customer payments' });
    const st = body.status;
    if (isVendor && ['confirmed', 'paid', 'done', 'rejected'].includes(st)) {
      let q = 'UPDATE orders SET status = $1', params = [st], i = 2;
      if (st === 'confirmed') {
        const ca = Math.floor(Number(body.confirmedAmount));
        q += `, confirmed_amount = $${i++}`;
        params.push((ca >= 0 && isFinite(ca)) ? ca : (o.declared_amount || o.amount || 0));
      }
      q += ` WHERE id = $${i} RETURNING *`;
      params.push(o.id);
      const { rows: [updated] } = await pool.query(q, params);
      return json(res, 200, updated);
    }
    if (isCustomer && st === 'cancelled' && o.status === 'pending') {
      const { rows: [updated] } = await pool.query('UPDATE orders SET status = $1 WHERE id = $2 RETURNING *', ['cancelled', o.id]);
      return json(res, 200, updated);
    }
    return json(res, 403, { error: 'forbidden' });
  }

  // ---- inquiries ----
  if (url === '/api/inquiries' && method === 'GET') {
    const me = await authUser(req);
    if (!me) return json(res, 403, { error: 'auth required' });
    let q, params;
    if (me.role === 'vendor') {
      const { rows: ownBiz } = await pool.query('SELECT id FROM businesses WHERE owner_id = $1', [me.id]);
      const ids = ownBiz.map(b => b.id);
      if (!ids.length) return json(res, 200, []);
      q = `SELECT i.*, b.name AS business_name FROM inquiries i LEFT JOIN businesses b ON i.business_id = b.id WHERE i.business_id = ANY($1) ORDER BY i.created_at DESC`;
      params = [ids];
    } else if (me.role === 'customer') {
      q = `SELECT i.*, b.name AS business_name FROM inquiries i LEFT JOIN businesses b ON i.business_id = b.id WHERE i.user_id = $1 OR (i.user_id IS NULL AND i.phone = $2) ORDER BY i.created_at DESC`;
      params = [me.id, me.phone];
    } else {
      q = `SELECT i.*, b.name AS business_name FROM inquiries i LEFT JOIN businesses b ON i.business_id = b.id ORDER BY i.created_at DESC`;
      params = [];
    }
    const { rows } = await pool.query(q, params);
    return json(res, 200, rows);
  }

  if (url === '/api/inquiries' && method === 'POST') {
    if (!body.businessId || !body.name || !body.message) return json(res, 400, { error: 'businessId, name & message required' });
    const me = await authUser(req);
    const { rows: [q] } = await pool.query(
      `INSERT INTO inquiries (business_id, name, phone, user_id, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [body.businessId, body.name, body.phone || '', me ? me.id : null, body.message]
    );
    return json(res, 201, q);
  }

  const qRead = url.match(/^\/api\/inquiries\/(.+)\/read$/);
  if (qRead && method === 'POST') {
    const me = await needAuth(req, res);
    if (!me) return;
    const { rows } = await pool.query('SELECT * FROM inquiries WHERE id = $1', [qRead[1]]);
    if (!rows.length) return json(res, 404, { error: 'not found' });
    const q = rows[0];
    const { rows: bizRows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [q.business_id]);
    const biz = bizRows[0];
    const mine = me.role === 'admin' || (biz && await ownsBusiness(me, biz)) || (q.user_id && String(q.user_id) === String(me.id));
    if (!mine) return json(res, 403, { error: 'forbidden' });
    const { rows: [updated] } = await pool.query('UPDATE inquiries SET read = true WHERE id = $1 RETURNING *', [q.id]);
    return json(res, 200, updated);
  }

  json(res, 404, { error: 'Not found' });
};

// ---- platform money helpers ----
async function chargeOp(vendorId, businessId, kind) {
  const { rows } = await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId]);
  const b = rows[0];
  if (!b) return null;
  let billing = b.billing || { model: null, status: 'none', opsCount: 0, opsDue: 0 };
  if (billing.model !== 'perOp') return null;
  const { rows: s } = await pool.query('SELECT value FROM settings WHERE key = $1', ['platform']);
  const settings = s[0]?.value || {};
  if (!settings.models?.perOp) return null;
  const amount = settings.perOpPrice || 5000;
  billing.opsCount += 1;
  billing.opsDue += amount;
  await pool.query('UPDATE businesses SET billing = $1 WHERE id = $2', [JSON.stringify(billing), businessId]);
  await pool.query(
    `INSERT INTO ledger (vendor_id, business_id, transaction_type, amount, currency, payment_method, status, reference)
     VALUES ($1,$2,'per_download',$3,'SYP','platform','completed',$4)`,
    [vendorId, businessId, amount, 'OP-' + kind + '-' + businessId + '-' + billing.opsCount]
  );
  return true;
}

async function revenueReport() {
  const { rows: s } = await pool.query('SELECT value FROM settings WHERE key = $1', ['platform']);
  const settings = s[0]?.value || {};
  const now = Date.now();
  const { rows: vendors } = await pool.query(`SELECT count(*)::int AS n FROM users WHERE role = 'vendor'`);
  const { rows: allBiz } = await pool.query('SELECT * FROM businesses WHERE owner_id IS NOT NULL');
  const { rows: subs } = await pool.query('SELECT * FROM subscriptions');
  const { rows: ledgerAll } = await pool.query('SELECT * FROM ledger');
  const { rows: ledgerMonth } = await pool.query('SELECT * FROM ledger WHERE created_at > now() - interval \'30 days\'');

  const activeBiz = allBiz.filter(b => {
    if (!b.billing) return false;
    if (b.billing.model === 'perOp') return b.billing.status === 'active';
    if (!b.billing.end) return false;
    return new Date(b.billing.end).getTime() > now && ['active', 'trial'].includes(b.billing.status);
  });
  const trialStores = allBiz.filter(b => b.billing?.status === 'trial' && activeBiz.includes(b));
  const sum = arr => arr.reduce((acc, x) => acc + (Number(x.amount) || 0), 0);

  return {
    currency: settings.currency || 'SYP',
    totalVendors: vendors[0].n,
    activeStores: activeBiz.length,
    trialStores: trialStores.length,
    monthlySubs: subs.filter(s => s.model === 'monthly' && s.status === 'active').length,
    yearlySubs: subs.filter(s => s.model === 'yearly' && s.status === 'active').length,
    paidOps: ledgerAll.filter(t => t.transaction_type === 'per_download').length,
    totalRevenue: sum(ledgerAll),
    monthlyRevenue: sum(ledgerMonth),
    yearlyRevenue: sum(ledgerAll),
    perOpRevenue: sum(ledgerAll.filter(t => t.transaction_type === 'per_download')),
    expiringSoon: subs
      .filter(s => s.status !== 'trial' && s.end && (new Date(s.end).getTime() - now) < 7 * 86400000 && (new Date(s.end).getTime() > now))
      .map(s => {
        const biz = allBiz.find(b => String(b.id) === String(s.business_id));
        return { id: s.id, business: biz?.name || '', model: s.model, end: s.end };
      }),
    ledgerCount: ledgerAll.length
  };
}
