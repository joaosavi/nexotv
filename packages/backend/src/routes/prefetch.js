'use strict';

/**
 * Server-side fetch to bypass browser CORS for playlist/EPG configuration pre-flight.
 * Includes basic SSRF protection by blocking local/private network ranges.
 */

const { Router } = require('express');
const dns = require('dns').promises;
const env = require('../config/env');
const { makeLogger } = require('../utils/logger');
const { isPrivateIp } = require('../middleware/ssrf');

const router = Router();
const log = makeLogger();

const PREFETCH_MAX_BYTES = env.PREFETCH_MAX_BYTES;
const PREFETCH_ENABLED = env.PREFETCH_ENABLED;

router.post('/api/prefetch', async (req, res) => {
    if (!PREFETCH_ENABLED) return res.status(403).json({ error: 'Prefetch disabled by server' });

    const { url, purpose } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'Missing url' });
    if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'Only http(s) URLs allowed' });

    try {
        const u = new URL(url);
        const host = u.hostname;
        // Basic SSRF / local network block
        if (
            !env.ALLOW_LOCAL_URLS && (
                host === 'localhost' ||
                host === '0.0.0.0' ||
                /^127\./.test(host) ||
                /^10\./.test(host) ||
                /^192\.168\./.test(host) ||
                /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host) ||
                /^169\.254\./.test(host)
            )
        ) {
            return res.status(400).json({ error: 'Blocked host' });
        }

        log.debug('Prefetch start', { url, purpose });

        try {
            const resolved = await dns.lookup(u.hostname);
            if (isPrivateIp(resolved.address)) {
                return res.status(400).json({ error: 'Blocked host' });
            }
        } catch {
            return res.status(400).json({ error: 'Cannot resolve host' });
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 45000);

        let fetched;
        try {
            fetched = await fetch(url, {
                method: 'GET',
                signal: controller.signal,
                headers: { 'User-Agent': 'NexoTV Prefetch/2.0' }
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!fetched.ok) {
            log.debug('Prefetch non-OK', fetched.status, url);
            return res.status(502).json({ error: `Fetch failed (${fetched.status})` });
        }

        // Accumulate stream with a byte limit
        const chunks = [];
        let received = 0;
        let truncated = false;

        if (fetched.body) {
            if (typeof fetched.body.getReader === 'function') {
                const reader = fetched.body.getReader();
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;

                    received += value.length;
                    if (received <= PREFETCH_MAX_BYTES) {
                        chunks.push(Buffer.from(value));
                    } else {
                        truncated = true;
                        reader.cancel().catch(() => { });
                        break;
                    }
                }
            } else if (typeof fetched.body.on === 'function') {
                await new Promise((resolve, reject) => {
                    const onData = (chunk) => {
                        received += chunk.length;
                        if (received <= PREFETCH_MAX_BYTES) {
                            chunks.push(Buffer.from(chunk));
                        } else {
                            truncated = true;
                            fetched.body.removeListener('data', onData);
                            if (typeof fetched.body.destroy === 'function') {
                                fetched.body.destroy();
                            }
                            resolve();
                        }
                    };
                    fetched.body.on('data', onData);
                    fetched.body.on('end', resolve);
                    fetched.body.on('error', reject);
                });
            } else {
                // Async iterable fallback
                for await (const chunk of fetched.body) {
                    received += chunk.length;
                    if (received <= PREFETCH_MAX_BYTES) {
                        chunks.push(Buffer.from(chunk));
                    } else {
                        truncated = true;
                        break;
                    }
                }
            }
        }

        let content = Buffer.concat(chunks).toString('utf8');
        if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1); // strip BOM

        log.debug('Prefetch done', { bytes: received, truncated, returnedBytes: Buffer.byteLength(content) });

        res.json({
            ok: true,
            bytes: received,
            truncated,
            purpose: purpose || null,
            content
        });
    } catch (e) {
        log.debug('Prefetch error', e.message);
        res.status(500).json({
            error: 'Prefetch error',
            detail: env.DEBUG ? e.message : undefined
        });
    }
});

module.exports = router;
