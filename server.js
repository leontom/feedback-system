/**
 * Self-hosted Feedback & Bug widget — backend server
 *
 * Run:  npm start           (production)
 *       npm run dev         (auto-reload)
 *
 * Everything lives in ./data (sqlite db + uploaded screenshots).
 * No native modules: storage uses Node's built-in node:sqlite.
 */
'use strict';

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const express = require('express');

// ----------------------------------------------------------------------------
// Tiny .env loader (no dependency). Lines like KEY=value; # comments ignored.
// ----------------------------------------------------------------------------
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
})();

// ----------------------------------------------------------------------------
// Config
// ----------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || '3000', 10);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'changeme';
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// Optional comma-separated allowlist of origins permitted to submit. Empty = allow all.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// Secret used to sign the admin session cookie. Auto-derived if not provided.
const SESSION_SECRET = process.env.SESSION_SECRET ||
  crypto.createHash('sha256').update('fbw|' + ADMIN_PASSWORD).digest('hex');
const MAX_BODY = process.env.MAX_BODY || '25mb';

const DATA_DIR = path.join(__dirname, 'data');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

if (ADMIN_PASSWORD === 'changeme') {
  console.warn('\n  ⚠  ADMIN_PASSWORD is the default "changeme". Set one in .env before going live.\n');
}

// ----------------------------------------------------------------------------
// Database
// ----------------------------------------------------------------------------
const db = new DatabaseSync(path.join(DATA_DIR, 'feedback.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    site_id     TEXT NOT NULL DEFAULT 'default',
    category    TEXT NOT NULL DEFAULT 'bug',
    message     TEXT NOT NULL DEFAULT '',
    email       TEXT,
    screenshot  TEXT,
    page_url    TEXT,
    origin      TEXT,
    user_agent  TEXT,
    viewport    TEXT,
    screen_size TEXT,
    meta        TEXT,
    status      TEXT NOT NULL DEFAULT 'new',
    ip          TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_reports_site   ON reports(site_id);
  CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
  CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);
`);

const q = {
  insert: db.prepare(`INSERT INTO reports
    (site_id, category, message, email, screenshot, page_url, origin, user_agent, viewport, screen_size, meta, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
  byId: db.prepare(`SELECT * FROM reports WHERE id = ?`),
  setStatus: db.prepare(`UPDATE reports SET status = ? WHERE id = ?`),
  del: db.prepare(`SELECT screenshot FROM reports WHERE id = ?`),
  delRun: db.prepare(`DELETE FROM reports WHERE id = ?`),
  sites: db.prepare(`SELECT site_id, COUNT(*) AS total,
      SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) AS unread
    FROM reports GROUP BY site_id ORDER BY total DESC`),
  stats: db.prepare(`SELECT status, COUNT(*) AS n FROM reports GROUP BY status`),
};

// ----------------------------------------------------------------------------
// App
// ----------------------------------------------------------------------------
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: MAX_BODY }));

// --- helpers ---------------------------------------------------------------
function originAllowed(origin) {
  if (ALLOWED_ORIGINS.length === 0) return true;
  return origin && ALLOWED_ORIGINS.includes(origin);
}

function signSession() {
  const payload = JSON.stringify({ exp: Date.now() + 1000 * 60 * 60 * 24 * 30 }); // 30 days
  const b64 = Buffer.from(payload).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}
function verifySession(token) {
  if (!token || token.indexOf('.') === -1) return false;
  const [b64, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  if (sig.length !== expect.length) return false;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(b64, 'base64url').toString());
    return Date.now() < exp;
  } catch { return false; }
}
function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function requireAuth(req, res, next) {
  if (verifySession(parseCookies(req).fbw_session)) return next();
  res.status(401).json({ error: 'Not signed in' });
}

// very small in-memory rate limiter for the public submit endpoint
const hits = new Map(); // ip -> [timestamps]
function rateLimited(ip, limit = 20, windowMs = 60_000) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > limit;
}
setInterval(() => { // periodic cleanup
  const now = Date.now();
  for (const [ip, arr] of hits) {
    const keep = arr.filter((t) => now - t < 60_000);
    if (keep.length) hits.set(ip, keep); else hits.delete(ip);
  }
}, 120_000).unref();

function clean(str, max) {
  if (typeof str !== 'string') return '';
  return str.slice(0, max);
}

// ============================================================================
// PUBLIC: widget script (served with permissive CORS so any site can load it)
// ============================================================================
app.get('/widget.js', (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Content-Type', 'application/javascript; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=300');
  res.sendFile(path.join(__dirname, 'public', 'widget.js'));
});

// ============================================================================
// PUBLIC: feedback submission (CORS open; protected by rate limit + validation)
// ============================================================================
app.options('/api/feedback', (req, res) => {
  res.set('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  res.set('Access-Control-Max-Age', '86400');
  res.sendStatus(204);
});

app.post('/api/feedback', (req, res) => {
  const origin = req.headers.origin || '';
  res.set('Access-Control-Allow-Origin', origin || '*');

  if (!originAllowed(origin)) {
    return res.status(403).json({ error: 'This origin is not allowed to submit feedback.' });
  }

  const ip = (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim();
  if (rateLimited(ip)) {
    return res.status(429).json({ error: 'Too many reports. Please wait a moment and try again.' });
  }

  const b = req.body || {};
  if (b.hp) return res.json({ ok: true, id: 0 }); // honeypot tripped: pretend success

  const message = clean(b.message, 8000).trim();
  const category = ['bug', 'idea', 'feedback', 'other'].includes(b.category) ? b.category : 'bug';
  if (!message && !b.screenshot) {
    return res.status(400).json({ error: 'Please describe the issue or attach a screenshot.' });
  }

  // Persist screenshot (data URL) to disk
  let screenshotFile = null;
  if (typeof b.screenshot === 'string' && b.screenshot.startsWith('data:image/')) {
    const m = b.screenshot.match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (m) {
      const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length <= 20 * 1024 * 1024) { // 20MB cap
        const name = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}.${ext}`;
        fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
        screenshotFile = name;
      }
    }
  }

  let meta = null;
  try { if (b.meta) meta = JSON.stringify(b.meta).slice(0, 20000); } catch { /* ignore */ }

  const info = q.insert.run(
    clean(b.siteId, 120) || 'default',
    category,
    message,
    clean(b.email, 200) || null,
    screenshotFile,
    clean(b.pageUrl, 1000) || null,
    origin || null,
    clean(req.headers['user-agent'], 500) || null,
    clean(b.viewport, 50) || null,
    clean(b.screen, 50) || null,
    meta,
    ip || null
  );

  res.json({ ok: true, id: Number(info.lastInsertRowid) });
});

// ============================================================================
// ADMIN AUTH
// ============================================================================
app.post('/admin/login', (req, res) => {
  const pw = (req.body && req.body.password) || '';
  if (typeof pw !== 'string' ||
      pw.length !== ADMIN_PASSWORD.length ||
      !crypto.timingSafeEqual(Buffer.from(pw.padEnd(64)), Buffer.from(ADMIN_PASSWORD.padEnd(64)))) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  const secure = PUBLIC_URL.startsWith('https');
  res.set('Set-Cookie',
    `fbw_session=${signSession()}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${60 * 60 * 24 * 30}` +
    (secure ? '; Secure' : ''));
  res.json({ ok: true });
});

app.post('/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'fbw_session=; HttpOnly; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/session', (req, res) => {
  res.json({ authenticated: verifySession(parseCookies(req).fbw_session) });
});

// ============================================================================
// ADMIN API (auth required)
// ============================================================================
app.get('/api/reports', requireAuth, (req, res) => {
  const { site, status, category, search } = req.query;
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

  const where = [];
  const params = [];
  if (site && site !== 'all') { where.push('site_id = ?'); params.push(site); }
  if (status && status !== 'all') { where.push('status = ?'); params.push(status); }
  if (category && category !== 'all') { where.push('category = ?'); params.push(category); }
  if (search) { where.push('(message LIKE ? OR page_url LIKE ? OR email LIKE ?)');
    const s = `%${search}%`; params.push(s, s, s); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = db.prepare(`SELECT COUNT(*) AS n FROM reports ${clause}`).get(...params).n;
  const rows = db.prepare(
    `SELECT id, site_id, category, message, email, screenshot, page_url, status, created_at
     FROM reports ${clause} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);

  res.json({ total, limit, offset, reports: rows });
});

app.get('/api/reports/:id', requireAuth, (req, res) => {
  const row = q.byId.get(parseInt(req.params.id, 10));
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(row);
});

app.patch('/api/reports/:id', requireAuth, (req, res) => {
  const status = (req.body && req.body.status) || '';
  if (!['new', 'open', 'resolved', 'archived'].includes(status)) {
    return res.status(400).json({ error: 'Invalid status' });
  }
  q.setStatus.run(status, parseInt(req.params.id, 10));
  res.json({ ok: true });
});

app.delete('/api/reports/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id, 10);
  const row = q.del.get(id);
  if (row && row.screenshot) {
    try { fs.unlinkSync(path.join(UPLOAD_DIR, row.screenshot)); } catch { /* ignore */ }
  }
  q.delRun.run(id);
  res.json({ ok: true });
});

app.get('/api/sites', requireAuth, (req, res) => res.json({ sites: q.sites.all() }));

app.get('/api/stats', requireAuth, (req, res) => {
  const out = { new: 0, open: 0, resolved: 0, archived: 0, total: 0 };
  for (const r of q.stats.all()) { out[r.status] = r.n; out.total += r.n; }
  res.json(out);
});

// screenshots are private — auth required
app.get('/uploads/:file', requireAuth, (req, res) => {
  const file = path.basename(req.params.file);
  const full = path.join(UPLOAD_DIR, file);
  if (!full.startsWith(UPLOAD_DIR) || !fs.existsSync(full)) return res.sendStatus(404);
  res.sendFile(full);
});

// ============================================================================
// Dashboard (single page). Auth handled client-side via /api/session.
// ============================================================================
// PUBLIC: web fonts (CORS-open so the widget can load them cross-origin from any embedding site)
app.use('/fonts', (req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  next();
}, express.static(path.join(__dirname, 'public', 'fonts')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.use(express.static(path.join(__dirname, 'public')));

// ----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`\n  Feedback system running`);
  console.log(`  Dashboard:  ${PUBLIC_URL}`);
  console.log(`  Widget:     ${PUBLIC_URL}/widget.js`);
  console.log(`  Listening on port ${PORT}\n`);
});
