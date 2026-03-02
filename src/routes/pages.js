const { Router } = require('express');
const path = require('path');
const { createManifest } = require('../addon/manifest');

const router = Router();

// The static dir is passed via the app or computed here
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

// Legacy redirect
router.get('/:token/configure', (req, res) => {
    return res.redirect(`/${encodeURIComponent(req.params.token)}/configure-xtream`);
});

router.get('/:token/configure-xtream', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/manifest.json', (req, res) => {
    const manifest = createManifest();
    res.json(manifest);
});

module.exports = router;
