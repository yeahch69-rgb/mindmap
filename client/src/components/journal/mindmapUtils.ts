import { EntryType, FreeMapEdge, JournalEntry, JournalIdea, JournalProject, PortSide, TurnState } from './types';

export const PORT_SIDES: PortSide[] = ['top', 'right', 'bottom', 'left'];
export const ROOT_SUBTOPIC_KEY = 'root-subtopic';
export const NEXT_STEP_TOPIC_MARKER = '__NEXT_STEP_TOPIC__';
export const CURRENT_FOCUS_INTENT_MARKER = '__CURRENT_FOCUS_INTENT__';

export const WIRE_COLOR_PRESETS = ['#7C3AED', '#059669', '#D97706', '#E11D48', '#0284C7'];

export interface ObstacleBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CreateJournalEntryPayload {
  projectId: number;
  entry_type: EntryType;
  speaker_name: string | null;
  content: string;
  entry_date: string;
  entry_time: string | null;
  due_date: string | null;
  due_time: string | null;
  completed_target_type: 'ENTRY' | 'IDEA' | null;
  completed_target_id: number | null;
  parent_node_key?: string | null;
  next_turn_state?: TurnState;
}

export interface CreateJournalIdeaPayload {
  projectId: number;
  title: string;
  note: string | null;
  parent_idea_id: number | null;
  parent_node_key?: string | null;
}

export function isTopicMilestoneEntry(en: JournalEntry): boolean {
  return (
    en.speaker_name === NEXT_STEP_TOPIC_MARKER ||
    String(en.content || '').startsWith('💡 → Next Step:')
  );
}

export function isCurrentFocusIntentEntry(en: JournalEntry): boolean {
  return en.speaker_name === CURRENT_FOCUS_INTENT_MARKER;
}

/**
 * Finds the auto-created initial INTENT entry that duplicates the project's '최초 의도 (Pinned)'
 * so the Mind Map only shows '최초 의도 (Pinned)' once while keeping the entry in the Timeline.
 */
export function findDuplicateInitialIntentEntryId(
  project: JournalProject | null,
  entries: JournalEntry[]
): number | null {
  if (!project) return null;
  const initialText = String(
    project.initial_intent_summary || project.intent_summary || ''
  ).trim();
  if (!initialText) return null;

  const sorted = [...entries].sort((a, b) => a.id - b.id);
  for (const en of sorted) {
    if (
      en.entry_type === 'INTENT' &&
      !isTopicMilestoneEntry(en) &&
      !isCurrentFocusIntentEntry(en) &&
      String(en.content || '').trim() === initialText
    ) {
      return en.id;
    }
  }
  return null;
}

export function remapMindMapKey(key: string, duplicateInitialEntryId: number | null): string {
  if (duplicateInitialEntryId !== null && key === `entry-${duplicateInitialEntryId}`) {
    return 'intent-pinned';
  }
  return key;
}

export function cleanTopicMilestoneTitle(content: string): string {
  return String(content || '')
    .replace(/^💡\s*→\s*Next Step:\s*/i, '')
    .replace(/^🎯\s*(?:\[[^\]]+\]\s*)?/, '')
    .trim();
}

export function computeTopicAndDialogueDefaultParents(
  entries: JournalEntry[],
  parentOverrides: Record<string, string>,
  baseRootKey: string
): {
  topicEntries: JournalEntry[];
  defaultParents: Map<string, string>;
} {
  const sorted = [...entries].sort((a, b) => a.id - b.id);
  const topicEntries = sorted.filter(isTopicMilestoneEntry);
  const dialogueEntries = sorted.filter((e) => e.entry_type !== 'INTENT');
  const defaultParents = new Map<string, string>();

  topicEntries.forEach((t, idx) => {
    const tKey = `entry-${t.id}`;
    defaultParents.set(tKey, idx === 0 ? baseRootKey : `entry-${topicEntries[idx - 1].id}`);
  });

  if (topicEntries.length === 0) {
    let chainTail = baseRootKey;
    for (const d of dialogueEntries) {
      const dKey = `entry-${d.id}`;
      defaultParents.set(dKey, chainTail);
      if (parentOverrides[dKey] !== ROOT_SUBTOPIC_KEY) {
        chainTail = dKey;
      }
    }
  } else {
    topicEntries.forEach((t, idx) => {
      const minId = idx === 0 ? -1 : t.id;
      const maxId = idx + 1 < topicEntries.length ? topicEntries[idx + 1].id : Infinity;
      const bucket = dialogueEntries.filter((d) => d.id > minId && d.id < maxId);
      let chainTail = `entry-${t.id}`;
      for (const d of bucket) {
        const dKey = `entry-${d.id}`;
        defaultParents.set(dKey, chainTail);
        if (parentOverrides[dKey] !== ROOT_SUBTOPIC_KEY) {
          chainTail = dKey;
        }
      }
    });
  }

  return { topicEntries, defaultParents };
}

export function getWsFreeMindMapStorageKey(userId?: number): string {
  return `nygc_journal_free_ws_${userId || 'guest'}`;
}

export function getPortCoords(
  x: number,
  y: number,
  w: number,
  h: number,
  side: PortSide
): { x: number; y: number } {
  switch (side) {
    case 'top':
      return { x: x + w / 2, y };
    case 'bottom':
      return { x: x + w / 2, y: y + h };
    case 'left':
      return { x, y: y + h / 2 };
    case 'right':
    default:
      return { x: x + w, y: y + h / 2 };
  }
}

export function getPortOutVector(side: PortSide): { dx: number; dy: number } {
  switch (side) {
    case 'top':
      return { dx: 0, dy: -1 };
    case 'bottom':
      return { dx: 0, dy: 1 };
    case 'left':
      return { dx: -1, dy: 0 };
    case 'right':
    default:
      return { dx: 1, dy: 0 };
  }
}

export function chooseFacingPorts(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number }
): { fromSide: PortSide; toSide: PortSide } {
  const fcx = from.x + from.w / 2;
  const fcy = from.y + from.h / 2;
  const tcx = to.x + to.w / 2;
  const tcy = to.y + to.h / 2;
  const dx = tcx - fcx;
  const dy = tcy - fcy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { fromSide: 'right', toSide: 'left' } : { fromSide: 'left', toSide: 'right' };
  }
  return dy >= 0 ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
}

/**
 * Port selection optimized for left-to-right hierarchical mind maps:
 * - Same column & vertically adjacent: bottom <-> top
 * - Same column & separated by other cards: right <-> right
 * - Different rows: bottom <-> top (enters the horizontal inter-row corridor directly)
 * - Same row & separated by intermediate cards: bottom <-> bottom
 * - Same row & adjacent columns: right <-> left
 */
export function chooseSmartLeftRightPorts(
  from: { x: number; y: number; w: number; h: number },
  to: { x: number; y: number; w: number; h: number }
): { fromSide: PortSide; toSide: PortSide } {
  const fcy = from.y + from.h / 2;
  const tcy = to.y + to.h / 2;
  // 1. Same column
  if (Math.abs(from.x - to.x) < 40) {
    if (Math.abs(tcy - fcy) <= Math.max(from.h, to.h) + 40) {
      return fcy <= tcy ? { fromSide: 'bottom', toSide: 'top' } : { fromSide: 'top', toSide: 'bottom' };
    }
    return { fromSide: 'right', toSide: 'right' };
  }
  // 2. Different rows (vertical separation >= 1 row) -> use bottom/top ports to enter horizontal corridor directly
  if (from.y + from.h <= to.y + 8) {
    return { fromSide: 'bottom', toSide: 'top' };
  }
  if (to.y + to.h <= from.y + 8) {
    return { fromSide: 'top', toSide: 'bottom' };
  }
  // 3. Same row, separated by intermediate column(s)
  const hGap =
    from.x < to.x ? to.x - (from.x + from.w) : from.x - (to.x + to.w);
  if (hGap > 120) {
    return { fromSide: 'bottom', toSide: 'bottom' };
  }
  if (from.x + from.w <= to.x + 20) {
    return { fromSide: 'right', toSide: 'left' };
  }
  if (to.x + to.w <= from.x + 20) {
    return { fromSide: 'left', toSide: 'right' };
  }
  return chooseFacingPorts(from, to);
}

export function chooseOutwardPortSide(
  node: { x: number; y: number; w: number; h: number },
  parentCenter: { x: number; y: number }
): PortSide {
  const vx = node.x + node.w / 2 - parentCenter.x;
  const vy = node.y + node.h / 2 - parentCenter.y;
  if (vx === 0 && vy === 0) return 'right';
  if (Math.abs(vx) >= Math.abs(vy)) {
    return vx >= 0 ? 'right' : 'left';
  }
  return vy >= 0 ? 'bottom' : 'top';
}

export function getDefaultComposerKindForNode(
  kind?: string,
  entry?: JournalEntry
): EntryType | 'IDEA' {
  if (kind === 'IDEA') return 'IDEA';
  if (kind === 'INTENT_PINNED') return 'INTENT';
  if (entry) {
    if (isTopicMilestoneEntry(entry)) return 'DIALOGUE_ME';
    if (entry.entry_type === 'DIALOGUE_ME') return 'DIALOGUE_THEM';
    if (entry.entry_type === 'DIALOGUE_THEM') return 'DIALOGUE_ME';
    return entry.entry_type;
  }
  if (kind === 'NEXT_STEP') return 'PROGRESS';
  return 'DIALOGUE_ME';
}

export function buildDirectionalBezier(
  p1: { x: number; y: number },
  side1: PortSide,
  p2: { x: number; y: number },
  side2: PortSide
): { path: string; midX: number; midY: number } {
  const v1 = getPortOutVector(side1);
  const v2 = getPortOutVector(side2);
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const offset = Math.max(46, Math.min(170, dist * 0.42));
  const c1x = p1.x + v1.dx * offset;
  const c1y = p1.y + v1.dy * offset;
  const c2x = p2.x + v2.dx * offset;
  const c2y = p2.y + v2.dy * offset;
  const midX = 0.125 * p1.x + 0.375 * c1x + 0.375 * c2x + 0.125 * p2.x;
  const midY = 0.125 * p1.y + 0.375 * c1y + 0.375 * c2y + 0.125 * p2.y;
  return {
    path: `M ${p1.x} ${p1.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`,
    midX,
    midY,
  };
}

function pointNearOrInsideBox(
  pt: { x: number; y: number },
  box: ObstacleBox,
  pad: number
): boolean {
  return (
    pt.x >= box.x - pad &&
    pt.x <= box.x + box.w + pad &&
    pt.y >= box.y - pad &&
    pt.y <= box.y + box.h + pad
  );
}

function computeStubPoint(
  p: { x: number; y: number },
  side: PortSide,
  obstacles: ObstacleBox[]
): { x: number; y: number } {
  const v = getPortOutVector(side);
  let minFrontDist = Infinity;

  for (const obs of obstacles) {
    if (pointNearOrInsideBox(p, obs, 2)) continue;
    if (v.dx !== 0) {
      if (p.y < obs.y - 6 || p.y > obs.y + obs.h + 6) continue;
      if (v.dx > 0 && obs.x > p.x + 2) {
        minFrontDist = Math.min(minFrontDist, obs.x - p.x);
      } else if (v.dx < 0 && obs.x + obs.w < p.x - 2) {
        minFrontDist = Math.min(minFrontDist, p.x - (obs.x + obs.w));
      }
    } else {
      if (p.x < obs.x - 6 || p.x > obs.x + obs.w + 6) continue;
      if (v.dy > 0 && obs.y > p.y + 2) {
        minFrontDist = Math.min(minFrontDist, obs.y - p.y);
      } else if (v.dy < 0 && obs.y + obs.h < p.y - 2) {
        minFrontDist = Math.min(minFrontDist, p.y - (obs.y + obs.h));
      }
    }
  }

  const stubDist =
    minFrontDist < 44 ? Math.max(7, Math.min(20, Math.round(minFrontDist / 2))) : 16;
  return {
    x: Math.round(p.x + v.dx * stubDist),
    y: Math.round(p.y + v.dy * stubDist),
  };
}

function simplifyOrthogonalPolyline(
  raw: Array<{ x: number; y: number }>
): Array<{ x: number; y: number }> | null {
  const pts: Array<{ x: number; y: number }> = [];
  for (const pt of raw) {
    const prev = pts[pts.length - 1];
    if (prev && Math.abs(prev.x - pt.x) < 0.5 && Math.abs(prev.y - pt.y) < 0.5) {
      continue;
    }
    pts.push({ x: Math.round(pt.x), y: Math.round(pt.y) });
  }
  if (pts.length < 2) return null;

  const out: Array<{ x: number; y: number }> = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = out[out.length - 1];
    const b = pts[i];
    const c = pts[i + 1];
    const sameX = Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5;
    const sameY = Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5;
    if (sameX) {
      const dir1 = b.y - a.y;
      const dir2 = c.y - b.y;
      if (dir1 * dir2 < -0.5) return null; // 180-degree spike reversal
      continue;
    }
    if (sameY) {
      const dir1 = b.x - a.x;
      const dir2 = c.x - b.x;
      if (dir1 * dir2 < -0.5) return null; // 180-degree spike reversal
      continue;
    }
    out.push(b);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

function isOrthogonalPolylineValidAndClear(
  pts: Array<{ x: number; y: number }>,
  side1: PortSide,
  side2: PortSide,
  obstacles: ObstacleBox[],
  clearancePad: number
): boolean {
  if (pts.length < 2) return false;
  const p1 = pts[0];
  const p2 = pts[pts.length - 1];
  const v1 = getPortOutVector(side1);
  const v2 = getPortOutVector(side2);

  // Verify port exit direction
  const d1x = pts[1].x - p1.x;
  const d1y = pts[1].y - p1.y;
  if (d1x * v1.dx + d1y * v1.dy < 6 || Math.abs(d1x * v1.dy - d1y * v1.dx) > 1) {
    return false;
  }

  // Verify port entry direction
  const prevEnd = pts[pts.length - 2];
  const d2x = prevEnd.x - p2.x;
  const d2y = prevEnd.y - p2.y;
  if (d2x * v2.dx + d2y * v2.dy < 6 || Math.abs(d2x * v2.dy - d2y * v2.dx) > 1) {
    return false;
  }

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const sx1 = Math.min(a.x, b.x);
    const sy1 = Math.min(a.y, b.y);
    const sx2 = Math.max(a.x, b.x);
    const sy2 = Math.max(a.y, b.y);

    const isFirstSeg = i === 0;
    const isLastSeg = i === pts.length - 2;

    for (const obs of obstacles) {
      let pad = clearancePad;
      if (isFirstSeg && pointNearOrInsideBox(p1, obs, 2)) {
        pad = -2;
      } else if (isLastSeg && pointNearOrInsideBox(p2, obs, 2)) {
        pad = -2;
      }
      const rx1 = obs.x - pad;
      const ry1 = obs.y - pad;
      const rx2 = obs.x + obs.w + pad;
      const ry2 = obs.y + obs.h + pad;
      if (sx2 > rx1 && sx1 < rx2 && sy2 > ry1 && sy1 < ry2) {
        return false;
      }
    }
  }

  return true;
}

function buildRoundedOrthogonalSvg(pts: Array<{ x: number; y: number }>): {
  path: string;
  midX: number;
  midY: number;
} {
  if (pts.length < 2) {
    return { path: '', midX: 0, midY: 0 };
  }

  // Compute 50% arc-length midpoint along segments
  const segLengths: number[] = [];
  let totalLen = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const len = Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
    segLengths.push(len);
    totalLen += len;
  }

  let midX = (pts[0].x + pts[pts.length - 1].x) / 2;
  let midY = (pts[0].y + pts[pts.length - 1].y) / 2;
  let halfTarget = totalLen / 2;
  for (let i = 0; i < segLengths.length; i++) {
    const len = segLengths[i];
    if (halfTarget <= len || i === segLengths.length - 1) {
      const t = len > 0 ? Math.max(0, Math.min(1, halfTarget / len)) : 0.5;
      midX = pts[i].x + (pts[i + 1].x - pts[i].x) * t;
      midY = pts[i].y + (pts[i + 1].y - pts[i].y) * t;
      break;
    }
    halfTarget -= len;
  }

  // Build SVG path with rounded quadratic Bezier corners
  const parts: string[] = [`M ${pts[0].x} ${pts[0].y}`];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const len1 = Math.hypot(curr.x - prev.x, curr.y - prev.y);
    const len2 = Math.hypot(next.x - curr.x, next.y - curr.y);
    if (len1 < 2 || len2 < 2) {
      parts.push(`L ${curr.x} ${curr.y}`);
      continue;
    }
    const r = Math.min(12, len1 * 0.45, len2 * 0.45);
    const u1x = (curr.x - prev.x) / len1;
    const u1y = (curr.y - prev.y) / len1;
    const u2x = (next.x - curr.x) / len2;
    const u2y = (next.y - curr.y) / len2;
    const bx = Math.round((curr.x - u1x * r) * 10) / 10;
    const by = Math.round((curr.y - u1y * r) * 10) / 10;
    const ax = Math.round((curr.x + u2x * r) * 10) / 10;
    const ay = Math.round((curr.y + u2y * r) * 10) / 10;
    parts.push(`L ${bx} ${by} Q ${curr.x} ${curr.y}, ${ax} ${ay}`);
  }
  parts.push(`L ${pts[pts.length - 1].x} ${pts[pts.length - 1].y}`);

  return {
    path: parts.join(' '),
    midX: Math.round(midX),
    midY: Math.round(midY),
  };
}

/**
 * Guaranteed obstacle-avoiding rounded-channel router for Mind Map connections.
 * Routes wires strictly through empty inter-row and inter-column corridors around all node cards and [+] buttons.
 */
export function buildObstacleAvoidingPath(
  p1: { x: number; y: number },
  side1: PortSide,
  p2: { x: number; y: number },
  side2: PortSide,
  obstacles: ObstacleBox[]
): { path: string; midX: number; midY: number } {
  if (!obstacles || obstacles.length === 0) {
    return buildDirectionalBezier(p1, side1, p2, side2);
  }

  const s1 = computeStubPoint(p1, side1, obstacles);
  const s2 = computeStubPoint(p2, side2, obstacles);

  // Collect candidate horizontal (Y) and vertical (X) corridor lines
  const rawXs: number[] = [p1.x, s1.x, p2.x, s2.x, Math.round((s1.x + s2.x) / 2)];
  const rawYs: number[] = [p1.y, s1.y, p2.y, s2.y, Math.round((s1.y + s2.y) / 2)];

  let minX = Math.min(p1.x, p2.x);
  let maxX = Math.max(p1.x, p2.x);
  let minY = Math.min(p1.y, p2.y);
  let maxY = Math.max(p1.y, p2.y);

  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    minX = Math.min(minX, o.x);
    maxX = Math.max(maxX, o.x + o.w);
    minY = Math.min(minY, o.y);
    maxY = Math.max(maxY, o.y + o.h);
    rawXs.push(o.x - 13, o.x + o.w + 13);
    rawYs.push(o.y - 13, o.y + o.h + 13);

    for (let j = i + 1; j < obstacles.length; j++) {
      const b = obstacles[j];
      if (o.x + o.w < b.x && b.x - (o.x + o.w) <= 90) {
        rawXs.push(Math.round((o.x + o.w + b.x) / 2));
      } else if (b.x + b.w < o.x && o.x - (b.x + b.w) <= 90) {
        rawXs.push(Math.round((b.x + b.w + o.x) / 2));
      }
      if (o.y + o.h < b.y && b.y - (o.y + o.h) <= 90) {
        rawYs.push(Math.round((o.y + o.h + b.y) / 2));
      } else if (b.y + b.h < o.y && o.y - (b.y + b.h) <= 90) {
        rawYs.push(Math.round((b.y + b.h + o.y) / 2));
      }
    }
  }
  rawXs.push(minX - 28, maxX + 28);
  rawYs.push(minY - 28, maxY + 28);

  const dedupeSorted = (arr: number[], mustKeep: number[]): number[] => {
    const keepSet = new Set(mustKeep.map((v) => Math.round(v)));
    const sorted = Array.from(new Set(arr.map((v) => Math.round(v)))).sort((a, b) => a - b);
    const out: number[] = [];
    for (const v of sorted) {
      if (keepSet.has(v) || out.length === 0 || Math.abs(v - out[out.length - 1]) >= 4) {
        out.push(v);
      }
    }
    return out;
  };

  const candXs = dedupeSorted(rawXs, [p1.x, s1.x, p2.x, s2.x]);
  const candYs = dedupeSorted(rawYs, [p1.y, s1.y, p2.y, s2.y]);

  const tryFindBestPath = (pad: number): Array<{ x: number; y: number }> | null => {
    let bestPts: Array<{ x: number; y: number }> | null = null;
    let bestScore = Infinity;

    const evaluate = (rawCandidate: Array<{ x: number; y: number }>) => {
      const simplified = simplifyOrthogonalPolyline(rawCandidate);
      if (!simplified) return;
      let len = 0;
      for (let i = 0; i < simplified.length - 1; i++) {
        len +=
          Math.abs(simplified[i + 1].x - simplified[i].x) +
          Math.abs(simplified[i + 1].y - simplified[i].y);
      }
      const bends = simplified.length - 2;
      const score = len + bends * 36;
      if (score >= bestScore) return;
      if (!isOrthogonalPolylineValidAndClear(simplified, side1, side2, obstacles, pad)) {
        return;
      }
      bestScore = score;
      bestPts = simplified;
    };

    // 1. Direct L / Z shapes through s1 and s2
    evaluate([p1, s1, { x: s2.x, y: s1.y }, s2, p2]);
    evaluate([p1, s1, { x: s1.x, y: s2.y }, s2, p2]);
    evaluate([p1, { x: p1.x, y: s1.y }, { x: p2.x, y: s1.y }, p2]);
    evaluate([p1, { x: p1.x, y: s2.y }, { x: p2.x, y: s2.y }, p2]);
    evaluate([p1, { x: s1.x, y: p1.y }, { x: s1.x, y: p2.y }, p2]);
    evaluate([p1, { x: s2.x, y: p1.y }, { x: s2.x, y: p2.y }, p2]);

    // 2. Single Horizontal Corridor hy
    for (const hy of candYs) {
      evaluate([p1, s1, { x: s1.x, y: hy }, { x: s2.x, y: hy }, s2, p2]);
      evaluate([p1, { x: p1.x, y: hy }, { x: p2.x, y: hy }, p2]);
    }

    // 3. Single Vertical Corridor vx
    for (const vx of candXs) {
      evaluate([p1, s1, { x: vx, y: s1.y }, { x: vx, y: s2.y }, s2, p2]);
      evaluate([p1, { x: vx, y: p1.y }, { x: vx, y: p2.y }, p2]);
    }

    // 4. Two-Corridor (vx + hy) combinations
    for (const vx of candXs) {
      for (const hy of candYs) {
        evaluate([p1, s1, { x: vx, y: s1.y }, { x: vx, y: hy }, { x: s2.x, y: hy }, s2, p2]);
        evaluate([p1, s1, { x: s1.x, y: hy }, { x: vx, y: hy }, { x: vx, y: s2.y }, s2, p2]);
      }
    }

    if (bestPts) return bestPts;

    // 5. Three-Corridor (vx1 -> hy -> vx2 and hy1 -> vx -> hy2) for multi-obstacle detours
    const nearXs = [...candXs]
      .sort((a, b) => Math.abs(a - (s1.x + s2.x) / 2) - Math.abs(b - (s1.x + s2.x) / 2))
      .slice(0, 14);
    const nearYs = [...candYs]
      .sort((a, b) => Math.abs(a - (s1.y + s2.y) / 2) - Math.abs(b - (s1.y + s2.y) / 2))
      .slice(0, 14);

    for (const hy of nearYs) {
      for (const vx1 of nearXs) {
        for (const vx2 of nearXs) {
          evaluate([
            p1,
            s1,
            { x: vx1, y: s1.y },
            { x: vx1, y: hy },
            { x: vx2, y: hy },
            { x: vx2, y: s2.y },
            s2,
            p2,
          ]);
        }
      }
    }

    return bestPts;
  };

  const winningPts = tryFindBestPath(5) || tryFindBestPath(2);
  if (winningPts) {
    return buildRoundedOrthogonalSvg(winningPts);
  }

  return buildDirectionalBezier(p1, side1, p2, side2);
}

/**
 * For Free Mind Map: uses smooth organic Bezier curve when the curve is clear of obstacles,
 * and automatically switches to obstacle-avoiding rounded-channel detour when a card blocks the curve!
 */
export function buildSmartFreeMapPath(
  p1: { x: number; y: number },
  side1: PortSide,
  p2: { x: number; y: number },
  side2: PortSide,
  obstacles: ObstacleBox[]
): { path: string; midX: number; midY: number } {
  const bezier = buildDirectionalBezier(p1, side1, p2, side2);
  if (!obstacles || obstacles.length === 0) return bezier;

  const v1 = getPortOutVector(side1);
  const v2 = getPortOutVector(side2);
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const offset = Math.max(46, Math.min(170, dist * 0.42));
  const c1x = p1.x + v1.dx * offset;
  const c1y = p1.y + v1.dy * offset;
  const c2x = p2.x + v2.dx * offset;
  const c2y = p2.y + v2.dy * offset;

  // Sample 18 points along the cubic Bezier curve to check if it crosses any card
  let hitsCard = false;
  for (let step = 1; step <= 17; step++) {
    const t = step / 18;
    const mt = 1 - t;
    const x =
      mt * mt * mt * p1.x +
      3 * mt * mt * t * c1x +
      3 * mt * t * t * c2x +
      t * t * t * p2.x;
    const y =
      mt * mt * mt * p1.y +
      3 * mt * mt * t * c1y +
      3 * mt * t * t * c2y +
      t * t * t * p2.y;

    for (const obs of obstacles) {
      const isSourceOrTarget =
        pointNearOrInsideBox(p1, obs, 2) || pointNearOrInsideBox(p2, obs, 2);
      if (isSourceOrTarget && (t < 0.14 || t > 0.86)) continue;
      const pad = isSourceOrTarget ? 0 : 5;
      if (
        x >= obs.x - pad &&
        x <= obs.x + obs.w + pad &&
        y >= obs.y - pad &&
        y <= obs.y + obs.h + pad
      ) {
        hitsCard = true;
        break;
      }
    }
    if (hitsCard) break;
  }

  if (!hitsCard) return bezier;
  return buildObstacleAvoidingPath(p1, side1, p2, side2, obstacles);
}

export function wouldCycleInParentMap(
  nodeKey: string,
  candidateParent: string,
  currentParents: Map<string, string | undefined>
): boolean {
  if (candidateParent === nodeKey) return true;
  let curr: string | undefined = candidateParent;
  const visited = new Set<string>();
  while (curr) {
    if (curr === nodeKey) return true;
    if (visited.has(curr)) return true;
    visited.add(curr);
    curr = currentParents.get(curr);
  }
  return false;
}

export function isDescendantInParentMap(
  candidateKey: string,
  ancestorKey: string,
  effectiveParentMap: Map<string, string | undefined>
): boolean {
  if (candidateKey === ancestorKey) return true;
  let curr = effectiveParentMap.get(candidateKey);
  const visited = new Set<string>();
  while (curr) {
    if (curr === ancestorKey) return true;
    if (visited.has(curr)) return true;
    visited.add(curr);
    curr = effectiveParentMap.get(curr);
  }
  return false;
}

export function buildRelatedIdeaWires(
  ideas: JournalIdea[],
  customEdges: FreeMapEdge[],
  hasNode: (key: string) => boolean
): Array<{ fromKey: string; toKey: string }> {
  const list: Array<{ fromKey: string; toKey: string }> = [];
  const seen = new Set<string>();
  const customPairSet = new Set<string>();
  for (const ce of customEdges) {
    const pair = [ce.fromKey, ce.toKey].sort().join('::');
    customPairSet.add(pair);
  }
  for (const idea of ideas) {
    const k1 = `idea-${idea.id}`;
    if (!hasNode(k1)) continue;
    for (const tid of idea.related_idea_ids || []) {
      const k2 = `idea-${tid}`;
      if (tid === idea.id || !hasNode(k2)) continue;
      const pair = [k1, k2].sort().join('::');
      if (seen.has(pair) || customPairSet.has(pair)) continue;
      seen.add(pair);
      list.push({ fromKey: k1, toKey: k2 });
    }
  }
  return list;
}

/**
 * Computes which node keys are hidden because one of their ancestors is collapsed,
 * and counts how many total descendants are inside each node's subtree (for `[-]` / `[+N]` badges).
 */
export function computeSubtreeCollapseState(
  allKeys: string[],
  effectiveParentMap: Map<string, string | undefined>,
  collapsedKeys: Set<string>
): {
  hiddenKeys: Set<string>;
  descendantCountMap: Map<string, number>;
  directChildCountMap: Map<string, number>;
} {
  const childrenMap = new Map<string, string[]>();
  const directChildCountMap = new Map<string, number>();

  for (const key of allKeys) {
    const pKey = effectiveParentMap.get(key);
    if (pKey && pKey !== key) {
      const list = childrenMap.get(pKey) || [];
      list.push(key);
      childrenMap.set(pKey, list);
    }
  }
  for (const [pKey, list] of childrenMap.entries()) {
    directChildCountMap.set(pKey, list.length);
  }

  const descendantCountMap = new Map<string, number>();
  const countDesc = (key: string, stack: Set<string>): number => {
    const cached = descendantCountMap.get(key);
    if (cached !== undefined) return cached;
    if (stack.has(key)) return 0;
    stack.add(key);
    let total = 0;
    for (const child of childrenMap.get(key) || []) {
      total += 1 + countDesc(child, stack);
    }
    stack.delete(key);
    descendantCountMap.set(key, total);
    return total;
  };
  for (const key of allKeys) {
    countDesc(key, new Set());
  }

  const hiddenKeys = new Set<string>();
  const hideSubtree = (key: string, stack: Set<string>) => {
    if (stack.has(key)) return;
    stack.add(key);
    for (const child of childrenMap.get(key) || []) {
      hiddenKeys.add(child);
      hideSubtree(child, stack);
    }
    stack.delete(key);
  };
  for (const collapsed of collapsedKeys) {
    hideSubtree(collapsed, new Set());
  }

  return { hiddenKeys, descendantCountMap, directChildCountMap };
}

/**
 * Builds a clean hierarchical Markdown outline from rendered Mind Map nodes,
 * parent relationships, and custom cross-link wires.
 */
export function buildMindMapMarkdown(
  title: string,
  nodes: Array<{ key: string; title: string; subtitle?: string; badge?: string; kind?: string }>,
  effectiveParentMap: Map<string, string | undefined>,
  customEdges: FreeMapEdge[],
  duplicateInitialEntryId: number | null = null
): string {
  const nodeMap = new Map(nodes.map((n) => [n.key, n]));
  const childrenMap = new Map<string, string[]>();
  const roots: string[] = [];

  for (const n of nodes) {
    if (n.kind === 'ADD_HINT') continue;
    const pKey = effectiveParentMap.get(n.key);
    if (pKey && nodeMap.has(pKey) && pKey !== n.key) {
      const list = childrenMap.get(pKey) || [];
      list.push(n.key);
      childrenMap.set(pKey, list);
    } else {
      roots.push(n.key);
    }
  }

  const lines: string[] = [`# ${title}`, ''];
  const visited = new Set<string>();

  const walk = (key: string, depth: number) => {
    if (visited.has(key)) return;
    visited.add(key);
    const node = nodeMap.get(key);
    if (!node) return;
    const indent = '  '.repeat(depth);
    const badgeStr = node.badge ? ` \`[${node.badge}]\`` : '';
    const cleanSub = node.subtitle ? node.subtitle.replace(/\s+/g, ' ').trim() : '';
    const subStr = cleanSub ? ` — ${cleanSub}` : '';
    lines.push(`${indent}- **${node.title}**${badgeStr}${subStr}`);
    for (const cKey of childrenMap.get(key) || []) {
      walk(cKey, depth + 1);
    }
  };

  for (const rKey of roots) {
    walk(rKey, 0);
  }

  if (customEdges.length > 0) {
    const wireLines: string[] = [];
    for (const edge of customEdges) {
      const fKey = remapMindMapKey(edge.fromKey, duplicateInitialEntryId);
      const tKey = remapMindMapKey(edge.toKey, duplicateInitialEntryId);
      const fNode = nodeMap.get(fKey);
      const tNode = nodeMap.get(tKey);
      if (!fNode || !tNode) continue;
      const lbl = edge.label ? ` (${edge.label})` : '';
      wireLines.push(`- ${fNode.title} ↔ ${tNode.title}${lbl}`);
    }
    if (wireLines.length > 0) {
      lines.push('', '## 연결선 (Cross-Links)', ...wireLines);
    }
  }

  return lines.join('\n');
}

export interface PngExportNode {
  x: number;
  y: number;
  w: number;
  h: number;
  title: string;
  subtitle?: string;
  badge?: string;
  isRoot?: boolean;
  accentColor: string;
  fillColor: string;
  borderColor: string;
  textColor?: string;
}

export interface PngExportEdge {
  pathD: string;
  color: string;
  dashed?: boolean;
  strokeWidth?: number;
  label?: string;
  midX?: number;
  midY?: number;
}

/**
 * Renders Mind Map nodes & SVG paths to a crisp 2x high-DPI PNG via pure Canvas 2D
 * (immune to SVG foreignObject cross-origin canvas tainting) and triggers download.
 */
export function downloadMindMapAsPng(
  filename: string,
  nodes: PngExportNode[],
  edges: PngExportEdge[]
): void {
  if (nodes.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }
  const pad = 64;
  const contentW = Math.max(400, maxX - minX + pad * 2);
  const contentH = Math.max(300, maxY - minY + pad * 2);

  // Clamp DPR so massive maps never exceed browser canvas memory limits
  const maxDim = Math.max(contentW, contentH);
  const scale = maxDim > 3800 ? 1 : maxDim > 2200 ? 1.5 : 2;

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(contentW * scale);
  canvas.height = Math.ceil(contentH * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  ctx.scale(scale, scale);
  // Background
  ctx.fillStyle = '#FAFAF7';
  ctx.fillRect(0, 0, contentW, contentH);

  // Subtle dot grid
  ctx.fillStyle = '#E6E2D8';
  for (let gx = 16; gx < contentW; gx += 24) {
    for (let gy = 16; gy < contentH; gy += 24) {
      ctx.fillRect(gx, gy, 1.5, 1.5);
    }
  }

  ctx.save();
  ctx.translate(-minX + pad, -minY + pad);

  // 1. Edges
  for (const edge of edges) {
    if (!edge.pathD) continue;
    ctx.save();
    ctx.strokeStyle = edge.color || '#7C3AED';
    ctx.lineWidth = edge.strokeWidth || 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (edge.dashed) ctx.setLineDash([6, 4]);
    try {
      const p2d = new Path2D(edge.pathD);
      ctx.stroke(p2d);
    } catch {
      // ignore malformed path
    }
    ctx.restore();

    if (edge.label && typeof edge.midX === 'number' && typeof edge.midY === 'number') {
      ctx.save();
      ctx.font = 'bold 11px sans-serif';
      const tw = ctx.measureText(edge.label).width;
      const pw = tw + 14;
      const ph = 20;
      const rx = edge.midX - pw / 2;
      const ry = edge.midY - ph / 2;
      ctx.fillStyle = '#FFFFFF';
      ctx.strokeStyle = edge.color || '#7C3AED';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(rx, ry, pw, ph, 10);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#1F2937';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(edge.label, edge.midX, edge.midY + 0.5);
      ctx.restore();
    }
  }

  // 2. Nodes
  const clipText = (text: string, maxW: number): string => {
    if (!text) return '';
    if (ctx.measureText(text).width <= maxW) return text;
    let lo = 0;
    let hi = text.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    return text.slice(0, Math.max(1, lo)) + '…';
  };

  for (const n of nodes) {
    ctx.save();
    ctx.fillStyle = n.fillColor;
    ctx.strokeStyle = n.borderColor;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(n.x, n.y, n.w, n.h, 11);
    ctx.fill();
    ctx.stroke();

    // Left accent stripe for non-root nodes
    if (!n.isRoot && n.accentColor) {
      ctx.fillStyle = n.accentColor;
      ctx.beginPath();
      ctx.roundRect(n.x, n.y, 4, n.h, [11, 0, 0, 11]);
      ctx.fill();
    }

    const innerX = n.x + 12;
    const innerW = n.w - 24;
    ctx.fillStyle = n.textColor || (n.isRoot ? '#FFFFFF' : '#1F2937');
    ctx.font = n.isRoot ? 'bold 13px sans-serif' : 'bold 11.5px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const titleY = n.subtitle ? n.y + 11 : n.y + Math.max(10, (n.h - 14) / 2);
    ctx.fillText(clipText(n.title, innerW), innerX, titleY);

    if (n.subtitle) {
      ctx.fillStyle = n.isRoot ? 'rgba(255,255,255,0.85)' : '#4B5563';
      ctx.font = '10.5px sans-serif';
      const cleanSub = n.subtitle.replace(/\s+/g, ' ').trim();
      ctx.fillText(clipText(cleanSub, innerW), innerX, titleY + 20);
    }
    ctx.restore();
  }

  ctx.restore();

  const url = canvas.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
