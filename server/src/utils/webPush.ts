import https from 'node:https';
import webpush from 'web-push';
import { db } from '../db/database.js';
import { scheduleCloudBackup } from '../db/cloudSync.js';
import {
  getJstDateStr,
  getJstDateStrWithDayOffset,
  getJstDateTimeStr,
  getJstTimeStr,
} from './jstTime.js';
import {
  addDaysYmd,
  diffDaysYmd as diffSignedDaysYmd,
  expandAnniversariesForRange,
  normalizeReminderDays,
  SpaceAnniversaryRecord,
} from './anniversaryLunar.js';

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
  title?: string;
  body?: string;
  titleKo?: string;
  bodyKo?: string;
  titleJa?: string;
  bodyJa?: string;
  titleEn?: string;
  bodyEn?: string;
  url?: string;
  tag?: string;
  projectId?: number;
}

function resolveLocalizedPush(payload: PushNotificationPayload, lang?: string | null): { title: string; body: string } {
  if (lang === 'ja') {
    return {
      title: payload.titleJa || payload.titleKo || payload.title || '',
      body: payload.bodyJa || payload.bodyKo || payload.body || '',
    };
  }
  if (lang === 'en') {
    return {
      title: payload.titleEn || payload.titleKo || payload.title || '',
      body: payload.bodyEn || payload.bodyKo || payload.body || '',
    };
  }
  return {
    title: payload.titleKo || payload.title || payload.titleEn || payload.titleJa || '',
    body: payload.bodyKo || payload.body || payload.bodyEn || payload.bodyJa || '',
  };
}

export async function sendPushToUsers(userIds: number[], payload: PushNotificationPayload): Promise<number> {
  if (!pushInitialized) initWebPush();
  const uniqueIds = Array.from(new Set(userIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (uniqueIds.length === 0) return 0;

  const placeholders = uniqueIds.map(() => '?').join(',');
  const subs = db
    .prepare(`
      SELECT s.id, s.endpoint, s.p256dh, s.auth, COALESCE(u.language, 'ko') as language
      FROM push_subscriptions s
      INNER JOIN users u ON u.id = s.user_id
      WHERE s.user_id IN (${placeholders}) AND COALESCE(u.push_enabled, 1) = 1
    `)
    .all(...uniqueIds) as Array<{ id: number; endpoint: string; p256dh: string; auth: string; language: string }>;

  if (subs.length === 0) return 0;

  let sentCount = 0;
  await Promise.all(
    subs.map(async (sub) => {
      const resolved = resolveLocalizedPush(payload, sub.language);
      const bodyStr = JSON.stringify({
        title: resolved.title,
        body: resolved.body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: {
          url: payload.url || (payload.projectId ? `/?project=${payload.projectId}` : '/'),
          projectId: payload.projectId,
          tag: payload.tag || 'mindmap-alert',
        },
      });
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

async function sendTurnWaitOverdueReminders(todayJst: string, nowJst: string) {
  const overdueWaits = db
    .prepare(`
      SELECT w.id, w.project_id, w.watcher_user_id, w.wait_days, w.started_at, w.target_date, w.target_name,
             p.title, p.mode, p.turn_state, p.active_turn_user_id, p.partner_name, p.created_by,
             (SELECT COUNT(*) FROM journal_project_members m WHERE m.project_id = p.id) as member_count
      FROM journal_turn_waits w
      INNER JOIN journal_projects p ON p.id = w.project_id
      WHERE w.notified_at IS NULL
        AND p.turn_state NOT IN ('DONE', 'HOLD')
        AND w.target_date <= ?
    `)
    .all(todayJst) as any[];

  for (const w of overdueWaits) {
    const watcherId = Number(w.watcher_user_id);
    if (!watcherId || watcherId <= 0) continue;

    const hasAppMembers = w.mode === 'COLLAB' && Number(w.member_count) > 0;
    const activeTurnId = w.active_turn_user_id ? Number(w.active_turn_user_id) : Number(w.created_by);
    const isStillWaiting = hasAppMembers
      ? activeTurnId !== watcherId
      : w.turn_state === 'THEIR_TURN';

    if (!isStillWaiting) {
      db.prepare('DELETE FROM journal_turn_waits WHERE id = ?').run(w.id);
      continue;
    }

    const dedupKey = `turn-wait:${w.id}:${todayJst}`;
    if (hasPushLog(dedupKey)) continue;

    const elapsedDays = diffJstDays(String(w.started_at), todayJst);
    const targetName = String(w.target_name || w.partner_name || '').trim();
    const targetSuffix = targetName ? ` (${targetName}님 대기)` : '';

    const sent = await sendPushToUsers([watcherId], {
      title: `📌 ${w.title}`,
      body: `⏰ 설정한 대기 기간(${w.wait_days}일)이 지났습니다${targetSuffix}. 현재 ${elapsedDays}일 경과 · 확인해 주세요.`,
      projectId: Number(w.project_id),
      tag: `mindmap-turn-wait-${w.project_id}-${w.id}`,
    });
    if (sent > 0) {
      recordPushLog(dedupKey, nowJst);
      db.prepare('UPDATE journal_turn_waits SET notified_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
        nowJst,
        w.id
      );
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

    if (nowHHMM >= '07:00' && nowHHMM < '21:00') {
      await sendTurnWaitOverdueReminders(todayJst, nowJst);
    }

    await sendCalendarEventReminders(todayJst, tomorrowJst, nowMin, nowJst);
    await sendAnniversaryReminders(todayJst, nowHHMM, nowJst);
  } catch (err: any) {
    console.warn('Mindmap push reminder check error:', err?.message || err);
  }
}

function eventOccursOnDate(ev: any, targetYmd: string): boolean {
  const start = String(ev.start_date || '').slice(0, 10);
  if (!start || targetYmd < start) return false;
  const rec = String(ev.recurrence_type || 'NONE');
  const until = ev.recurrence_until ? String(ev.recurrence_until).slice(0, 10) : '';
  if (rec === 'NONE') {
    return targetYmd === start;
  }
  if (until && targetYmd > until) return false;
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ty, tm, td] = targetYmd.split('-').map(Number);
  if (!sy || !sm || !sd || !ty || !tm || !td) return false;
  if (rec === 'DAILY') return true;
  if (rec === 'WEEKLY') {
    const sDow = new Date(Date.UTC(sy, sm - 1, sd)).getUTCDay();
    const tDow = new Date(Date.UTC(ty, tm - 1, td)).getUTCDay();
    return sDow === tDow;
  }
  if (rec === 'MONTHLY') {
    const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    return td === Math.min(sd, lastDay);
  }
  if (rec === 'YEARLY') {
    const lastDay = new Date(Date.UTC(ty, sm, 0)).getUTCDate();
    return tm === sm && td === Math.min(sd, lastDay);
  }
  return false;
}

async function sendCalendarEventReminders(
  todayJst: string,
  tomorrowJst: string,
  nowMin: number | null,
  nowJst: string
) {
  if (nowMin === null) return;

  const events = db
    .prepare(`
      SELECT e.id, e.space_id, e.title, e.start_date, e.start_time, e.is_all_day,
             e.attendee_ids_json, e.recurrence_type, e.recurrence_until, e.reminder_minutes,
             s.name as space_name
      FROM calendar_events e
      INNER JOIN collab_spaces s ON s.id = e.space_id
      WHERE e.event_status = 'CONFIRMED'
        AND e.reminder_minutes IS NOT NULL
        AND e.start_date <= ?
    `)
    .all(tomorrowJst) as any[];

  for (const ev of events) {
    const remMin = Number(ev.reminder_minutes);
    if (!Number.isFinite(remMin) || remMin < 0) continue;

    const eventTimeMin = ev.is_all_day ? 9 * 60 : (parseMinutes(ev.start_time) ?? 9 * 60);
    const candidateDates = [todayJst, tomorrowJst];

    for (const occDate of candidateDates) {
      if (!eventOccursOnDate(ev, occDate)) continue;

      const dayDeltaMin = occDate === tomorrowJst ? 24 * 60 : 0;
      const minsUntilEvent = dayDeltaMin + eventTimeMin - nowMin;

      // Trigger if within [remMin - 5, remMin] window
      if (minsUntilEvent <= remMin && minsUntilEvent >= remMin - 5) {
        const dedupKey = `cal-rem:${ev.id}:${occDate}:${remMin}`;
        if (hasPushLog(dedupKey)) continue;

        let attendeeIds: number[] = [];
        try {
          const parsed = JSON.parse(ev.attendee_ids_json || '[]');
          if (Array.isArray(parsed)) {
            attendeeIds = Array.from(
              new Set(parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0))
            );
          }
        } catch {}

        if (attendeeIds.length === 0) continue;

        const memberRows = db
          .prepare('SELECT user_id FROM collab_space_members WHERE space_id = ?')
          .all(Number(ev.space_id)) as Array<{ user_id: number }>;
        const memberSet = new Set(memberRows.map((m) => Number(m.user_id)));
        const targetUserIds = attendeeIds.filter((id) => memberSet.has(id));
        if (targetUserIds.length === 0) continue;

        const timeKo = ev.is_all_day ? '종일' : (ev.start_time || '09:00');
        const timeJa = ev.is_all_day ? '終日' : (ev.start_time || '09:00');
        const timeEn = ev.is_all_day ? 'All Day' : (ev.start_time || '09:00');

        const remKo =
          remMin === 0
            ? '지금 시작'
            : remMin >= 1440
              ? '하루 전 알림'
              : remMin >= 60
                ? `${Math.round(remMin / 60)}시간 전`
                : `${remMin}분 전`;
        const remJa =
          remMin === 0
            ? 'まもなく開始'
            : remMin >= 1440
              ? '1日前リマインド'
              : remMin >= 60
                ? `${Math.round(remMin / 60)}時間前`
                : `${remMin}分前`;
        const remEn =
          remMin === 0
            ? 'Starting now'
            : remMin >= 1440
              ? '1 day before'
              : remMin >= 60
                ? `${Math.round(remMin / 60)}h before`
                : `${remMin}m before`;

        const shortTitle = truncateText(ev.title, 36);
        const spaceName = ev.space_name || 'Shared Space';

        const sent = await sendPushToUsers(targetUserIds, {
          titleKo: `📅 ${spaceName}`,
          bodyKo: `⏰ [${remKo}] ${shortTitle} (${occDate} ${timeKo})`,
          titleJa: `📅 ${spaceName}`,
          bodyJa: `⏰ [${remJa}] ${shortTitle} (${occDate} ${timeJa})`,
          titleEn: `📅 ${spaceName}`,
          bodyEn: `⏰ [${remEn}] ${shortTitle} (${occDate} ${timeEn})`,
          url: `/?tab=calendar&space=${ev.space_id}&event=${ev.id}`,
          tag: `space-cal-rem-${ev.id}-${occDate}`,
        });
        if (sent > 0) {
          recordPushLog(dedupKey, nowJst);
        }
      }
    }
  }
}

export function buildAnniversaryPushPayload(params: {
  spaceId: number;
  spaceName: string;
  anniversaryId: number;
  title: string;
  occurrenceDate: string;
  daysBefore: number;
  calendarType: 'SOLAR' | 'LUNAR';
  lunarMonth: number | null;
  lunarDay: number | null;
  isLeapMonth: boolean;
  adjustedFromLeapToNormal: boolean;
  adjustedFrom30To29: boolean;
}): PushNotificationPayload {
  const shortTitle = truncateText(params.title, 36);
  const spaceName = params.spaceName || 'Shared Space';

  const timingKo =
    params.daysBefore === 0
      ? '오늘 D-Day'
      : `D-${params.daysBefore} (${params.daysBefore}일 전)`;
  const timingJa =
    params.daysBefore === 0
      ? '今日 D-Day'
      : `D-${params.daysBefore} (${params.daysBefore}日前)`;
  const timingEn =
    params.daysBefore === 0
      ? 'Today (D-Day)'
      : `D-${params.daysBefore} (${params.daysBefore} day${params.daysBefore === 1 ? '' : 's'} left)`;

  let lunarSuffixKo = '';
  let lunarSuffixJa = '';
  let lunarSuffixEn = '';

  if (params.calendarType === 'LUNAR' && params.lunarMonth && params.lunarDay) {
    const leapKo = params.isLeapMonth ? '윤' : '';
    const leapJa = params.isLeapMonth ? '閏' : '';
    const leapEn = params.isLeapMonth ? 'Leap ' : '';

    const adjPartsKo: string[] = [];
    const adjPartsJa: string[] = [];
    const adjPartsEn: string[] = [];
    if (params.adjustedFromLeapToNormal) {
      adjPartsKo.push('평달 보정');
      adjPartsJa.push('平月補正');
      adjPartsEn.push('normal month');
    }
    if (params.adjustedFrom30To29) {
      adjPartsKo.push('29일 보정');
      adjPartsJa.push('29日補正');
      adjPartsEn.push('day 29');
    }

    const adjKo = adjPartsKo.length > 0 ? `, ${adjPartsKo.join('·')}` : '';
    const adjJa = adjPartsJa.length > 0 ? `・${adjPartsJa.join('・')}` : '';
    const adjEn = adjPartsEn.length > 0 ? `, adjusted: ${adjPartsEn.join(', ')}` : '';

    lunarSuffixKo = ` · 음력 ${leapKo}${params.lunarMonth}.${params.lunarDay}${adjKo}`;
    lunarSuffixJa = ` · 韓国旧暦 ${leapJa}${params.lunarMonth}/${params.lunarDay}${adjJa}`;
    lunarSuffixEn = ` · Korean Lunar ${leapEn}${params.lunarMonth}/${params.lunarDay}${adjEn}`;
  }

  return {
    titleKo: `🎂 ${spaceName} · 기념일 알림`,
    bodyKo: `[${timingKo}] ${shortTitle} (${params.occurrenceDate}${lunarSuffixKo})`,
    titleJa: `🎂 ${spaceName} · 記念日リマインド`,
    bodyJa: `[${timingJa}] ${shortTitle} (${params.occurrenceDate}${lunarSuffixJa})`,
    titleEn: `🎂 ${spaceName} · Anniversary Reminder`,
    bodyEn: `[${timingEn}] ${shortTitle} (${params.occurrenceDate}${lunarSuffixEn})`,
    url: `/?tab=calendar&space=${params.spaceId}&date=${params.occurrenceDate}`,
    tag: `space-anniv-${params.anniversaryId}-${params.occurrenceDate}-d${params.daysBefore}`,
  };
}

export async function sendAnniversaryReminders(
  todayJst: string,
  nowHHMM: string,
  nowJst: string,
  sender: (userIds: number[], payload: PushNotificationPayload) => Promise<number> = sendPushToUsers
): Promise<number> {
  // Deliver anniversary reminders from 09:00 JST onward (idempotent across restarts via DB log)
  if (nowHHMM < '09:00') return 0;

  // Prune anniversary push logs older than 400 days (JST)
  const pruneCutoff = `${getJstDateStrWithDayOffset(-400)} 00:00:00`;
  db.prepare('DELETE FROM space_anniversary_push_logs WHERE sent_at < ?').run(pruneCutoff);

  const rows = db
    .prepare(`
      SELECT a.*, s.name as space_name
      FROM space_anniversaries a
      INNER JOIN collab_spaces s ON s.id = a.space_id
      WHERE a.reminder_days_json IS NOT NULL
        AND TRIM(a.reminder_days_json) != ''
        AND TRIM(a.reminder_days_json) != '[]'
    `)
    .all() as any[];

  if (rows.length === 0) return 0;

  let totalSentLogs = 0;

  for (const row of rows) {
    const reminderDays = normalizeReminderDays(row.reminder_days_json);
    if (reminderDays.length === 0) continue;

    const maxOffset = Math.max(...reminderDays);
    const rangeEnd = addDaysYmd(todayJst, maxOffset);

    const record: SpaceAnniversaryRecord = {
      id: Number(row.id),
      space_id: Number(row.space_id),
      title: String(row.title || ''),
      memo: String(row.memo || ''),
      calendar_type: row.calendar_type === 'LUNAR' ? 'LUNAR' : 'SOLAR',
      base_date: String(row.base_date || ''),
      is_leap_month: Boolean(row.is_leap_month),
      is_recurring: Boolean(row.is_recurring),
      reminder_days: reminderDays,
      created_by: Number(row.created_by),
      creator_name: '',
      updated_by: row.updated_by ? Number(row.updated_by) : null,
      created_at: row.created_at,
      updated_at: row.updated_at,
    };

    const occurrences = expandAnniversariesForRange([record], todayJst, rangeEnd);
    if (occurrences.length === 0) continue;

    let cachedMemberIds: number[] | null = null;

    for (const occ of occurrences) {
      const daysBefore = diffSignedDaysYmd(todayJst, occ.solarDate);
      if (!reminderDays.includes(daysBefore)) continue;

      const alreadySent = db
        .prepare(`
          SELECT 1
          FROM space_anniversary_push_logs
          WHERE anniversary_id = ? AND occurrence_date = ? AND reminder_day = ?
        `)
        .get(record.id, occ.solarDate, daysBefore);
      if (alreadySent) continue;

      if (cachedMemberIds === null) {
        const memberRows = db
          .prepare('SELECT user_id FROM collab_space_members WHERE space_id = ?')
          .all(record.space_id) as Array<{ user_id: number }>;
        cachedMemberIds = Array.from(
          new Set(memberRows.map((m) => Number(m.user_id)).filter((id) => Number.isInteger(id) && id > 0))
        );
      }
      if (cachedMemberIds.length === 0) continue;

      const payload = buildAnniversaryPushPayload({
        spaceId: record.space_id,
        spaceName: String(row.space_name || 'Shared Space'),
        anniversaryId: record.id,
        title: record.title,
        occurrenceDate: occ.solarDate,
        daysBefore,
        calendarType: record.calendar_type,
        lunarMonth: occ.lunarMonth,
        lunarDay: occ.lunarDay,
        isLeapMonth: occ.isLeapMonth,
        adjustedFromLeapToNormal: occ.adjustedFromLeapToNormal,
        adjustedFrom30To29: occ.adjustedFrom30To29,
      });

      const sent = await sender(cachedMemberIds, payload);
      if (sent > 0) {
        db.prepare(`
          INSERT OR IGNORE INTO space_anniversary_push_logs (anniversary_id, occurrence_date, reminder_day, sent_at)
          VALUES (?, ?, ?, ?)
        `).run(record.id, occ.solarDate, daysBefore, nowJst);
        totalSentLogs += 1;
      }
    }
  }

  if (totalSentLogs > 0) {
    scheduleCloudBackup('anniversary_push_log', 2000);
  }

  return totalSentLogs;
}

export function startPushScheduler() {
  setTimeout(() => {
    void runJournalReminderChecks();
  }, 20_000);
  setInterval(() => {
    void runJournalReminderChecks();
  }, 60 * 1000);
}
