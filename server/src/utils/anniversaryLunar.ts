import KoreanLunarCalendarModule from 'korean-lunar-calendar';

interface KoreanLunarCalendarInstance {
  setLunarDate(lunarYear: number, lunarMonth: number, lunarDay: number, isIntercalation: boolean): boolean;
  getSolarCalendar(): { year: number; month: number; day: number };
}

const KoreanLunarCalendar = ((KoreanLunarCalendarModule as any).default ??
  KoreanLunarCalendarModule) as new () => KoreanLunarCalendarInstance;

export type AnniversaryCalendarType = 'SOLAR' | 'LUNAR';

export interface SpaceAnniversaryRecord {
  id: number;
  space_id: number;
  title: string;
  memo: string;
  calendar_type: AnniversaryCalendarType;
  base_date: string; // YYYY-MM-DD (Gregorian if SOLAR, Korean Lunar if LUNAR)
  is_leap_month: boolean;
  is_recurring: boolean;
  reminder_days: number[];
  created_by: number;
  creator_name: string;
  updated_by: number | null;
  created_at: string;
  updated_at: string;
}

export interface ResolvedLunarDate {
  solarDate: string; // YYYY-MM-DD (Gregorian)
  lunarYear: number;
  lunarMonth: number;
  lunarDay: number;
  isLeapMonth: boolean;
  adjustedFromLeapToNormal: boolean;
  adjustedFrom30To29: boolean;
}

export interface AnniversaryOccurrence {
  anniversary: SpaceAnniversaryRecord;
  occurrenceKey: string;
  solarDate: string;
  occurrenceYear: number;
  lunarMonth: number | null;
  lunarDay: number | null;
  isLeapMonth: boolean;
  adjustedFromLeapToNormal: boolean;
  adjustedFrom30To29: boolean;
  adjustedFromSolarFeb29To28: boolean;
  nthYear: number | null;
}

export const KARI_MIN_LUNAR_YEAR = 1391;
export const KARI_MAX_LUNAR_YEAR = 2050;
export const ALLOWED_ANNIVERSARY_REMINDER_DAYS = [0, 1, 3, 7, 14, 30] as const;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatYmdParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`;
}

export function parseYmdStrict(ymd: string): { year: number; month: number; day: number } | null {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  return { year, month, day };
}

export function isValidGregorianYmd(ymd: string): boolean {
  const p = parseYmdStrict(ymd);
  if (!p) return false;
  if (p.year < 1000 || p.year > 2999 || p.month < 1 || p.month > 12 || p.day < 1 || p.day > 31) {
    return false;
  }
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day));
  return (
    dt.getUTCFullYear() === p.year &&
    dt.getUTCMonth() === p.month - 1 &&
    dt.getUTCDate() === p.day
  );
}

export function isValidKoreanLunarYmd(ymd: string): boolean {
  const p = parseYmdStrict(ymd);
  if (!p) return false;
  return (
    p.year >= KARI_MIN_LUNAR_YEAR &&
    p.year <= KARI_MAX_LUNAR_YEAR &&
    p.month >= 1 &&
    p.month <= 12 &&
    p.day >= 1 &&
    p.day <= 30
  );
}

export function diffDaysYmd(fromYmd: string, toYmd: string): number {
  const a = parseYmdStrict(fromYmd);
  const b = parseYmdStrict(toYmd);
  if (!a || !b) return 0;
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((msB - msA) / (24 * 60 * 60 * 1000));
}

export function addDaysYmd(ymd: string, delta: number): string {
  const p = parseYmdStrict(ymd);
  if (!p) return ymd;
  const dt = new Date(Date.UTC(p.year, p.month - 1, p.day + delta));
  return formatYmdParts(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function normalizeReminderDays(raw: unknown): number[] {
  let list: unknown[] = [];
  if (Array.isArray(raw)) {
    list = raw;
  } else if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch {
      list = [];
    }
  }
  const allowed = new Set<number>(ALLOWED_ANNIVERSARY_REMINDER_DAYS);
  const unique = new Set<number>();
  for (const item of list) {
    const n = Number(item);
    if (Number.isInteger(n) && allowed.has(n)) {
      unique.add(n);
    }
  }
  return Array.from(unique).sort((a, b) => a - b);
}

/**
 * Convert Korean Lunar date (KARI / KST standard) to Gregorian YYYY-MM-DD with mandatory fallbacks:
 * 1. If leap month is requested but does not exist in target lunar year -> fallback to normal month (same month/day).
 * 2. If lunar day is 30 but target lunar month is a small month (29 days) -> fallback to day 29.
 */
export function resolveKoreanLunarToSolar(
  lunarYear: number,
  lunarMonth: number,
  lunarDay: number,
  preferLeapMonth: boolean
): ResolvedLunarDate | null {
  if (
    !Number.isInteger(lunarYear) ||
    lunarYear < KARI_MIN_LUNAR_YEAR ||
    lunarYear > KARI_MAX_LUNAR_YEAR ||
    !Number.isInteger(lunarMonth) ||
    lunarMonth < 1 ||
    lunarMonth > 12 ||
    !Number.isInteger(lunarDay) ||
    lunarDay < 1 ||
    lunarDay > 30
  ) {
    return null;
  }

  const cal = new KoreanLunarCalendar();

  const trySet = (
    day: number,
    isLeap: boolean,
    adjustedFromLeapToNormal: boolean,
    adjustedFrom30To29: boolean
  ): ResolvedLunarDate | null => {
    const ok = cal.setLunarDate(lunarYear, lunarMonth, day, isLeap);
    if (!ok) return null;
    const solar = cal.getSolarCalendar();
    return {
      solarDate: formatYmdParts(solar.year, solar.month, solar.day),
      lunarYear,
      lunarMonth,
      lunarDay: day,
      isLeapMonth: isLeap,
      adjustedFromLeapToNormal,
      adjustedFrom30To29,
    };
  };

  // 1. Exact match
  const exact = trySet(lunarDay, preferLeapMonth, false, false);
  if (exact) return exact;

  // 2. If leap month was requested:
  if (preferLeapMonth) {
    // 2a. Leap month exists, only day 30 -> 29
    if (lunarDay === 30) {
      const leap29 = trySet(29, true, false, true);
      if (leap29) return leap29;
    }
    // 2b. No leap month in this year -> fallback to normal month
    const normalExact = trySet(lunarDay, false, true, false);
    if (normalExact) return normalExact;
    // 2c. No leap month AND normal month has 29 days -> fallback to normal month day 29
    if (lunarDay === 30) {
      const normal29 = trySet(29, false, true, true);
      if (normal29) return normal29;
    }
    return null;
  }

  // 3. Normal month with day 30 -> 29
  if (lunarDay === 30) {
    return trySet(29, false, false, true);
  }

  return null;
}

export function resolveBaseSolarDate(
  ann: Pick<SpaceAnniversaryRecord, 'calendar_type' | 'base_date' | 'is_leap_month'>
): {
  solarDate: string;
  adjustedFromLeapToNormal: boolean;
  adjustedFrom30To29: boolean;
} | null {
  if (ann.calendar_type === 'LUNAR') {
    const p = parseYmdStrict(ann.base_date);
    if (!p) return null;
    const resolved = resolveKoreanLunarToSolar(p.year, p.month, p.day, Boolean(ann.is_leap_month));
    if (!resolved) return null;
    return {
      solarDate: resolved.solarDate,
      adjustedFromLeapToNormal: resolved.adjustedFromLeapToNormal,
      adjustedFrom30To29: resolved.adjustedFrom30To29,
    };
  }
  if (!isValidGregorianYmd(ann.base_date)) return null;
  return {
    solarDate: ann.base_date,
    adjustedFromLeapToNormal: false,
    adjustedFrom30To29: false,
  };
}

/**
 * Expand anniversaries into concrete Gregorian occurrences within [rangeStart, rangeEnd] (inclusive).
 */
export function expandAnniversariesForRange(
  anniversaries: SpaceAnniversaryRecord[],
  rangeStart: string,
  rangeEnd: string
): AnniversaryOccurrence[] {
  const startP = parseYmdStrict(rangeStart);
  const endP = parseYmdStrict(rangeEnd);
  if (!startP || !endP || rangeStart > rangeEnd) return [];

  const result: AnniversaryOccurrence[] = [];

  for (const ann of anniversaries) {
    const baseP = parseYmdStrict(ann.base_date);
    if (!baseP) continue;

    const baseSolar = resolveBaseSolarDate(ann);
    if (!baseSolar) continue;

    if (!ann.is_recurring) {
      if (baseSolar.solarDate >= rangeStart && baseSolar.solarDate <= rangeEnd) {
        result.push({
          anniversary: ann,
          occurrenceKey: `${ann.id}:${baseSolar.solarDate}`,
          solarDate: baseSolar.solarDate,
          occurrenceYear: baseP.year,
          lunarMonth: ann.calendar_type === 'LUNAR' ? baseP.month : null,
          lunarDay: ann.calendar_type === 'LUNAR' ? (baseSolar.adjustedFrom30To29 ? 29 : baseP.day) : null,
          isLeapMonth: ann.calendar_type === 'LUNAR' ? (ann.is_leap_month && !baseSolar.adjustedFromLeapToNormal) : false,
          adjustedFromLeapToNormal: baseSolar.adjustedFromLeapToNormal,
          adjustedFrom30To29: baseSolar.adjustedFrom30To29,
          adjustedFromSolarFeb29To28: false,
          nthYear: null,
        });
      }
      continue;
    }

    const seenSolarDates = new Set<string>();

    if (ann.calendar_type === 'SOLAR') {
      const minYear = Math.max(baseP.year, startP.year);
      const maxYear = endP.year;
      for (let y = minYear; y <= maxYear; y++) {
        const lastDay = new Date(Date.UTC(y, baseP.month, 0)).getUTCDate();
        const clampedDay = Math.min(baseP.day, lastDay);
        const occSolar = formatYmdParts(y, baseP.month, clampedDay);
        if (occSolar < baseSolar.solarDate || occSolar < rangeStart || occSolar > rangeEnd) continue;
        if (seenSolarDates.has(occSolar)) continue;
        seenSolarDates.add(occSolar);
        result.push({
          anniversary: ann,
          occurrenceKey: `${ann.id}:${occSolar}`,
          solarDate: occSolar,
          occurrenceYear: y,
          lunarMonth: null,
          lunarDay: null,
          isLeapMonth: false,
          adjustedFromLeapToNormal: false,
          adjustedFrom30To29: false,
          adjustedFromSolarFeb29To28: baseP.month === 2 && baseP.day === 29 && clampedDay === 28,
          nthYear: y > baseP.year ? y - baseP.year : null,
        });
      }
    } else {
      // Korean Lunar recurring: lunar year can span into Jan/Feb of next Gregorian year
      const minLunarYear = Math.max(KARI_MIN_LUNAR_YEAR, baseP.year, startP.year - 1);
      const maxLunarYear = Math.min(KARI_MAX_LUNAR_YEAR, endP.year + 1);
      for (let ly = minLunarYear; ly <= maxLunarYear; ly++) {
        const resolved = resolveKoreanLunarToSolar(ly, baseP.month, baseP.day, Boolean(ann.is_leap_month));
        if (!resolved) continue;
        if (resolved.solarDate < baseSolar.solarDate || resolved.solarDate < rangeStart || resolved.solarDate > rangeEnd) {
          continue;
        }
        if (seenSolarDates.has(resolved.solarDate)) continue;
        seenSolarDates.add(resolved.solarDate);
        result.push({
          anniversary: ann,
          occurrenceKey: `${ann.id}:${resolved.solarDate}`,
          solarDate: resolved.solarDate,
          occurrenceYear: ly,
          lunarMonth: resolved.lunarMonth,
          lunarDay: resolved.lunarDay,
          isLeapMonth: resolved.isLeapMonth,
          adjustedFromLeapToNormal: resolved.adjustedFromLeapToNormal,
          adjustedFrom30To29: resolved.adjustedFrom30To29,
          adjustedFromSolarFeb29To28: false,
          nthYear: ly > baseP.year ? ly - baseP.year : null,
        });
      }
    }
  }

  return result;
}
