#!/usr/bin/env node

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const PORT = process.env.PORT ? Number(process.env.PORT) : 8787;

function send(res, status, body, headers) {
  res.writeHead(status, {
    'cache-control': 'no-store',
    ...(headers || {}),
  });
  res.end(body);
}

function sendJson(res, obj, status = 200) {
  send(res, status, JSON.stringify(obj, null, 2) + '\n', { 'content-type': 'application/json; charset=utf-8' });
}

function sendFile(res, filePath) {
  if (!fs.existsSync(filePath)) return send(res, 404, 'Not Found');
  const ext = path.extname(filePath).toLowerCase();
  const ct =
    ext === '.html'
      ? 'text/html; charset=utf-8'
      : ext === '.js'
        ? 'text/javascript; charset=utf-8'
        : ext === '.css'
          ? 'text/css; charset=utf-8'
          : ext === '.json'
            ? 'application/json; charset=utf-8'
            : 'application/octet-stream';
  const body = fs.readFileSync(filePath);
  send(res, 200, body, { 'content-type': ct });
}

function safeJoin(base, rel) {
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(base)) return null;
  return resolved;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (url.pathname === '/api/campaigns') {
    const p = path.join(ROOT, 'processed', 'campaigns.json');
    if (!fs.existsSync(p)) {
      return sendJson(res, { error: 'processed/campaigns.json not found. Run: node scripts/build-processed.js' }, 404);
    }
    return sendFile(res, p);
  }

  // Main page
  if (url.pathname === '/' || url.pathname === '/index.html') {
    return sendFile(res, path.join(ROOT, 'index.html'));
  }

  // App page
  if (url.pathname === '/main_service.html') {
    return sendFile(res, path.join(ROOT, 'main_service.html'));
  }

  // Serve static root files for prototype.
  const rel = url.pathname.replace(/^\//, '');
  const p = safeJoin(ROOT, rel);
  if (!p) return send(res, 400, 'Bad Request');
  return sendFile(res, p);
});

server.listen(PORT, () => {
  console.log(`Prototype server: http://127.0.0.1:${PORT}`);
  console.log(`- UI:  http://127.0.0.1:${PORT}/`);
  console.log(`- App: http://127.0.0.1:${PORT}/main_service.html`);
  console.log(`- API: http://127.0.0.1:${PORT}/api/campaigns`);
});
