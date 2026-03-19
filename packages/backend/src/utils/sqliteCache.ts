import path from 'path';
import zlib from 'zlib';
import Database from 'better-sqlite3';
import { makeLogger } from './logger';

const log = makeLogger();

let db: Database.Database | null = null;

export function init(dbPath: string | null) {
    if (db) return db;

    const { repoRoot } = require('../config/env');
    const resolvedPath = dbPath || path.resolve(repoRoot, 'data', 'cache.sqlite');
    const dir = path.dirname(resolvedPath);

    const fs = require('fs');
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }

    try {
        db = new Database(resolvedPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
    } catch {
        // SQLite fails on Windows bind mounts in Docker (SQLITE_IOERR_SHMOPEN).
        // Fall back to in-memory cache — safe since this is pure cache (no primary data).
        log.warn('SQLite persistent cache unavailable (filesystem limitation), using in-memory cache — data will not survive restarts');
        try { db?.close(); } catch {}
        for (const ext of ['', '-shm', '-wal']) {
            try { fs.unlinkSync(resolvedPath + ext); } catch {}
        }
        db = new Database(':memory:');
    }

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

function compress(obj: any) {
    return zlib.gzipSync(Buffer.from(JSON.stringify(obj)));
}

function decompress(buffer: Buffer) {
    return JSON.parse(zlib.gunzipSync(buffer).toString());
}

export function get(key: string) {
    if (!db) return null;
    const stmt = db.prepare('SELECT value, expires_at FROM CacheEntry WHERE key = ?');
    const row = stmt.get(key) as any;
    if (!row) return null;

    if (row.expires_at && row.expires_at < Date.now()) {
        const delStmt = db.prepare('DELETE FROM CacheEntry WHERE key = ?');
        delStmt.run(key);
        log.debug('Cache expired, deleted', { key });
        return null;
    }

    try {
        return decompress(row.value);
    } catch (e: any) {
        log.error('Cache decompress error', { key, error: e.message });
        return null;
    }
}

export function set(key: string, value: any, ttlMs: number) {
    if (!db) return;
    const compressed = compress(value);
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;

    const stmt = db.prepare(
        'INSERT OR REPLACE INTO CacheEntry (key, value, expires_at) VALUES (?, ?, ?)'
    );
    stmt.run(key, compressed, expiresAt);
    log.debug('Cache set', { key, bytes: compressed.length, expiresAt });
}

export function setRaw(key: string, value: any, ttlMs: number) {
    if (!db) return;
    const raw = Buffer.from(JSON.stringify(value));
    const expiresAt = ttlMs ? Date.now() + ttlMs : null;
    db.prepare(
        'INSERT OR REPLACE INTO CacheEntry (key, value, expires_at) VALUES (?, ?, ?)'
    ).run(key, raw, expiresAt);
    log.debug('Cache setRaw', { key, bytes: raw.length, expiresAt });
}

export function getRaw(key: string) {
    if (!db) return null;
    const stmt = db.prepare('SELECT value, expires_at FROM CacheEntry WHERE key = ?');
    const row = stmt.get(key) as any;
    if (!row) return null;
    if (row.expires_at && row.expires_at < Date.now()) {
        db.prepare('DELETE FROM CacheEntry WHERE key = ?').run(key);
        log.debug('Cache expired, deleted', { key });
        return null;
    }
    try {
        return JSON.parse(row.value.toString());
    } catch (e: any) {
        log.error('Cache getRaw parse error', { key, error: e.message });
        return null;
    }
}

export function del(key: string) {
    if (!db) return;
    db.prepare('DELETE FROM CacheEntry WHERE key = ?').run(key);
}

export function cleanExpired() {
    if (!db) return 0;
    const result = db.prepare('DELETE FROM CacheEntry WHERE expires_at < ?').run(Date.now());
    if (result.changes > 0) {
        log.debug('Cache GC: cleaned expired entries', { deleted: result.changes });
    }
    return result.changes;
}

export function vacuum() {
    if (!db) return;
    db.exec('VACUUM');
    log.debug('Cache VACUUM completed');
}

export function close() {
    if (db) {
        db.close();
        db = null;
        log.debug('SQLite cache closed');
    }
}
