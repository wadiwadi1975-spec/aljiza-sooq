const http = require('http');
const fs = require('fs');
const path = require('path');
const handler = require('./api/index');

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try { req.body = body ? JSON.parse(body) : {}; } catch (e) { req.body = {}; }
      const out = {
        statusCode: 200, _data: null,
        setHeader() {}, status(c) { this.statusCode = c; return this; },
        json(d) { this._data = JSON.stringify(d); this.end(); },
        end(d) {
          if (d) this._data = d;
          res.writeHead(this.statusCode, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
          res.end(this._data || '');
        }
      };
      handler(req, out);
    });
    return;
  }
  let p = req.url.split('?')[0];
  if (p === '/') p = '/index.html';
  const f = path.join(__dirname, 'public', decodeURIComponent(p).replace(/^\/+/, ''));
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(data);
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log('AL-JIZA SOOQ on http://localhost:' + PORT));
