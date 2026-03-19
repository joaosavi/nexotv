import express from 'express';
import compression from 'compression';
import { globalIpLimiter } from '../../src/middleware/rateLimiter';
import apiRouter from '../../src/routes/api';
import stremioRouter from '../../src/routes/stremio';

export function createTestApp() {
  const app = express();
  app.use(express.json({ limit: '512kb' }));
  app.use(compression());
  app.use(globalIpLimiter);
  app.use(apiRouter);
  app.use(stremioRouter);
  return app;
}
