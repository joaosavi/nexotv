import { Router } from 'express';
import path from 'path';
import { createManifest } from '../addon/manifest';

const router = Router();

// Resolve correctly in both dev (src/routes) and prod (dist/src/routes)
const isDist = __dirname.split(path.sep).includes('dist');
const publicDir = isDist
    ? path.join(__dirname, '..', '..', '..', 'public')
    : path.join(__dirname, '..', '..', 'public');

router.get('/', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/configure', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/configure-iptv-org', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/configure-xtream', (req, res) => {
    res.redirect(301, '/configure');
});

router.get('/:token/configure', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/:token/configure-xtream', (req, res) => {
    res.redirect(301, `/${encodeURIComponent(req.params.token)}/configure`);
});

router.get('/:token/configure-iptv-org', (req, res) => {
    res.sendFile(path.join(publicDir, 'html', 'xtream-config.html'));
});

router.get('/manifest.json', (req, res) => {
    const manifest = createManifest() as any;
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    manifest.behaviorHints.configureUrl = `${baseUrl}/configure`;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json(manifest);
});

export default router;
