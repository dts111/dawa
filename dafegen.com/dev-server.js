#!/usr/bin/env node
// Local-only dev server: serves this folder's static files and answers
// POST /api/staff-login using credentials from .env. Never deployed —
// run manually with `node dev-server.js` to test the login flow locally.
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = process.env.PORT || 8935;
const ROOT = __dirname;
const ENV_PATH = path.join(ROOT, '.env');

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
};

function loadEnv(filePath) {
  const env = {};
  if (!fs.existsSync(filePath)) return env;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    env[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
  }
  return env;
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(ROOT, decodeURIComponent(urlPath.split('?')[0]));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function handleStaffLogin(req, res) {
  let body = '';
  req.on('data', (chunk) => { body += chunk; });
  req.on('end', () => {
    let email = '';
    let password = '';
    try {
      ({ email = '', password = '' } = JSON.parse(body || '{}'));
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: false, error: 'Invalid request body' }));
      return;
    }

    const env = loadEnv(ENV_PATH);
    const emailMatches = email.trim().toLowerCase() === (env.STAFF_EMAIL || '').toLowerCase();
    const passwordMatches = password === env.STAFF_PASSWORD;
    const success = Boolean(env.STAFF_EMAIL && env.STAFF_PASSWORD && emailMatches && passwordMatches);

    res.writeHead(success ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success }));
  });
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/staff-login') {
    handleStaffLogin(req, res);
    return;
  }
  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`dafegen.com dev server running at http://localhost:${PORT}`);
});
