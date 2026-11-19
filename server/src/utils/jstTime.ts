const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function getJstNow(now: Date = new Date()): Date {
  return new Date(now.getTime() + JST_OFFSET_MS);
}

export function getJstDateStr(now: Date = new Date()): string {
  return getJstNow(now).toISOString().slice(0, 10);
}

export function getJstTimeStr(now: Date = new Date()): string {
  return getJstNow(now).toISOString().slice(11, 16);
}

export function getJstDateStrWithDayOffset(offsetDays: number, now: Date = new Date()): string {
  return getJstDateStr(new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000));
}

export function getJstDateTimeStr(now: Date = new Date()): string {
  return getJstNow(now).toISOString().slice(0, 19).replace('T', ' ');
}
