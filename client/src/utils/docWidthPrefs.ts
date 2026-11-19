export type FullWidthMap = Record<string, boolean>;

export function loadFullWidthMap(storageKey: string): FullWidthMap {
  try {
    if (typeof window === 'undefined') return {};
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: FullWidthMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (v === true) out[k] = true;
    }
    return out;
  } catch {
    return {};
  }
}

export function setDocFullWidthPref(
  storageKey: string,
  prevMap: FullWidthMap,
  docId: number | string,
  nextValue: boolean
): FullWidthMap {
  const key = String(docId);
  const nextMap: FullWidthMap = { ...prevMap };
  if (nextValue) {
    nextMap[key] = true;
  } else {
    delete nextMap[key];
  }
  try {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(storageKey, JSON.stringify(nextMap));
    }
  } catch {
    // ignore storage restriction
  }
  return nextMap;
}
