import https from 'node:https';
import webpush from 'web-push';
import { db } from '../db/database.js';
import { getJstDateStr } from './jstTime.js';

const pushHttpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 30000,
  maxSockets: 20,
  maxFreeSockets: 10,
});

const PUSH_REQUEST_OPTIONS: webpush.RequestOptions = {
  urgency: 'high',
  TTL: 86400,
  timeout: 10000,
  agent: pushHttpsAgent,
};

let cachedPublicKey = '';
let pushInitialized = false;

export function initWebPush() {
  let publicKey = process.env.VAPID_PUBLIC_KEY?.trim() || '';
  let privateKey = process.env.VAPID_PRIVATE_KEY?.trim() || '';

  if (!publicKey || !privateKey) {
    const pubRow = db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_public_key'").get() as { value: string } | undefined;
    const privRow = db.prepare("SELECT value FROM app_settings WHERE key = 'vapid_private_key'").get() as { value: string } | undefined;
    if (pubRow?.value && privRow?.value) {
      publicKey = pubRow.value;
      privateKey = privRow.value;
    } else {
      const generated = webpush.generateVAPIDKeys();
      publicKey = generated.publicKey;
      privateKey = generated.privateKey;
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_public_key', ?)").run(publicKey);
      db.prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('vapid_private_key', ?)").run(privateKey);
    }
  }

  cachedPublicKey = publicKey;
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:noreply@project-mindmap.local',
      publicKey,
      privateKey
    );
    pushInitialized = true;
  } catch (err: any) {
    console.warn('Web Push VAPID setup warning:', err?.message || err);
  }
}

export function getPublicVapidKey(): string {
  if (!cachedPublicKey) {
    initWebPush();
  }
  return cachedPublicKey;
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
  projectId?: number;
}

export async function sendPushToUsers(userIds: number[], payload: PushNotificationPayload): Promise<number> {
  if (!pushInitialized) initWebPush();
  const uniqueIds = Array.from(new Set(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return 0;

  const placeholders = uniqueIds.map(() => '?').join(',');
  const subs = db
    .prepare(`
      SELECT s.id, s.endpoint, s.p256dh, s.auth
      FROM push_subscriptions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.user_id IN (${placeholders}) AND COALESCE(u.push_enabled, 1) = 1
    `)
    .all(...uniqueIds) as Array<{ id: number; endpoint: string; p256dh: string; auth: string }>;

  if (subs.length === 0) return 0;

  const bodyStr = JSON.stringify({
    title: payload.title,
    body: payload.body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: {
      url: payload.url || (payload.projectId ? `/?project=${payload.projectId}` : '/'),
      projectId: payload.projectId,
      tag: payload.tag || 'mindmap-alert',
    },
  });

  let sentCount = 0;
  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          bodyStr,
          PUSH_REQUEST_OPTIONS
        );
        sentCount += 1;
      } catch (err: any) {
        const statusCode = err?.statusCode;
        if (statusCode === 404 || statusCode === 410) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        }
      }
    })
  );

  return sentCount;
}

function diffJstDays(fromYmd: string, toYmd: string): number {
  const [fy, fm, fd] = String(fromYmd || '').slice(0, 10).split('-').map(Number);
  const [ty, tm, td] = String(toYmd || '').slice(0, 10).split('-').map(Number);
  if (!fy || !fm || !fd || !ty || !tm || !td) return 0;
  const fromMs = Date.UTC(fy, fm - 1, fd);
  const toMs = Date.UTC(ty, tm - 1, td);
  return Math.max(0, Math.floor((toMs - fromMs) / (24 * 60 * 60 * 1000)));
}

async function runStaleAndDueCheck() {
  const todayJst = getJstDateStr();
  try {
    const activeProjects = db
      .prepare(`
        SELECT id, title, mode, turn_state, active_turn_user_id, next_action, next_action_date,
               stale_threshold_days, last_activity_at, stale_push_last_sent_at, created_by
        FROM journal_projects
        WHERE turn_state NOT IN ('DONE', 'HOLD')
          AND COALESCE(stale_push_last_sent_at, '') != ?
      `)
      .all(todayJst) as any[];

    for (const p of activeProjects) {
      const lastYmd = String(p.last_activity_at || todayJst).slice(0, 10);
      const daysSinceUpdate = diffJstDays(lastYmd, todayJst);
      const threshold = Math.max(1, Number(p.stale_threshold_days) || 7);
      const isStale = daysSinceUpdate >= threshold;
      const isDueOrOverdue = Boolean(
        p.next_action && p.next_action_date && String(p.next_action_date).slice(0, 10) <= todayJst
      );

      if (!isStale && !isDueOrOverdue) continue;

      const memberRows = db
        .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
        .all(Number(p.id)) as Array<{ user_id: number }>;

      const targetUserIds = [
        Number(p.created_by),
        ...(p.mode === 'COLLAB' ? memberRows.map((m) => Number(m.user_id)) : []),
      ];

      const body = isDueOrOverdue
        ? `📅 Next Step (${p.next_action_date}): ${p.next_action}`
        : `⏳ D+${daysSinceUpdate}일째 업데이트가 없습니다. 진행 상황을 점검해 보세요.`;

      const sent = await sendPushToUsers(targetUserIds, {
        title: `📌 ${p.title}`,
        body,
        projectId: Number(p.id),
        tag: `mindmap-remind-${p.id}-${todayJst}`,
      });

      if (sent > 0) {
        db.prepare('UPDATE journal_projects SET stale_push_last_sent_at = ? WHERE id = ?').run(
          todayJst,
          Number(p.id)
        );
      }
    }
  } catch (err: any) {
    console.warn('Mindmap push reminder check error:', err?.message || err);
  }
}

export function startPushScheduler() {
  // Check once 20s after boot, then every 30 minutes
  setTimeout(() => {
    void runStaleAndDueCheck();
  }, 20_000);
  setInterval(() => {
    void runStaleAndDueCheck();
  }, 30 * 60 * 1000);
}
