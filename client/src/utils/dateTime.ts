const JST_TIMEZONE = 'Asia/Tokyo';

export function parseServerTimestamp(raw?: string | Date | null): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime()) ? null : raw;
  }

  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
    const parsed = new Date(`${trimmed.replace(' ', 'T')}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed)) {
    const parsed = new Date(`${trimmed}Z`);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function formatJstTime(raw?: string | Date | null): string {
  const date = parseServerTimestamp(raw);
  if (!date) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: JST_TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function getJstDateKey(raw?: string | Date | null): string {
  const date = parseServerTimestamp(raw);
  if (!date) return '';
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: JST_TIMEZONE,
  }).format(date);
}

export function getJstTodayStr(): string {
  return getJstDateKey(new Date());
}
