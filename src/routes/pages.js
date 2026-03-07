const { Router } = require('express');
const path = require('path');
const { createManifest } = require('../addon/manifest');

const router = Router();

const publicDir = path.join(__dirname, '..', '..', 'public');

router.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/configure-xtream', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/configure', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/:token/configure', (req, res) => {
    return res.redirect(`/${encodeURIComponent(req.params.token)}/configure-xtream`);
});

router.get('/:token/configure-xtream', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/manifest.json', (req, res) => {
    const manifest = createManifest();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(manifest);
});

module.exports = router;
