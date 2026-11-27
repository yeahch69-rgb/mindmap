import KoreanLunarCalendar from 'korean-lunar-calendar';
import { SpaceAnniversary } from '../types/spaces';

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
  anniversary: SpaceAnniversary;
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

export interface AnniversaryDDaySummary {
  anniversary: SpaceAnniversary;
  baseSolarDate: string;
  primaryOccurrence: AnniversaryOccurrence;
  /** diffDays(todayJst, primaryOccurrence.solarDate): >0 D-N, 0 D-Day, <0 D+N */
  primaryDiffDays: number;
  primaryLabel: string;
  /** For recurring anniversaries whose base date has passed: diffDays(baseSolarDate, todayJst) */
  elapsedDays: number | null;
  elapsedLabel: string | null;
  sortGroup: 0 | 1 | 2;
  sortDistance: number;
}

export const KARI_MIN_LUNAR_YEAR = 1391;
export const KARI_MAX_LUNAR_YEAR = 2050;
export const ANNIVERSARY_REMINDER_OPTIONS = [0, 1, 3, 7, 14] as const;

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

export function diffDaysYmd(fromYmd: string, toYmd: string): number {
  const a = parseYmdStrict(fromYmd);
  const b = parseYmdStrict(toYmd);
  if (!a || !b) return 0;
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((msB - msA) / (24 * 60 * 60 * 1000));
}

export function formatDDayLabel(diffDaysFromToday: number): string {
  if (diffDaysFromToday === 0) return 'D-Day';
  if (diffDaysFromToday > 0) return `D-${diffDaysFromToday}`;
  return `D+${Math.abs(diffDaysFromToday)}`;
}

export function hasKoreanLunarLeapMonth(lunarYear: number, lunarMonth: number): boolean {
  if (
    !Number.isInteger(lunarYear) ||
    lunarYear < KARI_MIN_LUNAR_YEAR ||
    lunarYear > KARI_MAX_LUNAR_YEAR ||
    !Number.isInteger(lunarMonth) ||
    lunarMonth < 1 ||
    lunarMonth > 12
  ) {
    return false;
  }
  const cal = new KoreanLunarCalendar();
  return cal.setLunarDate(lunarYear, lunarMonth, 1, true);
}

export function getKoreanLunarMonthDays(
  lunarYear: number,
  lunarMonth: number,
  isLeapMonth: boolean
): number {
  if (
    !Number.isInteger(lunarYear) ||
    lunarYear < KARI_MIN_LUNAR_YEAR ||
    lunarYear > KARI_MAX_LUNAR_YEAR ||
    !Number.isInteger(lunarMonth) ||
    lunarMonth < 1 ||
    lunarMonth > 12
  ) {
    return 0;
  }
  const cal = new KoreanLunarCalendar();
  if (cal.setLunarDate(lunarYear, lunarMonth, 30, isLeapMonth)) return 30;
  if (cal.setLunarDate(lunarYear, lunarMonth, 29, isLeapMonth)) return 29;
  return 0;
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

  const exact = trySet(lunarDay, preferLeapMonth, false, false);
  if (exact) return exact;

  if (preferLeapMonth) {
    if (lunarDay === 30) {
      const leap29 = trySet(29, true, false, true);
      if (leap29) return leap29;
    }
    const normalExact = trySet(lunarDay, false, true, false);
    if (normalExact) return normalExact;
    if (lunarDay === 30) {
      const normal29 = trySet(29, false, true, true);
      if (normal29) return normal29;
    }
    return null;
  }

  if (lunarDay === 30) {
    return trySet(29, false, false, true);
  }

  return null;
}

export function resolveBaseSolarDate(
  ann: Pick<SpaceAnniversary, 'calendar_type' | 'base_date' | 'is_leap_month'>
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

export function expandAnniversariesForRange(
  anniversaries: SpaceAnniversary[],
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
          isLeapMonth:
            ann.calendar_type === 'LUNAR'
              ? ann.is_leap_month && !baseSolar.adjustedFromLeapToNormal
              : false,
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
      const minLunarYear = Math.max(KARI_MIN_LUNAR_YEAR, baseP.year, startP.year - 1);
      const maxLunarYear = Math.min(KARI_MAX_LUNAR_YEAR, endP.year + 1);
      for (let ly = minLunarYear; ly <= maxLunarYear; ly++) {
        const resolved = resolveKoreanLunarToSolar(ly, baseP.month, baseP.day, Boolean(ann.is_leap_month));
        if (!resolved) continue;
        if (
          resolved.solarDate < baseSolar.solarDate ||
          resolved.solarDate < rangeStart ||
          resolved.solarDate > rangeEnd
        ) {
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

export function computeAnniversaryDDay(
  ann: SpaceAnniversary,
  todayJst: string
): AnniversaryDDaySummary | null {
  const baseP = parseYmdStrict(ann.base_date);
  const todayP = parseYmdStrict(todayJst);
  if (!baseP || !todayP) return null;

  const baseSolar = resolveBaseSolarDate(ann);
  if (!baseSolar) return null;

  if (!ann.is_recurring) {
    const occ: AnniversaryOccurrence = {
      anniversary: ann,
      occurrenceKey: `${ann.id}:${baseSolar.solarDate}`,
      solarDate: baseSolar.solarDate,
      occurrenceYear: baseP.year,
      lunarMonth: ann.calendar_type === 'LUNAR' ? baseP.month : null,
      lunarDay: ann.calendar_type === 'LUNAR' ? (baseSolar.adjustedFrom30To29 ? 29 : baseP.day) : null,
      isLeapMonth:
        ann.calendar_type === 'LUNAR'
          ? ann.is_leap_month && !baseSolar.adjustedFromLeapToNormal
          : false,
      adjustedFromLeapToNormal: baseSolar.adjustedFromLeapToNormal,
      adjustedFrom30To29: baseSolar.adjustedFrom30To29,
      adjustedFromSolarFeb29To28: false,
      nthYear: null,
    };
    const diff = diffDaysYmd(todayJst, occ.solarDate);
    return {
      anniversary: ann,
      baseSolarDate: baseSolar.solarDate,
      primaryOccurrence: occ,
      primaryDiffDays: diff,
      primaryLabel: formatDDayLabel(diff),
      elapsedDays: null,
      elapsedLabel: null,
      sortGroup: diff === 0 ? 0 : diff > 0 ? 1 : 2,
      sortDistance: Math.abs(diff),
    };
  }

  // Recurring: find the earliest occurrence >= todayJst (and >= baseSolar.solarDate)
  const candidates: AnniversaryOccurrence[] = [];

  if (ann.calendar_type === 'SOLAR') {
    const startYear = Math.max(baseP.year, todayP.year);
    for (let y = startYear; y <= startYear + 2; y++) {
      const lastDay = new Date(Date.UTC(y, baseP.month, 0)).getUTCDate();
      const clampedDay = Math.min(baseP.day, lastDay);
      const occSolar = formatYmdParts(y, baseP.month, clampedDay);
      if (occSolar >= todayJst && occSolar >= baseSolar.solarDate) {
        candidates.push({
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
    }
  } else {
    const startLunarYear = Math.max(KARI_MIN_LUNAR_YEAR, baseP.year, todayP.year - 1);
    const endLunarYear = Math.min(KARI_MAX_LUNAR_YEAR, Math.max(baseP.year, todayP.year) + 2);
    for (let ly = startLunarYear; ly <= endLunarYear; ly++) {
      const resolved = resolveKoreanLunarToSolar(ly, baseP.month, baseP.day, Boolean(ann.is_leap_month));
      if (!resolved) continue;
      if (resolved.solarDate >= todayJst && resolved.solarDate >= baseSolar.solarDate) {
        candidates.push({
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

  candidates.sort((a, b) => a.solarDate.localeCompare(b.solarDate));
  const nextOcc = candidates[0];
  if (!nextOcc) return null;

  const upcomingDiff = diffDaysYmd(todayJst, nextOcc.solarDate);
  const rawElapsed = diffDaysYmd(baseSolar.solarDate, todayJst);
  const elapsedDays = rawElapsed > 0 ? rawElapsed : null;

  return {
    anniversary: ann,
    baseSolarDate: baseSolar.solarDate,
    primaryOccurrence: nextOcc,
    primaryDiffDays: upcomingDiff,
    primaryLabel: formatDDayLabel(upcomingDiff),
    elapsedDays,
    elapsedLabel: elapsedDays !== null ? `D+${elapsedDays}` : null,
    sortGroup: upcomingDiff === 0 ? 0 : 1,
    sortDistance: upcomingDiff,
  };
}

export function sortAnniversaryDDays(summaries: AnniversaryDDaySummary[]): AnniversaryDDaySummary[] {
  return [...summaries].sort((a, b) => {
    if (a.sortGroup !== b.sortGroup) return a.sortGroup - b.sortGroup;
    if (a.sortDistance !== b.sortDistance) return a.sortDistance - b.sortDistance;
    return a.anniversary.id - b.anniversary.id;
  });
}

export function formatBaseCalendarBadge(
  ann: Pick<SpaceAnniversary, 'calendar_type' | 'base_date' | 'is_leap_month'>,
  L: (ko: string, ja: string, en: string) => string
): string {
  const p = parseYmdStrict(ann.base_date);
  if (!p) return ann.base_date;
  if (ann.calendar_type === 'LUNAR') {
    const leapKo = ann.is_leap_month ? '윤' : '';
    const leapJa = ann.is_leap_month ? '閏' : '';
    const leapEn = ann.is_leap_month ? 'Leap ' : '';
    return L(
      `음력 ${leapKo}${p.month}.${p.day}`,
      `旧暦 ${leapJa}${p.month}/${p.day}`,
      `Lunar ${leapEn}${p.month}/${p.day}`
    );
  }
  return L(`양력 ${p.month}.${p.day}`, `新暦 ${p.month}/${p.day}`, `Solar ${p.month}/${p.day}`);
}

export function formatReminderDayLabel(
  day: number,
  L: (ko: string, ja: string, en: string) => string
): string {
  if (day === 0) return L('당일', '当日', 'On the day');
  return L(`${day}일 전`, `${day}日前`, `${day}d before`);
}
