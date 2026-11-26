import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { TranslateButton } from '../common/TranslateButton';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { MobileNodeBottomSheet } from './MobileNodeBottomSheet';
import { TimelineCardActionItem, TimelineCardActionsMenu } from './TimelineCardActionsMenu';
import {
  Archive,
  Check,
  CheckCircle2,
  Copy,
  CornerDownRight,
  Crosshair,
  Download,
  Edit2,
  ExternalLink,
  GitBranch,
  Link2,
  Lock,
  Maximize2,
  MessageSquare,
  Move,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
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
import {
  CreateJournalEntryPayload,
  CreateJournalIdeaPayload,
  ObstacleBox,
  PORT_SIDES,
  ROOT_SUBTOPIC_KEY,
  WIRE_COLOR_PRESETS,
  buildDirectionalBezier,
  buildMindMapMarkdown,
  buildRelatedIdeaWires,
  buildSmartFreeMapPath,
  chooseFacingPorts,
  cleanTopicMilestoneTitle,
  computeSubtreeCollapseState,
  computeTopicAndDialogueDefaultParents,
  downloadMindMapAsPng,
  findDuplicateInitialIntentEntryId,
  getDefaultComposerKindForNode,
  getPortCoords,
  getPortOutVector,
  getWsFreeMindMapStorageKey,
  isCurrentFocusIntentEntry,
  isDescendantInParentMap,
  isTopicMilestoneEntry,
  remapMindMapKey,
  wouldCycleInParentMap,
} from './mindmapUtils';
import { MindMapNodeComposer } from './MindMapNodeComposer';

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
  onAddIdea?: (payload: CreateJournalIdeaPayload) => Promise<JournalIdea | null | void>;
  onAddEntry?: (payload: CreateJournalEntryPayload) => Promise<JournalEntry | null | void>;
  onEditEntry?: (entry: JournalEntry, updates: { content: string; speaker_name?: string | null }) => Promise<void>;
  onDeleteEntry?: (entryId: number) => Promise<void>;
  onPromoteEntryToNextStep?: (entry: JournalEntry) => Promise<void>;
  onSetNextStep?: (projectId: number, nextAction: string, nextActionDate: string | null) => Promise<void>;
  onPromoteIdea?: (idea: JournalIdea) => Promise<void>;
  onUpdateIdeaStatus?: (idea: JournalIdea, status: IdeaStatus) => Promise<void>;
  onDeleteIdea?: (idea: JournalIdea) => Promise<void>;
  onJumpToTimeline?: (targetKey: string) => void;
  focusNodeKey?: string | null;
  onSelectNodeKey?: (key: string | null) => void;
  onConsumedFocusNode?: () => void;
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
const WORLD_MIN_X = -2400;
const WORLD_MAX_X = 6000;
const WORLD_MIN_Y = -1800;
const WORLD_MAX_Y = 4800;
const ZOOM_STEPS = [0.45, 0.6, 0.75, 0.9, 1, 1.15, 1.3];

interface BoxRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Computes the unit outward ray direction from the Project Root node (`rootBox`)
 * through `parentBox` (using each node's actual current coordinates, including user drag placement).
 */
function computeBranchOutwardUnitVector(
  parentBox: BoxRect,
  rootBox?: BoxRect | null,
  fallbackAngle = -Math.PI / 2
): { ux: number; uy: number; angle: number } {
  const pCx = parentBox.x + parentBox.w / 2;
  const pCy = parentBox.y + parentBox.h / 2;
  const rCx = rootBox ? rootBox.x + rootBox.w / 2 : CENTER_X;
  const rCy = rootBox ? rootBox.y + rootBox.h / 2 : CENTER_Y;
  const dx = pCx - rCx;
  const dy = pCy - rCy;
  const len = Math.hypot(dx, dy);
  if (len < 10) {
    return {
      ux: Math.cos(fallbackAngle),
      uy: Math.sin(fallbackAngle),
      angle: fallbackAngle,
    };
  }
  const ux = dx / len;
  const uy = dy / len;
  return {
    ux,
    uy,
    angle: Math.atan2(uy, ux),
  };
}

/**
 * Places a child box closely adjacent to `parentBox` (~24-28px edge gap)
 * along the exact straight ray `angle` without elliptical angle distortion.
 */
function computeCloseAdjacentPosAlongAngle(
  parentBox: BoxRect,
  childW: number,
  childH: number,
  angle: number,
  distanceMult = 1
): { x: number; y: number } {
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const pCx = parentBox.x + parentBox.w / 2;
  const pCy = parentBox.y + parentBox.h / 2;
  const reqHalfW = (parentBox.w + childW) / 2 + 28;
  const reqHalfH = (parentBox.h + childH) / 2 + 24;
  const distToExitX = Math.abs(ux) > 0.04 ? reqHalfW / Math.abs(ux) : Infinity;
  const distToExitY = Math.abs(uy) > 0.04 ? reqHalfH / Math.abs(uy) : Infinity;
  const stepDist = Math.min(distToExitX, distToExitY) * distanceMult;
  const cCx = pCx + ux * stepDist;
  const cCy = pCy + uy * stepDist;
  return {
    x: Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X - childW, Math.round(cCx - childW / 2))),
    y: Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y - childH, Math.round(cCy - childH / 2))),
  };
}

function resolveCollisionFreePos(
  desiredX: number,
  desiredY: number,
  w: number,
  h: number,
  occupied: BoxRect[],
  parentBox?: BoxRect | null,
  preferredAngle?: number
): { x: number; y: number } {
  const overlaps = (tx: number, ty: number) =>
    occupied.some(
      (o) =>
        tx < o.x + o.w + 16 &&
        tx + w + 16 > o.x &&
        ty < o.y + o.h + 14 &&
        ty + h + 14 > o.y
    );

  const cx = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X - w, Math.round(desiredX)));
  const cy = Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y - h, Math.round(desiredY)));
  if (!overlaps(cx, cy)) return { x: cx, y: cy };

  // 1) If parentBox and outward branch angle are known, fan tightly around preferredAngle right next to parentBox
  if (parentBox && typeof preferredAngle === 'number') {
    const angleOffsets = [0, 0.28, -0.28, 0.54, -0.54, 0.82, -0.82, 1.1, -1.1];
    const distMults = [1.0, 1.22, 1.45, 1.7, 2.0, 2.35, 2.7];
    for (const mult of distMults) {
      for (const off of angleOffsets) {
        const candidate = computeCloseAdjacentPosAlongAngle(
          parentBox,
          w,
          h,
          preferredAngle + off,
          mult
        );
        if (!overlaps(candidate.x, candidate.y)) {
          return candidate;
        }
      }
    }
  }

  // 2) Fallback: search outward from (desiredX, desiredY) biased along preferredAngle
  const baseAng = typeof preferredAngle === 'number' ? preferredAngle : 0;
  const fanSteps = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6];
  for (let ring = 1; ring <= 14; ring++) {
    const r = ring * 58;
    for (const step of fanSteps) {
      const ang = baseAng + (step / 12) * Math.PI * 2;
      const nx = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X - w, Math.round(desiredX + Math.cos(ang) * r)));
      const ny = Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y - h, Math.round(desiredY + Math.sin(ang) * r)));
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
  onAddEntry,
  onEditEntry,
  onDeleteEntry,
  onPromoteEntryToNextStep,
  onSetNextStep,
  onPromoteIdea,
  onUpdateIdeaStatus,
  onDeleteIdea,
  onJumpToTimeline,
  focusNodeKey,
  onSelectNodeKey,
  onConsumedFocusNode,
}) => {
  const { L } = useLanguage();
  const tr = useContentTranslation();

  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);

  const [zoomIdx, setZoomIdx] = useState(4); // 100%
  const scale = ZOOM_STEPS[zoomIdx] || 1;

  // Workspace overview ("ALL") local persistence key
  const wsStorageKey = getWsFreeMindMapStorageKey(currentUserId);

  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [customEdges, setCustomEdges] = useState<FreeMapEdge[]>([]);
  const [parentOverrides, setParentOverrides] = useState<Record<string, string>>({});
  const [undoStack, setUndoStack] = useState<
    Array<{
      positions: Record<string, { x: number; y: number }>;
      customEdges: FreeMapEdge[];
      parentOverrides: Record<string, string>;
    }>
  >([]);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
  const [moveSubtreeWithParent, setMoveSubtreeWithParent] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [nodeKindFilter, setNodeKindFilter] = useState<'ALL' | 'DIALOGUE' | 'IDEA' | 'TOPIC'>('ALL');
  const [copiedMd, setCopiedMd] = useState(false);

  const [connectMode, setConnectMode] = useState(false);
  const [nestMode, setNestMode] = useState(false);
  const [selectedNodeKey, setSelectedNodeKey] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [highlightedNodeKey, setHighlightedNodeKey] = useState<string | null>(null);
  const [wireLabelDraft, setWireLabelDraft] = useState('');

  const lastSelfSelectedKeyRef = useRef<string | null>(null);
  const selectAndSyncNode = useCallback(
    (nextKey: string | null) => {
      lastSelfSelectedKeyRef.current = nextKey;
      setSelectedNodeKey(nextKey);
      setHighlightedNodeKey(nextKey);
      onSelectNodeKey?.(nextKey);
    },
    [onSelectNodeKey]
  );

  // Inline entry editing in Inspector bar
  const [editingEntryInline, setEditingEntryInline] = useState(false);
  const [entryEditContent, setEntryEditContent] = useState('');
  const [isSavingEntryEdit, setIsSavingEntryEdit] = useState(false);

  // Composer state for adding root / child timeline nodes directly in Free Mind Map
  const [composerState, setComposerState] = useState<{
    open: boolean;
    initialKind: EntryType | 'IDEA';
    initialCompletedTarget: string;
    parentNodeKey: string | null;
    parentNodeTitle: string | null;
    parentIdeaId: number | null;
    spawnPos: { x: number; y: number } | null;
  }>({
    open: false,
    initialKind: 'IDEA',
    initialCompletedTarget: '',
    parentNodeKey: null,
    parentNodeTitle: null,
    parentIdeaId: null,
    spawnPos: null,
  });

  // Dragging node / panning canvas / connecting wire state
  const [draggingNode, setDraggingNode] = useState<{
    key: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    moved: boolean;
    descendantOrigPositions: Record<string, { x: number; y: number }>;
    preDragPositions: Record<string, { x: number; y: number }>;
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
  const prevProjectIdRef = useRef<number | null>(project?.id ?? null);
  useEffect(() => {
    const currPid = project?.id ?? null;
    if (prevProjectIdRef.current !== currPid) {
      prevProjectIdRef.current = currPid;
      setSelectedNodeKey(null);
      setSelectedEdgeId(null);
      setCollapsedKeys(new Set());
      setUndoStack([]);
      setEditingEntryInline(false);
      setSearchQuery('');
      setNodeKindFilter('ALL');
    }
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
      const bounds = resolvedNodesRef.current?.canvasBounds || { offsetX: 0, offsetY: 0 };
      const rootKey = project ? 'proj-root' : 'ws-root';
      const rootNode = resolvedNodesRef.current?.allMap?.get(rootKey);
      const cx = (rootNode ? rootNode.x + rootNode.w / 2 : CENTER_X) + bounds.offsetX;
      const cy = (rootNode ? rootNode.y + rootNode.h / 2 : CENTER_Y) + bounds.offsetY;
      const targetLeft = Math.max(0, cx * scale - vp.clientWidth / 2);
      const targetTop = Math.max(0, cy * scale - vp.clientHeight / 2);
      vp.scrollTo({ left: targetLeft, top: targetTop, behavior });
    },
    [scale, project]
  );

  // Center canvas on root when switching project or mounting (unless focusing a specific target node!)
  useEffect(() => {
    if (focusNodeKey) return;
    const timer = setTimeout(() => centerViewport('auto'), 40);
    return () => clearTimeout(timer);
  }, [project?.id, focusNodeKey]);

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

  const duplicateInitialEntryId = useMemo(
    () => findDuplicateInitialIntentEntryId(project, entries),
    [project, entries]
  );

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

    // 1. Pinned Intent (Top-Left / North) + Chained Current Focus / Core Memo Updates
    const initialIntentText = (project.initial_intent_summary || project.intent_summary || '').trim();
    if (initialIntentText) {
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
        subtitle: initialIntentText,
        bgClass: 'bg-amber-50',
        borderClass: 'border-amber-300',
      });
    }

    const focusIntentEntries = [...entries]
      .filter((en) => en.id !== duplicateInitialEntryId && isCurrentFocusIntentEntry(en))
      .sort((a, b) => a.id - b.id);

    focusIntentEntries.forEach((en, fIdx) => {
      const eKey = `entry-${en.id}`;
      const isLatestFocus = fIdx === focusIntentEntries.length - 1;
      const defaultParentKey =
        fIdx === 0
          ? initialIntentText
            ? 'intent-pinned'
            : 'proj-root'
          : `entry-${focusIntentEntries[fIdx - 1].id}`;
      list.push({
        key: eKey,
        w: 224,
        h: 72,
        defaultX: CENTER_X - 310 - (fIdx + 1) * 235,
        defaultY: CENTER_Y - 230 - (fIdx + 1) * 45,
        parentKey: defaultParentKey,
        autoEdgeColor: '#D97706',
        kind: 'ENTRY',
        title: isLatestFocus
          ? L('🧭 현재 방향 · 핵심 메모', '🧭 現在の方向・核心メモ', '🧭 Current Focus · Memo')
          : L('🧭 이전 방향 · 메모', '🧭 以前の方向・メモ', '🧭 Previous Focus'),
        subtitle: en.content,
        badge: en.entry_date ? en.entry_date.slice(5) : undefined,
        bgClass: isLatestFocus ? 'bg-amber-50/95' : 'bg-amber-50/60',
        borderClass: isLatestFocus ? 'border-amber-400' : 'border-amber-300',
        entry: en,
      });
    });

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

    // 3. Entries (Full unbroken chains; users fold past branches via [-]/[+N])
    const visibleEntries = entries.filter(
      (en) => en.id !== duplicateInitialEntryId && !isCurrentFocusIntentEntry(en)
    );

    const { topicEntries, defaultParents: topicDialogueParents } =
      computeTopicAndDialogueDefaultParents(visibleEntries, parentOverrides, 'proj-root');
    const topicIdSet = new Set(topicEntries.map((t) => t.id));

    // Only count direct root-attached entries when assigning initial root angles around proj-root
    const rootLevelEntries = visibleEntries.filter((en) => {
      const eKey = `entry-${en.id}`;
      if (parentOverrides[eKey] === ROOT_SUBTOPIC_KEY) return false;
      const pKey = parentOverrides[eKey] || topicDialogueParents.get(eKey) || 'proj-root';
      return pKey === 'proj-root';
    });
    const rootSubtopicEntries = visibleEntries.filter(
      (en) => parentOverrides[`entry-${en.id}`] === ROOT_SUBTOPIC_KEY
    );

    visibleEntries.forEach((en, idx) => {
      const eKey = `entry-${en.id}`;
      const isTopic = topicIdSet.has(en.id);
      const topicIdx = isTopic ? topicEntries.findIndex((x) => x.id === en.id) : -1;
      const isCurrentTopic = isTopic && topicIdx === topicEntries.length - 1;
      const isRootSub = parentOverrides[eKey] === ROOT_SUBTOPIC_KEY;

      let angle = Math.PI; // Default straight left (180 deg)
      if (isRootSub) {
        const subIdx = Math.max(0, rootSubtopicEntries.findIndex((x) => x.id === en.id));
        const subTotal = Math.max(1, rootSubtopicEntries.length);
        const subT = subTotal === 1 ? 0.5 : subIdx / (subTotal - 1);
        angle = -Math.PI * 0.62 + subT * (Math.PI * 0.36); // Top sector
      } else {
        const rootIdx = rootLevelEntries.findIndex((x) => x.id === en.id);
        if (rootIdx >= 0) {
          const rTotal = Math.max(1, rootLevelEntries.length);
          const rT = rTotal === 1 ? 0.5 : rootIdx / (rTotal - 1);
          angle = Math.PI * 0.78 + rT * (Math.PI * 0.44); // Left sector centered at 180 deg
        } else {
          const total = Math.max(1, visibleEntries.length);
          const t = total === 1 ? 0.5 : idx / (total - 1);
          angle = Math.PI * 0.75 + t * (Math.PI * 0.5);
        }
      }
      const radius = 260;

      const edgeColor = isTopic
        ? isCurrentTopic
          ? '#059669'
          : '#D97706'
        : isRootSub
        ? '#7C3AED'
        : en.entry_type === 'DIALOGUE_ME'
        ? '#1B4D3E'
        : en.entry_type === 'DIALOGUE_THEM'
        ? '#0284C7'
        : en.entry_type === 'PROGRESS'
        ? '#059669'
        : '#D97706';
      const bgClass = isTopic
        ? isCurrentTopic
          ? 'bg-emerald-50/90'
          : 'bg-amber-50/90'
        : isRootSub
        ? 'bg-purple-50/75'
        : en.entry_type === 'DIALOGUE_ME'
        ? 'bg-emerald-50/50'
        : en.entry_type === 'DIALOGUE_THEM'
        ? 'bg-sky-50/70'
        : en.entry_type === 'PROGRESS'
        ? 'bg-emerald-50/80'
        : 'bg-amber-50/70';
      const borderClass = isTopic
        ? isCurrentTopic
          ? 'border-emerald-400'
          : 'border-amber-300'
        : isRootSub
        ? 'border-purple-300'
        : en.entry_type === 'DIALOGUE_ME'
        ? 'border-forest-300'
        : en.entry_type === 'DIALOGUE_THEM'
        ? 'border-sky-300'
        : en.entry_type === 'PROGRESS'
        ? 'border-emerald-300'
        : 'border-amber-300';

      list.push({
        key: eKey,
        w: 215,
        h: 66,
        defaultX: CENTER_X + Math.cos(angle) * radius - 107,
        defaultY: CENTER_Y + Math.sin(angle) * radius - 33,
        parentKey: topicDialogueParents.get(eKey) || 'proj-root',
        autoEdgeColor: edgeColor,
        kind: 'ENTRY',
        title: isTopic
          ? `🎯 ${cleanTopicMilestoneTitle(en.content)}`
          : `${en.entry_date ? `${en.entry_date.slice(5)} · ` : ''}${getEntryLabel(en.entry_type, en.speaker_name)}`,
        subtitle: isTopic
          ? en.due_date
            ? `📅 ${en.due_date}`
            : isCurrentTopic
            ? L('현재 진행 토픽 (다음 할 일)', '現在の進行トピック', 'Active Topic (Next Step)')
            : L(`토픽 ${topicIdx + 1} (이전 할 일)`, `トピック ${topicIdx + 1} (前の行動)`, `Topic ${topicIdx + 1} (Previous)`)
          : en.content,
        badge: isRootSub
          ? L('🌿 서브토픽', '🌿 サブ', '🌿 Subtopic')
          : isTopic
          ? isCurrentTopic
            ? L('현재 토픽', '現在', 'Current')
            : L(`토픽 ${topicIdx + 1}`, `T${topicIdx + 1}`, `T${topicIdx + 1}`)
          : undefined,
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
  }, [project, entries, ideas, allProjects, customEdges, parentOverrides, duplicateInitialEntryId, L]);

    // Compute resolved screen coordinates + effective parentKey for every node
  const resolvedNodes = useMemo(() => {
    const defMap = new Map<string, FreeNodeDef>();
    for (const d of nodeDefs) defMap.set(d.key, d);

    const effectiveParentMap = new Map<string, string | undefined>();
    for (const d of nodeDefs) {
      effectiveParentMap.set(d.key, d.parentKey);
    }
    for (const d of nodeDefs) {
      if (d.kind === 'ROOT') continue;
      const rawOv = parentOverrides[d.key];
      if (!rawOv) continue;
      const ov = remapMindMapKey(rawOv, duplicateInitialEntryId);
      if (ov === ROOT_SUBTOPIC_KEY) {
        effectiveParentMap.set(d.key, project ? 'proj-root' : 'ws-root');
        continue;
      }
      if (ov && defMap.has(ov) && ov !== d.key && !wouldCycleInParentMap(d.key, ov, effectiveParentMap)) {
        effectiveParentMap.set(d.key, ov);
      }
    }

    // Topological order: always resolve parents before children so every child knows its parent's live coordinates
    const topoDefs: FreeNodeDef[] = [];
    const visitedKeys = new Set<string>();
    for (const d of nodeDefs) {
      if (d.kind === 'ROOT') {
        topoDefs.push(d);
        visitedKeys.add(d.key);
      }
    }
    let remainingDefs = nodeDefs.filter((d) => !visitedKeys.has(d.key));
    let safetyPass = 0;
    while (remainingDefs.length > 0 && safetyPass < 30) {
      const nextRemaining: FreeNodeDef[] = [];
      let progressed = false;
      for (const d of remainingDefs) {
        const pKey = effectiveParentMap.get(d.key);
        if (!pKey || !defMap.has(pKey) || visitedKeys.has(pKey)) {
          topoDefs.push(d);
          visitedKeys.add(d.key);
          progressed = true;
        } else {
          nextRemaining.push(d);
        }
      }
      remainingDefs = nextRemaining;
      if (!progressed) break;
      safetyPass += 1;
    }
    for (const d of remainingDefs) {
      topoDefs.push(d);
      visitedKeys.add(d.key);
    }

    const occupied: BoxRect[] = [];
    // Reserve saved positions first so newly added nodes never collide with user-placed nodes
    for (const def of topoDefs) {
      const saved = positions[def.key];
      if (saved) {
        occupied.push({ x: saved.x, y: saved.y, w: def.w, h: def.h });
      }
    }

    const rootKey = project ? 'proj-root' : 'ws-root';
    const resultMap = new Map<string, FreeNodeDef & { x: number; y: number }>();

    for (const def of topoDefs) {
      const resolvedParentKey = effectiveParentMap.get(def.key);
      const saved = positions[def.key];
      if (saved) {
        const node = { ...def, parentKey: resolvedParentKey, x: saved.x, y: saved.y };
        resultMap.set(def.key, node);
      } else {
        const rootNode = resultMap.get(rootKey);
        const parentNode = resolvedParentKey ? resultMap.get(resolvedParentKey) : undefined;
        let desiredX = def.defaultX;
        let desiredY = def.defaultY;
        let preferredAngle: number | undefined;
        let anchorParentBox: BoxRect | null = null;

        if (parentNode && resolvedParentKey !== rootKey) {
          // Child of a branch node: extend in a straight line outward along the ray from rootNode -> parentNode
          const { angle } = computeBranchOutwardUnitVector(parentNode, rootNode);
          preferredAngle = angle;
          anchorParentBox = parentNode;
          const adj = computeCloseAdjacentPosAlongAngle(parentNode, def.w, def.h, angle, 1.0);
          desiredX = adj.x;
          desiredY = adj.y;
        } else if (parentNode && resolvedParentKey === rootKey) {
          // Direct child of rootNode: anchor closely around rootNode's current position along its default sector angle
          const defaultAngle = Math.atan2(
            def.defaultY + def.h / 2 - CENTER_Y,
            def.defaultX + def.w / 2 - CENTER_X
          );
          preferredAngle = defaultAngle;
          anchorParentBox = parentNode;
          const distMult = def.kind === 'PROJECT_CARD' ? 1.25 : 1.12;
          const adj = computeCloseAdjacentPosAlongAngle(parentNode, def.w, def.h, defaultAngle, distMult);
          desiredX = adj.x;
          desiredY = adj.y;
        }

        const pos = resolveCollisionFreePos(
          desiredX,
          desiredY,
          def.w,
          def.h,
          occupied,
          anchorParentBox,
          preferredAngle
        );
        occupied.push({ x: pos.x, y: pos.y, w: def.w, h: def.h });
        const node = { ...def, parentKey: resolvedParentKey, x: pos.x, y: pos.y };
        resultMap.set(def.key, node);
      }
    }

    const ordered = nodeDefs
      .map((d) => resultMap.get(d.key))
      .filter((n): n is FreeNodeDef & { x: number; y: number } => Boolean(n));

    const { hiddenKeys, descendantCountMap } = computeSubtreeCollapseState(
      ordered.map((n) => n.key),
      effectiveParentMap,
      collapsedKeys
    );
    const visibleOrdered = ordered.filter((n) => !hiddenKeys.has(n.key));
    const visibleMap = new Map<string, FreeNodeDef & { x: number; y: number }>();
    for (const n of visibleOrdered) visibleMap.set(n.key, n);

    // Auto-expanding canvas bounds around all visible nodes (keeps saved coordinates intact)
    let minX = 0;
    let minY = 0;
    let maxX = CANVAS_W;
    let maxY = CANVAS_H;
    for (const n of visibleOrdered) {
      minX = Math.min(minX, n.x - 240);
      minY = Math.min(minY, n.y - 200);
      maxX = Math.max(maxX, n.x + n.w + 260);
      maxY = Math.max(maxY, n.y + n.h + 220);
    }
    const offsetX = Math.max(0, Math.ceil(-minX));
    const offsetY = Math.max(0, Math.ceil(-minY));
    const canvasWidth = Math.max(CANVAS_W, Math.ceil(maxX + offsetX));
    const canvasHeight = Math.max(CANVAS_H, Math.ceil(maxY + offsetY));

    return {
      ordered: visibleOrdered,
      allOrdered: ordered,
      map: visibleMap,
      allMap: resultMap,
      effectiveParentMap,
      descendantCountMap,
      canvasBounds: { offsetX, offsetY, width: canvasWidth, height: canvasHeight },
    };
  }, [nodeDefs, positions, parentOverrides, duplicateInitialEntryId, collapsedKeys, project]);

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
    (potentialParentKey: string, draggedKey: string): boolean =>
      isDescendantInParentMap(potentialParentKey, draggedKey, resolvedNodes.effectiveParentMap),
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

  const pushUndoSnapshot = useCallback(
    (overridePos?: Record<string, { x: number; y: number }>) => {
      setUndoStack((prev) => [
        ...prev.slice(-19),
        {
          positions: { ...(overridePos || positionsRef.current) },
          customEdges: [...customEdgesRef.current],
          parentOverrides: { ...parentOverridesRef.current },
        },
      ]);
    },
    []
  );

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setPositions(last.positions);
      setCustomEdges(last.customEdges);
      setParentOverrides(last.parentOverrides);
      persistLayout(last.positions, last.customEdges, last.parentOverrides);
      return prev.slice(0, -1);
    });
  }, [persistLayout]);

  const toggleCollapseNode = useCallback((nodeKey: string) => {
    setCollapsedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  }, []);

  const fitAllNodesInViewport = useCallback(
    (behavior: ScrollBehavior = 'smooth') => {
      const vp = viewportRef.current;
      const list = resolvedNodesRef.current.ordered;
      if (!vp || list.length === 0) return;
      const bounds = resolvedNodesRef.current.canvasBounds;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const n of list) {
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w);
        maxY = Math.max(maxY, n.y + n.h);
      }
      const spanW = Math.max(320, maxX - minX + 140);
      const spanH = Math.max(240, maxY - minY + 120);
      const desiredScale = Math.min(vp.clientWidth / spanW, vp.clientHeight / spanH, 1.0);
      let bestIdx = 0;
      for (let i = 0; i < ZOOM_STEPS.length; i++) {
        if (ZOOM_STEPS[i] <= desiredScale + 0.03) bestIdx = i;
      }
      const nextScale = ZOOM_STEPS[bestIdx] || 0.75;
      setZoomIdx(bestIdx);
      const centerX = (minX + maxX) / 2 + bounds.offsetX;
      const centerY = (minY + maxY) / 2 + bounds.offsetY;
      setTimeout(() => {
        const curVp = viewportRef.current;
        if (!curVp) return;
        curVp.scrollTo({
          left: Math.max(0, centerX * nextScale - curVp.clientWidth / 2),
          top: Math.max(0, centerY * nextScale - curVp.clientHeight / 2),
          behavior,
        });
      }, 30);
    },
    []
  );

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
        const def = resolvedNodesRef.current.allMap.get(draggingNode.key);
        const w = def?.w || 215;
        const h = def?.h || 68;
        const nx = Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X - w, Math.round(draggingNode.origX + dx)));
        const ny = Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y - h, Math.round(draggingNode.origY + dy)));
        const actualDx = nx - draggingNode.origX;
        const actualDy = ny - draggingNode.origY;
        const shouldMoveSubtree = !nestMode && (e.shiftKey ? !moveSubtreeWithParent : moveSubtreeWithParent);

        setPositions((prev) => {
          const next: Record<string, { x: number; y: number }> = {
            ...prev,
            [draggingNode.key]: { x: nx, y: ny },
          };
          if (shouldMoveSubtree) {
            for (const [descKey, origPos] of Object.entries(draggingNode.descendantOrigPositions)) {
              const dDef = resolvedNodesRef.current.allMap.get(descKey);
              const dw = dDef?.w || 215;
              const dh = dDef?.h || 68;
              next[descKey] = {
                x: Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X - dw, Math.round(origPos.x + actualDx))),
                y: Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y - dh, Math.round(origPos.y + actualDy))),
              };
            }
          }
          return next;
        });
      } else if (panning && viewportRef.current) {
        const dx = e.clientX - panning.startClientX;
        const dy = e.clientY - panning.startClientY;
        viewportRef.current.scrollLeft = panning.scrollLeft - dx;
        viewportRef.current.scrollTop = panning.scrollTop - dy;
      } else if (connectingWire && canvasRef.current) {
        const rect = canvasRef.current.getBoundingClientRect();
        const bounds = resolvedNodesRef.current.canvasBounds;
        const px = (e.clientX - rect.left) / scale - bounds.offsetX;
        const py = (e.clientY - rect.top) / scale - bounds.offsetY;
        setConnectingWire((prev) => (prev ? { ...prev, pointerX: px, pointerY: py } : null));
      }
    };

    const handlePointerUp = () => {
      if (draggingNode) {
        if (draggingNode.moved) {
          pushUndoSnapshot(draggingNode.preDragPositions);
          const nestTargetKey = hoveredNestTargetRef.current;
          if (nestMode && nestTargetKey) {
            const targetNode = resolvedNodesRef.current.map.get(nestTargetKey);
            const draggedNode = resolvedNodesRef.current.map.get(draggingNode.key);
            const rootNode = resolvedNodesRef.current.allMap.get(project ? 'proj-root' : 'ws-root');
            const nextParents = {
              ...parentOverridesRef.current,
              [draggingNode.key]: nestTargetKey,
            };
            let nextPositions = { ...positionsRef.current };
            if (targetNode && draggedNode) {
              const subtreeNodes = resolvedNodesRef.current.allOrdered.filter(
                (n) =>
                  n.key === draggingNode.key ||
                  isDescendantInParentMap(
                    n.key,
                    draggingNode.key,
                    resolvedNodesRef.current.effectiveParentMap
                  )
              );
              const subtreeKeySet = new Set(subtreeNodes.map((n) => n.key));
              const occupied = resolvedNodesRef.current.ordered
                .filter((n) => !subtreeKeySet.has(n.key))
                .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));
              const { angle } = computeBranchOutwardUnitVector(targetNode, rootNode);
              const desired = computeCloseAdjacentPosAlongAngle(targetNode, draggedNode.w, draggedNode.h, angle, 1.0);
              const placed = resolveCollisionFreePos(
                desired.x,
                desired.y,
                draggedNode.w,
                draggedNode.h,
                occupied,
                targetNode,
                angle
              );
              const deltaX = placed.x - draggingNode.origX;
              const deltaY = placed.y - draggingNode.origY;

              nextPositions = { ...nextPositions, [draggingNode.key]: placed };
              for (const desc of subtreeNodes) {
                if (desc.key === draggingNode.key) continue;
                const origDesc = draggingNode.descendantOrigPositions[desc.key] || { x: desc.x, y: desc.y };
                nextPositions[desc.key] = {
                  x: Math.max(WORLD_MIN_X, Math.min(WORLD_MAX_X - desc.w, Math.round(origDesc.x + deltaX))),
                  y: Math.max(WORLD_MIN_Y, Math.min(WORLD_MAX_Y - desc.h, Math.round(origDesc.y + deltaY))),
                };
              }
              setPositions(nextPositions);
            }
            setParentOverrides(nextParents);
            persistLayout(nextPositions, customEdgesRef.current, nextParents);
          } else {
            persistLayout(positionsRef.current, customEdgesRef.current, parentOverridesRef.current);
          }
        } else {
          const nextKey = selectedNodeKey === draggingNode.key ? null : draggingNode.key;
          selectAndSyncNode(nextKey);
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
            pushUndoSnapshot();
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

    const handlePointerCancel = () => {
      if (draggingNode) setDraggingNode(null);
      if (panning) setPanning(null);
      if (connectingWire) setConnectingWire(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
    };
  }, [draggingNode, panning, connectingWire, nestMode, moveSubtreeWithParent, scale, project, persistLayout, pushUndoSnapshot, selectedNodeKey, selectAndSyncNode]);

  // Escape & Ctrl+Z keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      const isEditingInput = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !isEditingInput) {
        if (undoStack.length > 0) {
          e.preventDefault();
          handleUndo();
        }
        return;
      }
      if (e.key !== 'Escape') return;
      if (editingEntryInline) {
        setEditingEntryInline(false);
        return;
      }
      if (connectMode || nestMode) {
        setConnectMode(false);
        setNestMode(false);
        return;
      }
      if (selectedEdgeId) setSelectedEdgeId(null);
      if (selectedNodeKey) selectAndSyncNode(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [connectMode, nestMode, selectedEdgeId, selectedNodeKey, selectAndSyncNode, editingEntryInline, undoStack.length, handleUndo]);

  useEffect(() => {
    if (!selectedEdgeId) {
      setWireLabelDraft('');
      return;
    }
    const found = customEdges.find((e) => e.id === selectedEdgeId);
    setWireLabelDraft(found?.label || '');
  }, [selectedEdgeId, customEdges]);

  useEffect(() => {
    setEditingEntryInline(false);
    setEntryEditContent('');
  }, [selectedNodeKey]);

  // External focus jump from Timeline or tab sync between Mind Map <-> Free Mind Map
  useEffect(() => {
    if (!focusNodeKey) return;
    if (lastSelfSelectedKeyRef.current === focusNodeKey) return;
    const remapped = remapMindMapKey(focusNodeKey, duplicateInitialEntryId);

    setCollapsedKeys((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let curr = resolvedNodes.effectiveParentMap.get(remapped);
      const visited = new Set<string>();
      let changed = false;
      while (curr && !visited.has(curr)) {
        visited.add(curr);
        if (next.has(curr)) {
          next.delete(curr);
          changed = true;
        }
        curr = resolvedNodes.effectiveParentMap.get(curr);
      }
      return changed ? next : prev;
    });

    const node = resolvedNodes.allMap.get(remapped);
    if (node) {
      lastSelfSelectedKeyRef.current = null;
      const isSheetViewport =
        typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches;
      setSelectedNodeKey(isSheetViewport ? null : remapped);
      setHighlightedNodeKey(remapped);
      const centerOnNode = (behavior: ScrollBehavior) => {
        const vp = viewportRef.current;
        if (!vp) return;
        const bounds = resolvedNodes.canvasBounds;
        const targetLeft = Math.max(0, (node.x + node.w / 2 + bounds.offsetX) * scale - vp.clientWidth / 2);
        const targetTop = Math.max(0, (node.y + node.h / 2 + bounds.offsetY) * scale - vp.clientHeight / 2);
        vp.scrollTo({ left: targetLeft, top: targetTop, behavior });
      };
      centerOnNode('auto');
      const timer = setTimeout(() => centerOnNode('smooth'), 45);
      onConsumedFocusNode?.();
      return () => clearTimeout(timer);
    }
  }, [focusNodeKey, duplicateInitialEntryId, resolvedNodes.allMap, resolvedNodes.effectiveParentMap, resolvedNodes.canvasBounds, scale, onConsumedFocusNode]);

  const handleResetRadialPositions = () => {
    pushUndoSnapshot();
    setPositions({});
    persistLayout({}, customEdges, parentOverrides);
    setTimeout(() => centerViewport('smooth'), 40);
  };

  const handleDetachNodeToRoot = (nodeKey: string) => {
    pushUndoSnapshot();
    const nextParents = { ...parentOverrides };
    delete nextParents[nodeKey];
    setParentOverrides(nextParents);
    persistLayout(positions, customEdges, nextParents);
  };

  const handleUpdateCustomEdge = (edgeId: string, patch: { color?: string; label?: string }) => {
    pushUndoSnapshot();
    const nextEdges = customEdges.map((e) => {
      if (e.id !== edgeId) return e;
      const nextLabel =
        patch.label !== undefined ? patch.label.trim().slice(0, 40) || undefined : e.label;
      return {
        ...e,
        ...(patch.color !== undefined ? { color: patch.color } : {}),
        label: nextLabel,
      };
    });
    setCustomEdges(nextEdges);
    persistLayout(positions, nextEdges, parentOverrides);
  };

  const handleDeleteCustomEdge = (edgeId: string) => {
    pushUndoSnapshot();
    const nextEdges = customEdges.filter((e) => e.id !== edgeId);
    setCustomEdges(nextEdges);
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    persistLayout(positions, nextEdges, parentOverrides);
  };

  const openComposerForNode = useCallback(
    (
      targetNode: (typeof resolvedNodes.ordered)[number] | null,
      spawnPos: { x: number; y: number } | null = null,
      asRootSubtopic = false,
      overrideKind?: EntryType | 'IDEA',
      initialCompletedTarget = ''
    ) => {
      const rootNode = resolvedNodes.map.get('proj-root');
      if (asRootSubtopic) {
        const defaultRootSpawn = rootNode
          ? computeCloseAdjacentPosAlongAngle(rootNode, 215, 68, -Math.PI / 2, 1.12)
          : { x: CENTER_X - 110, y: CENTER_Y - 180 };
        setComposerState({
          open: true,
          initialKind: overrideKind || 'DIALOGUE_ME',
          initialCompletedTarget: '',
          parentNodeKey: ROOT_SUBTOPIC_KEY,
          parentNodeTitle: L('프로젝트 루트 (새 서브토픽)', 'プロジェクトルート (新規サブトピック)', 'Project Root (New Subtopic)'),
          parentIdeaId: null,
          spawnPos: spawnPos || defaultRootSpawn,
        });
        return;
      }
      if (targetNode && targetNode.kind !== 'ROOT' && targetNode.kind !== 'PROJECT_CARD') {
        const { angle } = computeBranchOutwardUnitVector(targetNode, rootNode);
        const fallbackSpawn = computeCloseAdjacentPosAlongAngle(targetNode, 215, 68, angle, 1.0);
        setComposerState({
          open: true,
          initialKind: overrideKind || getDefaultComposerKindForNode(targetNode.kind, targetNode.entry),
          initialCompletedTarget,
          parentNodeKey: targetNode.key,
          parentNodeTitle: targetNode.title,
          parentIdeaId: targetNode.idea ? targetNode.idea.id : null,
          spawnPos: spawnPos || fallbackSpawn,
        });
      } else {
        setComposerState({
          open: true,
          initialKind: overrideKind || (onAddIdea ? 'IDEA' : 'INTENT'),
          initialCompletedTarget,
          parentNodeKey: null,
          parentNodeTitle: null,
          parentIdeaId: null,
          spawnPos: null,
        });
      }
    },
    [onAddIdea, resolvedNodes.map, L]
  );

  const handleComposerCreatedNode = useCallback(
    (newKey: string, parentKey: string | null) => {
      pushUndoSnapshot();
      const nextParents = parentKey
        ? { ...parentOverridesRef.current, [newKey]: parentKey }
        : parentOverridesRef.current;
      let nextPositions = positionsRef.current;

      const rootNode = resolvedNodesRef.current.map.get('proj-root');
      const effectiveParentKey =
        parentKey === ROOT_SUBTOPIC_KEY
          ? 'proj-root'
          : parentKey
          ? remapMindMapKey(parentKey, duplicateInitialEntryId)
          : null;
      const parentNode = effectiveParentKey
        ? resolvedNodesRef.current.map.get(effectiveParentKey)
        : undefined;

      const occupied = resolvedNodesRef.current.ordered
        .filter((n) => n.key !== newKey)
        .map((n) => ({ x: n.x, y: n.y, w: n.w, h: n.h }));

      let placedPos: { x: number; y: number } | null = null;
      if (parentNode && effectiveParentKey !== 'proj-root') {
        const { angle } = computeBranchOutwardUnitVector(parentNode, rootNode);
        const desired = computeCloseAdjacentPosAlongAngle(parentNode, 215, 68, angle, 1.0);
        placedPos = resolveCollisionFreePos(
          desired.x,
          desired.y,
          215,
          68,
          occupied,
          parentNode,
          angle
        );
        nextPositions = { ...nextPositions, [newKey]: placedPos };
        setPositions(nextPositions);
      } else if (parentNode && effectiveParentKey === 'proj-root') {
        const subAngle = -Math.PI / 2;
        const desired = computeCloseAdjacentPosAlongAngle(parentNode, 215, 68, subAngle, 1.12);
        placedPos = resolveCollisionFreePos(
          desired.x,
          desired.y,
          215,
          68,
          occupied,
          parentNode,
          subAngle
        );
        nextPositions = { ...nextPositions, [newKey]: placedPos };
        setPositions(nextPositions);
      } else if (composerState.spawnPos) {
        placedPos = resolveCollisionFreePos(
          composerState.spawnPos.x,
          composerState.spawnPos.y,
          215,
          68,
          occupied
        );
        nextPositions = { ...nextPositions, [newKey]: placedPos };
        setPositions(nextPositions);
      }

      if (parentKey) {
        setParentOverrides(nextParents);
      }
      if (parentKey || nextPositions !== positionsRef.current) {
        persistLayout(nextPositions, customEdgesRef.current, nextParents);
      }
      if (placedPos && viewportRef.current) {
        const vp = viewportRef.current;
        const bounds = resolvedNodesRef.current.canvasBounds;
        const targetLeft = Math.max(0, (placedPos.x + 110 + bounds.offsetX) * scale - vp.clientWidth / 2);
        const targetTop = Math.max(0, (placedPos.y + 34 + bounds.offsetY) * scale - vp.clientHeight / 2);
        setTimeout(() => {
          vp.scrollTo({ left: targetLeft, top: targetTop, behavior: 'smooth' });
        }, 50);
      }
    },
    [composerState.spawnPos, duplicateInitialEntryId, persistLayout, pushUndoSnapshot, scale]
  );

  // Trailing dashed [+] buttons at every branch's leaf node (0 children)
  const leafAddButtons = useMemo(() => {
    if (!project || (!onAddIdea && !onAddEntry)) return [];
    const parentsWithChildren = new Set<string>();
    for (const n of resolvedNodes.ordered) {
      if (n.parentKey) parentsWithChildren.add(n.parentKey);
    }
    const btns: Array<{
      key: string;
      parentNode: (typeof resolvedNodes.ordered)[number];
      isRootSubtopicTrigger?: boolean;
      portX: number;
      portY: number;
      btnX: number;
      btnY: number;
      spawnX: number;
      spawnY: number;
      size: number;
      edgeColor: string;
    }> = [];

    // 1) Root center node [+] button (creates a new independent subtopic branch off proj-root)
    const rootNode = resolvedNodes.map.get('proj-root');
    if (rootNode) {
      const rootSize = 28;
      const rootPort = getPortCoords(rootNode.x, rootNode.y, rootNode.w, rootNode.h, 'top');
      const rcx = rootPort.x;
      const rcy = rootPort.y - 30;
      const rootSpawn = computeCloseAdjacentPosAlongAngle(rootNode, 215, 68, -Math.PI / 2, 1.12);
      btns.push({
        key: 'free-leaf-add::proj-root',
        parentNode: rootNode,
        isRootSubtopicTrigger: true,
        portX: rootPort.x,
        portY: rootPort.y,
        btnX: rcx - rootSize / 2,
        btnY: rcy - rootSize / 2,
        spawnX: rootSpawn.x,
        spawnY: rootSpawn.y,
        size: rootSize,
        edgeColor: '#7C3AED',
      });
    }

    // 2) Leaf node [+] buttons at the end of every branch (skip collapsed parents)
    for (const n of resolvedNodes.ordered) {
      if (
        n.kind === 'ROOT' ||
        n.kind === 'PROJECT_CARD' ||
        parentsWithChildren.has(n.key) ||
        (resolvedNodes.descendantCountMap.get(n.key) || 0) > 0
      ) {
        continue;
      }
      const { ux, uy, angle } = computeBranchOutwardUnitVector(n, rootNode);
      const side: PortSide =
        Math.abs(ux) >= Math.abs(uy)
          ? ux >= 0
            ? 'right'
            : 'left'
          : uy >= 0
          ? 'bottom'
          : 'top';
      const port = getPortCoords(n.x, n.y, n.w, n.h, side);
      const out = getPortOutVector(side);
      const size = 28;
      const cx = port.x + out.dx * 30;
      const cy = port.y + out.dy * 30;
      const spawn = computeCloseAdjacentPosAlongAngle(n, n.w, n.h, angle, 1.0);
      btns.push({
        key: `free-leaf-add::${n.key}`,
        parentNode: n,
        portX: port.x,
        portY: port.y,
        btnX: cx - size / 2,
        btnY: cy - size / 2,
        spawnX: spawn.x,
        spawnY: spawn.y,
        size,
        edgeColor: n.autoEdgeColor,
      });
    }
    return btns;
  }, [project, onAddIdea, onAddEntry, resolvedNodes.ordered, resolvedNodes.map, resolvedNodes.descendantCountMap]);

  const selectedNode = selectedNodeKey ? resolvedNodes.allMap.get(selectedNodeKey) || null : null;
  const selectedIdea = selectedNode?.idea || null;
  const selectedEntry = selectedNode?.entry || null;
  const selectedEdge = selectedEdgeId ? customEdges.find((e) => e.id === selectedEdgeId) || null : null;

  const isSearchActive = searchQuery.trim().length > 0 || nodeKindFilter !== 'ALL';
  const doesNodeMatchFilter = useCallback(
    (node: (typeof resolvedNodes.ordered)[number]): boolean => {
      if (!isSearchActive) return true;
      if (node.kind === 'ROOT') return true;
      if (nodeKindFilter === 'DIALOGUE') {
        if (
          node.kind !== 'ENTRY' ||
          !node.entry ||
          (node.entry.entry_type !== 'DIALOGUE_ME' &&
            node.entry.entry_type !== 'DIALOGUE_THEM' &&
            node.entry.entry_type !== 'PROGRESS')
        ) {
          return false;
        }
      } else if (nodeKindFilter === 'IDEA') {
        if (node.kind !== 'IDEA') return false;
      } else if (nodeKindFilter === 'TOPIC') {
        if (
          node.kind !== 'NEXT_STEP' &&
          !(node.entry && isTopicMilestoneEntry(node.entry)) &&
          !(node.entry && isCurrentFocusIntentEntry(node.entry)) &&
          node.kind !== 'INTENT_PINNED'
        ) {
          return false;
        }
      }
      const q = searchQuery.trim().toLowerCase();
      if (!q) return true;
      const hay = `${node.title} ${node.subtitle || ''} ${node.badge || ''} ${node.entry?.speaker_name || ''}`.toLowerCase();
      return hay.includes(q);
    },
    [isSearchActive, nodeKindFilter, searchQuery]
  );

  const handleSaveInlineEntryEdit = async () => {
    if (!selectedEntry || !onEditEntry || !entryEditContent.trim()) return;
    try {
      setIsSavingEntryEdit(true);
      await onEditEntry(selectedEntry, { content: entryEditContent.trim() });
      setEditingEntryInline(false);
    } finally {
      setIsSavingEntryEdit(false);
    }
  };

  const handleCopyMarkdown = async () => {
    const md = buildMindMapMarkdown(
      project ? project.title : L('전체 프로젝트 자유 마인드맵', '全体フリーマインドマップ', 'Free Mind Map'),
      resolvedNodes.allOrdered,
      resolvedNodes.effectiveParentMap,
      customEdges,
      duplicateInitialEntryId
    );
    try {
      await navigator.clipboard.writeText(md);
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 1800);
    } catch {
      prompt(L('마크다운 복사:', 'Markdownコピー:', 'Copy Markdown:'), md);
    }
  };

  const handleExportPng = () => {
    const pngNodes = resolvedNodes.ordered.map((n) => ({
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      title: n.title,
      subtitle: n.subtitle,
      badge: n.badge,
      isRoot: n.kind === 'ROOT',
      accentColor: n.autoEdgeColor,
      fillColor:
        n.kind === 'ROOT'
          ? '#1B4D3E'
          : n.kind === 'IDEA' || n.kind === 'INTENT_PINNED'
          ? '#FFFBEB'
          : n.kind === 'NEXT_STEP'
          ? '#ECFDF5'
          : '#FFFFFF',
      borderColor: n.kind === 'ROOT' ? '#143B2F' : n.autoEdgeColor || '#D6D3C4',
      textColor: n.kind === 'ROOT' ? '#FFFFFF' : '#1F2937',
    }));

    const pngEdges: Array<{
      pathD: string;
      color: string;
      dashed?: boolean;
      strokeWidth?: number;
      label?: string;
      midX?: number;
      midY?: number;
    }> = [];

    for (const node of resolvedNodes.ordered) {
      if (!node.parentKey) continue;
      const parent = resolvedNodes.map.get(node.parentKey);
      if (!parent) continue;
      const { fromSide, toSide } = chooseFacingPorts(parent, node);
      const p1 = getPortCoords(parent.x, parent.y, parent.w, parent.h, fromSide);
      const p2 = getPortCoords(node.x, node.y, node.w, node.h, toSide);
      const { path } = buildDirectionalBezier(p1, fromSide, p2, toSide);
      pngEdges.push({
        pathD: path,
        color: node.autoEdgeColor,
        strokeWidth: 1.8,
      });
    }
    for (const edge of customEdges) {
      const fKey = remapMindMapKey(edge.fromKey, duplicateInitialEntryId);
      const tKey = remapMindMapKey(edge.toKey, duplicateInitialEntryId);
      const from = resolvedNodes.map.get(fKey);
      const to = resolvedNodes.map.get(tKey);
      if (!from || !to) continue;
      const p1 = getPortCoords(from.x, from.y, from.w, from.h, edge.fromSide);
      const p2 = getPortCoords(to.x, to.y, to.w, to.h, edge.toSide);
      const { path, midX, midY } = buildSmartFreeMapPath(
        p1,
        edge.fromSide,
        p2,
        edge.toSide,
        obstacleBoxes
      );
      pngEdges.push({
        pathD: path,
        color: edge.color || '#7C3AED',
        strokeWidth: 2.4,
        label: edge.label,
        midX,
        midY,
      });
    }

    const safeTitle = (project?.title || 'workspace-freemap').replace(/[\\/:*?"<>|]/g, '_');
    downloadMindMapAsPng(`${safeTitle}-freemap.png`, pngNodes, pngEdges);
  };

  // Cross-links defined via related_idea_ids (shown as subtle purple dashed wires unless already covered by a custom_edge)
  const relatedIdeaWires = useMemo(
    () => buildRelatedIdeaWires(ideas, customEdges, (k) => resolvedNodes.map.has(k)),
    [ideas, customEdges, resolvedNodes.map]
  );

  const obstacleBoxes = useMemo<ObstacleBox[]>(() => {
    const list: ObstacleBox[] = resolvedNodes.ordered.map((n) => ({
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
    }));
    if (!connectMode && !nestMode) {
      for (const btn of leafAddButtons) {
        list.push({
          x: btn.btnX,
          y: btn.btnY,
          w: btn.size,
          h: btn.size,
        });
      }
    }
    return list;
  }, [resolvedNodes.ordered, leafAddButtons, connectMode, nestMode]);

  const [isMobileViewport, setIsMobileViewport] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.matchMedia('(max-width: 1279px)').matches : false
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(max-width: 1279px)');
    const onChange = () => setIsMobileViewport(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return (
    <div className="bg-white rounded-xl border border-ivory-300 shadow-2xs overflow-hidden">
      {/* Toolbar */}
      <div className="px-3 py-2.5 bg-ivory-50 border-b border-ivory-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-900 min-w-0">
            <Move className="w-4 h-4 text-forest-700 shrink-0" />
            <span className="truncate">
              {project
                ? L(`자유 마인드맵 · ${project.title}`, `フリーマインドマップ · ${project.title}`, `Free Mind Map · ${project.title}`)
                : L('전체 자유 마인드맵', '全体フリーマインドマップ', 'Workspace Free Mind Map')}
            </span>
          </div>

          <span className="hidden xl:inline-flex items-center gap-1.5 text-[11px] font-bold text-charcoal-500 pl-2 border-l border-ivory-300 shrink-0">
            {L(
              '노드 드래그: 자유 이동 · 연결/종속은 우측 더 보기에서 켜기',
              'ノードドラッグ: 自由配置 · 接続/従属は右のメニューで切替',
              'Drag nodes to move · Toggle Connect / Nest in More menu'
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
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

          {(() => {
            const toolbarActions: TimelineCardActionItem[] = [];
            if (project && (onAddIdea || onAddEntry)) {
              toolbarActions.push({
                key: 'new-node',
                label: L('새 노드 / 기록', '新規ノード / 記録', 'New Node / Entry'),
                icon: <Plus className="w-3.5 h-3.5 text-forest-700" />,
                tone: 'emerald',
                onClick: () => openComposerForNode(null),
              });
            }
            if (project && onOpenProjectDetail) {
              toolbarActions.push({
                key: 'open-detail',
                label: L('프로젝트 상세 열기', 'プロジェクト詳細を開く', 'Open Project Detail'),
                icon: <ExternalLink className="w-3.5 h-3.5 text-charcoal-600" />,
                onClick: () => onOpenProjectDetail(project.id),
              });
            }
            toolbarActions.push(
              {
                key: 'connect',
                label: L('노드 연결', 'ノード接続', 'Connect Nodes'),
                icon: <Link2 className="w-3.5 h-3.5 text-violet-700" />,
                tone: 'violet',
                active: connectMode,
                badge: connectMode ? 'ON' : undefined,
                dividerBefore: toolbarActions.length > 0,
                onClick: () => {
                  setConnectMode((prev) => {
                    const next = !prev;
                    if (next) setNestMode(false);
                    return next;
                  });
                },
              },
              {
                key: 'nest',
                label: L('노드 종속', 'ノード従属', 'Nest Nodes'),
                icon: <CornerDownRight className="w-3.5 h-3.5 text-emerald-700" />,
                tone: 'emerald',
                active: nestMode,
                badge: nestMode ? 'ON' : undefined,
                onClick: () => {
                  setNestMode((prev) => {
                    const next = !prev;
                    if (next) setConnectMode(false);
                    return next;
                  });
                },
              },
              {
                key: 'move-subtree',
                label: L('하위 함께 이동', '子ノードも連動移動', 'Move Subtree Together'),
                icon: <GitBranch className="w-3.5 h-3.5 text-forest-700" />,
                tone: 'emerald',
                active: moveSubtreeWithParent,
                badge: moveSubtreeWithParent ? 'ON' : 'OFF',
                onClick: () => setMoveSubtreeWithParent((v) => !v),
              },
              {
                key: 'fit',
                label: L('전체 보기', '全体表示', 'Fit to Screen'),
                icon: <Maximize2 className="w-3.5 h-3.5 text-charcoal-600" />,
                dividerBefore: true,
                onClick: () => fitAllNodesInViewport('smooth'),
              },
              {
                key: 'center',
                label: L('중앙으로 이동', '中央ノードへ移動', 'Center on Root'),
                icon: <Crosshair className="w-3.5 h-3.5 text-charcoal-600" />,
                onClick: () => centerViewport('smooth'),
              },
              {
                key: 'reset-radial',
                label: L('방사형 재정렬', '放射状に再整列', 'Reset Radial Layout'),
                icon: <RotateCcw className="w-3.5 h-3.5 text-charcoal-600" />,
                onClick: handleResetRadialPositions,
              },
              {
                key: 'undo',
                label: L('되돌리기', '元に戻す', 'Undo'),
                icon: <Undo2 className="w-3.5 h-3.5 text-charcoal-600" />,
                disabled: undoStack.length === 0,
                dividerBefore: true,
                onClick: handleUndo,
              },
              {
                key: 'copy-md',
                label: copiedMd
                  ? L('마크다운 복사됨', 'Markdownコピー済', 'Markdown Copied')
                  : L('마크다운 복사', 'Markdownコピー', 'Copy Markdown'),
                icon: copiedMd ? (
                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-charcoal-600" />
                ),
                onClick: () => void handleCopyMarkdown(),
              },
              {
                key: 'export-png',
                label: L('PNG 이미지 저장', 'PNG画像として保存', 'Save as PNG'),
                icon: <Download className="w-3.5 h-3.5 text-charcoal-600" />,
                onClick: handleExportPng,
              }
            );
            return (
              <TimelineCardActionsMenu
                items={toolbarActions}
                hasActive={connectMode || nestMode}
              />
            );
          })()}
        </div>
      </div>

      {/* Compact Search, Filter & Fold Controls Bar */}
      {project && (
        <div className="px-3 py-1.5 bg-white border-b border-ivory-200 flex flex-wrap items-center justify-between gap-2 text-[11px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <div className="relative">
              <Search className="w-3 h-3 text-charcoal-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={L('노드 검색·하이라이트...', 'ノード検索...', 'Search nodes...')}
                className="pl-6 pr-6 py-1 rounded-lg bg-ivory-50 border border-ivory-300 text-[11px] font-medium text-charcoal-900 w-36 sm:w-44 focus:outline-none focus:ring-1 focus:ring-forest-500"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 text-charcoal-400 hover:text-charcoal-700"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            {(
              [
                { id: 'ALL', label: L('전체', 'すべて', 'All') },
                { id: 'DIALOGUE', label: L('💬 대화·완료', '💬 対話', '💬 Dialogue') },
                { id: 'IDEA', label: L('💡 아이디어', '💡 アイデア', '💡 Ideas') },
                { id: 'TOPIC', label: L('🎯 토픽·의도', '🎯 トピック', '🎯 Topics') },
              ] as const
            ).map((chip) => (
              <button
                key={chip.id}
                type="button"
                onClick={() => setNodeKindFilter(chip.id)}
                className={`px-2 py-0.5 rounded-full border font-bold transition ${
                  nodeKindFilter === chip.id
                    ? 'bg-forest-800 text-white border-forest-900'
                    : 'bg-ivory-50 text-charcoal-600 border-ivory-300 hover:bg-ivory-100'
                }`}
              >
                {chip.label}
              </button>
            ))}
          </div>
          {collapsedKeys.size > 0 && (
            <button
              type="button"
              onClick={() => setCollapsedKeys(new Set())}
              className="px-2 py-0.5 rounded-full bg-amber-50 border border-amber-300 text-amber-900 font-bold hover:bg-amber-100"
            >
              {L(`접힌 가지 모두 펼치기 (${collapsedKeys.size})`, `折りたたみ全解除 (${collapsedKeys.size})`, `Expand All (${collapsedKeys.size})`)}
            </button>
          )}
        </div>
      )}

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

      {/* Unified Timeline & Idea Node Composer */}
      {composerState.open && project && (onAddIdea || onAddEntry) && (
        <MindMapNodeComposer
          project={project}
          entries={entries}
          ideas={ideas}
          initialKind={composerState.initialKind}
          initialCompletedTarget={composerState.initialCompletedTarget}
          parentNodeKey={composerState.parentNodeKey}
          parentNodeTitle={composerState.parentNodeTitle}
          parentIdeaId={composerState.parentIdeaId}
          onAddIdea={onAddIdea}
          onAddEntry={onAddEntry}
          onSetNextStep={onSetNextStep}
          onCreatedNode={handleComposerCreatedNode}
          onClose={() => setComposerState((prev) => ({ ...prev, open: false }))}
        />
      )}

      {/* Interactive Dotted Grid Free Canvas */}
      <div
        ref={viewportRef}
        onPointerDown={(e) => {
          if (e.target === viewportRef.current || e.target === canvasRef.current) {
            selectAndSyncNode(null);
            setSelectedEdgeId(null);
            if (e.pointerType !== 'touch' && e.button === 0) {
              setPanning({
                startClientX: e.clientX,
                startClientY: e.clientY,
                scrollLeft: viewportRef.current?.scrollLeft || 0,
                scrollTop: viewportRef.current?.scrollTop || 0,
              });
            }
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
            width: resolvedNodes.canvasBounds.width * scale,
            height: resolvedNodes.canvasBounds.height * scale,
          }}
          className="relative"
        >
          <div
            ref={canvasRef}
            onPointerDown={(e) => {
              if (e.target === canvasRef.current) {
                selectAndSyncNode(null);
                setSelectedEdgeId(null);
                if (e.pointerType !== 'touch' && e.button === 0) {
                  setPanning({
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    scrollLeft: viewportRef.current?.scrollLeft || 0,
                    scrollTop: viewportRef.current?.scrollTop || 0,
                  });
                }
              }
            }}
            style={{
              width: resolvedNodes.canvasBounds.width,
              height: resolvedNodes.canvasBounds.height,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
            className="relative"
          >
            {/* SVG Edges Layer */}
            <svg
              width={resolvedNodes.canvasBounds.width}
              height={resolvedNodes.canvasBounds.height}
              className="absolute inset-0 pointer-events-none"
            >
              <g
                transform={`translate(${resolvedNodes.canvasBounds.offsetX}, ${resolvedNodes.canvasBounds.offsetY})`}
              >
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

              {/* 1b. Dashed Connectors to Trailing Leaf [+] Buttons */}
              {!connectMode &&
                !nestMode &&
                leafAddButtons.map((btn) => (
                  <line
                    key={`edge-${btn.key}`}
                    x1={btn.portX}
                    y1={btn.portY}
                    x2={btn.btnX + btn.size / 2}
                    y2={btn.btnY + btn.size / 2}
                    stroke={btn.edgeColor}
                    strokeWidth={1.8}
                    strokeDasharray="4 3"
                    strokeOpacity={0.65}
                  />
                ))}

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
                    const { path } = buildSmartFreeMapPath(p1, fromSide, p2, toSide, obstacleBoxes);
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
                const { path } = buildSmartFreeMapPath(p1, fromSide, p2, toSide, obstacleBoxes);
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

              {/* 4. Custom User-Dragged Port-to-Port Edges (Smart Bezier + Automatic Obstacle Detour) */}
              {customEdges.map((edge) => {
                const fromKey = remapMindMapKey(edge.fromKey, duplicateInitialEntryId);
                const toKey = remapMindMapKey(edge.toKey, duplicateInitialEntryId);
                const from = resolvedNodes.map.get(fromKey);
                const to = resolvedNodes.map.get(toKey);
                if (!from || !to) return null;
                const p1 = getPortCoords(from.x, from.y, from.w, from.h, edge.fromSide);
                const p2 = getPortCoords(to.x, to.y, to.w, to.h, edge.toSide);
                const { path, midX, midY } = buildSmartFreeMapPath(
                  p1,
                  edge.fromSide,
                  p2,
                  edge.toSide,
                  obstacleBoxes
                );
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
                    {edge.label ? (
                      <g
                        onClick={(ev) => {
                          ev.stopPropagation();
                          setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
                        }}
                      >
                        <rect
                          x={midX - Math.max(24, edge.label.length * 5.2 + 12)}
                          y={midY - 10}
                          width={Math.max(48, edge.label.length * 10.4 + 24)}
                          height={20}
                          rx={10}
                          fill={isEdgeSelected ? '#E11D48' : '#FFFFFF'}
                          stroke={isEdgeSelected ? '#9F1239' : edge.color || '#7C3AED'}
                          strokeWidth={1.6}
                        />
                        <text
                          x={midX}
                          y={midY + 3.5}
                          textAnchor="middle"
                          fontSize={10}
                          fontWeight="bold"
                          fill={isEdgeSelected ? '#FFFFFF' : '#1F2937'}
                        >
                          {edge.label}
                        </text>
                      </g>
                    ) : (
                      <>
                        <circle
                          cx={midX}
                          cy={midY}
                          r={isEdgeSelected ? 10 : 7}
                          fill={isEdgeSelected ? '#E11D48' : '#FFFFFF'}
                          stroke={isEdgeSelected ? '#9F1239' : edge.color || '#7C3AED'}
                          strokeWidth={1.8}
                          onClick={(ev) => {
                            ev.stopPropagation();
                            setSelectedEdgeId((prev) => (prev === edge.id ? null : edge.id));
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
                              setSelectedEdgeId(null);
                            }}
                          >
                            ✎
                          </text>
                        )}
                      </>
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
              </g>
            </svg>

            {/* Draggable Nodes + Conditional 4-Way Connection Port Dots */}
            {resolvedNodes.ordered.map((node) => {
              const isSelected = selectedNodeKey === node.key;
              const isDraggingThis = draggingNode?.key === node.key;
              const isWireSource = connectingWire?.fromKey === node.key;
              const isWireTargetNode = hoveredConnectTarget?.key === node.key;
              const isNestTargetNode = hoveredNestTargetKey === node.key;
              const descendantCount = resolvedNodes.descendantCountMap.get(node.key) || 0;
              const isCollapsed = collapsedKeys.has(node.key);
              const matchesFilter = doesNodeMatchFilter(node);
              const isHighlighted = highlightedNodeKey === node.key;
              const offX = resolvedNodes.canvasBounds.offsetX;
              const offY = resolvedNodes.canvasBounds.offsetY;

              return (
                <div
                  key={node.key}
                  style={{
                    left: node.x + offX,
                    top: node.y + offY,
                    width: node.w,
                    height: node.h,
                    WebkitTouchCallout: 'none',
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    e.stopPropagation();
                    const descOrig: Record<string, { x: number; y: number }> = {};
                    for (const cand of resolvedNodes.allOrdered) {
                      if (
                        cand.key !== node.key &&
                        isDescendantInParentMap(cand.key, node.key, resolvedNodes.effectiveParentMap)
                      ) {
                        descOrig[cand.key] = { x: cand.x, y: cand.y };
                      }
                    }
                    setDraggingNode({
                      key: node.key,
                      startClientX: e.clientX,
                      startClientY: e.clientY,
                      origX: node.x,
                      origY: node.y,
                      moved: false,
                      descendantOrigPositions: descOrig,
                      preDragPositions: { ...positionsRef.current },
                    });
                  }}
                  className={`group absolute rounded-xl border px-3 py-1.5 shadow-sm flex flex-col justify-center cursor-move touch-none select-none transition-shadow ${
                    node.bgClass
                  } ${node.borderClass} ${
                    isSelected ? 'ring-2 ring-gold-500 shadow-md z-30' : 'hover:shadow-md z-20'
                  } ${isDraggingThis ? 'shadow-lg z-40 opacity-90' : ''} ${
                    isWireTargetNode ? 'ring-2 ring-violet-500 bg-violet-50/40' : ''
                  } ${isNestTargetNode ? 'ring-2 ring-emerald-500 bg-emerald-50/70 scale-[1.03] z-30' : ''} ${
                    isSearchActive && !matchesFilter ? 'opacity-25' : ''
                  } ${
                    isSearchActive && matchesFilter && node.kind !== 'ROOT' ? 'ring-2 ring-amber-400' : ''
                  } ${isHighlighted ? 'ring-4 ring-amber-500 shadow-lg animate-pulse z-40' : ''}`}
                >
                  {/* Subtree Collapse / Expand Toggle Badge ([-] / [+N]) */}
                  {!connectMode && !nestMode && node.kind !== 'ROOT' && descendantCount > 0 && (
                    <button
                      type="button"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapseNode(node.key);
                      }}
                      title={
                        isCollapsed
                          ? L(`접힌 하위 노드 ${descendantCount}개 펼치기`, `子ノード ${descendantCount}件を展開`, `Expand ${descendantCount} hidden nodes`)
                          : L('하위 가지 접기', '子分岐を折りたたむ', 'Collapse branch')
                      }
                      className={`absolute -right-2.5 -top-2.5 z-30 h-5 px-1.5 rounded-full border text-[10px] font-mono font-bold shadow-xs transition flex items-center justify-center ${
                        isCollapsed
                          ? 'bg-amber-500 text-white border-amber-700 hover:bg-amber-600 scale-105'
                          : 'bg-white text-charcoal-600 border-ivory-400 opacity-0 group-hover:opacity-100 hover:bg-ivory-100'
                      }`}
                    >
                      {isCollapsed ? `+${descendantCount}` : '−'}
                    </button>
                  )}
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
                          className={`absolute ${posCls} w-3.5 h-3.5 rounded-full border-2 cursor-crosshair touch-none transition-all z-30 ${
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

            {/* Trailing Dashed [+] Add Buttons on Each Branch's Last Node */}
            {!connectMode &&
              !nestMode &&
              leafAddButtons.map((btn) => (
                <button
                  key={btn.key}
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    openComposerForNode(
                      btn.isRootSubtopicTrigger ? null : btn.parentNode,
                      { x: btn.spawnX, y: btn.spawnY },
                      Boolean(btn.isRootSubtopicTrigger)
                    );
                  }}
                  style={{
                    left: btn.btnX + resolvedNodes.canvasBounds.offsetX,
                    top: btn.btnY + resolvedNodes.canvasBounds.offsetY,
                    width: btn.size,
                    height: btn.size,
                  }}
                  title={
                    btn.isRootSubtopicTrigger
                      ? L(
                          '프로젝트 루트에서 새 독립 서브토픽 가지 추가',
                          'プロジェクトルートから新規サブトピック分岐を追加',
                          'Add new independent subtopic branch from Project Root'
                        )
                      : L(
                          `[${btn.parentNode.title}] 끝에 새 노드 추가`,
                          `「${btn.parentNode.title}」の先に新規追加`,
                          `Add node after "${btn.parentNode.title}"`
                        )
                  }
                  className={`absolute rounded-full border border-dashed bg-white/95 hover:text-white hover:border-solid hover:scale-110 shadow-xs flex items-center justify-center transition z-20 ${
                    btn.isRootSubtopicTrigger
                      ? 'border-purple-600 text-purple-800 hover:bg-purple-700'
                      : 'border-forest-500 text-forest-800 hover:bg-forest-800'
                  }`}
                >
                  <Plus className="w-3.5 h-3.5" />
                </button>
              ))}
          </div>
        </div>

        {/* Selected Custom Edge Label, Color & Delete Inspector Pill */}
        {selectedEdge && (
          <div className="sticky bottom-3 left-1/2 -translate-x-1/2 w-fit max-w-[95%] mx-auto z-40 px-3 py-2 rounded-2xl bg-charcoal-900 text-white text-xs font-bold shadow-xl flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1">
              {WIRE_COLOR_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleUpdateCustomEdge(selectedEdge.id, { color: c })}
                  className={`w-4 h-4 rounded-full border-2 transition ${
                    (selectedEdge.color || '#7C3AED') === c
                      ? 'border-white scale-115'
                      : 'border-transparent opacity-75 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                  title={L('연결선 색상 변경', '接続線の色を変更', 'Change wire color')}
                />
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleUpdateCustomEdge(selectedEdge.id, { label: wireLabelDraft });
              }}
              className="flex items-center gap-1"
            >
              <input
                type="text"
                value={wireLabelDraft}
                onChange={(e) => setWireLabelDraft(e.target.value)}
                placeholder={L('관계 메모 입력', '関係メモを入力', 'Enter label')}
                className="px-2 py-0.5 rounded bg-white text-charcoal-900 text-[11px] font-medium w-36 focus:outline-none"
              />
              <button
                type="submit"
                className="px-2 py-0.5 rounded bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-500"
              >
                {L('저장', '保存', 'Save')}
              </button>
            </form>
            <div className="hidden sm:flex items-center gap-1">
              {[
                L('원인', '原因', 'Cause'),
                L('참고', '参考', 'Ref'),
                L('블로커', '課題', 'Blocker'),
                L('파생', '派生', 'Derived'),
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setWireLabelDraft(preset);
                    handleUpdateCustomEdge(selectedEdge.id, { label: preset });
                  }}
                  className="px-1.5 py-0.5 rounded bg-white/15 hover:bg-white/25 text-[10px] font-bold"
                >
                  {preset}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => handleDeleteCustomEdge(selectedEdge.id)}
              className="px-2 py-0.5 rounded bg-rose-600 text-white font-bold hover:bg-rose-500"
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
      {(() => {
        const renderSelectedNodeInspector = () => {
          if (!selectedNode) return null;
          return (
            <>
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
                <span className="font-bold text-sm text-charcoal-900">
                  {tr.getText(`jfmm-${selectedNode.key}`, 'title', selectedNode.title)}
                </span>
                <TranslateButton
                  size="xs"
                  visible={tr.shouldShowButton(selectedNode.title, selectedNode.subtitle)}
                  translated={tr.isTranslated(`jfmm-${selectedNode.key}`)}
                  loading={tr.isTranslating(`jfmm-${selectedNode.key}`)}
                  error={tr.getError(`jfmm-${selectedNode.key}`)}
                  onClick={() =>
                    tr.toggleTranslate(
                      `jfmm-${selectedNode.key}`,
                      {
                        title: selectedNode.title || '',
                        subtitle: selectedNode.subtitle || '',
                      },
                      'journal'
                    )
                  }
                />
              </div>
              {editingEntryInline && selectedEntry ? (
                <div className="space-y-1.5 pt-1">
                  <textarea
                    rows={3}
                    autoFocus
                    value={entryEditContent}
                    onChange={(e) => setEntryEditContent(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                        e.preventDefault();
                        void handleSaveInlineEntryEdit();
                      }
                    }}
                    className="w-full p-2 bg-white border border-forest-400 rounded-lg text-xs text-charcoal-900 focus:outline-none focus:ring-2 focus:ring-forest-500/40"
                  />
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      disabled={isSavingEntryEdit || !entryEditContent.trim()}
                      onClick={() => void handleSaveInlineEntryEdit()}
                      className="px-2.5 py-1 rounded-lg bg-forest-800 text-white font-bold hover:bg-forest-900 disabled:opacity-50"
                    >
                      {L('수정 저장 (Ctrl+Enter)', '変更を保存', 'Save (Ctrl+Enter)')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingEntryInline(false)}
                      className="px-2.5 py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 font-bold hover:bg-ivory-100"
                    >
                      {L('취소', 'キャンセル', 'Cancel')}
                    </button>
                  </div>
                </div>
              ) : (
                selectedNode.subtitle && (
                  <p className="text-charcoal-700 whitespace-pre-wrap">
                    {tr.getText(`jfmm-${selectedNode.key}`, 'subtitle', selectedNode.subtitle)}
                  </p>
                )
              )}
              {parentOverrides[selectedNode.key] && (
                <div className="flex items-center gap-2 pt-1">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 text-[11px] font-bold">
                    <CornerDownRight className="w-3 h-3" />
                    {parentOverrides[selectedNode.key] === ROOT_SUBTOPIC_KEY
                      ? L('🌿 루트 직결 독립 서브토픽', '🌿 ルート直結サブトピック', '🌿 Root Subtopic')
                      : `${L('종속 상위:', '従属親:', 'Nested under:')} ${
                          resolvedNodes.map.get(
                            remapMindMapKey(parentOverrides[selectedNode.key], duplicateInitialEntryId)
                          )?.title || ''
                        }`}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDetachNodeToRoot(selectedNode.key)}
                    className="px-2 py-0.5 rounded-lg bg-white border border-ivory-300 text-charcoal-700 font-bold text-[11px] hover:bg-ivory-100"
                  >
                    {L('원래 위치로 분리', '元の位置へ戻す', 'Detach to Default')}
                  </button>
                </div>
              )}
            </div>
            {!isMobileViewport && (
              <button
                type="button"
                onClick={() => selectAndSyncNode(null)}
                className="p-1 rounded-lg hover:bg-ivory-200 text-charcoal-500"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {project && (onAddIdea || onAddEntry) && selectedNode.kind !== 'ROOT' && selectedNode.kind !== 'PROJECT_CARD' && (
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-1.5 pt-2 border-t border-ivory-200">
              <button
                type="button"
                onClick={() => openComposerForNode(selectedNode)}
                className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-forest-800 text-white font-bold hover:bg-forest-900 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{L('이 노드에서 가지 뻗기', 'ここから分岐を追加', 'Add Child Node')}</span>
              </button>
              {parentOverrides[selectedNode.key] !== ROOT_SUBTOPIC_KEY && (
                <button
                  type="button"
                  onClick={() => {
                    pushUndoSnapshot();
                    const nextParents = {
                      ...parentOverrides,
                      [selectedNode.key]: ROOT_SUBTOPIC_KEY,
                    };
                    setParentOverrides(nextParents);
                    persistLayout(positions, customEdges, nextParents);
                  }}
                  className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-purple-300 text-purple-800 font-bold hover:bg-purple-50 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                >
                  <span aria-hidden="true" className="shrink-0">🌿</span>
                  <span>{L('루트 서브토픽으로 분리', 'ルートサブトピック化', 'Make Root Subtopic')}</span>
                </button>
              )}
              {onJumpToTimeline && (selectedEntry || selectedIdea) && (
                <button
                  type="button"
                  onClick={() => onJumpToTimeline(selectedNode.key)}
                  className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-sky-300 text-sky-900 font-bold hover:bg-sky-50 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                >
                  <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                  <span>{L('타임라인에서 보기', 'タイムラインで見る', 'View in Timeline')}</span>
                </button>
              )}
              {selectedEntry && (
                <>
                  {onEditEntry && Number(selectedEntry.author_id) === Number(currentUserId) && (
                    <button
                      type="button"
                      onClick={() => {
                        setEntryEditContent(selectedEntry.content);
                        setEditingEntryInline((prev) => !prev);
                      }}
                      className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-800 font-bold hover:bg-ivory-100 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                    >
                      <Edit2 className="w-3.5 h-3.5 shrink-0" />
                      <span>{L('내용 수정', '内容を編集', 'Edit')}</span>
                    </button>
                  )}
                  {onAddEntry && selectedEntry.entry_type !== 'PROGRESS' && (
                    <button
                      type="button"
                      onClick={() =>
                        openComposerForNode(selectedNode, null, false, 'PROGRESS', `ENTRY:${selectedEntry.id}`)
                      }
                      className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                      <span>{L('완료 기록', '完了記録', 'Mark Done')}</span>
                    </button>
                  )}
                  {onPromoteEntryToNextStep &&
                    !isTopicMilestoneEntry(selectedEntry) &&
                    !isCurrentFocusIntentEntry(selectedEntry) && (
                      <button
                        type="button"
                        onClick={() => void onPromoteEntryToNextStep(selectedEntry)}
                        className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-amber-500 text-white font-bold hover:bg-amber-600 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                      >
                        <Sparkles className="w-3.5 h-3.5 shrink-0" />
                        <span>{L('다음 할 일(토픽) 승격', 'Next Step昇格', 'Promote to Topic')}</span>
                      </button>
                    )}
                  {onDeleteEntry &&
                    (Number(selectedEntry.author_id) === Number(currentUserId) ||
                      Number(project.created_by) === Number(currentUserId)) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            !confirm(
                              L(
                                '이 기록을 삭제하시겠습니까? 하위 노드는 자동으로 상위 가지에 이어집니다.',
                                'この記録を削除しますか？（子ノードは自動的に親へ引き継がれます）',
                                'Delete this log? Child nodes will automatically re-attach to its parent.'
                              )
                            )
                          ) {
                            return;
                          }
                          void onDeleteEntry(selectedEntry.id);
                          selectAndSyncNode(null);
                        }}
                        className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-rose-200 text-rose-700 font-bold hover:bg-rose-50 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                      >
                        <Trash2 className="w-3.5 h-3.5 shrink-0" />
                        <span>{L('삭제', '削除', 'Delete')}</span>
                      </button>
                    )}
                </>
              )}
              {selectedIdea && onPromoteIdea && selectedIdea.status !== 'PROMOTED' && (
                <button
                  type="button"
                  onClick={() => void onPromoteIdea(selectedIdea)}
                  className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                >
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span>{L('Next Step 승격', 'Next Stepへ昇格', 'Promote to Next Step')}</span>
                </button>
              )}
              {selectedIdea && onUpdateIdeaStatus && (
                <button
                  type="button"
                  onClick={() =>
                    void onUpdateIdeaStatus(
                      selectedIdea,
                      selectedIdea.status === 'ARCHIVED' ? 'OPEN' : 'ARCHIVED'
                    )
                  }
                  className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 font-bold hover:bg-ivory-100 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                >
                  <Archive className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {selectedIdea.status === 'ARCHIVED'
                      ? L('다시 열기', '再開', 'Reopen')
                      : L('보관', '保管', 'Archive')}
                  </span>
                </button>
              )}
              {selectedIdea && onDeleteIdea && (
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
                    selectAndSyncNode(null);
                  }}
                  className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-rose-200 text-rose-700 font-bold hover:bg-rose-50 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
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
            </>
          );
        };

        return (
          <>
            {!isMobileViewport && selectedNode && (
              <div className="p-3.5 bg-ivory-50 border-t border-ivory-300 space-y-2 text-xs">
                {renderSelectedNodeInspector()}
              </div>
            )}
            <MobileNodeBottomSheet
              isOpen={isMobileViewport && Boolean(selectedNode)}
              onClose={() => selectAndSyncNode(null)}
              title={L('노드 상세', 'ノード詳細', 'Node Detail')}
            >
              {selectedNode && (
                <div className="p-3.5 space-y-2 text-xs">
                  {renderSelectedNodeInspector()}
                </div>
              )}
            </MobileNodeBottomSheet>
          </>
        );
      })()}
    </div>
  );
};
