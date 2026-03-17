const path = require('path');
const zlib = require('zlib');
const Database = require('better-sqlite3');
const { makeLogger } = require('./logger');

const log = makeLogger();

let db = null;

function init(dbPath) {
    if (db) return db;

    const resolvedPath = dbPath || path.resolve(process.cwd(), 'data', 'cache.sqlite');
    const dir = path.dirname(resolvedPath);

    const fs = require('fs');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(resolvedPath);

    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');

    db.exec(`
        CREATE TABLE IF NOT EXISTS CacheEntry (
            key TEXT PRIMARY KEY,
            value BLOB,
            expires_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_expires ON CacheEntry(expires_at);
    `);

    log.debug('SQLite cache initialized', { path: resolvedPath });
    return db;
}

function compress(obj) {
    return zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
}

function decompress(buffer) {
    return JSON.parse(zlib.gunzipSync(buffer).toString());
}

function get(key) {
    if (!db) return null;
    const stmt = db.prepare('SELECT value, expires_at FROM CacheEntry WHERE key = ?');
    const row = stmt.get(key);
    if (!row) return null;

    if (row.expires_at && row.expires_at < Date.now()) {
        const delStmt = db.prepare('DELETE FROM CacheEntry WHERE key = ?');
        delStmt.run(key);
        log.debug('Cache expired, deleted', { key });
        return null;
    }

    try {
        return decompress(row.value);
    } catch (e) {
        log.error('Cache decompress error', { key, error: e.message });
        return null;
    }
}

function set(key, value, ttlMs) {
    if (!db) return;
    const compressed = compress(value);
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;

    const stmt = db.prepare(
        'INSERT OR REPLACE INTO CacheEntry (key, value, expires_at) VALUES (?, ?, ?)'
    );
    stmt.run(key, compressed, expiresAt);
    log.debug('Cache set', { key, bytes: compressed.length, expiresAt });
}

function del(key) {
    if (!db) return;
    db.prepare('DELETE FROM CacheEntry WHERE key = ?').run(key);
}

function cleanExpired() {
    if (!db) return 0;
    const result = db.prepare('DELETE FROM CacheEntry WHERE expires_at < ?').run(Date.now());
    if (result.changes > 0) {
        log.debug('Cache GC: cleaned expired entries', { deleted: result.changes });
    }
    return result.changes;
}

function vacuum() {
    if (!db) return;
    db.exec('VACUUM');
    log.debug('Cache VACUUM completed');
}

function close() {
    if (db) {
        db.close();
        db = null;
        log.debug('SQLite cache closed');
    }
}

module.exports = { init, get, set, del, cleanExpired, vacuum, close };
