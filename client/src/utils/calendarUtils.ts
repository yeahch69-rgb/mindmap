import { CalendarEventItem } from '../types/spaces';

export function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

export function formatYmd(year: number, monthIndex0: number, day: number): string {
  const dt = new Date(Date.UTC(year, monthIndex0, day));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function parseYmd(ymd: string): { year: number; month: number; day: number } {
  const [y, m, d] = String(ymd || '').slice(0, 10).split('-').map(Number);
  return { year: y || 2026, month: m || 1, day: d || 1 };
}

export function addDaysYmd(ymd: string, delta: number): string {
  const { year, month, day } = parseYmd(ymd);
  const dt = new Date(Date.UTC(year, month - 1, day + delta));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function diffDaysYmd(fromYmd: string, toYmd: string): number {
  const a = parseYmd(fromYmd);
  const b = parseYmd(toYmd);
  const msA = Date.UTC(a.year, a.month - 1, a.day);
  const msB = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((msB - msA) / (24 * 60 * 60 * 1000));
}

export interface MonthCell {
  ymd: string;
  day: number;
  inCurrentMonth: boolean;
  dayOfWeek: number; // 0 = Sun, 6 = Sat
}

/** Build 6-week (or 5-week) Sunday-first calendar grid for given year & 0-based month. */
export function buildMonthGrid(year: number, monthIndex0: number): MonthCell[][] {
  const firstDayOfWeek = new Date(Date.UTC(year, monthIndex0, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const totalCells = Math.ceil((firstDayOfWeek + daysInMonth) / 7) * 7;

  const weeks: MonthCell[][] = [];
  for (let i = 0; i < totalCells; i += 7) {
    const row: MonthCell[] = [];
    for (let d = 0; d < 7; d++) {
      const offset = i + d - firstDayOfWeek;
      const dt = new Date(Date.UTC(year, monthIndex0, 1 + offset));
      const y = dt.getUTCFullYear();
      const m = dt.getUTCMonth();
      const day = dt.getUTCDate();
      row.push({
        ymd: `${y}-${pad2(m + 1)}-${pad2(day)}`,
        day,
        inCurrentMonth: m === monthIndex0 && y === year,
        dayOfWeek: d,
      });
    }
    weeks.push(row);
  }
  return weeks;
}

export interface ExpandedEventInstance {
  instanceKey: string;
  event: CalendarEventItem;
  startDate: string;
  endDate: string;
  isRecurringInstance: boolean;
}

/** Expand non-recurring & recurring events into concrete occurrences overlapping [rangeStart, rangeEnd]. */
export function expandEventsForRange(
  events: CalendarEventItem[],
  rangeStart: string,
  rangeEnd: string
): ExpandedEventInstance[] {
  const result: ExpandedEventInstance[] = [];

  for (const ev of events) {
    if (ev.event_status === 'CANCELLED') continue;
    const spanDays = Math.max(0, diffDaysYmd(ev.start_date, ev.end_date));

    if (ev.recurrence_type === 'NONE') {
      if (ev.end_date >= rangeStart && ev.start_date <= rangeEnd) {
        result.push({
          instanceKey: `${ev.id}:${ev.start_date}`,
          event: ev,
          startDate: ev.start_date,
          endDate: ev.end_date,
          isRecurringInstance: false,
        });
      }
      continue;
    }

    const until = ev.recurrence_until && ev.recurrence_until < rangeEnd ? ev.recurrence_until : rangeEnd;
    if (ev.start_date > until) continue;

    // Walk occurrences up to rangeEnd
    const { year: sy, month: sm, day: sd } = parseYmd(ev.start_date);
    const { year: ry, month: rm, day: rd } = parseYmd(rangeStart);
    const startMs = Date.UTC(sy, sm - 1, sd);
    const rangeStartMs = Date.UTC(ry, rm - 1, rd);
    const effectiveMinStart = addDaysYmd(rangeStart, -spanDays);

    if (ev.recurrence_type === 'DAILY') {
      const cursorStart = ev.start_date > effectiveMinStart ? ev.start_date : effectiveMinStart;
      let cur = cursorStart;
      let guard = 0;
      while (cur <= until && guard < 120) {
        const occEnd = addDaysYmd(cur, spanDays);
        if (occEnd >= rangeStart && cur <= rangeEnd) {
          result.push({
            instanceKey: `${ev.id}:${cur}`,
            event: ev,
            startDate: cur,
            endDate: occEnd,
            isRecurringInstance: cur !== ev.start_date,
          });
        }
        cur = addDaysYmd(cur, 1);
        guard++;
      }
    } else if (ev.recurrence_type === 'WEEKLY') {
      const diffWeeks = Math.max(0, Math.floor((rangeStartMs - startMs) / (7 * 24 * 60 * 60 * 1000)) - 1);
      let cur = addDaysYmd(ev.start_date, diffWeeks * 7);
      let guard = 0;
      while (cur <= until && guard < 30) {
        if (cur >= ev.start_date) {
          const occEnd = addDaysYmd(cur, spanDays);
          if (occEnd >= rangeStart && cur <= rangeEnd) {
            result.push({
              instanceKey: `${ev.id}:${cur}`,
              event: ev,
              startDate: cur,
              endDate: occEnd,
              isRecurringInstance: cur !== ev.start_date,
            });
          }
        }
        cur = addDaysYmd(cur, 7);
        guard++;
      }
    } else if (ev.recurrence_type === 'MONTHLY') {
      const startMonthIndex = sy * 12 + (sm - 1);
      const minMonthIndex = Math.max(startMonthIndex, ry * 12 + (rm - 1) - 1);
      const { year: uy, month: um } = parseYmd(until);
      const maxMonthIndex = uy * 12 + (um - 1);

      for (let mIdx = minMonthIndex; mIdx <= maxMonthIndex; mIdx++) {
        const y = Math.floor(mIdx / 12);
        const m0 = mIdx % 12;
        const lastDay = new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();
        const occStart = formatYmd(y, m0, Math.min(sd, lastDay));
        if (occStart < ev.start_date || occStart > until) continue;
        const occEnd = addDaysYmd(occStart, spanDays);
        if (occEnd >= rangeStart && occStart <= rangeEnd) {
          result.push({
            instanceKey: `${ev.id}:${occStart}`,
            event: ev,
            startDate: occStart,
            endDate: occEnd,
            isRecurringInstance: occStart !== ev.start_date,
          });
        }
      }
    } else if (ev.recurrence_type === 'YEARLY') {
      const { year: uy } = parseYmd(until);
      const minYear = Math.max(sy, ry - 1);
      for (let y = minYear; y <= uy; y++) {
        const lastDay = new Date(Date.UTC(y, sm, 0)).getUTCDate();
        const occStart = formatYmd(y, sm - 1, Math.min(sd, lastDay));
        if (occStart < ev.start_date || occStart > until) continue;
        const occEnd = addDaysYmd(occStart, spanDays);
        if (occEnd >= rangeStart && occStart <= rangeEnd) {
          result.push({
            instanceKey: `${ev.id}:${occStart}`,
            event: ev,
            startDate: occStart,
            endDate: occEnd,
            isRecurringInstance: occStart !== ev.start_date,
          });
        }
      }
    }
  }

  return result;
}

export interface WeekBarPlacement {
  instance: ExpandedEventInstance;
  colStart: number; // 0..6
  colSpan: number; // 1..7
  lane: number; // 0, 1, 2...
  continuesBefore: boolean;
  continuesAfter: boolean;
}

/** Compute non-overlapping horizontal bar lanes for a 7-day week row (TimeTree style!). */
export function layoutWeekBars(weekCells: MonthCell[], instances: ExpandedEventInstance[]): WeekBarPlacement[] {
  const weekStart = weekCells[0].ymd;
  const weekEnd = weekCells[6].ymd;

  const overlapping = instances
    .filter((inst) => inst.endDate >= weekStart && inst.startDate <= weekEnd)
    .sort((a, b) => {
      // Multi-day & all-day first, then earlier startDate, then longer span, then earlier startTime
      const spanA = diffDaysYmd(a.startDate, a.endDate);
      const spanB = diffDaysYmd(b.startDate, b.endDate);
      if (a.startDate !== b.startDate) return a.startDate.localeCompare(b.startDate);
      if (spanA !== spanB) return spanB - spanA;
      if (a.event.is_all_day !== b.event.is_all_day) return a.event.is_all_day ? -1 : 1;
      const tA = a.event.start_time || '00:00';
      const tB = b.event.start_time || '00:00';
      if (tA !== tB) return tA.localeCompare(tB);
      return a.event.id - b.event.id;
    });

  const lanes: boolean[][] = [];
  const placements: WeekBarPlacement[] = [];

  for (const inst of overlapping) {
    const clampedStart = inst.startDate < weekStart ? weekStart : inst.startDate;
    const clampedEnd = inst.endDate > weekEnd ? weekEnd : inst.endDate;
    const colStart = Math.max(0, Math.min(6, diffDaysYmd(weekStart, clampedStart)));
    const colEnd = Math.max(colStart, Math.min(6, diffDaysYmd(weekStart, clampedEnd)));
    const colSpan = colEnd - colStart + 1;

    let assignedLane = -1;
    for (let l = 0; l < lanes.length; l++) {
      let free = true;
      for (let c = colStart; c <= colEnd; c++) {
        if (lanes[l][c]) {
          free = false;
          break;
        }
      }
      if (free) {
        assignedLane = l;
        break;
      }
    }

    if (assignedLane === -1) {
      assignedLane = lanes.length;
      lanes.push(new Array(7).fill(false));
    }

    for (let c = colStart; c <= colEnd; c++) {
      lanes[assignedLane][c] = true;
    }

    placements.push({
      instance: inst,
      colStart,
      colSpan,
      lane: assignedLane,
      continuesBefore: inst.startDate < weekStart,
      continuesAfter: inst.endDate > weekEnd,
    });
  }

  return placements;
}

export function formatShortDate(ymd: string): string {
  const { month, day } = parseYmd(ymd);
  return `${month}/${day}`;
}
