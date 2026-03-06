const { Router } = require('express');
const env = require('../config/env');

const router = Router();

router.get('/:token/logo/:tvgId.png', async (req, res) => {
    if (!req.addonInterface) {
        return res.redirect(`https://via.placeholder.com/250x375/333333/FFFFFF?text=${encodeURIComponent(req.params.tvgId)}`);
    }
    const sources = req.addonInterface._logoSources || [];
    if (!sources.length) {
        return res.redirect(`https://via.placeholder.com/250x375/333333/FFFFFF?text=${encodeURIComponent(req.params.tvgId)}`);
    }
    const { tvgId } = req.params;
    const rawId = tvgId;
    const noCountry = rawId.replace(/\.[a-z]{2,3}$/, '');
    const hyphenated = noCountry.replace(/[^a-zA-Z0-9]+/g, '-');
    const underscored = noCountry.replace(/[^a-zA-Z0-9]+/g, '_');
    const candidates = [...new Set([rawId, noCountry, hyphenated, underscored])];
    for (const cand of candidates) {
        for (const template of sources) {
            const url = template.replace('{id}', cand);
            try {
                const headCtrl = new AbortController();
                const headTimer = setTimeout(() => headCtrl.abort(), 7000);
                let head;
                let methodUsed = 'HEAD';
                try {
                    head = await fetch(url, { method: 'HEAD', signal: headCtrl.signal });
                } finally {
                    clearTimeout(headTimer);
                }
                if (!head.ok) {
                    const getCtrl = new AbortController();
                    const getTimer = setTimeout(() => getCtrl.abort(), 10000);
                    try {
                        head = await fetch(url, { method: 'GET', signal: getCtrl.signal });
                        methodUsed = 'GET';
                    } finally {
                        clearTimeout(getTimer);
                    }
                }
                if (head.ok) {
                    const len = parseInt(head.headers.get('content-length'), 10);
                    if (isNaN(len) || len > 50) {
                        if (req.userConfig && req.userConfig.resizeLogo === true) {
                            if (head.body) {
                                try { await head.body.cancel(); } catch (e) { /* ignore */ }
                            }
                            const wsrvUrl = `https://wsrv.nl/?url=${encodeURIComponent(url)}&w=250&h=375&fit=contain&bg=black`;
                            return res.redirect(wsrvUrl);
                        } else if (env.LOGO_CACHE_ENABLED === true) {
                            let resResponse = head;
                            if (methodUsed === 'HEAD') {
                                const getCtrl = new AbortController();
                                const getTimer = setTimeout(() => getCtrl.abort(), 10000);
                                try {
                                    resResponse = await fetch(url, { method: 'GET', signal: getCtrl.signal });
                                } finally {
                                    clearTimeout(getTimer);
                                }
                            }
                            const ct = resResponse.headers.get('content-type') || 'image/png';
                            const buf = Buffer.from(await resResponse.arrayBuffer());
                            if (buf.length > 50) {
                                res.setHeader('Content-Type', ct);
                                res.setHeader('Cache-Control', 'public, max-age=21600');
                                return res.end(buf);
                            }
                        } else {
                            if (head.body) {
                                try { await head.body.cancel(); } catch (e) { /* ignore */ }
                            }
                            return res.redirect(url);
                        }
                    }
                }
            } catch { /* continue */ }
        }
    }
    res.redirect(`https://via.placeholder.com/250x375/333333/FFFFFF?text=${encodeURIComponent(noCountry.toUpperCase().slice(0, 12))}`);
});

module.exports = router;
