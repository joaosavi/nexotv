import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { createManifest } from '../addon/manifest';

const router = Router();

// __dirname in compiled output = packages/backend/dist/src/routes/
// path to frontend dist: packages/frontend/dist/
const frontendDist = path.join(__dirname, '..', '..', '..', '..', 'frontend', 'dist');
const indexHtml = path.join(frontendDist, 'index.html');

function sendIndex(res: any) {
    if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
    } else {
        res.status(503).send('Frontend not built. Run: pnpm --filter frontend build');
    }
}

router.get('/', (req, res) => {
    sendIndex(res);
});

router.get('/configure', (req, res) => {
    sendIndex(res);
});

router.get('/configure-iptv-org', (req, res) => {
    sendIndex(res);
});

router.get('/configure-xtream', (req, res) => {
    res.redirect(301, '/configure');
});

router.get('/:token/configure', (req, res) => {
    sendIndex(res);
});

router.get('/:token/configure-xtream', (req, res) => {
    res.redirect(301, `/${encodeURIComponent(req.params.token)}/configure`);
});

router.get('/:token/configure-iptv-org', (req, res) => {
    sendIndex(res);
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
