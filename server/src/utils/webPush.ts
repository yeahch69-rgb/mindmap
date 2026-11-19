import https from 'node:https';
import webpush from 'web-push';
import { db } from '../db/database.js';
import {
  getJstDateStr,
  getJstDateStrWithDayOffset,
  getJstDateTimeStr,
  getJstTimeStr,
} from './jstTime.js';

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

function parseMinutes(hhmm: string | null | undefined): number | null {
  const m = String(hhmm || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function hasPushLog(dedupKey: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM journal_push_sent_log WHERE dedup_key = ?')
    .get(dedupKey);
  return Boolean(row);
}

function recordPushLog(dedupKey: string, nowJst: string): void {
  db.prepare(
    'INSERT OR IGNORE INTO journal_push_sent_log (dedup_key, sent_at) VALUES (?, ?)'
  ).run(dedupKey, nowJst);
}

function pruneOldPushLogs(): void {
  const cutoff = `${getJstDateStrWithDayOffset(-7)} 00:00:00`;
  db.prepare('DELETE FROM journal_push_sent_log WHERE sent_at < ?').run(cutoff);
}

function truncateText(text: string, maxLen = 36): string {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= maxLen) return clean;
  return `${clean.slice(0, maxLen - 1)}…`;
}

function getProjectParticipants(project: any): number[] {
  const memberRows =
    project.mode === 'COLLAB'
      ? (db
          .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
          .all(Number(project.id)) as Array<{ user_id: number }>)
      : [];
  return Array.from(
    new Set([Number(project.created_by), ...memberRows.map((m) => Number(m.user_id))])
  ).filter((id) => id > 0);
}

function getTurnHolderUserIds(project: any): number[] {
  if (project.mode !== 'COLLAB') {
    return [Number(project.created_by)].filter((id) => id > 0);
  }
  const memberRows = db
    .prepare('SELECT user_id FROM journal_project_members WHERE project_id = ?')
    .all(Number(project.id)) as Array<{ user_id: number }>;
  const memberIds = memberRows.map((m) => Number(m.user_id)).filter((id) => id > 0);

  if (project.active_turn_user_id) {
    const activeId = Number(project.active_turn_user_id);
    if (activeId === Number(project.created_by) || memberIds.includes(activeId)) {
      return [activeId];
    }
  }
  if (project.turn_state === 'THEIR_TURN') {
    const others = memberIds.filter((id) => id !== Number(project.created_by));
    if (others.length > 0) return Array.from(new Set(others));
  }
  return [Number(project.created_by)].filter((id) => id > 0);
}

async function sendBatchedDeadlinePush(
  project: any,
  targetUserIds: number[],
  entries: any[],
  targetDate: string,
  kind: 'eve' | 'morning',
  nowJst: string
) {
  const dedupKey = `due:${kind}:${project.id}:${targetDate}`;
  if (hasPushLog(dedupKey)) return;

  const items: string[] = [];
  if (
    project.next_action &&
    project.next_action_date &&
    String(project.next_action_date).slice(0, 10) === targetDate
  ) {
    items.push(`다음 할 일: ${truncateText(project.next_action, 28)}`);
  }
  for (const entry of entries) {
    if (String(entry.due_date || '').slice(0, 10) !== targetDate) continue;
    const timeLabel = entry.due_time ? ` (${entry.due_time})` : '';
    items.push(`${truncateText(entry.content, 28)}${timeLabel}`);
  }
  if (items.length === 0) return;

  const dayPrefix = kind === 'eve' ? `🌙 내일(${targetDate}) 마감` : `☀️ 오늘(${targetDate}) 마감`;
  const summary =
    items.length === 1
      ? `${dayPrefix} · ${items[0]}`
      : `${dayPrefix} (${items.length}건) · ${items[0]} 외 ${items.length - 1}건`;

  const sent = await sendPushToUsers(targetUserIds, {
    title: `📌 ${project.title}`,
    body: summary,
    projectId: Number(project.id),
    tag: `mindmap-due-${kind}-${project.id}-${targetDate}`,
  });
  if (sent > 0) {
    recordPushLog(dedupKey, nowJst);
  }
}

async function sendTimedEntryReminders(
  project: any,
  targetUserIds: number[],
  entries: any[],
  todayJst: string,
  nowMin: number,
  nowJst: string
) {
  for (const entry of entries) {
    if (String(entry.due_date || '').slice(0, 10) !== todayJst || !entry.due_time) continue;
    const dueMin = parseMinutes(entry.due_time);
    if (dueMin === null) continue;
    const diffMin = dueMin - nowMin;

    if (diffMin > 0 && diffMin <= 60) {
      const key = `due-1h:entry:${entry.id}:${todayJst}:${entry.due_time}`;
      if (!hasPushLog(key)) {
        const sent = await sendPushToUsers(targetUserIds, {
          title: `📌 ${project.title}`,
          body: `⏳ 마감 1시간 전 (${entry.due_time}): ${truncateText(entry.content, 40)}`,
          projectId: Number(project.id),
          tag: `mindmap-due-1h-${entry.id}`,
        });
        if (sent > 0) recordPushLog(key, nowJst);
      }
    } else if (diffMin <= 0 && diffMin >= -15) {
      const key = `due-now:entry:${entry.id}:${todayJst}:${entry.due_time}`;
      if (!hasPushLog(key)) {
        const sent = await sendPushToUsers(targetUserIds, {
          title: `📌 ${project.title}`,
          body: `⏰ 마감 시각 (${entry.due_time}): ${truncateText(entry.content, 40)}`,
          projectId: Number(project.id),
          tag: `mindmap-due-now-${entry.id}`,
        });
        if (sent > 0) recordPushLog(key, nowJst);
      }
    }
  }
}

async function runJournalReminderChecks() {
  const todayJst = getJstDateStr();
  const tomorrowJst = getJstDateStrWithDayOffset(1);
  const nowHHMM = getJstTimeStr();
  const nowJst = getJstDateTimeStr();
  const nowMin = parseMinutes(nowHHMM);

  try {
    pruneOldPushLogs();

    const activeProjects = db
      .prepare(`
        SELECT id, title, mode, turn_state, active_turn_user_id, next_action, next_action_date,
               stale_threshold_days, last_activity_at, stale_push_last_sent_at, created_by
        FROM journal_projects
        WHERE turn_state NOT IN ('DONE', 'HOLD')
      `)
      .all() as any[];

    const openDueEntries = db
      .prepare(`
        SELECT e.id, e.project_id, e.content, e.due_date, e.due_time
        FROM journal_entries e
        INNER JOIN journal_projects jp ON jp.id = e.project_id
        WHERE jp.turn_state NOT IN ('DONE', 'HOLD')
          AND e.due_date IS NOT NULL
          AND TRIM(e.due_date) != ''
          AND e.entry_type != 'PROGRESS'
          AND NOT EXISTS (
            SELECT 1 FROM journal_entries p
            WHERE p.project_id = e.project_id
              AND p.entry_type = 'PROGRESS'
              AND p.completed_target_type = 'ENTRY'
              AND p.completed_target_id = e.id
          )
      `)
      .all() as any[];

    const entriesByProject = new Map<number, any[]>();
    for (const row of openDueEntries) {
      const pid = Number(row.project_id);
      const list = entriesByProject.get(pid) || [];
      list.push(row);
      entriesByProject.set(pid, list);
    }

    for (const p of activeProjects) {
      const targetUserIds = getProjectParticipants(p);
      if (targetUserIds.length === 0) continue;

      const projectEntries = entriesByProject.get(Number(p.id)) || [];

      if (nowHHMM >= '20:00') {
        await sendBatchedDeadlinePush(p, targetUserIds, projectEntries, tomorrowJst, 'eve', nowJst);
      }
      if (nowHHMM >= '08:00') {
        await sendBatchedDeadlinePush(p, targetUserIds, projectEntries, todayJst, 'morning', nowJst);
      }
      if (nowMin !== null) {
        await sendTimedEntryReminders(p, targetUserIds, projectEntries, todayJst, nowMin, nowJst);
      }

      if (nowHHMM >= '09:00') {
        const staleKey = `stale:${p.id}:${todayJst}`;
        if (!hasPushLog(staleKey)) {
          const lastYmd = String(p.last_activity_at || todayJst).slice(0, 10);
          const daysSinceUpdate = diffJstDays(lastYmd, todayJst);
          const threshold = Math.max(1, Number(p.stale_threshold_days) || 7);
          if (daysSinceUpdate >= threshold) {
            const turnHolders = getTurnHolderUserIds(p);
            const sent = await sendPushToUsers(turnHolders, {
              title: `📌 ${p.title}`,
              body: `⏳ D+${daysSinceUpdate}일째 응답·업데이트가 없습니다. 현재 내 턴을 확인해 주세요.`,
              projectId: Number(p.id),
              tag: `mindmap-stale-${p.id}-${todayJst}`,
            });
            if (sent > 0) {
              recordPushLog(staleKey, nowJst);
              db.prepare('UPDATE journal_projects SET stale_push_last_sent_at = ? WHERE id = ?').run(
                todayJst,
                Number(p.id)
              );
            }
          }
        }
      }
    }
  } catch (err: any) {
    console.warn('Mindmap push reminder check error:', err?.message || err);
  }
}

export function startPushScheduler() {
  setTimeout(() => {
    void runJournalReminderChecks();
  }, 20_000);
  setInterval(() => {
    void runJournalReminderChecks();
  }, 60 * 1000);
}
