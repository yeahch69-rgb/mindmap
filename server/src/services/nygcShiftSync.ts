import crypto from 'crypto';
import { db } from '../db/database.js';
import { scheduleCloudBackup } from '../db/cloudSync.js';
import {
  getJstDateStr,
  getJstDateStrWithDayOffset,
  getJstDateTimeStr,
} from '../utils/jstTime.js';
import { PushNotificationPayload, sendPushToUsers } from '../utils/webPush.js';
import { broadcastSpaceUpdate } from '../utils/spaceRealtime.js';

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_SYNC_INTERVAL_MINUTES = 15;
const MAX_SYNC_INTERVAL_MINUTES = 30;
const DEFAULT_SYNC_INTERVAL_MINUTES = 20;
const SYNC_FETCH_TIMEOUT_MS = 25_000;

export interface SyncedShiftItem {
  work_date: string;
  shift_type: string;
  secondary_shift_type: string | null;
}

export interface ShiftDiffItem {
  kind: 'ADDED' | 'UPDATED' | 'REMOVED';
  work_date: string;
  prev_shift_type: string | null;
  prev_secondary_shift_type: string | null;
  next_shift_type: string | null;
  next_secondary_shift_type: string | null;
}

export interface NygcShiftSyncConfigRow {
  enabled: boolean;
  feedUrl: string;
  feedToken: string;
  enabledSpaceIds: number[];
  syncIntervalMinutes: number;
  initialSyncCompleted: boolean;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastSyncStatus: 'IDLE' | 'OK' | 'ERROR';
  lastSyncError: string | null;
  lastShiftCount: number;
  lastChangeSummary: string | null;
  updatedAt: string | null;
}

export interface NygcShiftSyncRunResult {
  ok: boolean;
  skipped?: boolean;
  initialLoad: boolean;
  shiftCount: number;
  diffCount: number;
  pushSent: number;
  summary: string | null;
  error?: string;
}

const SHIFT_TYPE_LABELS: Record<string, { ko: string; ja: string; en: string }> = {
  WORK: { ko: '출근', ja: '出勤', en: 'Work' },
  BUSINESS_TRIP: { ko: '출장', ja: '出張', en: 'Trip' },
  SHUTTLE: { ko: '송영', ja: '送迎', en: 'Shuttle' },
  EARLY_MORNING: { ko: '조조', ja: '早朝', en: 'Early' },
  HALF_OFF_AM: { ko: '오전반공휴', ja: '午前半公休', en: 'AM Off' },
  HALF_OFF_PM: { ko: '오후반공휴', ja: '午後半公休', en: 'PM Off' },
  HALF_DAY_AM: { ko: '오후반공휴', ja: '午後半公休', en: 'PM Off' },
  HALF_DAY_PM: { ko: '오전반공휴', ja: '午前半公休', en: 'AM Off' },
  OFF: { ko: '휴무', ja: '公休', en: 'Day Off' },
  ANNUAL_LEAVE: { ko: '연차', ja: '有休', en: 'Paid Leave' },
  HALF_LEAVE_AM: { ko: '오전반차', ja: '午前半休', en: 'AM Leave' },
  HALF_LEAVE_PM: { ko: '오후반차', ja: '午後半休', en: 'PM Leave' },
  EARLY: { ko: '조조', ja: '早番', en: 'Early' },
  REGULAR: { ko: '정출', ja: '通常', en: 'Regular' },
  NIGHT: { ko: '야간', ja: '夜勤', en: 'Night' },
  FULL_DAY: { ko: '종일', ja: '終日', en: 'Full Day' },
  DAY: { ko: '주간', ja: '日勤', en: 'Day' },
  MORNING: { ko: '오전', ja: '午前', en: 'Morning' },
  AFTERNOON: { ko: '오후', ja: '午後', en: 'Afternoon' },
};

function formatShiftLabel(
  shiftType: string | null,
  secondaryShiftType: string | null,
  lang: 'ko' | 'ja' | 'en'
): string {
  if (!shiftType) return '-';
  const main = SHIFT_TYPE_LABELS[shiftType]?.[lang] || shiftType;
  if (!secondaryShiftType) return main;
  const sub = SHIFT_TYPE_LABELS[secondaryShiftType]?.[lang] || secondaryShiftType;
  return `${main}+${sub}`;
}

function formatShortMonthDay(ymd: string): string {
  const parts = String(ymd || '').split('-');
  if (parts.length !== 3) return ymd;
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(m) || !Number.isFinite(d)) return ymd;
  return `${m}/${d}`;
}

export function normalizeFeedUrl(rawUrl: string): { url: string; error?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return { url: '' };

  let candidate = trimmed;
  if (!/^https?:\/\//i.test(candidate)) {
    candidate = `https://${candidate}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { url: '', error: '올바른 NYGC 피드 URL 형식이 아닙니다.' };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: '', error: '피드 URL은 http:// 또는 https:// 형식이어야 합니다.' };
  }

  // If only origin/root path was entered, append the default NYGC external feed path
  if (!parsed.pathname || parsed.pathname === '/') {
    parsed.pathname = '/api/shifts/external-feed';
  }
  parsed.search = '';
  parsed.hash = '';

  return { url: parsed.toString().replace(/\/+$/, '') };
}

function maskToken(token: string): string | null {
  if (!token) return null;
  if (token.length <= 10) return '••••••••';
  return `${token.slice(0, 6)}••••••••${token.slice(-4)}`;
}

function parseSpaceIdsJson(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return Array.from(
      new Set(parsed.map(Number).filter((id) => Number.isInteger(id) && id > 0))
    );
  } catch {
    return [];
  }
}

function clampIntervalMinutes(val: unknown): number {
  const num = Math.round(Number(val));
  if (!Number.isFinite(num)) return DEFAULT_SYNC_INTERVAL_MINUTES;
  return Math.max(MIN_SYNC_INTERVAL_MINUTES, Math.min(MAX_SYNC_INTERVAL_MINUTES, num));
}

export function getNygcShiftSyncConfig(): NygcShiftSyncConfigRow {
  const row = db
    .prepare('SELECT * FROM nygc_shift_sync_config WHERE id = 1')
    .get() as any | undefined;

  if (!row) {
    db.prepare('INSERT OR IGNORE INTO nygc_shift_sync_config (id) VALUES (1)').run();
    return {
      enabled: false,
      feedUrl: '',
      feedToken: '',
      enabledSpaceIds: [],
      syncIntervalMinutes: DEFAULT_SYNC_INTERVAL_MINUTES,
      initialSyncCompleted: false,
      lastSyncAt: null,
      lastSuccessAt: null,
      lastSyncStatus: 'IDLE',
      lastSyncError: null,
      lastShiftCount: 0,
      lastChangeSummary: null,
      updatedAt: null,
    };
  }

  return {
    enabled: Boolean(row.enabled),
    feedUrl: String(row.feed_url || ''),
    feedToken: String(row.feed_token || ''),
    enabledSpaceIds: parseSpaceIdsJson(row.enabled_space_ids_json),
    syncIntervalMinutes: clampIntervalMinutes(row.sync_interval_minutes),
    initialSyncCompleted: Boolean(row.initial_sync_completed),
    lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
    lastSuccessAt: row.last_success_at ? String(row.last_success_at) : null,
    lastSyncStatus:
      row.last_sync_status === 'OK' || row.last_sync_status === 'ERROR'
        ? row.last_sync_status
        : 'IDLE',
    lastSyncError: row.last_sync_error ? String(row.last_sync_error) : null,
    lastShiftCount: Number(row.last_shift_count || 0),
    lastChangeSummary: row.last_change_summary ? String(row.last_change_summary) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
  };
}

export function getNygcShiftSyncAdminView() {
  const config = getNygcShiftSyncConfig();
  const cachedRow = db
    .prepare('SELECT COUNT(*) as count FROM nygc_synced_shifts')
    .get() as { count: number } | undefined;

  const spaces = db
    .prepare(`
      SELECT
        s.id,
        s.name,
        s.color,
        s.is_personal,
        (SELECT COUNT(*) FROM collab_space_members m WHERE m.space_id = s.id) AS member_count
      FROM collab_spaces s
      ORDER BY s.is_personal ASC, s.id ASC
    `)
    .all() as Array<{
    id: number;
    name: string;
    color: string;
    is_personal: number;
    member_count: number;
  }>;

  const memberNameRows = db
    .prepare(`
      SELECT m.space_id, u.name
      FROM collab_space_members m
      INNER JOIN users u ON u.id = m.user_id
      ORDER BY CASE WHEN m.role = 'OWNER' THEN 0 ELSE 1 END, m.id ASC
    `)
    .all() as Array<{ space_id: number; name: string }>;

  const memberNamesBySpace = new Map<number, string[]>();
  for (const row of memberNameRows) {
    const sid = Number(row.space_id);
    const list = memberNamesBySpace.get(sid) || [];
    list.push(String(row.name));
    memberNamesBySpace.set(sid, list);
  }

  const existingSpaceSet = new Set(spaces.map((s) => Number(s.id)));
  const validEnabledSpaceIds = config.enabledSpaceIds.filter((id) => existingSpaceSet.has(id));

  return {
    config: {
      enabled: config.enabled,
      feedUrl: config.feedUrl,
      hasToken: Boolean(config.feedToken),
      tokenPreview: maskToken(config.feedToken),
      enabledSpaceIds: validEnabledSpaceIds,
      syncIntervalMinutes: config.syncIntervalMinutes,
      initialSyncCompleted: config.initialSyncCompleted,
      lastSyncAt: config.lastSyncAt,
      lastSuccessAt: config.lastSuccessAt,
      lastSyncStatus: config.lastSyncStatus,
      lastSyncError: config.lastSyncError,
      lastShiftCount: config.lastShiftCount,
      cachedShiftCount: Number(cachedRow?.count || 0),
      lastChangeSummary: config.lastChangeSummary,
      updatedAt: config.updatedAt,
    },
    spaces: spaces.map((s) => ({
      id: Number(s.id),
      name: String(s.name),
      color: String(s.color || '#1B4D3E'),
      isPersonal: Boolean(s.is_personal),
      memberCount: Number(s.member_count || 0),
      memberNames: memberNamesBySpace.get(Number(s.id)) || [],
    })),
  };
}

export function updateNygcShiftSyncConfig(input: {
  enabled?: boolean;
  feedUrl?: string;
  feedToken?: string;
  clearToken?: boolean;
  enabledSpaceIds?: number[];
  syncIntervalMinutes?: number;
}): { ok: boolean; error?: string; view?: ReturnType<typeof getNygcShiftSyncAdminView> } {
  const current = getNygcShiftSyncConfig();

  let nextFeedUrl = current.feedUrl;
  if (input.feedUrl !== undefined) {
    const normalized = normalizeFeedUrl(input.feedUrl);
    if (normalized.error) {
      return { ok: false, error: normalized.error };
    }
    nextFeedUrl = normalized.url;
  }

  let nextFeedToken = current.feedToken;
  if (input.clearToken) {
    nextFeedToken = '';
  } else if (typeof input.feedToken === 'string' && input.feedToken.trim().length > 0) {
    nextFeedToken = input.feedToken.trim();
  }

  let nextSpaceIds = current.enabledSpaceIds;
  if (Array.isArray(input.enabledSpaceIds)) {
    const candidateIds = Array.from(
      new Set(input.enabledSpaceIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))
    );
    if (candidateIds.length > 0) {
      const placeholders = candidateIds.map(() => '?').join(',');
      const validRows = db
        .prepare(`SELECT id FROM collab_spaces WHERE id IN (${placeholders})`)
        .all(...candidateIds) as Array<{ id: number }>;
      nextSpaceIds = validRows.map((r) => Number(r.id));
    } else {
      nextSpaceIds = [];
    }
  }

  const nextEnabled =
    input.enabled !== undefined ? Boolean(input.enabled) : current.enabled;
  const nextInterval =
    input.syncIntervalMinutes !== undefined
      ? clampIntervalMinutes(input.syncIntervalMinutes)
      : current.syncIntervalMinutes;

  const feedUrlChanged = Boolean(current.feedUrl && nextFeedUrl && current.feedUrl !== nextFeedUrl);
  const nowJst = getJstDateTimeStr();

  const tx = db.transaction(() => {
    if (feedUrlChanged) {
      db.prepare('DELETE FROM nygc_synced_shifts').run();
    }
    db.prepare(`
      UPDATE nygc_shift_sync_config
      SET enabled = ?,
          feed_url = ?,
          feed_token = ?,
          enabled_space_ids_json = ?,
          sync_interval_minutes = ?,
          initial_sync_completed = ?,
          last_shift_count = ?,
          updated_at = ?
      WHERE id = 1
    `).run(
      nextEnabled ? 1 : 0,
      nextFeedUrl,
      nextFeedToken,
      JSON.stringify(nextSpaceIds),
      nextInterval,
      feedUrlChanged ? 0 : (current.initialSyncCompleted ? 1 : 0),
      feedUrlChanged ? 0 : current.lastShiftCount,
      nowJst
    );
  });
  tx();

  scheduleCloudBackup('nygc_shift_sync_config', 1200);

  const affectedSpaceIds = Array.from(new Set([...current.enabledSpaceIds, ...nextSpaceIds]));
  for (const sid of affectedSpaceIds) {
    broadcastSpaceUpdate(sid, 'shift_sync_updated', { configUpdated: true });
  }

  return { ok: true, view: getNygcShiftSyncAdminView() };
}

export function getSyncedShiftsForSpace(
  spaceId: number,
  rawStartDate?: unknown,
  rawEndDate?: unknown
): {
  enabled: boolean;
  lastSuccessAt: string | null;
  shifts: SyncedShiftItem[];
} {
  const config = getNygcShiftSyncConfig();
  if (!config.enabled || !config.enabledSpaceIds.includes(spaceId)) {
    return {
      enabled: false,
      lastSuccessAt: null,
      shifts: [],
    };
  }

  const startDate =
    typeof rawStartDate === 'string' && YMD_RE.test(rawStartDate.trim())
      ? rawStartDate.trim()
      : getJstDateStrWithDayOffset(-45);
  const endDate =
    typeof rawEndDate === 'string' && YMD_RE.test(rawEndDate.trim())
      ? rawEndDate.trim()
      : getJstDateStrWithDayOffset(90);

  const rows = db
    .prepare(`
      SELECT work_date, shift_type, secondary_shift_type
      FROM nygc_synced_shifts
      WHERE work_date >= ? AND work_date <= ?
      ORDER BY work_date ASC
    `)
    .all(startDate, endDate) as Array<{
    work_date: string;
    shift_type: string;
    secondary_shift_type: string | null;
  }>;

  return {
    enabled: true,
    lastSuccessAt: config.lastSuccessAt,
    shifts: rows.map((r) => ({
      work_date: String(r.work_date),
      shift_type: String(r.shift_type),
      secondary_shift_type: r.secondary_shift_type ? String(r.secondary_shift_type) : null,
    })),
  };
}

export function computeShiftDiff(
  existingRows: SyncedShiftItem[],
  incomingRows: SyncedShiftItem[]
): ShiftDiffItem[] {
  const prevMap = new Map<string, SyncedShiftItem>();
  for (const row of existingRows) {
    prevMap.set(row.work_date, row);
  }

  const nextMap = new Map<string, SyncedShiftItem>();
  for (const row of incomingRows) {
    nextMap.set(row.work_date, row);
  }

  const allDates = Array.from(new Set([...prevMap.keys(), ...nextMap.keys()])).sort();
  const diffs: ShiftDiffItem[] = [];

  for (const ymd of allDates) {
    const prev = prevMap.get(ymd) || null;
    const next = nextMap.get(ymd) || null;

    if (!prev && next) {
      diffs.push({
        kind: 'ADDED',
        work_date: ymd,
        prev_shift_type: null,
        prev_secondary_shift_type: null,
        next_shift_type: next.shift_type,
        next_secondary_shift_type: next.secondary_shift_type,
      });
    } else if (prev && !next) {
      diffs.push({
        kind: 'REMOVED',
        work_date: ymd,
        prev_shift_type: prev.shift_type,
        prev_secondary_shift_type: prev.secondary_shift_type,
        next_shift_type: null,
        next_secondary_shift_type: null,
      });
    } else if (prev && next) {
      const prevSec = prev.secondary_shift_type || null;
      const nextSec = next.secondary_shift_type || null;
      if (prev.shift_type !== next.shift_type || prevSec !== nextSec) {
        diffs.push({
          kind: 'UPDATED',
          work_date: ymd,
          prev_shift_type: prev.shift_type,
          prev_secondary_shift_type: prevSec,
          next_shift_type: next.shift_type,
          next_secondary_shift_type: nextSec,
        });
      }
    }
  }

  return diffs;
}

function formatDiffEntry(item: ShiftDiffItem, lang: 'ko' | 'ja' | 'en'): string {
  const md = formatShortMonthDay(item.work_date);
  if (item.kind === 'ADDED') {
    const label = formatShiftLabel(item.next_shift_type, item.next_secondary_shift_type, lang);
    if (lang === 'ja') return `${md} ${label}(追加)`;
    if (lang === 'en') return `${md} ${label} (added)`;
    return `${md} ${label}(등록)`;
  }
  if (item.kind === 'REMOVED') {
    const prevLabel = formatShiftLabel(item.prev_shift_type, item.prev_secondary_shift_type, lang);
    if (lang === 'ja') return `${md} 削除(${prevLabel})`;
    if (lang === 'en') return `${md} removed (${prevLabel})`;
    return `${md} 삭제(${prevLabel})`;
  }
  const prevLabel = formatShiftLabel(item.prev_shift_type, item.prev_secondary_shift_type, lang);
  const nextLabel = formatShiftLabel(item.next_shift_type, item.next_secondary_shift_type, lang);
  return `${md} ${prevLabel}→${nextLabel}`;
}

export function buildShiftChangePushPayload(
  diffs: ShiftDiffItem[],
  firstSpaceId: number,
  todayJst: string
): PushNotificationPayload {
  // Prioritize today & upcoming changes in the preview snippet
  const upcoming = diffs.filter((d) => d.work_date >= todayJst);
  const past = diffs.filter((d) => d.work_date < todayJst);
  const ordered = [...upcoming, ...past];

  const total = ordered.length;
  const previewItems = ordered.slice(0, 3);
  const remaining = Math.max(0, total - previewItems.length);
  const focusDate = ordered[0]?.work_date || todayJst;

  const previewKo = previewItems.map((item) => formatDiffEntry(item, 'ko')).join(', ');
  const previewJa = previewItems.map((item) => formatDiffEntry(item, 'ja')).join('・');
  const previewEn = previewItems.map((item) => formatDiffEntry(item, 'en')).join(', ');

  if (total === 1) {
    return {
      titleKo: '📅 근무 시프트 변경',
      bodyKo: previewKo,
      titleJa: '📅 勤務シフト変更',
      bodyJa: previewJa,
      titleEn: '📅 Work Shift Updated',
      bodyEn: previewEn,
      url: `/?tab=calendar&space=${firstSpaceId}&date=${focusDate}`,
      tag: `nygc-shift-sync-${todayJst}`,
    };
  }

  return {
    titleKo: `📅 근무 시프트 ${total}건 변경`,
    bodyKo: remaining > 0 ? `${previewKo} 외 ${remaining}건` : previewKo,
    titleJa: `📅 勤務シフト ${total}件変更`,
    bodyJa: remaining > 0 ? `${previewJa} ほか${remaining}件` : previewJa,
    titleEn: `📅 ${total} Work Shift Updates`,
    bodyEn: remaining > 0 ? `${previewEn} +${remaining} more` : previewEn,
    url: `/?tab=calendar&space=${firstSpaceId}&date=${focusDate}`,
    tag: `nygc-shift-sync-${todayJst}`,
  };
}

function computeDiffHash(todayJst: string, diffs: ShiftDiffItem[]): string {
  const canonical = diffs.map((d) => [
    d.kind,
    d.work_date,
    d.prev_shift_type,
    d.prev_secondary_shift_type,
    d.next_shift_type,
    d.next_secondary_shift_type,
  ]);
  return crypto
    .createHash('sha256')
    .update(`${todayJst}|${JSON.stringify(canonical)}`, 'utf8')
    .digest('hex');
}

function parseJstTimestampMs(raw: string | null): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)) return null;
  const parsed = new Date(`${trimmed.replace(' ', 'T')}+09:00`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

let inFlightSync: Promise<NygcShiftSyncRunResult> | null = null;

export interface RunShiftSyncOptions {
  fetchImpl?: typeof fetch;
  pushSender?: (userIds: number[], payload: PushNotificationPayload) => Promise<number>;
}

export async function runNygcShiftSync(
  trigger: 'auto' | 'manual',
  options: RunShiftSyncOptions = {}
): Promise<NygcShiftSyncRunResult> {
  if (inFlightSync) {
    return inFlightSync;
  }

  const exec = async (): Promise<NygcShiftSyncRunResult> => {
    const config = getNygcShiftSyncConfig();
    if (trigger === 'auto' && !config.enabled) {
      return {
        ok: true,
        skipped: true,
        initialLoad: false,
        shiftCount: config.lastShiftCount,
        diffCount: 0,
        pushSent: 0,
        summary: null,
      };
    }

    if (!config.feedUrl || !config.feedToken) {
      const msg = 'NYGC 피드 URL과 비공개 연동 토큰을 먼저 설정해주세요.';
      if (trigger === 'manual') {
        return {
          ok: false,
          initialLoad: false,
          shiftCount: config.lastShiftCount,
          diffCount: 0,
          pushSent: 0,
          summary: null,
          error: msg,
        };
      }
      return {
        ok: true,
        skipped: true,
        initialLoad: false,
        shiftCount: config.lastShiftCount,
        diffCount: 0,
        pushSent: 0,
        summary: null,
      };
    }

    const nowJst = getJstDateTimeStr();
    const todayJst = getJstDateStr();
    const reqStartDate = getJstDateStrWithDayOffset(-60);
    const reqEndDate = getJstDateStrWithDayOffset(180);
    const fetcher = options.fetchImpl || globalThis.fetch;
    const sender = options.pushSender || sendPushToUsers;

    try {
      const urlObj = new URL(config.feedUrl);
      urlObj.searchParams.set('startDate', reqStartDate);
      urlObj.searchParams.set('endDate', reqEndDate);

      const response = await fetcher(urlObj.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${config.feedToken}`,
          'X-Shift-Feed-Token': config.feedToken,
        },
        signal: AbortSignal.timeout(SYNC_FETCH_TIMEOUT_MS),
      });

      if (!response.ok) {
        let errDetail = `HTTP ${response.status}`;
        try {
          const errJson = (await response.json()) as any;
          if (errJson?.error) errDetail = `${errDetail}: ${String(errJson.error)}`;
        } catch {
          // ignore non-json error body
        }
        throw new Error(errDetail);
      }

      const payload = (await response.json()) as any;
      if (!payload || !Array.isArray(payload.shifts)) {
        throw new Error('NYGC 피드 응답 형식이 올바르지 않습니다.');
      }

      const effStart =
        typeof payload.startDate === 'string' && YMD_RE.test(payload.startDate)
          ? payload.startDate
          : reqStartDate;
      const effEnd =
        typeof payload.endDate === 'string' && YMD_RE.test(payload.endDate)
          ? payload.endDate
          : reqEndDate;

      const dedupIncoming = new Map<string, SyncedShiftItem>();
      for (const raw of payload.shifts) {
        if (!raw || typeof raw !== 'object') continue;
        const workDate = typeof raw.work_date === 'string' ? raw.work_date.trim() : '';
        const shiftType = typeof raw.shift_type === 'string' ? raw.shift_type.trim() : '';
        const secRaw =
          typeof raw.secondary_shift_type === 'string' && raw.secondary_shift_type.trim()
            ? raw.secondary_shift_type.trim()
            : null;
        if (!YMD_RE.test(workDate) || !shiftType) continue;
        if (workDate < effStart || workDate > effEnd) continue;
        dedupIncoming.set(workDate, {
          work_date: workDate,
          shift_type: shiftType,
          secondary_shift_type: secRaw,
        });
      }
      const incomingShifts = Array.from(dedupIncoming.values()).sort((a, b) =>
        a.work_date.localeCompare(b.work_date)
      );

      const existingInWindow = db
        .prepare(`
          SELECT work_date, shift_type, secondary_shift_type
          FROM nygc_synced_shifts
          WHERE work_date >= ? AND work_date <= ?
          ORDER BY work_date ASC
        `)
        .all(effStart, effEnd) as SyncedShiftItem[];

      const diffs = computeShiftDiff(existingInWindow, incomingShifts);
      const isInitialLoad = !config.initialSyncCompleted;
      const pruneOldDate = getJstDateStrWithDayOffset(-365);

      const changeSummary =
        isInitialLoad
          ? `초기 적재 완료 (${incomingShifts.length}일)`
          : diffs.length > 0
            ? diffs
                .slice(0, 3)
                .map((d) => formatDiffEntry(d, 'ko'))
                .join(', ') + (diffs.length > 3 ? ` 외 ${diffs.length - 3}건` : '')
            : null;

      const tx = db.transaction(() => {
        const upsertStmt = db.prepare(`
          INSERT INTO nygc_synced_shifts (work_date, shift_type, secondary_shift_type, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(work_date) DO UPDATE SET
            shift_type = excluded.shift_type,
            secondary_shift_type = excluded.secondary_shift_type,
            updated_at = excluded.updated_at
        `);
        const deleteStmt = db.prepare('DELETE FROM nygc_synced_shifts WHERE work_date = ?');

        for (const item of incomingShifts) {
          upsertStmt.run(item.work_date, item.shift_type, item.secondary_shift_type, nowJst);
        }
        for (const diff of diffs) {
          if (diff.kind === 'REMOVED') {
            deleteStmt.run(diff.work_date);
          }
        }
        // Silently prune very old cache entries (>1 year old) outside the diff window
        db.prepare('DELETE FROM nygc_synced_shifts WHERE work_date < ?').run(pruneOldDate);

        db.prepare(`
          UPDATE nygc_shift_sync_config
          SET initial_sync_completed = 1,
              last_sync_at = ?,
              last_success_at = ?,
              last_sync_status = 'OK',
              last_sync_error = NULL,
              last_shift_count = ?,
              last_change_summary = COALESCE(?, last_change_summary),
              updated_at = ?
          WHERE id = 1
        `).run(nowJst, nowJst, incomingShifts.length, changeSummary, nowJst);
      });
      tx();

      let pushSent = 0;

      // Skip push on initial load; send 1 bundled 3-language push on subsequent detected changes
      if (!isInitialLoad && diffs.length > 0 && config.enabled && config.enabledSpaceIds.length > 0) {
        const prunePushCutoff = `${getJstDateStrWithDayOffset(-30)} 00:00:00`;
        db.prepare('DELETE FROM nygc_shift_push_log WHERE sent_at < ?').run(prunePushCutoff);

        const diffHash = computeDiffHash(todayJst, diffs);
        const alreadySent = db
          .prepare('SELECT 1 FROM nygc_shift_push_log WHERE diff_hash = ?')
          .get(diffHash);

        if (!alreadySent) {
          const spacePlaceholders = config.enabledSpaceIds.map(() => '?').join(',');
          const memberRows = db
            .prepare(`
              SELECT DISTINCT m.user_id, m.space_id
              FROM collab_space_members m
              INNER JOIN collab_spaces s ON s.id = m.space_id
              WHERE m.space_id IN (${spacePlaceholders})
            `)
            .all(...config.enabledSpaceIds) as Array<{ user_id: number; space_id: number }>;

          const recipientIds = Array.from(
            new Set(memberRows.map((r) => Number(r.user_id)).filter((id) => id > 0))
          );

          if (recipientIds.length > 0) {
            const firstSpaceId = Number(memberRows[0]?.space_id || config.enabledSpaceIds[0]);
            const pushPayload = buildShiftChangePushPayload(diffs, firstSpaceId, todayJst);
            pushSent = await sender(recipientIds, pushPayload);
            db.prepare(`
              INSERT OR IGNORE INTO nygc_shift_push_log (diff_hash, sent_at, summary)
              VALUES (?, ?, ?)
            `).run(diffHash, nowJst, changeSummary || `${diffs.length} changes`);
          }
        }
      }

      if (isInitialLoad || diffs.length > 0) {
        for (const sid of config.enabledSpaceIds) {
          broadcastSpaceUpdate(sid, 'shift_sync_updated', {
            changedCount: diffs.length,
            initialLoad: isInitialLoad,
          });
        }
        scheduleCloudBackup('nygc_shift_sync', 1500);
      } else if (trigger === 'manual') {
        scheduleCloudBackup('nygc_shift_sync_manual', 3000);
      }

      return {
        ok: true,
        initialLoad: isInitialLoad,
        shiftCount: incomingShifts.length,
        diffCount: diffs.length,
        pushSent,
        summary: changeSummary,
      };
    } catch (err: any) {
      const errorMessage = String(err?.message || err || 'Unknown sync error').slice(0, 300);
      // Keep existing cached shifts untouched on failure!
      db.prepare(`
        UPDATE nygc_shift_sync_config
        SET last_sync_at = ?,
            last_sync_status = 'ERROR',
            last_sync_error = ?,
            updated_at = ?
        WHERE id = 1
      `).run(nowJst, errorMessage, nowJst);

      return {
        ok: false,
        initialLoad: false,
        shiftCount: config.lastShiftCount,
        diffCount: 0,
        pushSent: 0,
        summary: null,
        error: errorMessage,
      };
    }
  };

  inFlightSync = exec().finally(() => {
    inFlightSync = null;
  });

  return inFlightSync;
}

let schedulerStarted = false;

async function checkAndRunScheduledSync() {
  try {
    const config = getNygcShiftSyncConfig();
    if (!config.enabled || !config.feedUrl || !config.feedToken) return;

    const lastAttemptMs = parseJstTimestampMs(config.lastSyncAt);
    const intervalMs = config.syncIntervalMinutes * 60 * 1000;
    if (lastAttemptMs !== null && Date.now() - lastAttemptMs < intervalMs) {
      return;
    }

    await runNygcShiftSync('auto');
  } catch (err: any) {
    console.warn('[NygcShiftSync] Scheduled check error:', err?.message || err);
  }
}

export function startNygcShiftSyncScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  setTimeout(() => {
    void checkAndRunScheduledSync();
  }, 25_000);

  setInterval(() => {
    void checkAndRunScheduledSync();
  }, 60_000);
}
