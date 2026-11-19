import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { initDatabase } from './db/database.js';
import {
  backupDatabaseToFirebase,
  getCloudSyncStatus,
  restoreDatabaseFromFirebaseOnStartup,
  scheduleCloudBackup,
  startCloudSyncDaemon,
} from './db/cloudSync.js';
import { authenticateToken, requireAdmin } from './middleware/auth.js';
import { initWebPush, startPushScheduler } from './utils/webPush.js';
import authRoutes, { ensureAdminAccount } from './routes/auth.js';
import adminRoutes from './routes/admin.js';
import journalRoutes from './routes/journal.js';
import pushRoutes from './routes/push.js';

const app = express();
const PORT = Number(process.env.PORT) || 4100;

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    credentials: true,
  })
);
app.use(express.json({ limit: '5mb' }));

// Trigger debounced Firebase DB snapshot after mutating API calls
app.use('/api', (req, res, next) => {
  if (
    ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
    req.path !== '/push/test' &&
    req.path !== '/system/cloud-sync/backup'
  ) {
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 400) {
        scheduleCloudBackup(`${req.method} ${req.path}`, 1200);
      }
    });
  }
  next();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/system/cloud-sync', authenticateToken, requireAdmin, (_req, res) => {
  res.json({ status: getCloudSyncStatus() });
});

app.post('/api/system/cloud-sync/backup', authenticateToken, requireAdmin, async (_req, res) => {
  const ok = await backupDatabaseToFirebase('manual_user_trigger', true);
  res.json({ ok, status: getCloudSyncStatus() });
});

app.use('/api/auth', authRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/push', pushRoutes);

// Serve built client bundle in production when present
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../../client/dist');

if (fs.existsSync(clientDistPath)) {
  app.use(express.static(clientDistPath));
  app.get('/{*splat}', (_req, res) => {
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

async function bootstrap() {
  await restoreDatabaseFromFirebaseOnStartup();
  initDatabase();
  ensureAdminAccount();
  initWebPush();
  startPushScheduler();
  startCloudSyncDaemon();

  app.listen(PORT, () => {
    console.log(`Project Mindmap server listening on http://localhost:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
