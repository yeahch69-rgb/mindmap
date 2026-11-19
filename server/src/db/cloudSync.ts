import fs from 'fs';
import path from 'path';
import os from 'os';
import zlib from 'zlib';
import crypto from 'crypto';
import Database from 'better-sqlite3';
import { db, getDbPath, reloadDatabase } from './database.js';

interface ServiceAccountConfig {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

export interface CloudSyncStatus {
  enabled: boolean;
  status: 'ACTIVE' | 'SYNCING' | 'NEEDS_SETUP' | 'DISABLED' | 'ERROR';
  projectId: string | null;
  lastSyncedAt: string | null;
  lastRestoredAt: string | null;
  lastReason: string | null;
  rawSizeBytes: number | null;
  compressedSizeBytes: number | null;
  message: string;
}

const FIRESTORE_COLLECTION = 'mindmap_cloud_db';
const CHUNK_SIZE = 700_000; // Well under Firestore's 1 MiB document limit

let cachedServiceAccount: ServiceAccountConfig | null | undefined = undefined;
let cachedAccessToken: { token: string; expiresAtMs: number } | null = null;

const syncState: CloudSyncStatus = {
  enabled: false,
  status: 'NEEDS_SETUP',
  projectId: null,
  lastSyncedAt: null,
  lastRestoredAt: null,
  lastReason: null,
  rawSizeBytes: null,
  compressedSizeBytes: null,
  message: 'Firebase 서비스 계정 설정 대기 중',
};

let lastUploadedSha256: string | null = null;
let isSyncInProgress = false;
let pendingBackupReason: string | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let shutdownHooksRegistered = false;

function normalizePrivateKey(raw: string): string {
  return raw.replace(/\\n/g, '\n').trim();
}

function loadServiceAccountConfig(): ServiceAccountConfig | null {
  if (cachedServiceAccount !== undefined) return cachedServiceAccount;

  if (process.env.DISABLE_CLOUD_SYNC === 'true') {
    syncState.enabled = false;
    syncState.status = 'DISABLED';
    syncState.message = 'DISABLE_CLOUD_SYNC 환경변수로 비활성화되어 있습니다.';
    cachedServiceAccount = null;
    return null;
  }

  let parsedJson: any = null;
  const rawJsonEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  const base64Env = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64?.trim();
  const filePathEnv = process.env.FIREBASE_SERVICE_ACCOUNT_PATH?.trim();

  try {
    if (rawJsonEnv) {
      parsedJson = JSON.parse(rawJsonEnv);
    } else if (base64Env) {
      parsedJson = JSON.parse(Buffer.from(base64Env, 'base64').toString('utf8'));
    } else if (filePathEnv && fs.existsSync(filePathEnv)) {
      parsedJson = JSON.parse(fs.readFileSync(filePathEnv, 'utf8'));
    }
  } catch (err: any) {
    console.warn('[CloudSync] Failed to parse Firebase service account JSON:', err?.message || err);
  }

  const projectId = String(
    parsedJson?.project_id || process.env.FIREBASE_PROJECT_ID || ''
  ).trim();
  const clientEmail = String(
    parsedJson?.client_email || process.env.FIREBASE_CLIENT_EMAIL || ''
  ).trim();
  const privateKey = normalizePrivateKey(
    String(parsedJson?.private_key || process.env.FIREBASE_PRIVATE_KEY || '')
  );

  if (!projectId || !clientEmail || !privateKey) {
    syncState.enabled = false;
    syncState.status = 'NEEDS_SETUP';
    syncState.projectId = projectId || null;
    syncState.message =
      'FIREBASE_SERVICE_ACCOUNT_JSON 환경변수가 설정되지 않았습니다 (로컬 SQLite 단독 실행 중).';
    cachedServiceAccount = null;
    return null;
  }

  cachedServiceAccount = { projectId, clientEmail, privateKey };
  syncState.enabled = true;
  syncState.projectId = projectId;
  return cachedServiceAccount;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function getGoogleAccessToken(sa: ServiceAccountConfig): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  if (cachedAccessToken && Date.now() < cachedAccessToken.expiresAtMs - 60_000) {
    return cachedAccessToken.token;
  }

  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: sa.clientEmail,
      scope: 'https://www.googleapis.com/auth/datastore',
      aud: 'https://oauth2.googleapis.com/token',
      exp: nowSec + 3600,
      iat: nowSec,
    })
  );

  const unsignedJwt = `${header}.${claimSet}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  const signature = base64UrlEncode(signer.sign(sa.privateKey));
  const assertion = `${unsignedJwt}.${signature}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    throw new Error(`Google OAuth token exchange failed (${tokenRes.status}): ${errText}`);
  }

  const tokenData = (await tokenRes.json()) as { access_token: string; expires_in?: number };
  cachedAccessToken = {
    token: tokenData.access_token,
    expiresAtMs: Date.now() + (tokenData.expires_in || 3600) * 1000,
  };
  return tokenData.access_token;
}

function getFirestoreDocUrl(projectId: string, docId: string): string {
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
    projectId
  )}/databases/(default)/documents/${FIRESTORE_COLLECTION}/${encodeURIComponent(docId)}`;
}

async function firestoreGetDoc(sa: ServiceAccountConfig, docId: string, token: string) {
  const res = await fetch(getFirestoreDocUrl(sa.projectId, docId), {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore GET ${docId} failed (${res.status}): ${txt}`);
  }
  return (await res.json()) as any;
}

async function firestoreUpsertDoc(
  sa: ServiceAccountConfig,
  docId: string,
  fields: Record<string, any>,
  token: string
) {
  const res = await fetch(getFirestoreDocUrl(sa.projectId, docId), {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore PATCH ${docId} failed (${res.status}): ${txt}`);
  }
}

function verifySqliteFile(filePath: string): {
  valid: boolean;
  userCount: number;
  projectCount: number;
  error?: string;
} {
  try {
    if (!fs.existsSync(filePath)) {
      return { valid: false, userCount: 0, projectCount: 0, error: 'File does not exist' };
    }
    const stat = fs.statSync(filePath);
    if (stat.size < 4096) {
      return { valid: false, userCount: 0, projectCount: 0, error: 'SQLite file too small' };
    }

    const headerBuf = Buffer.alloc(16);
    const fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, headerBuf, 0, 16, 0);
    fs.closeSync(fd);

    if (headerBuf.toString('utf8', 0, 15) !== 'SQLite format 3') {
      return { valid: false, userCount: 0, projectCount: 0, error: 'Invalid SQLite header' };
    }

    const testDb = new Database(filePath, { readonly: true });
    try {
      const integrity = testDb.pragma('integrity_check') as any[];
      if (!integrity || integrity[0]?.integrity_check !== 'ok') {
        testDb.close();
        return { valid: false, userCount: 0, projectCount: 0, error: 'integrity_check failed' };
      }

      const uRow = testDb.prepare('SELECT COUNT(*) as count FROM users').get() as {
        count: number;
      };
      const pRow = testDb.prepare('SELECT COUNT(*) as count FROM journal_projects').get() as {
        count: number;
      };
      testDb.close();
      return {
        valid: true,
        userCount: Number(uRow?.count || 0),
        projectCount: Number(pRow?.count || 0),
      };
    } catch (innerErr: any) {
      try {
        testDb.close();
      } catch {}
      return { valid: false, userCount: 0, projectCount: 0, error: innerErr.message };
    }
  } catch (err: any) {
    return { valid: false, userCount: 0, projectCount: 0, error: err.message };
  }
}

export function getCloudSyncStatus(): CloudSyncStatus {
  loadServiceAccountConfig();
  return { ...syncState };
}

export async function restoreDatabaseFromFirebaseOnStartup(): Promise<boolean> {
  const sa = loadServiceAccountConfig();
  if (!sa) return false;

  const tempRestorePath = path.resolve(
    os.tmpdir(),
    `mindmap_cloud_restore_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`
  );

  try {
    const token = await getGoogleAccessToken(sa);
    const manifestDoc = await firestoreGetDoc(sa, 'manifest', token);
    const fields = manifestDoc?.fields;
    if (!fields || !fields.chunkCount) {
      console.log(`☁️ [CloudSync] Connected to Firebase (${sa.projectId}). No remote snapshot yet.`);
      return false;
    }

    const chunkCount = parseInt(fields.chunkCount.integerValue || '0', 10);
    const expectedSha256 = fields.sha256?.stringValue || '';
    const updatedAt = fields.updatedAt?.stringValue || new Date().toISOString();

    if (chunkCount <= 0) return false;

    const chunks = await Promise.all(
      Array.from({ length: chunkCount }, async (_, i) => {
        const cDoc = await firestoreGetDoc(sa, `chunk_${i}`, token);
        const dataStr = cDoc?.fields?.data?.stringValue;
        if (typeof dataStr !== 'string') {
          throw new Error(`Missing data in Firestore chunk_${i}`);
        }
        return dataStr;
      })
    );

    const gzBuffer = Buffer.from(chunks.join(''), 'base64');
    const rawBuffer = zlib.gunzipSync(gzBuffer);

    if (expectedSha256) {
      const actualSha = crypto.createHash('sha256').update(rawBuffer).digest('hex');
      if (actualSha !== expectedSha256) {
        throw new Error(`Snapshot SHA-256 mismatch (expected ${expectedSha256}, got ${actualSha})`);
      }
    }

    fs.writeFileSync(tempRestorePath, rawBuffer);
    const verification = verifySqliteFile(tempRestorePath);
    if (!verification.valid) {
      throw new Error(`Restored DB failed verification: ${verification.error}`);
    }

    reloadDatabase(tempRestorePath);

    lastUploadedSha256 =
      expectedSha256 || crypto.createHash('sha256').update(rawBuffer).digest('hex');
    syncState.status = 'ACTIVE';
    syncState.lastRestoredAt = updatedAt;
    syncState.lastSyncedAt = updatedAt;
    syncState.rawSizeBytes = rawBuffer.length;
    syncState.compressedSizeBytes = gzBuffer.length;
    syncState.message = `Firebase Firestore(${sa.projectId})에서 DB 복원 완료 (사용자 ${verification.userCount}명, 프로젝트 ${verification.projectCount}개)`;

    console.log(
      `✅ [CloudSync] Restored SQLite DB from Firebase (${sa.projectId}) - Users: ${verification.userCount}, Projects: ${verification.projectCount}`
    );
    return true;
  } catch (err: any) {
    console.warn('[CloudSync] Startup restore error:', err?.message || err);
    syncState.status = 'ERROR';
    syncState.message = `복원 오류: ${err?.message || err}`;
    return false;
  } finally {
    try {
      if (fs.existsSync(tempRestorePath)) fs.unlinkSync(tempRestorePath);
    } catch {}
  }
}

export async function backupDatabaseToFirebase(reason = 'manual', force = false): Promise<boolean> {
  const sa = loadServiceAccountConfig();
  if (!sa) return false;

  if (isSyncInProgress) {
    pendingBackupReason = reason;
    return false;
  }

  isSyncInProgress = true;
  const tempPath = path.resolve(
    os.tmpdir(),
    `mindmap_cloud_snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}.db`
  );

  try {
    await db.backup(tempPath);

    const check = verifySqliteFile(tempPath);
    if (!check.valid) {
      throw new Error(`Local snapshot failed verification: ${check.error}`);
    }

    const rawBuffer = fs.readFileSync(tempPath);
    const rawSize = rawBuffer.length;
    const sha256 = crypto.createHash('sha256').update(rawBuffer).digest('hex');

    if (!force && lastUploadedSha256 === sha256 && syncState.status === 'ACTIVE') {
      return true;
    }

    const token = await getGoogleAccessToken(sa);

    // Safety guard: never overwrite an existing non-empty cloud backup with an empty fresh DB
    if (!lastUploadedSha256 && check.userCount === 0 && check.projectCount === 0) {
      const existingManifest = await firestoreGetDoc(sa, 'manifest', token);
      const remoteUsers = parseInt(existingManifest?.fields?.userCount?.integerValue || '0', 10);
      const remoteProjects = parseInt(
        existingManifest?.fields?.projectCount?.integerValue || '0',
        10
      );
      if (remoteUsers > 0 || remoteProjects > 0) {
        console.warn(
          '[CloudSync] Skipping backup of empty local DB because non-empty cloud snapshot exists.'
        );
        return false;
      }
    }

    syncState.status = 'SYNCING';

    const gzBuffer = zlib.gzipSync(rawBuffer, { level: 9 });
    const compressedSize = gzBuffer.length;
    const base64Str = gzBuffer.toString('base64');

    const chunks: string[] = [];
    for (let i = 0; i < base64Str.length; i += CHUNK_SIZE) {
      chunks.push(base64Str.slice(i, i + CHUNK_SIZE));
    }

    for (let i = 0; i < chunks.length; i++) {
      await firestoreUpsertDoc(
        sa,
        `chunk_${i}`,
        {
          index: { integerValue: String(i) },
          data: { stringValue: chunks[i] },
        },
        token
      );
    }

    const nowIso = new Date().toISOString();
    await firestoreUpsertDoc(
      sa,
      'manifest',
      {
        chunkCount: { integerValue: String(chunks.length) },
        rawSizeBytes: { integerValue: String(rawSize) },
        compressedSizeBytes: { integerValue: String(compressedSize) },
        userCount: { integerValue: String(check.userCount) },
        projectCount: { integerValue: String(check.projectCount) },
        sha256: { stringValue: sha256 },
        updatedAt: { stringValue: nowIso },
        reason: { stringValue: reason },
      },
      token
    );

    lastUploadedSha256 = sha256;
    syncState.status = 'ACTIVE';
    syncState.lastSyncedAt = nowIso;
    syncState.lastReason = reason;
    syncState.rawSizeBytes = rawSize;
    syncState.compressedSizeBytes = compressedSize;
    syncState.message = `Firebase Firestore(${sa.projectId}) 자동 백업 가동 중 (${(
      compressedSize / 1024
    ).toFixed(1)} KB)`;

    console.log(
      `☁️ [CloudSync] Backed up SQLite DB to Firebase (${(rawSize / 1024).toFixed(1)}KB -> ${(
        compressedSize / 1024
      ).toFixed(1)}KB, reason: ${reason})`
    );
    return true;
  } catch (err: any) {
    console.warn('[CloudSync] Backup error:', err?.message || err);
    syncState.status = 'ERROR';
    syncState.message = `백업 오류: ${err?.message || err}`;
    return false;
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {}
    isSyncInProgress = false;

    if (pendingBackupReason) {
      const nextReason = pendingBackupReason;
      pendingBackupReason = null;
      scheduleCloudBackup(nextReason, 1000);
    }
  }
}

export function scheduleCloudBackup(reason = 'db_mutation', delayMs = 1200): void {
  const sa = loadServiceAccountConfig();
  if (!sa) return;

  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void backupDatabaseToFirebase(reason, false);
  }, delayMs);
}

function ensureShutdownHooks(): void {
  if (shutdownHooksRegistered) return;
  shutdownHooksRegistered = true;

  const handleShutdown = async (signal: string) => {
    const sa = loadServiceAccountConfig();
    if (!sa) {
      process.exit(0);
      return;
    }
    console.log(`☁️ [CloudSync] Received ${signal}, flushing final DB backup to Firebase...`);
    try {
      await backupDatabaseToFirebase(`shutdown_${signal}`, false);
    } catch {}
    process.exit(0);
  };

  process.once('SIGTERM', () => {
    void handleShutdown('SIGTERM');
  });
  process.once('SIGINT', () => {
    void handleShutdown('SIGINT');
  });
}

export function startCloudSyncDaemon(): void {
  ensureShutdownHooks();
  const sa = loadServiceAccountConfig();
  if (!sa) return;

  setTimeout(() => {
    void backupDatabaseToFirebase('server_startup', false);
  }, 2000);
}

export { getDbPath };
