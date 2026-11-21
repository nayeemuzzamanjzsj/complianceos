import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { createServer as createViteServer } from 'vite';
import { initDatabase } from './server/db.ts';
import { seedDemoData } from './server/seed.ts';
import { validateAuthConfig } from './server/services/auth.ts';
import { authRouter } from './server/routes/auth.ts';
import { adminRouter } from './server/routes/admin.ts';
import { regulatoryRouter } from './server/routes/regulatory.ts';
import { applicabilityRouter } from './server/routes/applicability.ts';
import { workspaceRouter } from './server/routes/workspace.ts';

async function startServer() {
  validateAuthConfig();
  initDatabase();
  seedDemoData();

  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ComplianceOS', timestamp: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api', regulatoryRouter);
  app.use('/api', applicabilityRouter);
  app.use('/api', workspaceRouter);

  // Clean JSON error handler for API routes (never leak stack traces or internal DB details)
  app.use('/api', (err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.name === 'MulterError') {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Uploaded file exceeds the 10 MB size limit.'
          : 'Invalid file upload request.';
      res.status(400).json({ error: msg });
      return;
    }
    const status = typeof err?.status === 'number' ? err.status : 500;
    if (status >= 500) {
      console.error('[API Error]', err);
      res.status(status).json({ error: 'An unexpected server error occurred.' });
      return;
    }
    res.status(status).json({ error: err?.message || 'Invalid request.' });
  });

  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = Number(process.env.PORT) || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`ComplianceOS server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start ComplianceOS server:', err);
  process.exit(1);
});
