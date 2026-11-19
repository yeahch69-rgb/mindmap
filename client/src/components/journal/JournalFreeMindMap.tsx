import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import {
  Archive,
  CornerDownRight,
  Crosshair,
  ExternalLink,
  GitBranch,
  Link2,
  Lock,
  Move,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  EntryType,
  FreeMapEdge,
  IdeaStatus,
  JournalEntry,
  JournalIdea,
  JournalProject,
  MindMapLayoutData,
  PortSide,
  TurnState,
} from './types';

interface JournalFreeMindMapProps {
  /** Single-project mode when provided; workspace overview mode when null */
  project: JournalProject | null;
  entries?: JournalEntry[];
  ideas?: JournalIdea[];
  allProjects?: JournalProject[];
  currentUserId?: number;
  onFocusProject?: (projectId: number | null) => void;
  onOpenProjectDetail?: (projectId: number) => void;
  onSaveLayout?: (projectId: number, layout: MindMapLayoutData) => Promise<void>;
  onAddIdea?: (payload: {
    projectId: number;
    title: string;
    note: string | null;
    parent_idea_id: number | null;
  }) => Promise<void>;
  onPromoteIdea?: (idea: JournalIdea) => Promise<void>;
  onUpdateIdeaStatus?: (idea: JournalIdea, status: IdeaStatus) => Promise<void>;
  onDeleteIdea?: (idea: JournalIdea) => Promise<void>;
}

interface FreeNodeDef {
  key: string;
  w: number;
  h: number;
  defaultX: number;
  defaultY: number;
  parentKey?: string;
  autoEdgeColor: string;
  kind: 'ROOT' | 'INTENT_PINNED' | 'NEXT_STEP' | 'ENTRY' | 'IDEA' | 'PROJECT_CARD';
  title: string;
  subtitle?: string;
  badge?: string;
  bgClass: string;
  borderClass: string;
  idea?: JournalIdea;
  entry?: JournalEntry;
  projectItem?: JournalProject;
}

const CANVAS_W = 2400;
const CANVAS_H = 1600;
const CENTER_X = CANVAS_W / 2;
const CENTER_Y = CANVAS_H / 2;
const ZOOM_STEPS = [0.6, 0.75, 0.9, 1, 1.15, 1.3];
const PORT_SIDES: PortSide[] = ['top', 'right', 'bottom', 'left'];

function getPortCoords(x: number, y: number, w: number, h: number, side: PortSide): { x: number; y: number } {
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

function getPortOutVector(side: PortSide): { dx: number; dy: number } {
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

function chooseFacingPorts(
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

function buildDirectionalBezier(
  p1: { x: number; y: number },
  side1: PortSide,
  p2: { x: number; y: number },
  side2: PortSide
): { path: string; midX: number; midY: number } {
  const v1 = getPortOutVector(side1);
  const v2 = getPortOutVector(side2);
  const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
  const offset = Math.max(46, Math.min(160, dist * 0.42));
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

function resolveCollisionFreePos(
  desiredX: number,
  desiredY: number,
  w: number,
  h: number,
  occupied: Array<{ x: number; y: number; w: number; h: number }>
): { x: number; y: number } {
  const overlaps = (tx: number, ty: number) =>
    occupied.some(
      (o) =>
        tx < o.x + o.w + 22 &&
        tx + w + 22 > o.x &&
        ty < o.y + o.h + 18 &&
        ty + h + 18 > o.y
    );

  let cx = Math.max(24, Math.min(CANVAS_W - w - 24, Math.round(desiredX)));
  let cy = Math.max(24, Math.min(CANVAS_H - h - 24, Math.round(desiredY)));
  if (!overlaps(cx, cy)) return { x: cx, y: cy };

  for (let ring = 1; ring <= 14; ring++) {
    const r = ring * 68;
    for (let step = 0; step < 12; step++) {
      const ang = (step / 12) * Math.PI * 2;
      const nx = Math.max(24, Math.min(CANVAS_W - w - 24, Math.round(desiredX + Math.cos(ang) * r)));
      const ny = Math.max(24, Math.min(CANVAS_H - h - 24, Math.round(desiredY + Math.sin(ang) * r)));
      if (!overlaps(nx, ny)) return { x: nx, y: ny };
    }
  }
  return { x: cx, y: cy };
}

export const JournalFreeMindMap: React.FC<JournalFreeMindMapProps> = ({
  project,
  entries = [],
  ideas = [],
  allProjects = [],
  currentUserId = 0,
  onFocusProject,
  onOpenProjectDetail,
  onSaveLayout,
  onAddIdea,
  onPromoteIdea,
  onUpdateIdeaStatus,
  onDeleteIdea,
}) => {
  const { L } = useLanguage();

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [zoomIdx, setZoomIdx] = useState(3); // 100%
  const scale = ZOOM_STEPS[zoomIdx] || 1;

  // Workspace overview ("ALL") local persistence key
  const wsStorageKey = `nygc_journal_free_ws_${currentUserId || 'guest'}`;

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [customEdges, setCustomEdges] = useState<FreeMapEdge[]>([]);
  const [parentOverrides, setParentOverrides] = useState<Record<string, string>>({});
  const [connectMode, setConnectMode] = useState(false);
  const [nestMode, setNestMode] = useState(false);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);

  // Composer state for adding root / child ideas directly in Free Mind Map
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerParentId, setComposerParentId] = useState<number | null>(null);
  const [composerTitle, setComposerTitle] = useState('');
  const [composerNote, setComposerNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Dragging node / panning canvas / connecting wire state
  const [draggingNode, setDraggingNode] = useState<{
    key: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);

  const [panning, setPanning] = useState<{
    startClientX: number;
    startClientY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const [connectingWire, setConnectingWire] = useState<{
    fromKey: string;
    fromSide: PortSide;
    pointerX: number;
    pointerY: number;
  } | null>(null);

  // Hydrate layout from project.mindmap_layout or localStorage (ALL mode)
  useEffect(() => {
    setSelectedNodeKey(null);
    setSelectedEdgeId(null);
    setConnectingWire(null);
    if (project) {
      setPositions(project.mindmap_layout?.positions || {});
      setCustomEdges(project.mindmap_layout?.custom_edges || []);
      setParentOverrides(project.mindmap_layout?.parent_overrides || {});
    } else {
      try {
        const raw = localStorage.getItem(wsStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          setPositions(parsed?.positions || {});
          setCustomEdges(Array.isArray(parsed?.custom_edges) ? parsed.custom_edges : []);
          setParentOverrides(parsed?.parent_overrides && typeof parsed.parent_overrides === 'object' ? parsed.parent_overrides : {});
          return;
        }
      } catch {
        // ignore invalid storage
      }
      setPositions({});
      setCustomEdges([]);
      setParentOverrides({});
    }
  }, [project?.id, project?.mindmap_layout, wsStorageKey]);

  const centerViewport = useCallback(
    (behavior: ScrollBehavior = 'auto') => {
      const vp = viewportRef.current;
      if (!vp) return;
      const targetLeft = Math.max(0, CENTER_X * scale - vp.clientWidth / 2);
      const targetTop = Math.max(0, CENTER_Y * scale - vp.clientHeight / 2);
      vp.scrollTo({ left: targetLeft, top: targetTop, behavior });
    },
    [scale]
  );

  // Center canvas when switching project or mounting
  useEffect(() => {
    const timer = setTimeout(() => centerViewport('auto'), 40);
    return () => clearTimeout(timer);
  }, [project?.id]);

  const getTurnLabel = (turn: TurnState) => {
    if (turn === 'MY_TURN') return L('내 턴', '自分ターン', 'My Turn');
    if (turn === 'THEIR_TURN') return L('상대 대기', '相手待ち', 'Waiting');
    if (turn === 'HOLD') return L('보류', '保留', 'Hold');
    return L('완료', '完了', 'Done');
  };

  const getEntryLabel = (type: EntryType, speaker?: string | null) => {
    if (type === 'DIALOGUE_ME') return L('🗣️ 나', '🗣️ 自分', '🗣️ Me');
    if (type === 'DIALOGUE_THEM') return `👤 ${speaker || L('상대방', '相手', 'Partner')}`;
    if (type === 'PROGRESS') return L('✅ 완료', '✅ 完了', '✅ Done');
    return L('🧭 의도·결정', '🧭 意図・決定', '🧭 Intent');
  };

  // Build radial default node definitions (auto-updated whenever project/entries/ideas change!)
  const nodeDefs = useMemo<FreeNodeDef[]>(() => {
    const list: FreeNodeDef[] = [];

    if (!project) {
      // ALL Projects Workspace Overview Radial Map
      list.push({
        key: 'ws-root',
        w: 210,
        h: 72,
        defaultX: CENTER_X - 105,
        defaultY: CENTER_Y - 36,
        autoEdgeColor: '#1B4D3E',
        kind: 'ROOT',
        title: L('전체 프로젝트 저널', '全体プロジェクト日誌', 'All Project Journals'),
        subtitle: L(`총 ${allProjects.length}개 · 자유 배치`, `計 ${allProjects.length}件 · 自由配置`, `${allProjects.length} projects · Free layout`),
        bgClass: 'bg-forest-800 text-white',
        borderClass: 'border-forest-900',
      });

      const count = Math.max(1, allProjects.length);
      allProjects.forEach((p, idx) => {
        const angle = (idx / count) * Math.PI * 2 - Math.PI / 2;
        const radius = count <= 6 ? 270 : 320 + Math.floor(idx / 8) * 140;
        list.push({
          key: `proj-${p.id}`,
          w: 235,
          h: 76,
          defaultX: CENTER_X + Math.cos(angle) * radius - 117,
          defaultY: CENTER_Y + Math.sin(angle) * radius - 38,
          parentKey: 'ws-root',
          autoEdgeColor: p.color || '#1B4D3E',
          kind: 'PROJECT_CARD',
          title: p.title,
          subtitle: p.next_action || p.intent_summary || L('Next Step 미지정', 'Next Step未定', 'No Next Step'),
          badge: `${getTurnLabel(p.turn_state)}${p.is_stale ? ` · D+${p.days_since_update}` : ''}`,
          bgClass: p.is_stale ? 'bg-rose-50/90' : 'bg-white',
          borderClass: p.is_stale ? 'border-rose-300' : 'border-ivory-300',
          projectItem: p,
        });
      });

      return list;
    }

    // Single-Project Center-Out Radial Nodes
    list.push({
      key: 'proj-root',
      w: 224,
      h: 76,
      defaultX: CENTER_X - 112,
      defaultY: CENTER_Y - 38,
      autoEdgeColor: project.color || '#1B4D3E',
      kind: 'ROOT',
      title: project.title,
      subtitle: `${getTurnLabel(project.turn_state)}${project.resolved_partner_name ? ` · ${project.resolved_partner_name}` : ''}`,
      bgClass: 'bg-forest-800 text-white',
      borderClass: 'border-forest-900',
    });

    // 1. Pinned Intent (Top-Left / North)
    if (project.intent_summary) {
      list.push({
        key: 'intent-pinned',
        w: 224,
        h: 72,
        defaultX: CENTER_X - 310,
        defaultY: CENTER_Y - 230,
        parentKey: 'proj-root',
        autoEdgeColor: '#D97706',
        kind: 'INTENT_PINNED',
        title: L('🧭 최초 의도 (Pinned)', '🧭 当初の目的', '🧭 Pinned Intent'),
        subtitle: project.intent_summary,
        bgClass: 'bg-amber-50',
        borderClass: 'border-amber-300',
      });
    }

    // 2. Next Step (Bottom)
    list.push({
      key: 'next-step',
      w: 230,
      h: 70,
      defaultX: CENTER_X - 115,
      defaultY: CENTER_Y + 215,
      parentKey: 'proj-root',
      autoEdgeColor: project.next_action ? '#059669' : '#E11D48',
      kind: 'NEXT_STEP',
      title: `🎯 ${project.next_action || L('Next Step 미지정', 'Next Step未定', 'No Next Step')}`,
      subtitle: project.next_action_date ? `📅 ${project.next_action_date}` : L('다음 할 일', '次の行動', 'Next Action'),
      bgClass: project.next_action ? 'bg-emerald-50' : 'bg-rose-50',
      borderClass: project.next_action ? 'border-emerald-400' : 'border-rose-300',
    });

    // 3. Entries (recent 18 entries radiating in Left / Top-Left / Bottom-Left arc)
    const visibleEntries = entries.slice(-18);
    visibleEntries.forEach((en, idx) => {
      const total = Math.max(1, visibleEntries.length);
      // Fan from Top-North-West (215 deg) down through Left (180 deg) to Bottom-Left (125 deg)
      // Wait: more entries spiral slightly further out
      const arcSpan = Math.PI * 0.95; // ~170 degrees on the left side
      const t = total === 1 ? 0.5 : idx / (total - 1);
      const angle = Math.PI * 0.62 + t * arcSpan; // Left/Top-Left/Bottom-Left sector
      const ring = Math.floor(idx / 6);
      const radius = 290 + ring * 185;
      const edgeColor =
        en.entry_type === 'DIALOGUE_ME'
          ? '#1B4D3E'
          : en.entry_type === 'DIALOGUE_THEM'
          ? '#0284C7'
          : en.entry_type === 'PROGRESS'
          ? '#059669'
          : '#D97706';
      const bgClass =
        en.entry_type === 'DIALOGUE_ME'
          ? 'bg-emerald-50/50'
          : en.entry_type === 'DIALOGUE_THEM'
          ? 'bg-sky-50/70'
          : en.entry_type === 'PROGRESS'
          ? 'bg-emerald-50/80'
          : 'bg-amber-50/70';
      const borderClass =
        en.entry_type === 'DIALOGUE_ME'
          ? 'border-forest-300'
          : en.entry_type === 'DIALOGUE_THEM'
          ? 'border-sky-300'
          : en.entry_type === 'PROGRESS'
          ? 'border-emerald-300'
          : 'border-amber-300';

      list.push({
        key: `entry-${en.id}`,
        w: 215,
        h: 66,
        defaultX: CENTER_X + Math.cos(angle) * radius - 107,
        defaultY: CENTER_Y + Math.sin(angle) * radius - 33,
        parentKey: 'proj-root',
        autoEdgeColor: edgeColor,
        kind: 'ENTRY',
        title: `${en.entry_date ? `${en.entry_date.slice(5)} · ` : ''}${getEntryLabel(en.entry_type, en.speaker_name)}`,
        subtitle: en.content,
        bgClass,
        borderClass,
        entry: en,
      });
    });

    // 4. Ideas (radiating on the Right / Top-Right / Bottom-Right & sub-ideas fanning outward!)
    const ideaMap = new Map<number, JournalIdea>();
    ideas.forEach((i) => ideaMap.set(i.id, i));
    const rootIdeas = ideas.filter((i) => !i.parent_idea_id || !ideaMap.has(i.parent_idea_id) || i.parent_idea_id === i.id);
    const childIdeas = ideas.filter((i) => i.parent_idea_id && ideaMap.has(i.parent_idea_id) && i.parent_idea_id !== i.id);

    const ideaDefaultPos = new Map<number, { x: number; y: number }>();

    rootIdeas.forEach((idea, idx) => {
      const total = Math.max(1, rootIdeas.length);
      const t = total === 1 ? 0.5 : idx / (total - 1);
      const angle = -Math.PI * 0.42 + t * (Math.PI * 0.84); // Right sector (-75 deg to +75 deg)
      const ring = Math.floor(idx / 6);
      const radius = 290 + ring * 200;
      const dx = CENTER_X + Math.cos(angle) * radius - 105;
      const dy = CENTER_Y + Math.sin(angle) * radius - 34;
      ideaDefaultPos.set(idea.id, { x: dx, y: dy });

      list.push({
        key: `idea-${idea.id}`,
        w: 215,
        h: 68,
        defaultX: dx,
        defaultY: dy,
        parentKey: 'proj-root',
        autoEdgeColor: idea.status === 'PROMOTED' ? '#059669' : '#D97706',
        kind: 'IDEA',
        title: idea.title,
        subtitle: idea.note || undefined,
        badge:
          idea.status === 'PROMOTED'
            ? L('✨ 승격', '✨ 昇格', '✨ Promoted')
            : idea.status === 'ARCHIVED'
            ? L('보관', '保管', 'Archived')
            : undefined,
        bgClass:
          idea.status === 'PROMOTED'
            ? 'bg-emerald-50'
            : idea.status === 'ARCHIVED'
            ? 'bg-stone-100 opacity-80'
            : 'bg-amber-50/80',
        borderClass:
          idea.status === 'PROMOTED'
            ? 'border-emerald-400'
            : idea.status === 'ARCHIVED'
            ? 'border-stone-300'
            : 'border-amber-300',
        idea,
      });
    });

    // Place nested child ideas radially further from parent
    const siblingCounters = new Map<number, number>();
    const placedIds = new Set<number>(rootIdeas.map((r) => r.id));
    let remaining = [...childIdeas];
    let pass = 0;
    while (remaining.length > 0 && pass < 8) {
      const nextRemaining: JournalIdea[] = [];
      for (const idea of remaining) {
        const pid = idea.parent_idea_id!;
        if (!placedIds.has(pid)) {
          nextRemaining.push(idea);
          continue;
        }
        const parentPos = ideaDefaultPos.get(pid) || { x: CENTER_X + 200, y: CENTER_Y };
        const sibIdx = siblingCounters.get(pid) || 0;
        siblingCounters.set(pid, sibIdx + 1);
        const baseAngle = Math.atan2(parentPos.y - CENTER_Y, parentPos.x - CENTER_X);
        const fanAngle = baseAngle + (sibIdx - 0.5) * 0.42;
        const dx = parentPos.x + Math.cos(fanAngle) * 260;
        const dy = parentPos.y + Math.sin(fanAngle) * 145;
        ideaDefaultPos.set(idea.id, { x: dx, y: dy });
        placedIds.add(idea.id);

        list.push({
          key: `idea-${idea.id}`,
          w: 215,
          h: 68,
          defaultX: dx,
          defaultY: dy,
          parentKey: `idea-${pid}`,
          autoEdgeColor: idea.status === 'PROMOTED' ? '#059669' : '#D97706',
          kind: 'IDEA',
          title: idea.title,
          subtitle: idea.note || undefined,
          badge:
            idea.status === 'PROMOTED'
              ? L('✨ 승격', '✨ 昇格', '✨ Promoted')
              : idea.status === 'ARCHIVED'
              ? L('보관', '保管', 'Archived')
              : undefined,
          bgClass:
            idea.status === 'PROMOTED'
              ? 'bg-emerald-50'
              : idea.status === 'ARCHIVED'
              ? 'bg-stone-100 opacity-80'
              : 'bg-amber-50/80',
          borderClass:
            idea.status === 'PROMOTED'
              ? 'border-emerald-400'
              : idea.status === 'ARCHIVED'
              ? 'border-stone-300'
              : 'border-amber-300',
          idea,
        });
      }
      if (nextRemaining.length === remaining.length) break;
      remaining = nextRemaining;
      pass += 1;
    }

    return list;
  }, [project, entries, ideas, allProjects, L]);

  // Compute resolved screen coordinates + effective parentKey for every node
  const resolvedNodes = useMemo(() => {
    const defMap = new Map<string, FreeNodeDef>();
    for (const d of nodeDefs) defMap.set(d.key, d);

    const wouldCycle = (nodeKey: string, candidateParent: string, currentParents: Map<string, string | undefined>) => {
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
    };

    const effectiveParentMap = new Map<string, string | undefined>();
    for (const d of nodeDefs) {
      effectiveParentMap.set(d.key, d.parentKey);
    }
    for (const d of nodeDefs) {
      if (d.kind === 'ROOT') continue;
      const ov = parentOverrides[d.key];
      if (ov && defMap.has(ov) && !wouldCycle(d.key, ov, effectiveParentMap)) {
        effectiveParentMap.set(d.key, ov);
      }
    }

    const occupied: Array<{ x: number; y: number; w: number; h: number }> = [];
    // Reserve saved positions first so newly added nodes never collide with user-placed nodes
    for (const def of nodeDefs) {
      const saved = positions[def.key];
      if (saved) {
        occupied.push({ x: saved.x, y: saved.y, w: def.w, h: def.h });
      }
    }

    const resultMap = new Map<string, FreeNodeDef & { x: number; y: number }>();
    const ordered: Array<FreeNodeDef & { x: number; y: number }> = [];

    for (const def of nodeDefs) {
      const resolvedParentKey = effectiveParentMap.get(def.key);
      const saved = positions[def.key];
      if (saved) {
        const node = { ...def, parentKey: resolvedParentKey, x: saved.x, y: saved.y };
        resultMap.set(def.key, node);
        ordered.push(node);
      } else {
        let desiredX = def.defaultX;
        let desiredY = def.defaultY;
        const pSaved = resolvedParentKey
          ? positions[resolvedParentKey] || resultMap.get(resolvedParentKey)
          : undefined;
        if (resolvedParentKey && pSaved) {
          const pDef = defMap.get(resolvedParentKey);
          if (pDef) {
            if (def.kind === 'IDEA' && def.idea?.parent_idea_id) {
              desiredX = pSaved.x + (def.defaultX - pDef.defaultX);
              desiredY = pSaved.y + (def.defaultY - pDef.defaultY);
            } else if (parentOverrides[def.key]) {
              const ang = Math.atan2(pSaved.y - CENTER_Y, pSaved.x - CENTER_X);
              desiredX = pSaved.x + Math.cos(ang) * 250;
              desiredY = pSaved.y + Math.sin(ang) * 140;
            }
          }
        }
        const pos = resolveCollisionFreePos(desiredX, desiredY, def.w, def.h, occupied);
        occupied.push({ x: pos.x, y: pos.y, w: def.w, h: def.h });
        const node = { ...def, parentKey: resolvedParentKey, x: pos.x, y: pos.y };
        resultMap.set(def.key, node);
        ordered.push(node);
      }
    }

    return { ordered, map: resultMap, effectiveParentMap };
  }, [nodeDefs, positions, parentOverrides]);

  const persistLayout = useCallback(
    (
      nextPos: Record<string, { x: number; y: number }>,
      nextEdges: FreeMapEdge[],
      nextParents: Record<string, string>
    ) => {
      if (project && onSaveLayout) {
        void onSaveLayout(project.id, {
          positions: nextPos,
          custom_edges: nextEdges,
          parent_overrides: nextParents,
        });
      } else if (!project) {
        try {
          localStorage.setItem(
            wsStorageKey,
            JSON.stringify({
              positions: nextPos,
              custom_edges: nextEdges,
              parent_overrides: nextParents,
            })
          );
        } catch {
          // ignore storage quota errors
        }
      }
    },
    [project, onSaveLayout, wsStorageKey]
  );

  // Cycle check helper for nesting drop
  const isDescendantOrSelf = useCallback(
    (potentialParentKey: string, draggedKey: string): boolean => {
      if (potentialParentKey === draggedKey) return true;
      let curr: string | undefined = potentialParentKey;
      const visited = new Set<string>();
      while (curr) {
        if (curr === draggedKey) return true;
        if (visited.has(curr)) return true;
        visited.add(curr);
        curr = resolvedNodes.effectiveParentMap.get(curr);
      }
      return false;
    },
    [resolvedNodes.effectiveParentMap]
  );

  // Hovered overlap target while dragging in Node Nesting Mode
  const hoveredNestTargetKey = useMemo(() => {
    if (!nestMode || !draggingNode || !draggingNode.moved) return null;
    const draggedNode = resolvedNodes.map.get(draggingNode.key);
    if (!draggedNode || draggedNode.kind === 'ROOT') return null;

    let bestKey: string | null = null;
    let bestOverlapArea = 0;

    for (const candidate of resolvedNodes.ordered) {
      if (candidate.key === draggedNode.key) continue;
      if (isDescendantOrSelf(candidate.key, draggedNode.key)) continue;

      const xOverlap = Math.max(
        0,
        Math.min(draggedNode.x + draggedNode.w, candidate.x + candidate.w) -
          Math.max(draggedNode.x, candidate.x)
      );
      const yOverlap = Math.max(
        0,
        Math.min(draggedNode.y + draggedNode.h, candidate.y + candidate.h) -
          Math.max(draggedNode.y, candidate.y)
      );
      const area = xOverlap * yOverlap;
      if (area > 400 && area > bestOverlapArea) {
        bestOverlapArea = area;
        bestKey = candidate.key;
      }
    }

    return bestKey;
  }, [nestMode, draggingNode, resolvedNodes.map, resolvedNodes.ordered, isDescendantOrSelf]);

  // Determine hovered target port / node while dragging a connection wire
  const hoveredConnectTarget = useMemo(() => {
    if (!connectingWire) return null;
    const { fromKey, pointerX, pointerY } = connectingWire;

    let best: { key: string; side: PortSide; dist: number } | null = null;
    for (const n of resolvedNodes.ordered) {
      if (n.key === fromKey) continue;
      // 1. Direct port proximity check (24px radius)
      for (const side of PORT_SIDES) {
        const pt = getPortCoords(n.x, n.y, n.w, n.h, side);
        const dist = Math.hypot(pointerX - pt.x, pointerY - pt.y);
        if (dist <= 26 && (!best || dist < best.dist)) {
          best = { key: n.key, side, dist };
        }
      }
      // 2. Inside node bounding box -> snap to closest port of that node
      if (
        pointerX >= n.x &&
        pointerX <= n.x + n.w &&
        pointerY >= n.y &&
        pointerY <= n.y + n.h
      ) {
        let closestSide: PortSide = 'left';
        let closestDist = Infinity;
        for (const side of PORT_SIDES) {
          const pt = getPortCoords(n.x, n.y, n.w, n.h, side);
          const d = Math.hypot(pointerX - pt.x, pointerY - pt.y);
          if (d < closestDist) {
            closestDist = d;
            closestSide = side;
          }
        }
        return { key: n.key, side: closestSide };
      }
    }

    return best ? { key: best.key, side: best.side } : null;
  }, [connectingWire, resolvedNodes.ordered]);

  const positionsRef = useRef(positions);
  positionsRef.current = positions;
  const customEdgesRef = useRef(customEdges);
  customEdgesRef.current = customEdges;
  const parentOverridesRef = useRef(parentOverrides);
  parentOverridesRef.current = parentOverrides;
  const resolvedNodesRef = useRef(resolvedNodes);
  resolvedNodesRef.current = resolvedNodes;
  const hoveredTargetRef = useRef(hoveredConnectTarget);
  hoveredTargetRef.current = hoveredConnectTarget;
  const hoveredNestTargetRef = useRef(hoveredNestTargetKey);
  hoveredNestTargetRef.current = hoveredNestTargetKey;

  // Global window pointer listeners for smooth dragging / panning / connecting
  useEffect(() => {
    if (!draggingNode && !panning && !connectingWire) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (draggingNode) {
        const dx = (e.clientX - draggingNode.startClientX) / scale;
        const dy = (e.clientY - draggingNode.startClientY) / scale;
        const moved = draggingNode.moved || Math.hypot(e.clientX - draggingNode.startClientX, e.clientY - draggingNode.startClientY) > 4;
        if (moved !== draggingNode.moved) {
          setDraggingNode((prev) => (prev ? { ...prev, moved: true } : null));
        }
        const def = resolvedNodesRef.current.map.get(draggingNode.key);
        const w = def?.w || 215;
        const h = def?.h || 68;
        const nx = Math.max(12, Math.min(CANVAS_W - w - 12, Math.round(draggingNode.origX + dx)));
        const ny = Math.max(12, Math.min(CANVAS_H - h - 12, Math.round(draggingNode.origY + dy)));
        setPositions((prev) => ({ ...prev, [draggingNode.key]: { x: nx, y: ny } }));
      } else if (panning && viewportRef.current) {
        const dx = e.clientX - panning.startClientX;
        const dy = e.clientY - panning.startClientY;
        viewportRef.current.scrollLeft = panning.scrollLeft - dx;
        viewportRef.current.scrollTop = panning.scrollTop - dy;
      } else if (connectingWire && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const px = (e.clientX - rect.left) / scale;
        const py = (e.clientY - rect.top) / scale;
        setConnectingWire((prev) => (prev ? { ...prev, pointerX: px, pointerY: py } : null));
      }
    };

    const handlePointerUp = () => {
      if (draggingNode) {
        if (draggingNode.moved) {
          const nestTargetKey = hoveredNestTargetRef.current;
          if (nestMode && nestTargetKey) {
            const targetNode = resolvedNodesRef.current.map.get(nestTargetKey);
            const draggedNode = resolvedNodesRef.current.map.get(draggingNode.key);
            const nextParents = {
              ...parentOverridesRef.current,
              [draggingNode.key]: nestTargetKey,
            };
            let nextPositions = { ...positionsRef.current };
            if (targetNode && draggedNode) {
              const occupied = resolvedNodesRef.current.ordered
                .filter((n) => n.key !== draggingNode.key)
                .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
              const dirAngle = Math.atan2(
                targetNode.y + targetNode.h / 2 - CENTER_Y,
                targetNode.x + targetNode.w / 2 - CENTER_X
              );
              const desiredX = targetNode.x + Math.cos(dirAngle) * 255;
              const desiredY = targetNode.y + Math.sin(dirAngle) * 125;
              const placed = resolveCollisionFreePos(
                desiredX,
                desiredY,
                draggedNode.w,
                draggedNode.h,
                occupied
              );
              nextPositions = { ...nextPositions, [draggingNode.key]: placed };
              setPositions(nextPositions);
            }
            setParentOverrides(nextParents);
            persistLayout(nextPositions, customEdgesRef.current, nextParents);
          } else {
            persistLayout(positionsRef.current, customEdgesRef.current, parentOverridesRef.current);
          }
        } else {
          setSelectedNodeKey((prev) => (prev === draggingNode.key ? null : draggingNode.key));
          setSelectedEdgeId(null);
        }
        setDraggingNode(null);
      }

      if (panning) {
        setPanning(null);
      }

      if (connectingWire) {
        const target = hoveredTargetRef.current;
        if (target && target.key !== connectingWire.fromKey) {
          const exists = customEdgesRef.current.some(
            (ed) =>
              (ed.fromKey === connectingWire.fromKey &&
                ed.fromSide === connectingWire.fromSide &&
                ed.toKey === target.key &&
                ed.toSide === target.side) ||
              (ed.toKey === connectingWire.fromKey &&
                ed.toSide === connectingWire.fromSide &&
                ed.fromKey === target.key &&
                ed.fromSide === target.side)
          );
          if (!exists) {
            const newEdge: FreeMapEdge = {
              id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              fromKey: connectingWire.fromKey,
              fromSide: connectingWire.fromSide,
              toKey: target.key,
              toSide: target.side,
              color: '#7C3AED',
            };
            const nextEdges = [...customEdgesRef.current, newEdge];
            setCustomEdges(nextEdges);
            persistLayout(positionsRef.current, nextEdges, parentOverridesRef.current);
          }
        }
        setConnectingWire(null);
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [draggingNode, panning, connectingWire, nestMode, scale, persistLayout]);

  const handleResetRadialPositions = () => {
    setPositions({});
    persistLayout({}, customEdges, parentOverrides);
    setTimeout(() => centerViewport('smooth'), 40);
  };

  const handleDetachNodeToRoot = (nodeKey: string) => {
    const nextParents = { ...parentOverrides };
    delete nextParents[nodeKey];
    setParentOverrides(nextParents);
    persistLayout(positions, customEdges, nextParents);
  };

  const handleDeleteCustomEdge = (edgeId: string) => {
    const nextEdges = customEdges.filter((e) => e.id !== edgeId);
    setCustomEdges(nextEdges);
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    persistLayout(positions, nextEdges, parentOverrides);
  };

  const handleSubmitIdea = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!project || !onAddIdea || !composerTitle.trim()) return;
    try {
      setIsSubmitting(true);
      await onAddIdea({
        projectId: project.id,
        title: composerTitle.trim(),
        note: composerNote.trim() || null,
        parent_idea_id: composerParentId,
      });
      setComposerTitle('');
      setComposerNote('');
      setComposerOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const selectedNode = selectedNodeKey ? resolvedNodes.map.get(selectedNodeKey) || null : null;
  const selectedIdea = selectedNode?.idea || null;

  // Cross-links defined via related_idea_ids (shown as subtle purple dashed wires unless already covered by a custom_edge)
  const relatedIdeaWires = useMemo(() => {
    const list: Array<{ fromKey: string; toKey: string }> = [];
    const seen = new Set<string>();
    const customPairSet = new Set<string>();
    for (const ce of customEdges) {
      const pair = [ce.fromKey, ce.toKey].sort().join('::');
      customPairSet.add(pair);
    }
    for (const idea of ideas) {
      const k1 = `idea-${idea.id}`;
      if (!resolvedNodes.map.has(k1)) continue;
      for (const tid of idea.related_idea_ids || []) {
        const k2 = `idea-${tid}`;
        if (tid === idea.id || !resolvedNodes.map.has(k2)) continue;
        const pair = [k1, k2].sort().join('::');
        if (seen.has(pair) || customPairSet.has(pair)) continue;
        seen.add(pair);
        list.push({ fromKey: k1, toKey: k2 });
      }
    }
    return list;
  }, [ideas, customEdges, resolvedNodes.map]);

  return (
    <div className="bg-white rounded-xl border border-ivory-300 shadow-2xs overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 py-2.5 bg-ivory-50 border-b border-ivory-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-900">
            <Move className="w-4 h-4 text-forest-700" />
            <span>
              {project
                ? L(`자유 마인드맵 · ${project.title}`, `フリーマインドマップ · ${project.title}`, `Free Mind Map · ${project.title}`)
                : L('전체 자유 마인드맵', '全体フリーマインドマップ', 'Workspace Free Mind Map')}
            </span>
          </div>

          <span className="hidden xl:inline-flex items-center gap-1.5 text-[11px] font-bold text-charcoal-500 pl-2 border-l border-ivory-300">
            {L(
              '노드 드래그: 자유 이동 · 연결/종속은 우측 버튼으로 켜기',
              'ノードドラッグ: 自由配置 · 接続/従属は右ボタンで切替',
              'Drag nodes to move · Toggle Connect / Nest on the right'
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {project && onAddIdea && (
            <button
              type="button"
              onClick={() => {
                setComposerParentId(null);
                setComposerTitle('');
                setComposerNote('');
                setComposerOpen(true);
              }}
              className="px-2.5 py-1 rounded-lg bg-forest-800 text-white text-xs font-bold hover:bg-forest-900 inline-flex items-center gap-1"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{L('새 아이디어', '新規アイデア', 'New Idea')}</span>
            </button>
          )}

          {project && onOpenProjectDetail && (
            <button
              type="button"
              onClick={() => onOpenProjectDetail(project.id)}
              className="px-2.5 py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-800 text-xs font-bold hover:bg-ivory-100 inline-flex items-center gap-1"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>{L('상세 열기', '詳細を開く', 'Open Project')}</span>
            </button>
          )}

          <button
            type="button"
            onClick={() => centerViewport('smooth')}
            className="px-2 py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 text-xs font-bold hover:bg-ivory-100 inline-flex items-center gap-1"
            title={L('중앙으로 이동', '中央へ移動', 'Center view')}
          >
            <Crosshair className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{L('중앙', '中央', 'Center')}</span>
          </button>

          <button
            type="button"
            onClick={handleResetRadialPositions}
            className="px-2 py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 text-xs font-bold hover:bg-ivory-100 inline-flex items-center gap-1"
            title={L('방사형 기본 위치로 재정렬 (연결선은 유지)', '放射状に自動整列 (接続線は維持)', 'Reset radial positions (keeps links)')}
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{L('재정렬', '再整列', 'Auto-Arrange')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setConnectMode((prev) => {
                const next = !prev;
                if (next) setNestMode(false);
                return next;
              });
            }}
            className={`px-2.5 py-1 rounded-lg border text-xs font-bold inline-flex items-center gap-1 transition ${
              connectMode
                ? 'bg-violet-700 text-white border-violet-800 shadow-2xs'
                : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-100'
            }`}
            title={L('노드 상하좌우 연결점(●) 표시 및 드래그 연결', 'ノード上下左右の接続点(●)を表示', 'Show 4-way connection dots')}
          >
            <Link2 className="w-3.5 h-3.5" />
            <span>{L('노드 연결', 'ノード接続', 'Connect')}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setNestMode((prev) => {
                const next = !prev;
                if (next) setConnectMode(false);
                return next;
              });
            }}
            className={`px-2.5 py-1 rounded-lg border text-xs font-bold inline-flex items-center gap-1 transition ${
              nestMode
                ? 'bg-emerald-700 text-white border-emerald-800 shadow-2xs'
                : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-100'
            }`}
            title={L('노드를 다른 노드 위에 겹쳐 놓아 하위 노드로 종속', 'ノードを他ノードに重ねて従属させる', 'Drag & drop one node onto another to nest')}
          >
            <CornerDownRight className="w-3.5 h-3.5" />
            <span>{L('노드 종속', 'ノード従属', 'Nest')}</span>
          </button>

          <div className="flex items-center gap-1 bg-white border border-ivory-300 rounded-lg p-0.5">
            <button
              type="button"
              onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}
              disabled={zoomIdx === 0}
              className="p-1 rounded hover:bg-ivory-100 disabled:opacity-40"
              title={L('축소', '縮小', 'Zoom out')}
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-mono font-bold px-1 text-charcoal-700">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomIdx((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
              disabled={zoomIdx === ZOOM_STEPS.length - 1}
              className="p-1 rounded hover:bg-ivory-100 disabled:opacity-40"
              title={L('확대', '拡大', 'Zoom in')}
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Mode Hint Banner (Connect Mode OR Nest Mode) */}
      {(connectMode || nestMode) && (
        <div
          className={`px-3 py-2 border-b flex items-center justify-between gap-2 text-xs ${
            connectMode
              ? 'bg-violet-50 border-violet-200 text-violet-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2 font-bold">
            {connectMode ? <Link2 className="w-4 h-4 shrink-0" /> : <CornerDownRight className="w-4 h-4 shrink-0" />}
            <span>
              {connectMode
                ? L(
                    '노드 연결 활성화됨: 각 노드의 상하좌우 ● 점을 드래그해 다른 노드에 연결하세요.',
                    'ノード接続ON: 各ノードの上下左右 ● をドラッグして他のノードへ接続してください。',
                    'Connect mode active: Drag any ● dot to another node to create a wire.'
                  )
                : L(
                    '노드 종속 활성화됨: 노드를 다른 노드 위에 겹쳐 놓으면 해당 노드의 하위로 종속됩니다 (예: 프로젝트 → 나 → 상대).',
                    'ノード従属ON: ノードを別のノードの上に重ねると、その下位ノードとして従属します。',
                    'Nest mode active: Drag & drop any node overlapping another node to attach it as a child.'
                  )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setConnectMode(false);
              setNestMode(false);
            }}
            className={`px-2.5 py-1 rounded-lg text-white font-bold shrink-0 ${
              connectMode ? 'bg-violet-700 hover:bg-violet-800' : 'bg-emerald-700 hover:bg-emerald-800'
            }`}
          >
            {L('종료', '終了', 'Done')}
          </button>
        </div>
      )}

      {/* Inline Add Idea Bar */}
      {composerOpen && project && onAddIdea && (
        <form
          onSubmit={handleSubmitIdea}
          className="p-3 bg-amber-50/70 border-b border-amber-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs"
        >
          <div className="px-2 py-1 rounded bg-amber-100 border border-amber-300 text-amber-900 font-bold whitespace-nowrap shrink-0">
            {composerParentId
              ? `${L('하위 가지 →', '子ノード →', 'Child of:')} ${
                  ideas.find((i) => i.id === composerParentId)?.title || ''
                }`
              : L('새 아이디어 노드', '新規アイデア', 'New Idea Node')}
          </div>
          <input
            type="text"
            autoFocus
            value={composerTitle}
            onChange={(e) => setComposerTitle(e.target.value)}
            placeholder={L('뻗어나갈 아이디어 제목...', 'アイデア名...', 'Idea title...')}
            className="flex-1 p-1.5 bg-white border border-ivory-300 rounded-lg font-bold text-charcoal-900"
          />
          <input
            type="text"
            value={composerNote}
            onChange={(e) => setComposerNote(e.target.value)}
            placeholder={L('짧은 메모 (선택)', 'メモ (任意)', 'Note (optional)')}
            className="flex-1 p-1.5 bg-white border border-ivory-300 rounded-lg text-charcoal-800"
          />
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="submit"
              disabled={isSubmitting || !composerTitle.trim()}
              className="px-3 py-1.5 rounded-lg bg-forest-800 text-white font-bold disabled:opacity-50 hover:bg-forest-900"
            >
              {L('추가', '追加', 'Add')}
            </button>
            <button
              type="button"
              onClick={() => setComposerOpen(false)}
              className="p-1.5 rounded-lg bg-white border border-ivory-300 text-charcoal-600 hover:bg-ivory-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </form>
      )}

      {/* Interactive Dotted Grid Free Canvas */}
      <div
        ref={viewportRef}
        onPointerDown={(e) => {
          if (e.target === viewportRef.current || e.target === canvasRef.current) {
            setSelectedNodeKey(null);
            setSelectedEdgeId(null);
            setPanning({
              startClientX: e.clientX,
              startClientY: e.clientY,
              scrollLeft: viewportRef.current?.scrollLeft || 0,
              scrollTop: viewportRef.current?.scrollTop || 0,
            });
          }
        }}
        style={{
          backgroundImage: 'radial-gradient(circle, rgba(27,77,62,0.14) 1px, transparent 1px)',
          backgroundSize: `${Math.max(16, Math.round(24 * scale))}px ${Math.max(16, Math.round(24 * scale))}px`,
        }}
        className={`relative overflow-auto h-[580px] sm:h-[640px] bg-ivory-50/40 select-none ${
          panning ? 'cursor-grabbing' : 'cursor-grab'
        }`}
      >
        <div
          style={{
            width: CANVAS_W * scale,
            height: CANVAS_H * scale,
          }}
          className="relative"
        >
          <div
            ref={canvasRef}
            onPointerDown={(e) => {
              if (e.target === canvasRef.current) {
                setSelectedNodeKey(null);
                setSelectedEdgeId(null);
                setPanning({
                  startClientX: e.clientX,
                  startClientY: e.clientY,
                  scrollLeft: viewportRef.current?.scrollLeft || 0,
                  scrollTop: viewportRef.current?.scrollTop || 0,
                });
              }
            }}
            style={{
              width: CANVAS_W,
              height: CANVAS_H,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
            className="relative"
          >
            {/* SVG Edges Layer */}
            <svg width={CANVAS_W} height={CANVAS_H} className="absolute inset-0 pointer-events-none">
              {/* 1. Auto Structural Radial Links (Root -> Node / Parent Idea -> Child Idea) */}
              {resolvedNodes.ordered.map((node) => {
                if (!node.parentKey) return null;
                const parent = resolvedNodes.map.get(node.parentKey);
                if (!parent) return null;
                const { fromSide, toSide } = chooseFacingPorts(parent, node);
                const p1 = getPortCoords(parent.x, parent.y, parent.w, parent.h, fromSide);
                const p2 = getPortCoords(node.x, node.y, node.w, node.h, toSide);
                const { path } = buildDirectionalBezier(p1, fromSide, p2, toSide);
                return (
                  <path
                    key={`auto-${node.key}`}
                    d={path}
                    fill="none"
                    stroke={node.autoEdgeColor}
                    strokeWidth={1.8}
                    strokeOpacity={0.38}
                  />
                );
              })}

              {/* 2. Promoted Idea -> Next Step */}
              {project &&
                ideas
                  .filter((i) => i.status === 'PROMOTED')
                  .map((idea) => {
                    const from = resolvedNodes.map.get(`idea-${idea.id}`);
                    const to = resolvedNodes.map.get('next-step');
                    if (!from || !to) return null;
                    const { fromSide, toSide } = chooseFacingPorts(from, to);
                    const p1 = getPortCoords(from.x, from.y, from.w, from.h, fromSide);
                    const p2 = getPortCoords(to.x, to.y, to.w, to.h, toSide);
                    const { path } = buildDirectionalBezier(p1, fromSide, p2, toSide);
                    return (
                      <path
                        key={`free-promo-${idea.id}`}
                        d={path}
                        fill="none"
                        stroke="#059669"
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        strokeOpacity={0.85}
                      />
                    );
                  })}

              {/* 3. Synced related_idea_ids links */}
              {relatedIdeaWires.map((w, idx) => {
                const from = resolvedNodes.map.get(w.fromKey);
                const to = resolvedNodes.map.get(w.toKey);
                if (!from || !to) return null;
                const { fromSide, toSide } = chooseFacingPorts(from, to);
                const p1 = getPortCoords(from.x, from.y, from.w, from.h, fromSide);
                const p2 = getPortCoords(to.x, to.y, to.w, to.h, toSide);
                const { path } = buildDirectionalBezier(p1, fromSide, p2, toSide);
                return (
                  <path
                    key={`relwire-${idx}`}
                    d={path}
                    fill="none"
                    stroke="#8B5CF6"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    strokeOpacity={0.75}
                  />
                );
              })}

              {/* 4. Custom User-Dragged Port-to-Port Edges */}
              {customEdges.map((edge) => {
                const from = resolvedNodes.map.get(edge.fromKey);
                const to = resolvedNodes.map.get(edge.toKey);
                if (!from || !to) return null;
                const p1 = getPortCoords(from.x, from.y, from.w, from.h, edge.fromSide);
                const p2 = getPortCoords(to.x, to.y, to.w, to.h, edge.toSide);
                const { path, midX, midY } = buildDirectionalBezier(p1, edge.fromSide, p2, edge.toSide);
                const isEdgeSelected = selectedEdgeId === edge.id;
                return (
                  <g key={edge.id} className="pointer-events-auto cursor-pointer">
                    <path
                      d={path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth={14}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
                      }}
                    />
                    <path
                      d={path}
                      fill="none"
                      stroke={isEdgeSelected ? '#E11D48' : edge.color || '#7C3AED'}
                      strokeWidth={isEdgeSelected ? 3.2 : 2.4}
                      strokeOpacity={0.9}
                    />
                    {/* Midpoint clickable handle to inspect or delete custom link */}
                    <circle
                      cx={midX}
                      cy={midY}
                      r={isEdgeSelected ? 10 : 7}
                      fill={isEdgeSelected ? '#E11D48' : '#FFFFFF'}
                      stroke={isEdgeSelected ? '#9F1239' : '#7C3AED'}
                      strokeWidth={1.8}
                      onClick={(ev) => {
                        ev.stopPropagation();
                        if (isEdgeSelected) {
                          handleDeleteCustomEdge(edge.id);
                        } else {
                          setSelectedEdgeId(edge.id);
                        }
                      }}
                    />
                    {isEdgeSelected && (
                      <text
                        x={midX}
                        y={midY + 3.5}
                        textAnchor="middle"
                        fontSize={10}
                        fontWeight="bold"
                        fill="#FFFFFF"
                        onClick={(ev) => {
                          ev.stopPropagation();
                          handleDeleteCustomEdge(edge.id);
                        }}
                      >
                        ×
                      </text>
                    )}
                  </g>
                );
              })}

              {/* 5. Live Temporary Wire While Dragging from a Port Dot */}
              {connectingWire &&
                (() => {
                  const from = resolvedNodes.map.get(connectingWire.fromKey);
                  if (!from) return null;
                  const p1 = getPortCoords(from.x, from.y, from.w, from.h, connectingWire.fromSide);
                  let p2 = { x: connectingWire.pointerX, y: connectingWire.pointerY };
                  let endSide: PortSide =
                    connectingWire.fromSide === 'right'
                      ? 'left'
                      : connectingWire.fromSide === 'left'
                      ? 'right'
                      : connectingWire.fromSide === 'bottom'
                      ? 'top'
                      : 'bottom';
                  if (hoveredConnectTarget) {
                    const targetNode = resolvedNodes.map.get(hoveredConnectTarget.key);
                    if (targetNode) {
                      p2 = getPortCoords(
                        targetNode.x,
                        targetNode.y,
                        targetNode.w,
                        targetNode.h,
                        hoveredConnectTarget.side
                      );
                      endSide = hoveredConnectTarget.side;
                    }
                  }
                  const { path } = buildDirectionalBezier(p1, connectingWire.fromSide, p2, endSide);
                  return (
                    <path
                      d={path}
                      fill="none"
                      stroke="#7C3AED"
                      strokeWidth={2.8}
                      strokeDasharray="6 4"
                    />
                  );
                })()}
            </svg>

            {/* Draggable Nodes + Conditional 4-Way Connection Port Dots */}
            {resolvedNodes.ordered.map((node) => {
              const isSelected = selectedNodeKey === node.key;
              const isDraggingThis = draggingNode?.key === node.key;
              const isWireSource = connectingWire?.fromKey === node.key;
              const isWireTargetNode = hoveredConnectTarget?.key === node.key;
              const isNestTargetNode = hoveredNestTargetKey === node.key;

              return (
                <div
                  key={node.key}
                  style={{
                    left: node.x,
                    top: node.y,
                    width: node.w,
                    height: node.h,
                  }}
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    setDraggingNode({
                      key: node.key,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: node.x,
                      origY: node.y,
                      moved: false,
                    });
                  }}
                  className={`group absolute rounded-xl border px-3 py-1.5 shadow-sm flex flex-col justify-center cursor-move transition-shadow ${
                    node.bgClass
                  } ${node.borderClass} ${
                    isSelected ? 'ring-2 ring-gold-500 shadow-md z-30' : 'hover:shadow-md z-20'
                  } ${isDraggingThis ? 'shadow-lg z-40 opacity-90' : ''} ${
                    isWireTargetNode ? 'ring-2 ring-violet-500 bg-violet-50/40' : ''
                  } ${isNestTargetNode ? 'ring-2 ring-emerald-500 bg-emerald-50/70 scale-[1.03] z-30' : ''}`}
                >
                  {isNestTargetNode && (
                    <span className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-bold whitespace-nowrap shadow-xs pointer-events-none">
                      {L('↳ 여기에 종속', '↳ ここに従属', '↳ Nest here')}
                    </span>
                  )}

                  {/* 4 Port Handle Dots — shown ONLY when Connect Mode is active */}
                  {connectMode &&
                    PORT_SIDES.map((side) => {
                      const isHoveredPort =
                        hoveredConnectTarget?.key === node.key && hoveredConnectTarget?.side === side;
                      const isSourcePort = isWireSource && connectingWire?.fromSide === side;
                      const posCls =
                        side === 'top'
                          ? 'left-1/2 -top-2 -translate-x-1/2'
                          : side === 'bottom'
                          ? 'left-1/2 -bottom-2 -translate-x-1/2'
                          : side === 'left'
                          ? '-left-2 top-1/2 -translate-y-1/2'
                          : '-right-2 top-1/2 -translate-y-1/2';

                      return (
                        <div
                          key={`${node.key}-port-${side}`}
                          title={L('드래그하여 다른 노드와 연결', 'ドラッグして他のノードと接続', 'Drag to connect')}
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            const pt = getPortCoords(node.x, node.y, node.w, node.h, side);
                            setConnectingWire({
                              fromKey: node.key,
                              fromSide: side,
                              pointerX: pt.x,
                              pointerY: pt.y,
                            });
                          }}
                          className={`absolute ${posCls} w-3.5 h-3.5 rounded-full border-2 cursor-crosshair transition-all z-30 ${
                            isHoveredPort || isSourcePort
                              ? 'bg-violet-600 border-white scale-125 opacity-100 ring-2 ring-violet-400'
                              : connectingWire
                              ? 'bg-white border-violet-500 opacity-100 scale-105'
                              : 'bg-white border-violet-700 opacity-90 hover:bg-violet-600 hover:border-white hover:scale-125'
                          }`}
                        />
                      );
                    })}

                  {/* Card Content */}
                  {node.kind === 'ROOT' ? (
                    <div className="space-y-0.5 min-w-0 pointer-events-none">
                      <div className="font-bold text-xs leading-snug line-clamp-2">{node.title}</div>
                      {node.subtitle && (
                        <div className="text-[10px] opacity-85 truncate">{node.subtitle}</div>
                      )}
                    </div>
                  ) : node.kind === 'PROJECT_CARD' && node.projectItem ? (
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center justify-between gap-1 pointer-events-none">
                        <div className="flex items-center gap-1 min-w-0">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: node.projectItem.color }}
                          />
                          {node.projectItem.mode === 'SOLO' || node.projectItem.is_private === 1 ? (
                            <Lock className="w-3 h-3 text-charcoal-400 shrink-0" />
                          ) : (
                            <Users className="w-3 h-3 text-sky-600 shrink-0" />
                          )}
                          <span className="font-bold text-xs text-charcoal-900 truncate">
                            {node.title}
                          </span>
                        </div>
                        {onFocusProject && (
                          <button
                            type="button"
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => {
                              e.stopPropagation();
                              onFocusProject(node.projectItem!.id);
                            }}
                            className="pointer-events-auto px-1.5 py-0.5 rounded bg-forest-800 text-white text-[10px] font-bold hover:bg-forest-900 shrink-0"
                          >
                            {L('열기', '開く', 'Open')}
                          </button>
                        )}
                      </div>
                      {node.subtitle && (
                        <div className="text-[10px] text-charcoal-600 truncate pointer-events-none">
                          {node.subtitle}
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-0.5 min-w-0 pointer-events-none">
                      <div className="flex items-center justify-between gap-1 min-w-0">
                        <span className="font-bold text-xs text-charcoal-900 truncate">
                          {node.title}
                        </span>
                        {node.badge && (
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-white border border-ivory-300 text-charcoal-800 whitespace-nowrap shrink-0">
                            {node.badge}
                          </span>
                        )}
                      </div>
                      {node.subtitle && (
                        <p className="text-[10px] text-charcoal-600 line-clamp-2 leading-tight">
                          {node.subtitle}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Custom Edge Delete Pill Hint */}
        {selectedEdgeId && (
          <div className="sticky bottom-3 left-1/2 -translate-x-1/2 w-fit mx-auto z-40 px-3 py-1.5 rounded-full bg-rose-700 text-white text-xs font-bold shadow-lg flex items-center gap-2">
            <span>{L('선택된 연결선 삭제:', '選択中の接続線を削除:', 'Delete selected wire:')}</span>
            <button
              type="button"
              onClick={() => handleDeleteCustomEdge(selectedEdgeId)}
              className="px-2 py-0.5 rounded bg-white text-rose-800 font-bold hover:bg-rose-50"
            >
              {L('삭제', '削除', 'Delete')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedEdgeId(null)}
              className="opacity-80 hover:opacity-100"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Selected Node Inspector Bar */}
      {selectedNode && (
        <div className="p-3.5 bg-ivory-50 border-t border-ivory-300 space-y-2 text-xs">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-forest-100 text-forest-900 text-[10px] font-bold">
                  {selectedNode.kind === 'IDEA'
                    ? L('아이디어', 'アイデア', 'Idea')
                    : selectedNode.kind === 'ENTRY'
                    ? L('기록 로그', 'ログ', 'Log')
                    : L('노드 상세', 'ノード詳細', 'Node')}
                </span>
                <span className="font-bold text-sm text-charcoal-900">{selectedNode.title}</span>
              </div>
              {selectedNode.subtitle && (
                <p className="text-charcoal-700 whitespace-pre-wrap">{selectedNode.subtitle}</p>
              )}
              {parentOverrides[selectedNode.key] && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 text-[11px] font-bold">
                    <CornerDownRight className="w-3 h-3" />
                    {L('종속 상위:', '従属親:', 'Nested under:')}{' '}
                    {resolvedNodes.map.get(parentOverrides[selectedNode.key])?.title || ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDetachNodeToRoot(selectedNode.key)}
                    className="px-2 py-0.5 rounded-lg bg-white border border-ivory-300 text-charcoal-700 font-bold text-[11px] hover:bg-ivory-100"
                  >
                    {L('루트로 분리', 'ルートへ戻す', 'Detach to Root')}
                  </button>
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setSelectedNodeKey(null)}
              className="p-1 rounded-lg hover:bg-ivory-200 text-charcoal-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {project && selectedIdea && (
            <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-ivory-200">
              {onAddIdea && (
                <button
                  type="button"
                  onClick={() => {
                    setComposerParentId(selectedIdea.id);
                    setComposerTitle('');
                    setComposerNote('');
                    setComposerOpen(true);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-forest-800 text-white font-bold hover:bg-forest-900 inline-flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>{L('하위 아이디어 뻗기', '子アイデア追加', 'Add Sub-Idea')}</span>
                </button>
              )}
              {onPromoteIdea && selectedIdea.status !== 'PROMOTED' && (
                <button
                  type="button"
                  onClick={() => void onPromoteIdea(selectedIdea)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 inline-flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{L('Next Step 승격', 'Next Stepへ昇格', 'Promote to Next Step')}</span>
                </button>
              )}
              {onUpdateIdeaStatus && (
                <button
                  type="button"
                  onClick={() =>
                    void onUpdateIdeaStatus(
                      selectedIdea,
                      selectedIdea.status === 'ARCHIVED' ? 'OPEN' : 'ARCHIVED'
                    )
                  }
                  className="px-2.5 py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 font-bold hover:bg-ivory-100 inline-flex items-center gap-1"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>
                    {selectedIdea.status === 'ARCHIVED'
                      ? L('다시 열기', '再開', 'Reopen')
                      : L('보관', '保管', 'Archive')}
                  </span>
                </button>
              )}
              {onDeleteIdea && (
                <button
                  type="button"
                  onClick={() => {
                    const hasChildren = ideas.some((i) => i.parent_idea_id === selectedIdea.id);
                    const msg = hasChildren
                      ? L(
                          '이 아이디어와 연결된 하위 아이디어들도 함께 삭제됩니다. 삭제하시겠습니까?',
                          'このアイデアに紐づく子アイデアも同時に削除されます。削除しますか？',
                          'Sub-ideas under this node will also be deleted. Delete?'
                        )
                      : L('이 아이디어를 삭제하시겠습니까?', 'このアイデアを削除しますか？', 'Delete this idea?');
                    if (!confirm(msg)) return;
                    void onDeleteIdea(selectedIdea);
                    setSelectedNodeKey(null);
                  }}
                  className="px-2.5 py-1 rounded-lg bg-white border border-rose-200 text-rose-700 font-bold hover:bg-rose-50 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>{L('삭제', '削除', 'Delete')}</span>
                </button>
              )}
            </div>
          )}

          {!project && selectedNode.kind === 'PROJECT_CARD' && selectedNode.projectItem && onFocusProject && (
            <div className="pt-1 border-t border-ivory-200 flex items-center gap-2">
              <button
                type="button"
                onClick={() => onFocusProject(selectedNode.projectItem!.id)}
                className="px-2.5 py-1 rounded-lg bg-forest-800 text-white font-bold hover:bg-forest-900 inline-flex items-center gap-1"
              >
                <GitBranch className="w-3.5 h-3.5" />
                <span>{L('이 프로젝트 자유 마인드맵 열기', 'このプロジェクトのマップを開く', 'Open Project Map')}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
