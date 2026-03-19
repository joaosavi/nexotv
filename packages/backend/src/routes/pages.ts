import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { createManifest } from '../addon/manifest';

const router = Router();

// __dirname in compiled output = packages/backend/dist/src/routes/
// path to frontend dist: packages/frontend/dist/
const frontendDist = path.join(__dirname, '..', '..', '..', '..', 'frontend', 'dist');
const indexHtml = path.join(frontendDist, 'index.html');

function sendIndex(res: any, reqPath = '/') {
    if (fs.existsSync(indexHtml)) {
        res.sendFile(indexHtml);
    } else if (process.env.NODE_ENV !== 'production') {
        // In dev mode the Vite dev server runs on port 5173.
        // Redirect there so `localhost:7000/configure` works out of the box.
        const vitePort = process.env.VITE_PORT || '5173';
        const host = res.req?.hostname || 'localhost';
        res.redirect(302, `http://${host}:${vitePort}${reqPath}`);
    } else {
        res.status(503).send('Frontend not built. Run: pnpm --filter frontend build');
    }
}

router.get('/', (req, res) => {
    sendIndex(res, '/');
});

router.get('/configure', (req, res) => {
    sendIndex(res, '/configure');
});

router.get('/configure-iptv-org', (req, res) => {
    sendIndex(res, '/configure-iptv-org');
});

router.get('/configure-xtream', (req, res) => {
    res.redirect(301, '/configure');
});

router.get('/:token/configure', (req, res) => {
    sendIndex(res, `/${req.params.token}/configure`);
});

router.get('/:token/configure-xtream', (req, res) => {
    res.redirect(301, `/${encodeURIComponent(req.params.token)}/configure`);
});

router.get('/:token/configure-iptv-org', (req, res) => {
    sendIndex(res, `/${req.params.token}/configure-iptv-org`);
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
