'use strict';
/*
 * Evidence zakázek – místní server (jádro aplikace).
 * Každý PC spouští vlastní instanci (v Electronu nebo samostatně z příkazové řádky)
 * a všechny instance sdílejí jednu SQLite databázi ve sdílené složce (config.json -> dataDir).
 * Bez závislostí, vyžaduje Node.js 22.5+ (node:sqlite).
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

// ---------- konfigurace ----------
/** Přečte textový soubor v UTF-8 nebo UTF-16 (BOM); instalátor zapisuje UTF-16. */
function readText(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0xff && buf[1] === 0xfe) return buf.toString('utf16le').replace(/^﻿/, '');
  return buf.toString('utf8').replace(/^﻿/, '');
}

/** Najde první existující config.json z kandidátů; relativní cesty se berou od jeho složky. */
function loadConfig(candidates) {
  for (const file of candidates) {
    try {
      const cfg = JSON.parse(readText(file));
      return { cfg, baseDir: path.dirname(file), file };
    } catch { /* zkusit další */ }
  }
  return { cfg: {}, baseDir: __dirname, file: null };
}

const pad = (n) => String(n).padStart(2, '0');
const orderNo = (o) => `${pad(o.seq)}/${o.year}`;
const invoiceNo = (i) => `F${pad(i.seq)}/${i.year}`;
const now = () => new Date().toISOString();

class HttpError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (msg) => new HttpError(400, 'invalid', msg);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.json': 'application/json',
};
const PUBLIC_DIR = path.join(__dirname, 'public');
const PKG = (() => { try { return require('../package.json'); } catch { return {}; } })();

/**
 * Spustí server.
 * @param {{host?:string, port?:number, dataDir:string, keepDays?:number, token?:string, demo?:boolean}} opts
 */
async function startServer(opts) {
  const HOST = opts.host ?? '127.0.0.1';
  const IS_LOCAL = HOST === '127.0.0.1' || HOST === 'localhost' || HOST === '::1';
  const DATA_DIR = path.resolve(opts.dataDir);
  const DB_FILE = path.join(DATA_DIR, 'zakazky.db');
  const BACKUP_DIR = path.join(DATA_DIR, '..', 'backup');
  const KEEP_DAYS = opts.keepDays ?? 30;
  const TOKEN = opts.token || null;

  fs.mkdirSync(DATA_DIR, { recursive: true });

  // ---------- databáze ----------
  const db = new DatabaseSync(DB_FILE);
  // DELETE žurnál (ne WAL) – WAL nefunguje přes síťové disky.
  db.exec(`
    PRAGMA busy_timeout = 10000;
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', 0);

    CREATE TABLE IF NOT EXISTS orders (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      seq        INTEGER NOT NULL,
      year       INTEGER NOT NULL,
      customer   TEXT NOT NULL,
      location   TEXT NOT NULL,
      version    INTEGER NOT NULL DEFAULT 1,
      created_by TEXT, created_at TEXT,
      updated_by TEXT, updated_at TEXT,
      UNIQUE (year, seq)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      seq        INTEGER NOT NULL,
      year       INTEGER NOT NULL,
      date       TEXT,
      version    INTEGER NOT NULL DEFAULT 1,
      created_by TEXT, created_at TEXT,
      updated_by TEXT, updated_at TEXT,
      UNIQUE (year, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_order ON invoices(order_id);

    CREATE TABLE IF NOT EXISTS notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      text       TEXT NOT NULL,
      created_by TEXT, created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_notes_order ON notes(order_id);

    CREATE TABLE IF NOT EXISTS hidden_years (
      year      INTEGER PRIMARY KEY,
      hidden_by TEXT,
      hidden_at TEXT
    );

    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL, user TEXT, action TEXT NOT NULL, entity TEXT NOT NULL,
      entity_id INTEGER, detail TEXT
    );
  `);

  function tx(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'rev'").run();
      db.exec('COMMIT');
      return result;
    } catch (e) {
      try { db.exec('ROLLBACK'); } catch { /* už neběží */ }
      throw e;
    }
  }
  const getRev = () => db.prepare("SELECT value FROM meta WHERE key = 'rev'").get().value;
  const audit = (user, action, entity, id, detail) =>
    db.prepare('INSERT INTO audit (ts, user, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)')
      .run(now(), user, action, entity, id, detail);

  // ---------- automatická záloha ----------
  function dailyBackup() {
    try {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const day = new Date();
      const stamp = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
      const target = path.join(BACKUP_DIR, `zakazky-${stamp}.db`);
      if (!fs.existsSync(target)) {
        db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
        console.log('Záloha vytvořena:', target);
      }
      const limit = Date.now() - KEEP_DAYS * 86400000;
      for (const f of fs.readdirSync(BACKUP_DIR)) {
        if (!/^zakazky-\d{4}-\d{2}-\d{2}\.db$/.test(f)) continue;
        const p = path.join(BACKUP_DIR, f);
        if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p);
      }
    } catch (e) {
      console.error('Záloha se nepovedla:', e.message);
    }
  }

  // ---------- validace ----------
  function parseOrderNumber(text) {
    const m = /^\s*(\d{1,4})\s*\/\s*(\d{4})\s*$/.exec(String(text ?? ''));
    if (!m || Number(m[1]) < 1) throw bad('Číslo zakázky musí mít formát xx/rrrr (např. 05/2026).');
    return { seq: Number(m[1]), year: Number(m[2]) };
  }
  function parseInvoiceNumber(b) {
    const seq = Number(b.seq), year = Number(b.year);
    if (!Number.isInteger(seq) || seq < 1 || seq > 999999) throw bad('Pořadové číslo faktury musí být kladné celé číslo.');
    if (!Number.isInteger(year) || year < 1990 || year > 2100) throw bad('Rok faktury musí mít 4 číslice (rrrr).');
    return { seq, year };
  }
  function text(value, label, max = 200) {
    const s = String(value ?? '').trim();
    if (!s) throw bad(`Pole „${label}“ je povinné.`);
    if (s.length > max) throw bad(`Pole „${label}“ je příliš dlouhé.`);
    return s;
  }
  function optDate(value) {
    if (value == null || value === '') return null;
    const s = String(value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw bad('Neplatné datum.');
    return s;
  }
  const nextSeq = (year) => db.prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM orders WHERE year = ?').get(year).n;

  // ---------- doménová logika ----------
  function listOrders() {
    const orders = db.prepare('SELECT * FROM orders ORDER BY year, seq').all();
    const invoices = db.prepare('SELECT * FROM invoices ORDER BY year, seq').all();
    const notes = db.prepare('SELECT * FROM notes ORDER BY id DESC').all();
    const group = (rows, map) => {
      const g = new Map();
      for (const r of rows) {
        if (!g.has(r.order_id)) g.set(r.order_id, []);
        g.get(r.order_id).push(map(r));
      }
      return g;
    };
    const invBy = group(invoices, (i) => ({ id: i.id, number: invoiceNo(i), seq: i.seq, year: i.year, date: i.date, version: i.version }));
    const noteBy = group(notes, (n) => ({ id: n.id, text: n.text, author: n.created_by, createdAt: n.created_at, updatedAt: n.updated_at }));
    return orders.map((o) => ({
      id: o.id, number: orderNo(o), seq: o.seq, year: o.year, customer: o.customer, location: o.location,
      version: o.version, createdBy: o.created_by, createdAt: o.created_at, updatedBy: o.updated_by, updatedAt: o.updated_at,
      invoices: invBy.get(o.id) ?? [],
      notes: noteBy.get(o.id) ?? [],
    }));
  }

  const listHiddenYears = () => db.prepare('SELECT year FROM hidden_years ORDER BY year').all().map((r) => r.year);
  const assertYearVisible = (year) => {
    if (db.prepare('SELECT 1 FROM hidden_years WHERE year = ?').get(year)) {
      throw new HttpError(409, 'hiddenYear', `Rok ${year} je skrytý. Nejdřív ho znovu zobrazte na záložce „Skryté roky“.`);
    }
  };

  /** Schová/zobrazí celý rok pro všechny uživatele; data se nemažou. */
  function setYearHidden(year, hide, user) {
    if (!Number.isInteger(year) || year < 1990 || year > 2100) throw bad('Neplatný rok.');
    return tx(() => {
      if (hide) db.prepare('INSERT OR IGNORE INTO hidden_years (year, hidden_by, hidden_at) VALUES (?,?,?)').run(year, user, now());
      else db.prepare('DELETE FROM hidden_years WHERE year = ?').run(year);
      audit(user, hide ? 'hide' : 'unhide', 'year', year, String(year));
      return { year, hidden: hide };
    });
  }

  function createOrder(b, user) {
    const customer = text(b.customer, 'Odběratel');
    const location = text(b.location, 'Lokalita');
    return tx(() => {
      let { seq, year } = parseOrderNumber(b.number);
      assertYearVisible(year);
      if (b.auto) seq = nextSeq(year); // číslo přidělené serverem, ať se nikdy nepřekryje s kolegou
      const dup = db.prepare('SELECT id FROM orders WHERE year = ? AND seq = ?').get(year, seq);
      if (dup) throw new HttpError(409, 'duplicate', `Zakázka ${pad(seq)}/${year} už existuje.`);
      const r = db.prepare(
        'INSERT INTO orders (seq, year, customer, location, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(seq, year, customer, location, user, now(), user, now());
      audit(user, 'create', 'order', Number(r.lastInsertRowid), `${pad(seq)}/${year} · ${customer} · ${location}`);
      return { id: Number(r.lastInsertRowid), number: `${pad(seq)}/${year}` };
    });
  }

  function updateOrder(id, b, user) {
    const customer = text(b.customer, 'Odběratel');
    const location = text(b.location, 'Lokalita');
    const { seq, year } = parseOrderNumber(b.number);
    return tx(() => {
      const cur = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!cur) throw new HttpError(404, 'missing', 'Zakázka už neexistuje (smazal ji kolega).');
      if (cur.version !== b.version) throw new HttpError(409, 'conflict', 'Zakázku mezitím změnil jiný uživatel. Zobrazila se aktuální data, zkuste úpravu zopakovat.');
      if (year !== cur.year) assertYearVisible(year);
      const dup = db.prepare('SELECT id FROM orders WHERE year = ? AND seq = ? AND id <> ?').get(year, seq, id);
      if (dup) throw new HttpError(409, 'duplicate', `Zakázka ${pad(seq)}/${year} už existuje.`);
      db.prepare('UPDATE orders SET seq=?, year=?, customer=?, location=?, version=version+1, updated_by=?, updated_at=? WHERE id=?')
        .run(seq, year, customer, location, user, now(), id);
      audit(user, 'update', 'order', id, `${orderNo(cur)} → ${pad(seq)}/${year} · ${customer} · ${location}`);
      return { id };
    });
  }

  function deleteOrder(id, user) {
    return tx(() => {
      const cur = db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
      if (!cur) return { id };
      const invs = db.prepare('SELECT * FROM invoices WHERE order_id = ?').all(id).map(invoiceNo).join(', ');
      db.prepare('DELETE FROM orders WHERE id = ?').run(id);
      audit(user, 'delete', 'order', id, `${orderNo(cur)} · ${cur.customer}${invs ? ' · faktury: ' + invs : ''}`);
      return { id };
    });
  }

  function checkInvoiceDuplicate(seq, year, exceptId) {
    const dup = db.prepare(
      `SELECT i.id, o.seq AS oseq, o.year AS oyear FROM invoices i JOIN orders o ON o.id = i.order_id
       WHERE i.year = ? AND i.seq = ? AND i.id <> ?`
    ).get(year, seq, exceptId ?? -1);
    if (dup) {
      throw new HttpError(409, 'duplicate',
        `Faktura ${invoiceNo({ seq, year })} už existuje (zakázka ${pad(dup.oseq)}/${dup.oyear}).`);
    }
  }

  function createInvoice(orderId, b, user) {
    const { seq, year } = parseInvoiceNumber(b);
    const date = optDate(b.date);
    return tx(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new HttpError(404, 'missing', 'Zakázka už neexistuje.');
      checkInvoiceDuplicate(seq, year);
      const r = db.prepare(
        'INSERT INTO invoices (order_id, seq, year, date, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)'
      ).run(orderId, seq, year, date, user, now(), user, now());
      db.prepare('UPDATE orders SET version=version+1, updated_by=?, updated_at=? WHERE id=?').run(user, now(), orderId);
      audit(user, 'create', 'invoice', Number(r.lastInsertRowid), `${invoiceNo({ seq, year })} k zakázce ${orderNo(order)}${date ? ' · ' + date : ''}`);
      return { id: Number(r.lastInsertRowid) };
    });
  }

  function updateInvoice(id, b, user) {
    const { seq, year } = parseInvoiceNumber(b);
    const date = optDate(b.date);
    return tx(() => {
      const cur = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      if (!cur) throw new HttpError(404, 'missing', 'Faktura už neexistuje (smazal ji kolega).');
      if (cur.version !== b.version) throw new HttpError(409, 'conflict', 'Fakturu mezitím změnil jiný uživatel. Zobrazila se aktuální data, zkuste úpravu zopakovat.');
      checkInvoiceDuplicate(seq, year, id);
      db.prepare('UPDATE invoices SET seq=?, year=?, date=?, version=version+1, updated_by=?, updated_at=? WHERE id=?')
        .run(seq, year, date, user, now(), id);
      db.prepare('UPDATE orders SET version=version+1, updated_by=?, updated_at=? WHERE id=?').run(user, now(), cur.order_id);
      audit(user, 'update', 'invoice', id, `${invoiceNo(cur)} → ${invoiceNo({ seq, year })}${date ? ' · ' + date : ''}`);
      return { id };
    });
  }

  function deleteInvoice(id, user) {
    return tx(() => {
      const cur = db.prepare('SELECT * FROM invoices WHERE id = ?').get(id);
      if (!cur) return { id };
      db.prepare('DELETE FROM invoices WHERE id = ?').run(id);
      db.prepare('UPDATE orders SET version=version+1, updated_by=?, updated_at=? WHERE id=?').run(user, now(), cur.order_id);
      audit(user, 'delete', 'invoice', id, invoiceNo(cur));
      return { id };
    });
  }

  // Poznámky: kdokoli přidává, upravit/smazat může jen autor. Nemění verzi zakázky (nekolidují s úpravami údajů).
  const noteText = (v) => text(v, 'Poznámka', 5000);

  function createNote(orderId, b, user) {
    const t = noteText(b.text);
    return tx(() => {
      const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (!order) throw new HttpError(404, 'missing', 'Zakázka už neexistuje.');
      const r = db.prepare('INSERT INTO notes (order_id, text, created_by, created_at) VALUES (?,?,?,?)').run(orderId, t, user, now());
      audit(user, 'create', 'note', Number(r.lastInsertRowid), `zakázka ${orderNo(order)}`);
      return { id: Number(r.lastInsertRowid) };
    });
  }

  function updateNote(id, b, user) {
    const t = noteText(b.text);
    return tx(() => {
      const cur = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
      if (!cur) throw new HttpError(404, 'missing', 'Poznámka už neexistuje.');
      if (cur.created_by !== user) throw new HttpError(403, 'forbidden', `Poznámku může upravit jen autor (${cur.created_by}).`);
      db.prepare('UPDATE notes SET text = ?, updated_at = ? WHERE id = ?').run(t, now(), id);
      audit(user, 'update', 'note', id, `zakázka #${cur.order_id}`);
      return { id };
    });
  }

  function deleteNote(id, user) {
    return tx(() => {
      const cur = db.prepare('SELECT * FROM notes WHERE id = ?').get(id);
      if (!cur) return { id };
      if (cur.created_by !== user) throw new HttpError(403, 'forbidden', `Poznámku může smazat jen autor (${cur.created_by}).`);
      db.prepare('DELETE FROM notes WHERE id = ?').run(id);
      audit(user, 'delete', 'note', id, `zakázka #${cur.order_id}: ${cur.text.slice(0, 80)}`);
      return { id };
    });
  }

  function exportCsv() {
    const csvCell = (v) => {
      let s = String(v ?? '');
      if (/^[=+\-@]/.test(s)) s = "'" + s; // ochrana proti vzorcům v Excelu
      return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const d = (iso) => (iso ? `${iso.slice(8, 10)}. ${iso.slice(5, 7)}. ${iso.slice(0, 4)}` : '');
    const rows = [['Číslo zakázky', 'Odběratel', 'Lokalita', 'Faktura', 'Datum zaevidování', 'Poznámky', 'Skrytý rok']];
    const hiddenSet = new Set(listHiddenYears());
    for (const o of listOrders()) {
      const notes = o.notes.slice().reverse().map((n) => `${n.author}: ${n.text}`).join('\n');
      if (!o.invoices.length) rows.push([o.number, o.customer, o.location, '', '', notes, hiddenSet.has(o.year) ? 'ano' : '']);
      o.invoices.forEach((i, idx) => rows.push([o.number, o.customer, o.location, i.number, d(i.date), idx === 0 ? notes : '', hiddenSet.has(o.year) ? 'ano' : '']));
    }
    return '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
  }

  // ---------- HTTP ----------
  function readBody(req) {
    return new Promise((resolve, reject) => {
      let size = 0; const chunks = [];
      req.on('data', (c) => { size += c.length; if (size > 100_000) { reject(new HttpError(413, 'invalid', 'Příliš velký požadavek.')); req.destroy(); } else chunks.push(c); });
      req.on('end', () => {
        if (!chunks.length) return resolve({});
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(bad('Neplatný JSON.')); }
      });
      req.on('error', reject);
    });
  }

  function currentUser(req) {
    if (IS_LOCAL) return os.userInfo().username; // lokální režim: uživatel = přihlášený účet Windows
    try { return decodeURIComponent(String(req.headers['x-user'] || '')).slice(0, 60).trim() || 'neznámý'; } catch { return 'neznámý'; }
  }

  function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data === undefined ? '' : JSON.stringify(data));
  }

  async function handleApi(req, res, url) {
    const user = currentUser(req);
    const m = (re) => re.exec(url.pathname);
    let r;

    if (req.method === 'GET' && url.pathname === '/api/rev') return sendJson(res, 200, { rev: getRev() });
    if (req.method === 'GET' && url.pathname === '/api/me') return sendJson(res, 200, { user: IS_LOCAL ? user : null, askName: !IS_LOCAL, dbFile: DB_FILE, version: PKG.version, author: PKG.author });
    if (req.method === 'GET' && url.pathname === '/api/orders') return sendJson(res, 200, { rev: getRev(), orders: listOrders(), hiddenYears: listHiddenYears() });
    if (req.method === 'GET' && url.pathname === '/api/next-number') {
      const year = Number(url.searchParams.get('year')) || new Date().getFullYear();
      return sendJson(res, 200, { number: `${pad(nextSeq(year))}/${year}` });
    }
    if (req.method === 'GET' && url.pathname === '/api/audit') {
      const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 1000);
      return sendJson(res, 200, db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT ?').all(limit));
    }
    if (req.method === 'GET' && url.pathname === '/api/export.csv') {
      res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="zakazky.csv"' });
      return res.end(exportCsv());
    }

    if ((r = m(/^\/api\/years\/(\d{4})\/(hide|unhide)$/)) && req.method === 'POST') return sendJson(res, 200, setYearHidden(Number(r[1]), r[2] === 'hide', user));
    if (req.method === 'POST' && url.pathname === '/api/orders') return sendJson(res, 201, createOrder(await readBody(req), user));
    if ((r = m(/^\/api\/orders\/(\d+)$/))) {
      if (req.method === 'PUT') return sendJson(res, 200, updateOrder(Number(r[1]), await readBody(req), user));
      if (req.method === 'DELETE') return sendJson(res, 200, deleteOrder(Number(r[1]), user));
    }
    if ((r = m(/^\/api\/orders\/(\d+)\/invoices$/)) && req.method === 'POST') return sendJson(res, 201, createInvoice(Number(r[1]), await readBody(req), user));
    if ((r = m(/^\/api\/orders\/(\d+)\/notes$/)) && req.method === 'POST') return sendJson(res, 201, createNote(Number(r[1]), await readBody(req), user));
    if ((r = m(/^\/api\/invoices\/(\d+)$/))) {
      if (req.method === 'PUT') return sendJson(res, 200, updateInvoice(Number(r[1]), await readBody(req), user));
      if (req.method === 'DELETE') return sendJson(res, 200, deleteInvoice(Number(r[1]), user));
    }
    if ((r = m(/^\/api\/notes\/(\d+)$/))) {
      if (req.method === 'PUT') return sendJson(res, 200, updateNote(Number(r[1]), await readBody(req), user));
      if (req.method === 'DELETE') return sendJson(res, 200, deleteNote(Number(r[1]), user));
    }
    throw new HttpError(404, 'notfound', 'Neznámá adresa.');
  }

  function serveStatic(req, res, url) {
    let rel = decodeURIComponent(url.pathname);
    if (rel === '/') rel = '/index.html';
    const file = path.normalize(path.join(PUBLIC_DIR, rel));
    if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nenalezeno');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  }

  /** Volitelný přístupový token: server odpovídá jen oknu aplikace, které ho dostalo při startu. */
  function tokenGate(req, res, url) {
    if (!TOKEN) return true;
    const cookie = /(?:^|;\s*)zk=([^;]+)/.exec(req.headers.cookie || '');
    const sent = Buffer.from(cookie ? cookie[1] : '');
    const want = Buffer.from(TOKEN);
    if (sent.length === want.length && crypto.timingSafeEqual(sent, want)) return true;
    const k = Buffer.from(url.searchParams.get('k') || '');
    if (k.length === want.length && crypto.timingSafeEqual(k, want)) {
      res.writeHead(302, { 'Set-Cookie': `zk=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`, Location: url.pathname });
      res.end();
      return false;
    }
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Přístup odepřen.');
    return false;
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!tokenGate(req, res, url)) return;
      if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
      else serveStatic(req, res, url);
    } catch (e) {
      let status = e.status || 500, code = e.code || 'error', message = e.message;
      if (/UNIQUE constraint/i.test(String(e.message))) { status = 409; code = 'duplicate'; message = 'Takové číslo už existuje.'; }
      else if (!e.status) { console.error(e); message = 'Chyba serveru: ' + e.message; }
      if (!res.headersSent) sendJson(res, status, { error: message, code });
      else res.end();
    }
  });

  // ---------- ukázková data (jen s demo a prázdnou databází) ----------
  function seedDemo() {
    if (db.prepare('SELECT COUNT(*) AS n FROM orders').get().n > 0) return;
    const customers = ['Stavby s.r.o.', 'Jan Novák', 'Město Ostrava', 'Metrostav a.s.', 'Elektro-instal s.r.o.', 'Obec Vysoké', 'Agrostav a.s.', 'Petr Dvořák'];
    const places = ['Brno, Vídeňská', 'Plzeň, k.ú. Skvrňany', 'Ostrava, Nádražní', 'Praha 4, Budějovická', 'k.ú. Liberec', 'Olomouc, Masarykova', 'Zlín, k.ú. Prštné'];
    const noteSamples = [
      'Odběratel potvrdil rozsah prací telefonicky, čeká se na písemnou objednávku.',
      'Zaměření proběhlo, podklady jsou ve složce projektu.',
      'Fakturace po dokončení první etapy.',
    ];
    const invSeq = {};
    let n = 0;
    tx(() => {
      for (const [year, count] of [[2025, 12], [2026, 28]]) {
        for (let s = 1; s <= count; s++, n++) {
          const r = db.prepare('INSERT INTO orders (seq, year, customer, location, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)')
            .run(s, year, customers[(n * 3) % customers.length], places[(n * 5) % places.length], 'demo', now(), 'demo', now());
          const orderId = Number(r.lastInsertRowid);
          const invCount = n % 4 === 3 ? 0 : (n % 5 === 0 ? 2 : 1);
          for (let k = 0; k < invCount; k++) {
            invSeq[year] = (invSeq[year] ?? 0) + 1;
            const date = (n + k) % 3 === 0 ? null : `${year}-${pad(1 + ((n + k) % 12))}-${pad(1 + ((n * 7 + k) % 28))}`;
            db.prepare('INSERT INTO invoices (order_id, seq, year, date, created_by, created_at, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?)')
              .run(orderId, invSeq[year], year, date, 'demo', now(), 'demo', now());
          }
          if (n % 3 === 1) {
            db.prepare('INSERT INTO notes (order_id, text, created_by, created_at) VALUES (?,?,?,?)')
              .run(orderId, noteSamples[n % noteSamples.length], 'demo', new Date(Date.now() - (n % 9) * 86400000).toISOString());
          }
        }
      }
    });
    console.log('Vložena ukázková data.');
  }

  if (opts.demo) seedDemo();
  dailyBackup();

  const port = await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? 0, HOST, () => resolve(server.address().port));
  });

  return {
    port, host: HOST, dbFile: DB_FILE,
    close: () => new Promise((resolve) => {
      server.close(() => { try { db.close(); } catch { /* už zavřeno */ } resolve(); });
      server.closeAllConnections?.();
    }),
  };
}

module.exports = { startServer, loadConfig, readText };

// ---------- spuštění z příkazové řádky (bez Electronu, pro vývoj/testy) ----------
if (require.main === module) {
  const args = process.argv.slice(2);
  const flag = (name) => {
    const i = args.indexOf('--' + name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    return v && !v.startsWith('--') ? v : true;
  };
  const { cfg, baseDir } = loadConfig([path.join(__dirname, 'config.json')]);
  const dataDir = path.resolve(flag('data') ? process.cwd() : baseDir, String(flag('data') ?? cfg.dataDir ?? '../data'));
  startServer({
    host: String(flag('host') ?? cfg.host ?? '127.0.0.1'),
    port: Number(flag('port') ?? cfg.port ?? 3000),
    dataDir,
    keepDays: cfg.backupKeepDays,
    demo: !!flag('demo'),
  }).then((s) => {
    console.log(`Evidence zakázek běží na http://${s.host === '0.0.0.0' ? 'localhost' : s.host}:${s.port}`);
    console.log(`Databáze: ${s.dbFile}`);
  }).catch((e) => {
    if (e.code === 'EADDRINUSE') { console.log('Port už používá jiná instance aplikace.'); process.exit(0); }
    console.error(e);
    process.exit(1);
  });
}
