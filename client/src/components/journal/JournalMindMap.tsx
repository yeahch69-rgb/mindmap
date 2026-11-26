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
  Download,
  Edit2,
  ExternalLink,
  GitBranch,
  Link2,
  Lock,
  MessageSquare,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Unlink,
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
  buildObstacleAvoidingPath,
  buildRelatedIdeaWires,
  chooseSmartLeftRightPorts,
  cleanTopicMilestoneTitle,
  computeSubtreeCollapseState,
  computeTopicAndDialogueDefaultParents,
  downloadMindMapAsPng,
  findDuplicateInitialIntentEntryId,
  getDefaultComposerKindForNode,
  getPortCoords,
  getWsFreeMindMapStorageKey,
  isCurrentFocusIntentEntry,
  isTopicMilestoneEntry,
  remapMindMapKey,
  wouldCycleInParentMap,
} from './mindmapUtils';
import { MindMapNodeComposer } from './MindMapNodeComposer';

interface JournalMindMapProps {
  /** Single-project mode when provided; workspace overview mode when null */
  project: JournalProject | null;
  entries?: JournalEntry[];
  ideas?: JournalIdea[];
  /** Workspace overview mode project list */
  allProjects?: JournalProject[];
  currentUserId?: number;
  /** Select a project inside global Mind Map view */
  onFocusProject?: (projectId: number | null) => void;
  /** Open full project detail view */
  onOpenProjectDetail?: (projectId: number) => void;
  /** Persist shared custom_edges + parent_overrides while preserving FreeMindMap positions */
  onSaveLayout?: (projectId: number, layout: MindMapLayoutData) => Promise<void>;
  /** Idea & Entry CRUD callbacks (required for interactive editing in single-project mode) */
  onAddIdea?: (payload: CreateJournalIdeaPayload) => Promise<JournalIdea | null | void>;
  onAddEntry?: (payload: CreateJournalEntryPayload) => Promise<JournalEntry | null | void>;
  onEditEntry?: (entry: JournalEntry, updates: { content: string; speaker_name?: string | null }) => Promise<void>;
  onDeleteEntry?: (entryId: number) => Promise<void>;
  onPromoteEntryToNextStep?: (entry: JournalEntry) => Promise<void>;
  onSetNextStep?: (projectId: number, nextAction: string, nextActionDate: string | null) => Promise<void>;
  onToggleRelatedIdea?: (ideaId: number, targetIdeaId: number, projectId: number) => Promise<void>;
  onPromoteIdea?: (idea: JournalIdea) => Promise<void>;
  onUpdateIdeaStatus?: (idea: JournalIdea, status: IdeaStatus) => Promise<void>;
  onDeleteIdea?: (idea: JournalIdea) => Promise<void>;
  /** Jump to a specific card in Timeline tab */
  onJumpToTimeline?: (targetKey: string) => void;
  /** External request to select & center a specific node (e.g. jumped from Timeline or synced across Mind Map tabs) */
  focusNodeKey?: string | null;
  onSelectNodeKey?: (key: string | null) => void;
  onConsumedFocusNode?: () => void;
}

type NodeKind =
  | 'ROOT'
  | 'HUB'
  | 'INTENT_PINNED'
  | 'ENTRY'
  | 'IDEA'
  | 'NEXT_STEP'
  | 'ADD_HINT'
  | 'PROJECT_LEAF';

interface TreeNodeDef {
  key: string;
  w: number;
  h: number;
  defaultParentKey?: string;
  homeHubKey?: string;
  edgeColor: string;
  kind: NodeKind;
  title: string;
  subtitle?: string;
  badge?: string;
  accentColor: string;
  bgClass: string;
  borderClass: string;
  idea?: JournalIdea;
  entry?: JournalEntry;
  projectItem?: JournalProject;
}

interface PositionedNode extends TreeNodeDef {
  x: number;
  y: number;
  parentKey?: string;
}

const ZOOM_LEVELS = [0.75, 0.9, 1, 1.15, 1.3];

export const JournalMindMap: React.FC<JournalMindMapProps> = ({
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
  onToggleRelatedIdea,
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

  const [zoomIdx, setZoomIdx] = useState(2); // 1.0 default
  const scale = ZOOM_LEVELS[zoomIdx] || 1;

  const wsStorageKey = getWsFreeMindMapStorageKey(currentUserId);

  const [customEdges, setCustomEdges] = useState<FreeMapEdge[]>([]);
  const [parentOverrides, setParentOverrides] = useState<Record<string, string>>({});
  const [undoStack, setUndoStack] = useState<
    Array<{ customEdges: FreeMapEdge[]; parentOverrides: Record<string, string> }>
  >([]);
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => new Set());
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

  // Inline entry editing in Mind Map inspector bar
  const [editingEntryInline, setEditingEntryInline] = useState(false);
  const [entryEditContent, setEntryEditContent] = useState('');
  const [isSavingEntryEdit, setIsSavingEntryEdit] = useState(false);

  // 2-Click source for Node Nesting & Node Connection
  const [nestSourceKey, setNestSourceKey] = useState<string | null>(null);
  const [connectPendingSource, setConnectPendingSource] = useState<{
    key: string;
    side?: PortSide;
  } | null>(null);

  // Drag-and-drop Ghost state for Node Nesting
  const [draggingNest, setDraggingNest] = useState<{
    key: string;
    startClientX: number;
    startClientY: number;
    origX: number;
    origY: number;
    grabOffsetX: number;
    grabOffsetY: number;
    pointerX: number;
    pointerY: number;
    moved: boolean;
  } | null>(null);

  // Drag-or-click Port Wire state for Node Connection
  const [connectingWire, setConnectingWire] = useState<{
    fromKey: string;
    fromSide: PortSide;
    startClientX: number;
    startClientY: number;
    pointerX: number;
    pointerY: number;
    moved: boolean;
  } | null>(null);

  // Quick Unified Node Composer state inside Mind Map
  const [composerState, setComposerState] = useState<{
    open: boolean;
    initialKind: EntryType | 'IDEA';
    initialCompletedTarget: string;
    parentNodeKey: string | null;
    parentNodeTitle: string | null;
    parentIdeaId: number | null;
  }>({
    open: false,
    initialKind: 'IDEA',
    initialCompletedTarget: '',
    parentNodeKey: null,
    parentNodeTitle: null,
    parentIdeaId: null,
  });

  // Hydrate shared custom_edges + parent_overrides from project.mindmap_layout or localStorage
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
    setNestSourceKey(null);
    setConnectPendingSource(null);
    setConnectingWire(null);
    setDraggingNest(null);

    if (project) {
      setCustomEdges(project.mindmap_layout?.custom_edges || []);
      setParentOverrides(project.mindmap_layout?.parent_overrides || {});
    } else {
      try {
        const raw = localStorage.getItem(wsStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          setCustomEdges(Array.isArray(parsed?.custom_edges) ? parsed.custom_edges : []);
          setParentOverrides(
            parsed?.parent_overrides && typeof parsed.parent_overrides === 'object'
              ? parsed.parent_overrides
              : {}
          );
          return;
        }
      } catch {
        // ignore invalid storage
      }
      setCustomEdges([]);
      setParentOverrides({});
    }
  }, [project?.id, project?.mindmap_layout, wsStorageKey]);

  const persistLayout = useCallback(
    (nextEdges: FreeMapEdge[], nextParents: Record<string, string>) => {
      if (project && onSaveLayout) {
        void onSaveLayout(project.id, {
          positions: project.mindmap_layout?.positions || {},
          custom_edges: nextEdges,
          parent_overrides: nextParents,
        });
      } else if (!project) {
        try {
          let existingPositions: Record<string, { x: number; y: number }> = {};
          const raw = localStorage.getItem(wsStorageKey);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed?.positions && typeof parsed.positions === 'object') {
              existingPositions = parsed.positions;
            }
          }
          localStorage.setItem(
            wsStorageKey,
            JSON.stringify({
              positions: existingPositions,
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

  const getTurnMeta = (turn: TurnState) => {
    if (turn === 'MY_TURN') {
      return {
        label: L('내 턴', '自分ターン', 'My Turn'),
        color: '#E11D48',
        bg: 'bg-rose-50',
        border: 'border-rose-300',
      };
    }
    if (turn === 'THEIR_TURN') {
      return {
        label: L('상대 대기', '相手待ち', 'Waiting'),
        color: '#0284C7',
        bg: 'bg-sky-50',
        border: 'border-sky-300',
      };
    }
    if (turn === 'HOLD') {
      return {
        label: L('보류', '保留', 'Hold'),
        color: '#D97706',
        bg: 'bg-amber-50',
        border: 'border-amber-300',
      };
    }
    return {
      label: L('완료', '完了', 'Done'),
      color: '#059669',
      bg: 'bg-emerald-50',
      border: 'border-emerald-300',
    };
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

  // Keys referenced in shared customEdges or parentOverrides (ensure older referenced entries stay visible)
  const referencedKeys = useMemo(() => {
    const s = new Set<string>();
    for (const e of customEdges) {
      s.add(remapMindMapKey(e.fromKey, duplicateInitialEntryId));
      s.add(remapMindMapKey(e.toKey, duplicateInitialEntryId));
    }
    for (const [k, v] of Object.entries(parentOverrides)) {
      s.add(remapMindMapKey(k, duplicateInitialEntryId));
      s.add(remapMindMapKey(v, duplicateInitialEntryId));
    }
    return s;
  }, [customEdges, parentOverrides, duplicateInitialEntryId]);

  // Compute Left-to-Right Hierarchical Layout with universal recursive nesting
  const layout = useMemo(() => {
    const nodes: PositionedNode[] = [];
    const promotedLinks: Array<{ fromKey: string; toKey: string }> = [];
    const V_GAP = 26;
    const CHILD_GAP_X = 68;

    // Helper: Build tree children map from defs + parentOverrides
    const resolveHierarchy = (defs: TreeNodeDef[], rootKey: string) => {
      const defMap = new Map<string, TreeNodeDef>();
      for (const d of defs) defMap.set(d.key, d);

      const effectiveParentMap = new Map<string, string | undefined>();
      for (const d of defs) {
        effectiveParentMap.set(d.key, d.defaultParentKey);
      }
      for (const d of defs) {
        if (d.kind === 'ROOT' || d.kind === 'HUB' || d.kind === 'ADD_HINT') continue;
        const rawOv = parentOverrides[d.key];
        if (!rawOv) continue;
        const ov = remapMindMapKey(rawOv, duplicateInitialEntryId);
        if (ov === ROOT_SUBTOPIC_KEY) {
          effectiveParentMap.set(d.key, rootKey);
          continue;
        }
        if (ov === rootKey) {
          // Detach to node's natural top-level hub
          effectiveParentMap.set(d.key, d.homeHubKey || d.defaultParentKey);
          continue;
        }
        if (
          defMap.has(ov) &&
          ov !== d.key &&
          !wouldCycleInParentMap(d.key, ov, effectiveParentMap)
        ) {
          effectiveParentMap.set(d.key, ov);
        }
      }

      const childrenByParent = new Map<string, TreeNodeDef[]>();
      for (const d of defs) {
        const pk = effectiveParentMap.get(d.key);
        if (!pk) continue;
        const arr = childrenByParent.get(pk) || [];
        arr.push(d);
        childrenByParent.set(pk, arr);
      }

      return { defMap, effectiveParentMap, childrenByParent };
    };

    const createSubtreePlacer = (
      childrenByParent: Map<string, TreeNodeDef[]>,
      effectiveParentMap: Map<string, string | undefined>,
      onPlacedWidth: (rightEdge: number) => void
    ) => {
      const subtreeHCache = new Map<string, number>();

      const calcSubtreeH = (node: TreeNodeDef, visited: Set<string>): number => {
        if (visited.has(node.key)) return node.h;
        if (collapsedKeys.has(node.key)) {
          subtreeHCache.set(node.key, node.h);
          return node.h;
        }
        const nextVisited = new Set(visited);
        nextVisited.add(node.key);

        const kids = (childrenByParent.get(node.key) || []).filter((k) => !nextVisited.has(k.key));
        if (kids.length === 0) {
          subtreeHCache.set(node.key, node.h);
          return node.h;
        }
        let sum = 0;
        kids.forEach((k, idx) => {
          sum += calcSubtreeH(k, nextVisited);
          if (idx < kids.length - 1) sum += V_GAP;
        });
        const total = Math.max(node.h, sum);
        subtreeHCache.set(node.key, total);
        return total;
      };

      const placeSubtree = (
        node: TreeNodeDef,
        x: number,
        topY: number,
        visited: Set<string>
      ) => {
        if (visited.has(node.key)) return;
        const nextVisited = new Set(visited);
        nextVisited.add(node.key);

        const totalH = subtreeHCache.get(node.key) || node.h;
        const y = topY + (totalH - node.h) / 2;
        onPlacedWidth(x + node.w + 80);

        nodes.push({
          ...node,
          x,
          y,
          parentKey: effectiveParentMap.get(node.key),
        });

        if (collapsedKeys.has(node.key)) return;

        const kids = (childrenByParent.get(node.key) || []).filter((k) => !nextVisited.has(k.key));
        let childTop = topY;
        const nextX = x + node.w + CHILD_GAP_X;
        for (const k of kids) {
          const kidH = subtreeHCache.get(k.key) || k.h;
          placeSubtree(k, nextX, childTop, nextVisited);
          childTop += kidH + V_GAP;
        }
      };

      return { calcSubtreeH, placeSubtree, subtreeHCache };
    };

    // ---------------------------------------------------------
    // MODE A: WORKSPACE OVERVIEW MIND MAP (ALL PROJECTS)
    // ---------------------------------------------------------
    if (!project) {
      const turnBuckets: TurnState[] = ['MY_TURN', 'THEIR_TURN', 'HOLD', 'DONE'];
      const grouped = new Map<TurnState, JournalProject[]>();
      turnBuckets.forEach((t) => grouped.set(t, []));
      for (const p of allProjects) {
        const list = grouped.get(p.turn_state) || grouped.get('MY_TURN')!;
        list.push(p);
      }

      const activeBuckets = turnBuckets.filter((t) => (grouped.get(t)?.length || 0) > 0);
      if (activeBuckets.length === 0) {
        return {
          nodes: [],
          nodeMap: new Map<string, PositionedNode>(),
          effectiveParentMap: new Map<string, string | undefined>(),
          descendantCountMap: new Map<string, number>(),
          promotedLinks,
          leafAddButtons: [] as Array<{
            key: string;
            parentNode: PositionedNode;
            isRootSubtopicTrigger?: boolean;
            portX: number;
            portY: number;
            x: number;
            y: number;
            size: number;
          }>,
          width: 700,
          height: 240,
        };
      }

      const LEAF_H = 66;
      const HUB_H = 48;
      const defs: TreeNodeDef[] = [];

      for (const t of activeBuckets) {
        const meta = getTurnMeta(t);
        const items = grouped.get(t) || [];
        defs.push({
          key: `hub-${t}`,
          w: 180,
          h: HUB_H,
          defaultParentKey: 'ws-root',
          edgeColor: meta.color,
          kind: 'HUB',
          title: `${meta.label} (${items.length})`,
          accentColor: meta.color,
          bgClass: meta.bg,
          borderClass: meta.border,
        });
        for (const p of items) {
          defs.push({
            key: `proj-${p.id}`,
            w: 270,
            h: LEAF_H,
            defaultParentKey: `hub-${t}`,
            homeHubKey: `hub-${t}`,
            edgeColor: meta.color,
            kind: 'PROJECT_LEAF',
            title: p.title,
            subtitle: p.next_action || p.intent_summary || L('Next Step 미지정', 'Next Step未定', 'No next step'),
            badge: p.is_stale
              ? `D+${p.days_since_update} · 💡${p.open_idea_count ?? 0}`
              : `💬${p.entry_count ?? 0} · 💡${p.open_idea_count ?? 0}`,
            accentColor: p.color || meta.color,
            bgClass: p.is_stale ? 'bg-rose-50/70' : 'bg-white',
            borderClass: p.is_stale ? 'border-rose-300' : 'border-ivory-300',
            projectItem: p,
          });
        }
      }

      const { effectiveParentMap, childrenByParent } = resolveHierarchy(defs, 'ws-root');
      let maxCanvasX = 860;
      const { calcSubtreeH, placeSubtree, subtreeHCache } = createSubtreePlacer(
        childrenByParent,
        effectiveParentMap,
        (right) => {
          maxCanvasX = Math.max(maxCanvasX, right);
        }
      );

      let cursorY = 28;
      const hubPositions: Array<{ y: number }> = [];

      for (const t of activeBuckets) {
        const hubDef = defs.find((d) => d.key === `hub-${t}`)!;
        const directKids = childrenByParent.get(hubDef.key) || [];
        let branchSum = 0;
        directKids.forEach((kid, idx) => {
          branchSum += calcSubtreeH(kid, new Set());
          if (idx < directKids.length - 1) branchSum += V_GAP;
        });
        const branchHeight = Math.max(HUB_H, branchSum);
        const hubY = cursorY + (branchHeight - HUB_H) / 2;
        hubPositions.push({ y: hubY });

        let leafCursorY = cursorY;
        for (const kid of directKids) {
          const kidH = subtreeHCache.get(kid.key) || kid.h;
          placeSubtree(kid, 530, leafCursorY, new Set());
          leafCursorY += kidH + V_GAP;
        }

        nodes.push({
          ...hubDef,
          x: 280,
          y: hubY,
          parentKey: 'ws-root',
        });

        cursorY += branchHeight + 28;
      }

      const totalH = Math.max(260, cursorY);
      const firstHubY = hubPositions[0].y + HUB_H / 2;
      const lastHubY = hubPositions[hubPositions.length - 1].y + HUB_H / 2;
      const rootH = 64;
      const rootY = (firstHubY + lastHubY) / 2 - rootH / 2;

      nodes.push({
        key: 'ws-root',
        x: 28,
        y: rootY,
        w: 195,
        h: rootH,
        edgeColor: '#1B4D3E',
        kind: 'ROOT',
        title: L('프로젝트 저널 맵', 'プロジェクト全体マップ', 'Project Journal Map'),
        subtitle: L(`총 ${allProjects.length}개 진행 중`, `計 ${allProjects.length}件`, `${allProjects.length} projects`),
        accentColor: '#1B4D3E',
        bgClass: 'bg-forest-800 text-white',
        borderClass: 'border-forest-900',
      });

      const nodeMap = new Map<string, PositionedNode>();
      for (const n of nodes) nodeMap.set(n.key, n);

      const wsCollapse = computeSubtreeCollapseState(
        defs.map((d) => d.key),
        effectiveParentMap,
        collapsedKeys
      );

      return {
        nodes,
        nodeMap,
        effectiveParentMap,
        descendantCountMap: wsCollapse.descendantCountMap,
        promotedLinks,
        leafAddButtons: [] as Array<{
          key: string;
          parentNode: PositionedNode;
          isRootSubtopicTrigger?: boolean;
          portX: number;
          portY: number;
          x: number;
          y: number;
          size: number;
        }>,
        width: maxCanvasX,
        height: totalH,
      };
    }

    // ---------------------------------------------------------
    // MODE B: SINGLE-PROJECT UNIVERSAL RECURSIVE TREE MIND MAP
    // ---------------------------------------------------------
    const turnMeta = getTurnMeta(project.turn_state);
    const HUB_X = 295;
    const HUB_W = 180;
    const HUB_H = 44;
    const LEAF_X = 540;
    const LEAF_W = 230;
    const LEAF_H = 60;
    const IDEA_W = 225;
    const IDEA_H = 66;
    const NEXT_H = 62;
    const SECTION_GAP = 34;

    const defs: TreeNodeDef[] = [];

    // 4 Hubs
    defs.push({
      key: 'hub-intent',
      w: HUB_W,
      h: HUB_H,
      defaultParentKey: 'proj-root',
      edgeColor: '#D97706',
      kind: 'HUB',
      title: L('🧭 의도 · 결정 맥락', '🧭 意図・決定文脈', '🧭 Intent & Decisions'),
      accentColor: '#D97706',
      bgClass: 'bg-amber-50',
      borderClass: 'border-amber-300',
    });

    defs.push({
      key: 'hub-dialogue',
      w: HUB_W,
      h: HUB_H,
      defaultParentKey: 'proj-root',
      edgeColor: '#0284C7',
      kind: 'HUB',
      title: L(`💬 대화 · 진행 (${entries.length})`, `💬 対話・進捗 (${entries.length})`, `💬 Dialogue (${entries.length})`),
      accentColor: '#0284C7',
      bgClass: 'bg-sky-50',
      borderClass: 'border-sky-300',
    });

    defs.push({
      key: 'hub-ideas',
      w: HUB_W,
      h: HUB_H,
      defaultParentKey: 'proj-root',
      edgeColor: '#B45309',
      kind: 'HUB',
      title: L(`💡 아이디어 가지 (${ideas.length})`, `💡 アイデア分岐 (${ideas.length})`, `💡 Idea Tree (${ideas.length})`),
      accentColor: '#B45309',
      bgClass: 'bg-amber-50',
      borderClass: 'border-amber-400',
    });

    defs.push({
      key: 'hub-next',
      w: HUB_W,
      h: HUB_H,
      defaultParentKey: 'proj-root',
      edgeColor: project.next_action ? '#059669' : '#E11D48',
      kind: 'HUB',
      title: L('🎯 다음 할 일 (Next)', '🎯 次の行動 (Next)', '🎯 Next Step'),
      accentColor: project.next_action ? '#059669' : '#E11D48',
      bgClass: project.next_action ? 'bg-emerald-50' : 'bg-rose-50',
      borderClass: project.next_action ? 'border-emerald-300' : 'border-rose-300',
    });

    // 1. Pinned Initial Intent + Current Focus Revisions + Pure INTENT Entries
    const initialIntentText = (project.initial_intent_summary || project.intent_summary || '').trim();
    if (initialIntentText) {
      defs.push({
        key: 'intent-pinned',
        w: LEAF_W,
        h: LEAF_H,
        defaultParentKey: 'hub-intent',
        homeHubKey: 'hub-intent',
        edgeColor: '#D97706',
        kind: 'INTENT_PINNED',
        title: L('🧭 최초 의도 (Pinned)', '🧭 当初の目的 (Pinned)', '🧭 Pinned Intent'),
        subtitle: initialIntentText,
        accentColor: '#D97706',
        bgClass: 'bg-white',
        borderClass: 'border-amber-200',
      });
    }

    // Current Focus ('현재 방향 · 핵심 메모') revisions nested sequentially under 'intent-pinned'
    const focusIntentEntries = [...entries]
      .filter(isCurrentFocusIntentEntry)
      .sort((a, b) => a.id - b.id);
    focusIntentEntries.forEach((fEn, fIdx) => {
      const isLatestFocus = fIdx === focusIntentEntries.length - 1;
      const fKey = `entry-${fEn.id}`;
      const defaultParent =
        fIdx === 0
          ? initialIntentText
            ? 'intent-pinned'
            : 'hub-intent'
          : `entry-${focusIntentEntries[fIdx - 1].id}`;
      defs.push({
        key: fKey,
        w: LEAF_W,
        h: LEAF_H,
        defaultParentKey: defaultParent,
        homeHubKey: 'hub-intent',
        edgeColor: '#B45309',
        kind: 'ENTRY',
        title: isLatestFocus
          ? L('🧭 현재 방향 · 핵심 메모', '🧭 現在の方針・メモ', '🧭 Current Focus')
          : `${fEn.entry_date ? `${fEn.entry_date.slice(5)} · ` : ''}${L('🧭 이전 방향 · 메모', '🧭 以前の方針', '🧭 Previous Focus')}`,
        subtitle: fEn.content,
        badge: isLatestFocus
          ? L('현재 방향', '現在方針', 'Current')
          : L(`방향 ${fIdx + 1}`, `方針${fIdx + 1}`, `Focus ${fIdx + 1}`),
        accentColor: '#B45309',
        bgClass: isLatestFocus ? 'bg-amber-100/80' : 'bg-amber-50/75',
        borderClass: isLatestFocus ? 'border-amber-400' : 'border-amber-300',
        entry: fEn,
      });
    });

    const intentEntries = entries.filter(
      (e) =>
        e.entry_type === 'INTENT' &&
        !isTopicMilestoneEntry(e) &&
        !isCurrentFocusIntentEntry(e) &&
        e.id !== duplicateInitialEntryId
    );
    for (const en of intentEntries) {
      defs.push({
        key: `entry-${en.id}`,
        w: LEAF_W,
        h: LEAF_H,
        defaultParentKey: 'hub-intent',
        homeHubKey: 'hub-intent',
        edgeColor: '#D97706',
        kind: 'ENTRY',
        title: `${en.entry_date ? `${en.entry_date.slice(5)} · ` : ''}${getEntryLabel(en.entry_type, en.speaker_name)}`,
        subtitle: en.content,
        accentColor: '#D97706',
        bgClass: 'bg-amber-50/60',
        borderClass: 'border-amber-200',
        entry: en,
      });
    }

    // 2. TOPIC MILESTONES & DIALOGUE / PROGRESS CHAIN (Full unbroken chain; users fold past branches via [-]/[+N])
    const allTopicEntries = entries.filter(isTopicMilestoneEntry);
    const dialogueEntries = entries.filter((e) => e.entry_type !== 'INTENT');

    const { topicEntries, defaultParents: topicDialogueParents } =
      computeTopicAndDialogueDefaultParents(
        [...allTopicEntries, ...dialogueEntries],
        parentOverrides,
        'hub-dialogue'
      );

    topicEntries.forEach((tEn, tIdx) => {
      const isCurrentTopic = tIdx === topicEntries.length - 1;
      const cleanTitle = cleanTopicMilestoneTitle(tEn.content);
      const tKey = `entry-${tEn.id}`;
      const isRootSub = parentOverrides[tKey] === ROOT_SUBTOPIC_KEY;
      defs.push({
        key: tKey,
        w: LEAF_W,
        h: LEAF_H,
        defaultParentKey: topicDialogueParents.get(tKey) || 'hub-dialogue',
        homeHubKey: 'hub-dialogue',
        edgeColor: isCurrentTopic ? '#059669' : '#D97706',
        kind: 'ENTRY',
        title: `🎯 ${cleanTitle}`,
        subtitle: tEn.due_date
          ? `📅 ${tEn.due_date}`
          : isCurrentTopic
          ? L('현재 진행 토픽 (다음 할 일)', '現在の進行トピック', 'Active Topic (Next Step)')
          : L(`토픽 ${tIdx + 1} (이전 할 일)`, `トピック ${tIdx + 1} (前の行動)`, `Topic ${tIdx + 1} (Previous)`),
        badge: isRootSub
          ? L('🌿 서브토픽', '🌿 サブ', '🌿 Subtopic')
          : isCurrentTopic
          ? L('현재 토픽', '現在', 'Current')
          : L(`토픽 ${tIdx + 1}`, `T${tIdx + 1}`, `T${tIdx + 1}`),
        accentColor: isCurrentTopic ? '#059669' : '#D97706',
        bgClass: isCurrentTopic ? 'bg-emerald-50/90' : 'bg-amber-50/90',
        borderClass: isCurrentTopic ? 'border-emerald-400' : 'border-amber-300',
        entry: tEn,
      });
    });

    for (const en of dialogueEntries) {
      const eKey = `entry-${en.id}`;
      const isRootSub = parentOverrides[eKey] === ROOT_SUBTOPIC_KEY;
      const edgeColor =
        isRootSub
          ? '#7C3AED'
          : en.entry_type === 'DIALOGUE_ME'
          ? '#1B4D3E'
          : en.entry_type === 'DIALOGUE_THEM'
          ? '#0284C7'
          : '#059669';
      const bgClass =
        isRootSub
          ? 'bg-purple-50/75'
          : en.entry_type === 'DIALOGUE_ME'
          ? 'bg-emerald-50/50'
          : en.entry_type === 'DIALOGUE_THEM'
          ? 'bg-sky-50/70'
          : 'bg-emerald-50/80';
      const borderClass =
        isRootSub
          ? 'border-purple-300'
          : en.entry_type === 'DIALOGUE_ME'
          ? 'border-forest-300'
          : en.entry_type === 'DIALOGUE_THEM'
          ? 'border-sky-300'
          : 'border-emerald-300';
      defs.push({
        key: eKey,
        w: LEAF_W,
        h: LEAF_H,
        defaultParentKey: topicDialogueParents.get(eKey) || 'hub-dialogue',
        homeHubKey: 'hub-dialogue',
        edgeColor,
        kind: 'ENTRY',
        title: `${en.entry_date ? `${en.entry_date.slice(5)} · ` : ''}${getEntryLabel(en.entry_type, en.speaker_name)}`,
        subtitle: en.content,
        badge: isRootSub ? L('🌿 서브토픽', '🌿 サブ', '🌿 Subtopic') : undefined,
        accentColor: edgeColor,
        bgClass,
        borderClass,
        entry: en,
      });
    }

    // 3. IDEAS (use unified key: 'idea-${idea.id}')
    const ideaMap = new Map<number, JournalIdea>();
    ideas.forEach((i) => ideaMap.set(i.id, i));

    for (const idea of ideas) {
      const hasValidDbParent =
        Boolean(idea.parent_idea_id) &&
        idea.parent_idea_id !== idea.id &&
        ideaMap.has(idea.parent_idea_id!);

      const linkedCount = (idea.related_idea_ids || []).filter((id) => ideaMap.has(id)).length;
      const statusBadge =
        idea.status === 'PROMOTED'
          ? L('✨ Next Step 승격', '✨ 昇格済', '✨ Promoted')
          : idea.status === 'ARCHIVED'
          ? L('보관', '保管', 'Archived')
          : undefined;

      const bgClass =
        idea.status === 'PROMOTED'
          ? 'bg-emerald-50'
          : idea.status === 'ARCHIVED'
          ? 'bg-stone-100 opacity-75'
          : 'bg-amber-50/70';
      const borderClass =
        idea.status === 'PROMOTED'
          ? 'border-emerald-400'
          : idea.status === 'ARCHIVED'
          ? 'border-stone-300'
          : 'border-amber-300';

      defs.push({
        key: `idea-${idea.id}`,
        w: IDEA_W,
        h: IDEA_H,
        defaultParentKey: hasValidDbParent ? `idea-${idea.parent_idea_id}` : 'hub-ideas',
        homeHubKey: 'hub-ideas',
        edgeColor: idea.status === 'PROMOTED' ? '#059669' : '#D97706',
        kind: 'IDEA',
        title: idea.title,
        subtitle: idea.note || undefined,
        badge: linkedCount > 0 ? `${statusBadge ? statusBadge + ' · ' : ''}🔗${linkedCount}` : statusBadge,
        accentColor: idea.status === 'PROMOTED' ? '#059669' : '#D97706',
        bgClass,
        borderClass,
        idea,
      });
    }

    // 4. NEXT STEP TARGET (unified key: 'next-step')
    defs.push({
      key: 'next-step',
      w: 245,
      h: NEXT_H,
      defaultParentKey: 'hub-next',
      homeHubKey: 'hub-next',
      edgeColor: project.next_action ? '#059669' : '#E11D48',
      kind: 'NEXT_STEP',
      title: project.next_action || L('Next Step 미지정 (방치 위험)', 'Next Step未定 (放置リスク)', 'No Next Step set'),
      subtitle: project.next_action_date ? `📅 ${project.next_action_date}` : undefined,
      accentColor: project.next_action ? '#059669' : '#E11D48',
      bgClass: project.next_action ? 'bg-emerald-50/90' : 'bg-rose-50/90',
      borderClass: project.next_action ? 'border-emerald-400' : 'border-rose-300',
    });

    const { defMap, effectiveParentMap, childrenByParent } = resolveHierarchy(defs, 'proj-root');

    // Placeholder hints if a section hub currently has zero direct children
    const ensureHintIfEmpty = (hubKey: string, hintDef: TreeNodeDef) => {
      const kids = childrenByParent.get(hubKey) || [];
      if (kids.length === 0) {
        childrenByParent.set(hubKey, [hintDef]);
        effectiveParentMap.set(hintDef.key, hubKey);
      }
    };

    ensureHintIfEmpty('hub-intent', {
      key: 'intent-empty-hint',
      w: LEAF_W,
      h: 56,
      defaultParentKey: 'hub-intent',
      edgeColor: '#D97706',
      kind: 'ADD_HINT',
      title: L('+ 의도·결정 추가', '+ 意図・決定を追加', '+ Add intent log'),
      subtitle: L('클릭해서 의도를 기록하세요', 'クリックして意図を追加', 'Click to log intent'),
      accentColor: '#D97706',
      bgClass: 'bg-amber-50/40 border-dashed',
      borderClass: 'border-amber-300',
    });

    ensureHintIfEmpty('hub-dialogue', {
      key: 'dial-empty-hint',
      w: LEAF_W,
      h: 56,
      defaultParentKey: 'hub-dialogue',
      edgeColor: '#0284C7',
      kind: 'ADD_HINT',
      title: L('+ 대화·진행 추가', '+ 対話・進捗を追加', '+ Add dialogue log'),
      subtitle: L('클릭해서 대화/완료를 기록하세요', 'クリックして対話を追加', 'Click to log dialogue'),
      accentColor: '#0284C7',
      bgClass: 'bg-sky-50/40 border-dashed',
      borderClass: 'border-sky-300',
    });

    ensureHintIfEmpty('hub-ideas', {
      key: 'idea-add-hint',
      w: LEAF_W,
      h: 56,
      defaultParentKey: 'hub-ideas',
      edgeColor: '#D97706',
      kind: 'ADD_HINT',
      title: L('+ 첫 아이디어 가지 추가', '+ 最初のアイデアを追加', '+ Add first idea branch'),
      subtitle: L('클릭해서 가지를 뻗어보세요', 'クリックして分岐を追加', 'Click to start branching'),
      accentColor: '#D97706',
      bgClass: 'bg-amber-50/50 border-dashed',
      borderClass: 'border-amber-400',
    });

    let maxCanvasX = 850;
    const { calcSubtreeH, placeSubtree, subtreeHCache } = createSubtreePlacer(
      childrenByParent,
      effectiveParentMap,
      (right) => {
        maxCanvasX = Math.max(maxCanvasX, right);
      }
    );

    const hubOrder = ['hub-intent', 'hub-dialogue', 'hub-ideas', 'hub-next'];
    let cursorY = 24;
    let firstHubY = cursorY;
    let lastHubBottomY = cursorY + HUB_H;

    const { descendantCountMap } = computeSubtreeCollapseState(
      defs.map((d) => d.key),
      effectiveParentMap,
      collapsedKeys
    );

    hubOrder.forEach((hubKey, idx) => {
      const hubDef = defMap.get(hubKey)!;
      const directKids = collapsedKeys.has(hubKey) ? [] : childrenByParent.get(hubKey) || [];

      let sumH = 0;
      directKids.forEach((kid, kIdx) => {
        sumH += calcSubtreeH(kid, new Set());
        if (kIdx < directKids.length - 1) sumH += V_GAP;
      });

      const spanH = Math.max(HUB_H, sumH);
      const hubY = cursorY + (spanH - HUB_H) / 2;
      if (idx === 0) firstHubY = hubY;
      if (idx === hubOrder.length - 1) lastHubBottomY = hubY + HUB_H;

      nodes.push({
        ...hubDef,
        x: HUB_X,
        y: hubY,
        parentKey: 'proj-root',
      });

      let kidTop = cursorY;
      for (const kid of directKids) {
        const kidH = subtreeHCache.get(kid.key) || kid.h;
        placeSubtree(kid, LEAF_X, kidTop, new Set());
        kidTop += kidH + V_GAP;
      }

      cursorY += spanH + SECTION_GAP;
    });

    // Place any Root-Level Independent Subtopics (nodes with parentOverrides[key] === 'root-subtopic')
    const rootSubtopics = (childrenByParent.get('proj-root') || []).filter((k) => k.kind !== 'HUB');
    for (const sub of rootSubtopics) {
      const subSpanH = calcSubtreeH(sub, new Set());
      placeSubtree(sub, HUB_X, cursorY, new Set());
      lastHubBottomY = cursorY + subSpanH;
      cursorY += subSpanH + SECTION_GAP;
    }

    const rootH = 74;
    const rootY = (firstHubY + lastHubBottomY) / 2 - rootH / 2;
    const rootNode: PositionedNode = {
      key: 'proj-root',
      x: 24,
      y: rootY,
      w: 215,
      h: rootH,
      edgeColor: project.color || '#1B4D3E',
      kind: 'ROOT',
      title: project.title,
      subtitle: `${turnMeta.label}${project.resolved_partner_name ? ` · ${project.resolved_partner_name}` : ''}`,
      accentColor: project.color || '#1B4D3E',
      bgClass: 'bg-forest-800 text-white',
      borderClass: 'border-forest-900',
    };
    nodes.push(rootNode);

    const nodeMap = new Map<string, PositionedNode>();
    for (const n of nodes) nodeMap.set(n.key, n);

    for (const idea of ideas) {
      if (idea.status === 'PROMOTED' && nodeMap.has(`idea-${idea.id}`) && nodeMap.has('next-step')) {
        promotedLinks.push({
          fromKey: `idea-${idea.id}`,
          toKey: 'next-step',
        });
      }
    }

    // Trailing dashed [+] buttons at every branch leaf node AND at the top-level Project Root node
    const parentsWithChildren = new Set<string>();
    for (const n of nodes) {
      if (n.parentKey) parentsWithChildren.add(n.parentKey);
    }
    const leafAddButtons: Array<{
      key: string;
      parentNode: PositionedNode;
      isRootSubtopicTrigger?: boolean;
      portX: number;
      portY: number;
      x: number;
      y: number;
      size: number;
    }> = [];
    if (onAddIdea || onAddEntry) {
      // 1) Root center node [+] button (creates a new independent subtopic branch off proj-root)
      const rootBtnSize = 28;
      const rootBtnX = rootNode.x + (rootNode.w - rootBtnSize) / 2;
      const rootBtnY = rootNode.y + rootNode.h + 18;
      leafAddButtons.push({
        key: 'leaf-add::proj-root',
        parentNode: rootNode,
        isRootSubtopicTrigger: true,
        portX: rootNode.x + rootNode.w / 2,
        portY: rootNode.y + rootNode.h,
        x: rootBtnX,
        y: rootBtnY,
        size: rootBtnSize,
      });
      cursorY = Math.max(cursorY, rootBtnY + rootBtnSize + 24);

      // 2) Leaf node [+] buttons at the end of every branch (skip collapsed parents so [+N] badge never overlaps)
      for (const n of nodes) {
        if (
          (n.kind === 'INTENT_PINNED' ||
            n.kind === 'ENTRY' ||
            n.kind === 'IDEA' ||
            n.kind === 'NEXT_STEP') &&
          !parentsWithChildren.has(n.key) &&
          (descendantCountMap.get(n.key) || 0) === 0
        ) {
          const size = 28;
          const btnX = n.x + n.w + 22;
          leafAddButtons.push({
            key: `leaf-add::${n.key}`,
            parentNode: n,
            portX: n.x + n.w,
            portY: n.y + n.h / 2,
            x: btnX,
            y: n.y + (n.h - size) / 2,
            size,
          });
          maxCanvasX = Math.max(maxCanvasX, btnX + size + 36);
        }
      }
    }

    return {
      nodes,
      nodeMap,
      effectiveParentMap,
      descendantCountMap,
      promotedLinks,
      leafAddButtons,
      width: maxCanvasX + 36,
      height: Math.max(380, cursorY + 28),
    };
  }, [
    project,
    allProjects,
    entries,
    ideas,
    parentOverrides,
    referencedKeys,
    duplicateInitialEntryId,
    collapsedKeys,
    onAddIdea,
    onAddEntry,
    L,
  ]);

  const obstacleBoxes = useMemo<ObstacleBox[]>(() => {
    const list: ObstacleBox[] = layout.nodes.map((n) => ({
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
    }));
    if (!connectMode && !nestMode) {
      for (const btn of layout.leafAddButtons) {
        list.push({
          x: btn.x,
          y: btn.y,
          w: btn.size,
          h: btn.size,
        });
      }
    }
    return list;
  }, [layout.nodes, layout.leafAddButtons, connectMode, nestMode]);

  const relatedIdeaWires = useMemo(
    () => buildRelatedIdeaWires(ideas, customEdges, (k) => layout.nodeMap.has(k)),
    [ideas, customEdges, layout.nodeMap]
  );

  // Node Role helpers
  const isNodeMovable = useCallback(
    (node: PositionedNode) =>
      node.kind !== 'ROOT' && node.kind !== 'HUB' && node.kind !== 'ADD_HINT',
    []
  );

  const isNodeConnectable = useCallback(
    (node: PositionedNode) => node.kind !== 'HUB' && node.kind !== 'ADD_HINT',
    []
  );

  const canNestTarget = useCallback(
    (sourceKey: string, target: PositionedNode): 'NEST' | 'DETACH' | null => {
      if (target.key === sourceKey || target.kind === 'ADD_HINT') return null;
      if (target.kind === 'ROOT' || target.kind === 'HUB') {
        return parentOverrides[sourceKey] ? 'DETACH' : null;
      }
      if (wouldCycleInParentMap(sourceKey, target.key, layout.effectiveParentMap)) {
        return null;
      }
      return 'NEST';
    },
    [parentOverrides, layout.effectiveParentMap]
  );

  // Hovered target during drag-and-drop in Nest Mode
  const hoveredNestTargetKey = useMemo(() => {
    if (!nestMode || !draggingNest || !draggingNest.moved) return null;
    const draggedNode = layout.nodeMap.get(draggingNest.key);
    if (!draggedNode) return null;

    const ghostX = draggingNest.pointerX - draggingNest.grabOffsetX;
    const ghostY = draggingNest.pointerY - draggingNest.grabOffsetY;

    // 1. Direct pointer-inside-card priority
    for (const candidate of layout.nodes) {
      if (!canNestTarget(draggedNode.key, candidate)) continue;
      if (
        draggingNest.pointerX >= candidate.x &&
        draggingNest.pointerX <= candidate.x + candidate.w &&
        draggingNest.pointerY >= candidate.y &&
        draggingNest.pointerY <= candidate.y + candidate.h
      ) {
        return candidate.key;
      }
    }

    // 2. Fallback: Ghost bounding-box overlap (> 300px^2)
    let bestKey: string | null = null;
    let bestArea = 0;
    for (const candidate of layout.nodes) {
      if (!canNestTarget(draggedNode.key, candidate)) continue;
      const xOverlap = Math.max(
        0,
        Math.min(ghostX + draggedNode.w, candidate.x + candidate.w) - Math.max(ghostX, candidate.x)
      );
      const yOverlap = Math.max(
        0,
        Math.min(ghostY + draggedNode.h, candidate.y + candidate.h) - Math.max(ghostY, candidate.y)
      );
      const area = xOverlap * yOverlap;
      if (area > 300 && area > bestArea) {
        bestArea = area;
        bestKey = candidate.key;
      }
    }
    return bestKey;
  }, [nestMode, draggingNest, layout.nodeMap, layout.nodes, canNestTarget]);

  // Hovered target port/card while dragging a connection wire
  const hoveredConnectTarget = useMemo(() => {
    if (!connectingWire || !connectingWire.moved) return null;
    const { fromKey, pointerX, pointerY } = connectingWire;
    const fromNode = layout.nodeMap.get(fromKey);

    let best: { key: string; side: PortSide; dist: number } | null = null;
    for (const n of layout.nodes) {
      if (n.key === fromKey || !isNodeConnectable(n)) continue;
      for (const side of PORT_SIDES) {
        const pt = getPortCoords(n.x, n.y, n.w, n.h, side);
        const dist = Math.hypot(pointerX - pt.x, pointerY - pt.y);
        if (dist <= 26 && (!best || dist < best.dist)) {
          best = { key: n.key, side, dist };
        }
      }
      if (pointerX >= n.x && pointerX <= n.x + n.w && pointerY >= n.y && pointerY <= n.y + n.h) {
        if (fromNode) {
          const smart = chooseSmartLeftRightPorts(fromNode, n);
          return { key: n.key, side: smart.toSide };
        }
        return { key: n.key, side: 'left' as PortSide };
      }
    }

    return best ? { key: best.key, side: best.side } : null;
  }, [connectingWire, layout.nodes, layout.nodeMap, isNodeConnectable]);

  // Refs for smooth global window pointer listeners
  const customEdgesRef = useRef(customEdges);
  customEdgesRef.current = customEdges;
  const parentOverridesRef = useRef(parentOverrides);
  parentOverridesRef.current = parentOverrides;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const hoveredConnectTargetRef = useRef(hoveredConnectTarget);
  hoveredConnectTargetRef.current = hoveredConnectTarget;
  const hoveredNestTargetKeyRef = useRef(hoveredNestTargetKey);
  hoveredNestTargetKeyRef.current = hoveredNestTargetKey;
  const nestSourceKeyRef = useRef(nestSourceKey);
  nestSourceKeyRef.current = nestSourceKey;
  const connectPendingSourceRef = useRef(connectPendingSource);
  connectPendingSourceRef.current = connectPendingSource;

  const pushUndoSnapshot = useCallback(() => {
    setUndoStack((prev) => [
      ...prev.slice(-19),
      {
        customEdges: [...customEdgesRef.current],
        parentOverrides: { ...parentOverridesRef.current },
      },
    ]);
  }, []);

  const handleUndo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setCustomEdges(last.customEdges);
      setParentOverrides(last.parentOverrides);
      persistLayout(last.customEdges, last.parentOverrides);
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

  const createEdge = useCallback(
    (fromKey: string, fromSide: PortSide, toKey: string, toSide: PortSide) => {
      if (fromKey === toKey) return;
      const exists = customEdgesRef.current.some(
        (ed) =>
          (ed.fromKey === fromKey &&
            ed.fromSide === fromSide &&
            ed.toKey === toKey &&
            ed.toSide === toSide) ||
          (ed.toKey === fromKey &&
            ed.toSide === fromSide &&
            ed.fromKey === toKey &&
            ed.fromSide === toSide)
      );
      if (exists) return;

      pushUndoSnapshot();
      const newEdge: FreeMapEdge = {
        id: `e-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        fromKey,
        fromSide,
        toKey,
        toSide,
        color: '#7C3AED',
      };
      const nextEdges = [...customEdgesRef.current, newEdge];
      setCustomEdges(nextEdges);
      persistLayout(nextEdges, parentOverridesRef.current);
    },
    [persistLayout, pushUndoSnapshot]
  );

  const applyNestChoice = useCallback(
    (sourceKey: string, targetKey: string) => {
      const targetNode = layoutRef.current.nodeMap.get(targetKey);
      if (!targetNode) return;
      const mode = canNestTarget(sourceKey, targetNode);
      if (!mode) return;

      pushUndoSnapshot();
      const nextParents = { ...parentOverridesRef.current };
      if (mode === 'DETACH') {
        delete nextParents[sourceKey];
      } else {
        nextParents[sourceKey] = targetKey;
      }
      setParentOverrides(nextParents);
      persistLayout(customEdgesRef.current, nextParents);
    },
    [canNestTarget, persistLayout, pushUndoSnapshot]
  );

  // Global window pointer listeners for Nest Drag-and-Drop and Port Wire Drag/Click
  useEffect(() => {
    if (!draggingNest && !connectingWire) return;

    const handlePointerMove = (e: PointerEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const px = (e.clientX - rect.left) / scale;
      const py = (e.clientY - rect.top) / scale;

      if (draggingNest) {
        const moved =
          draggingNest.moved ||
          Math.hypot(e.clientX - draggingNest.startClientX, e.clientY - draggingNest.startClientY) > 5;
        setDraggingNest((prev) =>
          prev ? { ...prev, pointerX: px, pointerY: py, moved } : null
        );
      } else if (connectingWire) {
        const moved =
          connectingWire.moved ||
          Math.hypot(e.clientX - connectingWire.startClientX, e.clientY - connectingWire.startClientY) > 5;
        setConnectingWire((prev) =>
          prev ? { ...prev, pointerX: px, pointerY: py, moved } : null
        );
      }
    };

    const handlePointerUp = () => {
      if (draggingNest) {
        if (draggingNest.moved) {
          const dropKey = hoveredNestTargetKeyRef.current;
          if (dropKey) {
            applyNestChoice(draggingNest.key, dropKey);
            setNestSourceKey(null);
          }
        } else {
          // Pointer did not drag -> execute 2-Click Nesting interaction!
          const clickedKey = draggingNest.key;
          const currentSrc = nestSourceKeyRef.current;
          if (!currentSrc) {
            setNestSourceKey(clickedKey);
          } else if (currentSrc === clickedKey) {
            setNestSourceKey(null);
          } else {
            applyNestChoice(currentSrc, clickedKey);
            setNestSourceKey(null);
          }
        }
        setDraggingNest(null);
      }

      if (connectingWire) {
        if (connectingWire.moved) {
          const target = hoveredConnectTargetRef.current;
          if (target && target.key !== connectingWire.fromKey) {
            createEdge(connectingWire.fromKey, connectingWire.fromSide, target.key, target.side);
          }
          setConnectPendingSource(null);
        } else {
          // Pointer did not drag -> treat port click as 2-Click endpoint selection!
          const pending = connectPendingSourceRef.current;
          if (!pending) {
            setConnectPendingSource({ key: connectingWire.fromKey, side: connectingWire.fromSide });
          } else if (pending.key === connectingWire.fromKey) {
            setConnectPendingSource(null);
          } else {
            const fromNode = layoutRef.current.nodeMap.get(pending.key);
            const toNode = layoutRef.current.nodeMap.get(connectingWire.fromKey);
            const auto =
              fromNode && toNode
                ? chooseSmartLeftRightPorts(fromNode, toNode)
                : { fromSide: 'right' as PortSide, toSide: 'left' as PortSide };
            createEdge(
              pending.key,
              pending.side || auto.fromSide,
              connectingWire.fromKey,
              connectingWire.fromSide
            );
            setConnectPendingSource(null);
          }
        }
        setConnectingWire(null);
      }
    };

    const handlePointerCancel = () => {
      if (draggingNest) setDraggingNest(null);
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
  }, [draggingNest, connectingWire, scale, applyNestChoice, createEdge]);

  // Escape & Ctrl+Z / Cmd+Z keyboard shortcuts
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
      if (draggingNest || connectingWire) {
        setDraggingNest(null);
        setConnectingWire(null);
        return;
      }
      if (nestSourceKey) {
        setNestSourceKey(null);
        return;
      }
      if (connectPendingSource) {
        setConnectPendingSource(null);
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
  }, [
    draggingNest,
    connectingWire,
    nestSourceKey,
    connectPendingSource,
    connectMode,
    nestMode,
    selectedEdgeId,
    selectedNodeKey,
    selectAndSyncNode,
    editingEntryInline,
    undoStack.length,
    handleUndo,
  ]);

  // Sync wireLabelDraft whenever selectedEdgeId changes
  useEffect(() => {
    if (!selectedEdgeId) {
      setWireLabelDraft('');
      return;
    }
    const found = customEdges.find((e) => e.id === selectedEdgeId);
    setWireLabelDraft(found?.label || '');
  }, [selectedEdgeId, customEdges]);

  // Reset inline entry editor when selected node changes
  useEffect(() => {
    setEditingEntryInline(false);
    setEntryEditContent('');
  }, [selectedNodeKey]);

  // Open General Mind Map at the far-right end by default (since branches grow left-to-right),
  // unless an explicit focusNodeKey is currently active.
  useEffect(() => {
    if (focusNodeKey) return;
    const scrollToRightEdge = () => {
      const vp = viewportRef.current;
      if (!vp) return;
      const maxLeft = Math.max(0, vp.scrollWidth - vp.clientWidth);
      vp.scrollTo({ left: maxLeft, behavior: 'auto' });
    };
    scrollToRightEdge();
    const timer = setTimeout(scrollToRightEdge, 40);
    return () => clearTimeout(timer);
  }, [project?.id]);

  // External focus jump from Timeline or tab sync between Mind Map <-> Free Mind Map
  useEffect(() => {
    if (!focusNodeKey) return;
    if (lastSelfSelectedKeyRef.current === focusNodeKey) return;
    const remapped = remapMindMapKey(focusNodeKey, duplicateInitialEntryId);

    // Ensure all ancestors are expanded so the target node is visible
    setCollapsedKeys((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set(prev);
      let curr = layout.effectiveParentMap.get(remapped);
      const visited = new Set<string>();
      let changed = false;
      while (curr && !visited.has(curr)) {
        visited.add(curr);
        if (next.has(curr)) {
          next.delete(curr);
          changed = true;
        }
        curr = layout.effectiveParentMap.get(curr);
      }
      return changed ? next : prev;
    });

    const node = layout.nodeMap.get(remapped);
    if (node) {
      lastSelfSelectedKeyRef.current = null;
      const isSheetViewport =
        typeof window !== 'undefined' && window.matchMedia('(max-width: 1279px)').matches;
      setSelectedNodeKey(isSheetViewport ? null : remapped);
      setHighlightedNodeKey(remapped);
      const centerOnNode = (behavior: ScrollBehavior) => {
        const vp = viewportRef.current;
        if (!vp) return;
        const targetLeft = Math.max(0, (node.x + node.w / 2) * scale - vp.clientWidth / 2);
        const targetTop = Math.max(0, (node.y + node.h / 2) * scale - vp.clientHeight / 2);
        vp.scrollTo({ left: targetLeft, top: targetTop, behavior });
      };
      centerOnNode('smooth');
      const timer = setTimeout(() => centerOnNode('smooth'), 45);
      onConsumedFocusNode?.();
      return () => clearTimeout(timer);
    }
  }, [focusNodeKey, duplicateInitialEntryId, layout.nodeMap, layout.effectiveParentMap, scale, onConsumedFocusNode]);

  const handleDetachNodeToRoot = (nodeKey: string) => {
    pushUndoSnapshot();
    const nextParents = { ...parentOverrides };
    delete nextParents[nodeKey];
    setParentOverrides(nextParents);
    persistLayout(customEdges, nextParents);
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
    persistLayout(nextEdges, parentOverrides);
  };

  const handleDeleteCustomEdge = (edgeId: string) => {
    pushUndoSnapshot();
    const nextEdges = customEdges.filter((e) => e.id !== edgeId);
    setCustomEdges(nextEdges);
    if (selectedEdgeId === edgeId) setSelectedEdgeId(null);
    persistLayout(nextEdges, parentOverrides);
  };

  const openComposerForNode = (
    targetNode: PositionedNode | null,
    overrideKind?: EntryType | 'IDEA',
    asRootSubtopic = false,
    initialCompletedTarget = ''
  ) => {
    if (asRootSubtopic) {
      setComposerState({
        open: true,
        initialKind: overrideKind || 'DIALOGUE_ME',
        initialCompletedTarget: '',
        parentNodeKey: ROOT_SUBTOPIC_KEY,
        parentNodeTitle: L('프로젝트 루트 (새 서브토픽)', 'プロジェクトルート (新規サブトピック)', 'Project Root (New Subtopic)'),
        parentIdeaId: null,
      });
      return;
    }
    if (
      targetNode &&
      (targetNode.kind === 'INTENT_PINNED' ||
        targetNode.kind === 'ENTRY' ||
        targetNode.kind === 'IDEA' ||
        targetNode.kind === 'NEXT_STEP')
    ) {
      setComposerState({
        open: true,
        initialKind: overrideKind || getDefaultComposerKindForNode(targetNode.kind, targetNode.entry),
        initialCompletedTarget,
        parentNodeKey: targetNode.key,
        parentNodeTitle: targetNode.title,
        parentIdeaId: targetNode.idea ? targetNode.idea.id : null,
      });
    } else {
      setComposerState({
        open: true,
        initialKind: overrideKind || (onAddIdea ? 'IDEA' : 'INTENT'),
        initialCompletedTarget,
        parentNodeKey: null,
        parentNodeTitle: null,
        parentIdeaId: null,
      });
    }
  };

  const handleComposerCreatedNode = useCallback(
    (newKey: string, parentKey: string | null) => {
      if (!parentKey) return;
      pushUndoSnapshot();
      const nextParents = {
        ...parentOverridesRef.current,
        [newKey]: parentKey,
      };
      setParentOverrides(nextParents);
      persistLayout(customEdgesRef.current, nextParents);
    },
    [persistLayout, pushUndoSnapshot]
  );

  const handleCopyMarkdown = async () => {
    const md = buildMindMapMarkdown(
      project ? project.title : L('전체 프로젝트 저널 마인드맵', '全体プロジェクトマインドマップ', 'Project Journal Mind Map'),
      layout.nodes,
      layout.effectiveParentMap,
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
    const pngNodes = layout.nodes.map((n) => ({
      x: n.x,
      y: n.y,
      w: n.w,
      h: n.h,
      title: n.title,
      subtitle: n.subtitle,
      badge: n.badge,
      isRoot: n.kind === 'ROOT',
      accentColor: n.accentColor,
      fillColor:
        n.kind === 'ROOT'
          ? '#1B4D3E'
          : n.kind === 'HUB'
          ? '#F8F7F2'
          : n.kind === 'IDEA'
          ? '#FFFBEB'
          : n.kind === 'NEXT_STEP'
          ? '#ECFDF5'
          : '#FFFFFF',
      borderColor: n.kind === 'ROOT' ? '#143B2F' : n.accentColor || '#D6D3C4',
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

    for (const node of layout.nodes) {
      if (!node.parentKey) continue;
      const parent = layout.nodeMap.get(node.parentKey);
      if (!parent) continue;
      const x1 = parent.x + parent.w;
      const y1 = parent.y + parent.h / 2;
      const x2 = node.x;
      const y2 = node.y + node.h / 2;
      const cx = (x1 + x2) / 2;
      pngEdges.push({
        pathD: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`,
        color: parentOverrides[node.key] ? '#059669' : node.edgeColor,
        dashed: node.kind === 'ADD_HINT',
        strokeWidth: parentOverrides[node.key] ? 2.4 : 2,
      });
    }
    for (const edge of customEdges) {
      const fKey = remapMindMapKey(edge.fromKey, duplicateInitialEntryId);
      const tKey = remapMindMapKey(edge.toKey, duplicateInitialEntryId);
      const from = layout.nodeMap.get(fKey);
      const to = layout.nodeMap.get(tKey);
      if (!from || !to) continue;
      const p1 = getPortCoords(from.x, from.y, from.w, from.h, edge.fromSide);
      const p2 = getPortCoords(to.x, to.y, to.w, to.h, edge.toSide);
      const { path, midX, midY } = buildObstacleAvoidingPath(
        p1,
        edge.fromSide,
        p2,
        edge.toSide,
        obstacleBoxes
      );
      pngEdges.push({
        pathD: path,
        color: edge.color || '#7C3AED',
        strokeWidth: 2.3,
        label: edge.label,
        midX,
        midY,
      });
    }

    const safeTitle = (project?.title || 'workspace-mindmap').replace(/[\\/:*?"<>|]/g, '_');
    downloadMindMapAsPng(`${safeTitle}-mindmap.png`, pngNodes, pngEdges);
  };

  const handleNodeNormalOrModeClick = (node: PositionedNode) => {
    // 1. Connect Mode (node card click for 2-Click smart port connection)
    if (connectMode) {
      if (!isNodeConnectable(node)) return;
      if (!connectPendingSource) {
        setConnectPendingSource({ key: node.key });
      } else if (connectPendingSource.key === node.key) {
        setConnectPendingSource(null);
      } else {
        const fromNode = layout.nodeMap.get(connectPendingSource.key);
        const auto = fromNode
          ? chooseSmartLeftRightPorts(fromNode, node)
          : { fromSide: 'right' as PortSide, toSide: 'left' as PortSide };
        createEdge(
          connectPendingSource.key,
          connectPendingSource.side || auto.fromSide,
          node.key,
          auto.toSide
        );
        setConnectPendingSource(null);
      }
      return;
    }

    // 2. Nest Mode fallback (for non-draggable targets like ROOT or HUB to detach a picked child)
    if (nestMode) {
      if (nestSourceKey) {
        if (nestSourceKey === node.key) {
          setNestSourceKey(null);
        } else {
          applyNestChoice(nestSourceKey, node.key);
          setNestSourceKey(null);
        }
      }
      return;
    }

    // 3. Normal Mode
    if (onAddIdea || onAddEntry) {
      if (node.key === 'intent-empty-hint' || (node.kind === 'HUB' && node.key === 'hub-intent')) {
        openComposerForNode(null, 'INTENT');
        return;
      }
      if (node.key === 'dial-empty-hint' || (node.kind === 'HUB' && node.key === 'hub-dialogue')) {
        openComposerForNode(null, 'DIALOGUE_ME');
        return;
      }
      if (node.key === 'idea-add-hint' || (node.kind === 'HUB' && node.key === 'hub-ideas')) {
        openComposerForNode(null, 'IDEA');
        return;
      }
    }
    if (node.kind === 'PROJECT_LEAF' && node.projectItem) {
      if (onFocusProject) {
        onFocusProject(node.projectItem.id);
      } else if (onOpenProjectDetail) {
        onOpenProjectDetail(node.projectItem.id);
      }
      return;
    }
    if (node.kind !== 'HUB' && node.kind !== 'ADD_HINT') {
      const nextKey = selectedNodeKey === node.key ? null : node.key;
      selectAndSyncNode(nextKey);
      setSelectedEdgeId(null);
    }
  };

  const selectedNode = selectedNodeKey ? layout.nodeMap.get(selectedNodeKey) || null : null;
  const selectedIdea = selectedNode?.idea || null;
  const selectedEntry = selectedNode?.entry || null;
  const selectedEdge = selectedEdgeId ? customEdges.find((e) => e.id === selectedEdgeId) || null : null;
  const nestSourceNode = nestSourceKey ? layout.nodeMap.get(nestSourceKey) || null : null;
  const connectSourceNode = connectPendingSource ? layout.nodeMap.get(connectPendingSource.key) || null : null;

  const isSearchActive = searchQuery.trim().length > 0 || nodeKindFilter !== 'ALL';
  const doesNodeMatchFilter = useCallback(
    (node: PositionedNode): boolean => {
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

  const selectedNodeEdges = useMemo(() => {
    if (!selectedNodeKey) return [];
    return customEdges.filter((e) => {
      const fKey = remapMindMapKey(e.fromKey, duplicateInitialEntryId);
      const tKey = remapMindMapKey(e.toKey, duplicateInitialEntryId);
      return fKey === selectedNodeKey || tKey === selectedNodeKey;
    });
  }, [customEdges, selectedNodeKey, duplicateInitialEntryId]);

  const draggingGhostNode = draggingNest?.moved ? layout.nodeMap.get(draggingNest.key) || null : null;

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
      {/* Mind Map Top Toolbar */}
      <div className="px-3 py-2.5 bg-ivory-50 border-b border-ivory-200 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-900 min-w-0">
            <GitBranch className="w-4 h-4 text-forest-700 shrink-0" />
            <span className="truncate">
              {project
                ? L(`마인드맵 · ${project.title}`, `マインドマップ · ${project.title}`, `Mind Map · ${project.title}`)
                : L('전체 프로젝트 관계 마인드맵', '全体プロジェクト・マインドマップ', 'Workspace Mind Map')}
            </span>
          </div>

          <div className="hidden lg:flex items-center gap-2 text-[11px] font-bold text-charcoal-600 pl-2 border-l border-ivory-300 shrink-0">
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 bg-amber-600 inline-block" />
              {L('가지 분기', '分岐', 'Branch')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 bg-violet-600 inline-block" />
              {L('노드 연결', 'ノード接続', 'Wire')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-emerald-600 inline-block" />
              {L('Next Step 승격 ✨', 'Next Step昇格 ✨', 'Promoted')}
            </span>
          </div>
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
              onClick={() => setZoomIdx((z) => Math.min(ZOOM_LEVELS.length - 1, z + 1))}
              disabled={zoomIdx === ZOOM_LEVELS.length - 1}
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
                    if (next) {
                      setNestMode(false);
                      setNestSourceKey(null);
                    } else {
                      setConnectPendingSource(null);
                    }
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
                    if (next) {
                      setConnectMode(false);
                      setConnectPendingSource(null);
                    } else {
                      setNestSourceKey(null);
                    }
                    return next;
                  });
                },
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
          className={`px-3 py-2 border-b flex items-center justify-between gap-2 text-xs flex-wrap ${
            connectMode
              ? 'bg-violet-50 border-violet-200 text-violet-900'
              : 'bg-emerald-50 border-emerald-200 text-emerald-900'
          }`}
        >
          <div className="flex items-center gap-2 font-bold min-w-0">
            {connectMode ? <Link2 className="w-4 h-4 shrink-0" /> : <CornerDownRight className="w-4 h-4 shrink-0" />}
            <span className="truncate">
              {connectMode
                ? connectSourceNode
                  ? L(
                      `[${connectSourceNode.title}] 선택됨 → 연결할 대상 노드나 ● 포트를 클릭하세요. (자유 마인드맵과 공유)`,
                      `「${connectSourceNode.title}」選択中 → 接続先のノードまたは●をクリックしてください。`,
                      `[${connectSourceNode.title}] selected → Click target node or ● port to connect.`
                    )
                  : L(
                      '노드 연결 활성화됨: 카드(또는 ● 포트)를 2번 클릭하거나, ● 점을 드래그해 연결하세요. (자유 마인드맵과 공유)',
                      'ノード接続ON: カード(または●)を2クリック、または●をドラッグして接続してください。',
                      'Connect mode: Click 2 nodes/ports or drag a ● dot to wire nodes (synced with Free Mind Map).'
                    )
                : nestSourceNode
                ? L(
                    `[${nestSourceNode.title}] 선택됨 → 상위로 삼을 부모 노드를 클릭하세요. (원래 위치 복귀는 루트/허브 클릭)`,
                    `「${nestSourceNode.title}」選択中 → 親にするノードをクリックしてください。`,
                    `[${nestSourceNode.title}] selected → Click a parent node to nest under (click Root/Hub to detach).`
                  )
                : L(
                    '노드 종속 활성화됨: 종속시킬 [자식 → 부모] 노드를 차례로 클릭하거나, 노드를 끌어 부모 위에 놓으세요. (자유 마인드맵과 공유)',
                    'ノード従属ON: [子→親]の順に2クリック、またはノードを親の上にドラッグ＆ドロップしてください。',
                    'Nest mode: Click [Child → Parent] or drag & drop a node onto its parent (synced with Free Mind Map).'
                  )}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {(nestSourceKey || connectPendingSource) && (
              <button
                type="button"
                onClick={() => {
                  setNestSourceKey(null);
                  setConnectPendingSource(null);
                }}
                className="px-2 py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 font-bold hover:bg-ivory-100"
              >
                {L('선택 취소', '選択解除', 'Clear')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setConnectMode(false);
                setNestMode(false);
                setNestSourceKey(null);
                setConnectPendingSource(null);
              }}
              className={`px-2.5 py-1 rounded-lg text-white font-bold ${
                connectMode ? 'bg-violet-700 hover:bg-violet-800' : 'bg-emerald-700 hover:bg-emerald-800'
              }`}
            >
              {L('종료', '終了', 'Done')}
            </button>
          </div>
        </div>
      )}

      {/* Unified Mind Map Node Composer (All Timeline Types + Ideas) */}
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

      {/* Mind Map Canvas */}
      {layout.nodes.length === 0 ? (
        <div className="py-12 text-center text-xs text-charcoal-400">
          {L('마인드맵에 표시할 프로젝트가 없습니다.', 'マインドマップに表示するプロジェクトがありません。', 'No projects to display on mind map.')}
        </div>
      ) : (
        <div ref={viewportRef} className="overflow-auto bg-ivory-50/40 relative max-h-[680px]">
          <div
            style={{
              width: layout.width * scale,
              height: layout.height * scale,
            }}
            className="relative"
          >
            <div
              ref={canvasRef}
              onClick={(e) => {
                if (e.target === canvasRef.current) {
                  selectAndSyncNode(null);
                  setSelectedEdgeId(null);
                }
              }}
              style={{
                width: layout.width,
                height: layout.height,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
              className="relative select-none"
            >
              {/* SVG Edges Layer */}
              <svg
                width={layout.width}
                height={layout.height}
                className="absolute inset-0 pointer-events-none"
              >
                {/* 1. Structural Parent -> Child Bezier Curves (left-to-right tree + overridden parent hierarchy) */}
                {layout.nodes.map((node) => {
                  if (!node.parentKey) return null;
                  const parent = layout.nodeMap.get(node.parentKey);
                  if (!parent) return null;
                  const x1 = parent.x + parent.w;
                  const y1 = parent.y + parent.h / 2;
                  const x2 = node.x;
                  const y2 = node.y + node.h / 2;
                  const cx = (x1 + x2) / 2;
                  const isOverridden = Boolean(parentOverrides[node.key]);
                  const isAddHint = node.kind === 'ADD_HINT';
                  return (
                    <path
                      key={`edge-${node.key}`}
                      d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={isOverridden ? '#059669' : node.edgeColor}
                      strokeWidth={isOverridden ? 2.4 : 2}
                      strokeDasharray={isAddHint ? '4 3' : undefined}
                      strokeOpacity={isOverridden ? 0.78 : isAddHint ? 0.65 : 0.55}
                    />
                  );
                })}

                {/* 1b. Dashed Connectors to Trailing Leaf [+] Buttons & Root [+] Button */}
                {!connectMode &&
                  !nestMode &&
                  layout.leafAddButtons.map((btn) => {
                    const x2 = btn.isRootSubtopicTrigger ? btn.x + btn.size / 2 : btn.x;
                    const y2 = btn.isRootSubtopicTrigger ? btn.y : btn.y + btn.size / 2;
                    return (
                      <line
                        key={`edge-${btn.key}`}
                        x1={btn.portX}
                        y1={btn.portY}
                        x2={x2}
                        y2={y2}
                        stroke={btn.parentNode.accentColor}
                        strokeWidth={1.8}
                        strokeDasharray="4 3"
                        strokeOpacity={0.65}
                      />
                    );
                  })}

                {/* 2. Promoted Idea -> Next Step Curved Links (Obstacle-Avoiding) */}
                {layout.promotedLinks.map((lnk, idx) => {
                  const from = layout.nodeMap.get(lnk.fromKey);
                  const to = layout.nodeMap.get(lnk.toKey);
                  if (!from || !to) return null;
                  const { fromSide, toSide } = chooseSmartLeftRightPorts(from, to);
                  const p1 = getPortCoords(from.x, from.y, from.w, from.h, fromSide);
                  const p2 = getPortCoords(to.x, to.y, to.w, to.h, toSide);
                  const { path } = buildObstacleAvoidingPath(p1, fromSide, p2, toSide, obstacleBoxes);
                  const isDimmed =
                    Boolean(selectedNodeKey) &&
                    selectedNodeKey !== lnk.fromKey &&
                    selectedNodeKey !== lnk.toKey;
                  return (
                    <path
                      key={`promo-${idx}`}
                      d={path}
                      fill="none"
                      stroke="#059669"
                      strokeWidth={2.2}
                      strokeDasharray="6 4"
                      strokeOpacity={isDimmed ? 0.25 : 0.85}
                    />
                  );
                })}

                {/* 3. Synced related_idea_ids Links (Obstacle-Avoiding, deduplicated against customEdges) */}
                {relatedIdeaWires.map((w, idx) => {
                  const from = layout.nodeMap.get(w.fromKey);
                  const to = layout.nodeMap.get(w.toKey);
                  if (!from || !to) return null;
                  const { fromSide, toSide } = chooseSmartLeftRightPorts(from, to);
                  const p1 = getPortCoords(from.x, from.y, from.w, from.h, fromSide);
                  const p2 = getPortCoords(to.x, to.y, to.w, to.h, toSide);
                  const { path, midX, midY } = buildObstacleAvoidingPath(
                    p1,
                    fromSide,
                    p2,
                    toSide,
                    obstacleBoxes
                  );
                  const touchesSelected =
                    selectedNodeKey === w.fromKey || selectedNodeKey === w.toKey;
                  const isDimmed = Boolean(selectedNodeKey) && !touchesSelected;
                  return (
                    <g key={`relwire-${idx}`} opacity={isDimmed ? 0.25 : 1}>
                      <path
                        d={path}
                        fill="none"
                        stroke="#7C3AED"
                        strokeWidth={touchesSelected ? 2.6 : 2}
                        strokeDasharray="5 4"
                        strokeOpacity={0.85}
                      />
                      <circle cx={midX} cy={midY} r={9} fill="#F5F3FF" stroke="#7C3AED" strokeWidth={1.5} />
                      <text
                        x={midX}
                        y={midY + 3.5}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#5B21B6"
                        fontWeight="bold"
                      >
                        ∞
                      </text>
                    </g>
                  );
                })}

                {/* 4. Shared User-Created Custom Port-to-Port Edges (Obstacle-Avoiding Corridors) */}
                {customEdges.map((edge) => {
                  const resolvedFromKey = remapMindMapKey(edge.fromKey, duplicateInitialEntryId);
                  const resolvedToKey = remapMindMapKey(edge.toKey, duplicateInitialEntryId);
                  const from = layout.nodeMap.get(resolvedFromKey);
                  const to = layout.nodeMap.get(resolvedToKey);
                  if (!from || !to) return null;
                  const p1 = getPortCoords(from.x, from.y, from.w, from.h, edge.fromSide);
                  const p2 = getPortCoords(to.x, to.y, to.w, to.h, edge.toSide);
                  const { path, midX, midY } = buildObstacleAvoidingPath(
                    p1,
                    edge.fromSide,
                    p2,
                    edge.toSide,
                    obstacleBoxes
                  );
                  const isEdgeSelected = selectedEdgeId === edge.id;
                  const touchesSelectedNode =
                    Boolean(selectedNodeKey) &&
                    (resolvedFromKey === selectedNodeKey || resolvedToKey === selectedNodeKey);
                  const isDimmed =
                    (Boolean(selectedNodeKey) && !touchesSelectedNode && !isEdgeSelected) ||
                    (Boolean(selectedEdgeId) && !isEdgeSelected);

                  return (
                    <g
                      key={edge.id}
                      className="pointer-events-auto cursor-pointer"
                      opacity={isDimmed ? 0.22 : 1}
                    >
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
                        strokeWidth={isEdgeSelected || touchesSelectedNode ? 3.2 : 2.3}
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
                  connectingWire.moved &&
                  (() => {
                    const from = layout.nodeMap.get(connectingWire.fromKey);
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
                      const targetNode = layout.nodeMap.get(hoveredConnectTarget.key);
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
                    const { path } = hoveredConnectTarget
                      ? buildObstacleAvoidingPath(p1, connectingWire.fromSide, p2, endSide, obstacleBoxes)
                      : buildDirectionalBezier(p1, connectingWire.fromSide, p2, endSide);
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

                {/* 6. Live Nesting Drop Preview Line */}
                {draggingNest?.moved &&
                  hoveredNestTargetKey &&
                  (() => {
                    const from = layout.nodeMap.get(draggingNest.key);
                    const to = layout.nodeMap.get(hoveredNestTargetKey);
                    if (!from || !to) return null;
                    const p1 = { x: draggingNest.pointerX, y: draggingNest.pointerY };
                    const p2 = getPortCoords(to.x, to.y, to.w, to.h, 'right');
                    const { path } = buildDirectionalBezier(p1, 'left', p2, 'right');
                    return (
                      <path
                        d={path}
                        fill="none"
                        stroke="#059669"
                        strokeWidth={2.6}
                        strokeDasharray="5 4"
                      />
                    );
                  })()}
              </svg>

              {/* Interactive Nodes Layer */}
              {layout.nodes.map((node) => {
                const movable = isNodeMovable(node);
                const connectable = isNodeConnectable(node);
                const isSelected = selectedNodeKey === node.key;
                const isNestSource = nestMode && nestSourceKey === node.key;
                const isConnectSource = connectMode && connectPendingSource?.key === node.key;
                const isWireTargetNode = hoveredConnectTarget?.key === node.key;
                const isNestHoverTarget = hoveredNestTargetKey === node.key;
                const isDraggingThis = draggingNest?.moved && draggingNest.key === node.key;

                // Visual hint for valid/invalid parent targets when a source is picked in Nest Mode
                const nestTargetAbility =
                  nestMode && nestSourceKey && nestSourceKey !== node.key
                    ? canNestTarget(nestSourceKey, node)
                    : null;
                const isInvalidNestChoice =
                  nestMode &&
                  Boolean(nestSourceKey) &&
                  nestSourceKey !== node.key &&
                  !nestTargetAbility &&
                  node.kind !== 'ADD_HINT';

                const isConnectedToSelected =
                  Boolean(selectedNodeKey) &&
                  (customEdges.some(
                    (e) =>
                      (e.fromKey === selectedNodeKey && e.toKey === node.key) ||
                      (e.toKey === selectedNodeKey && e.fromKey === node.key)
                  ) ||
                    relatedIdeaWires.some(
                      (w) =>
                        (w.fromKey === selectedNodeKey && w.toKey === node.key) ||
                        (w.toKey === selectedNodeKey && w.fromKey === node.key)
                    ));

                const hasParentOverride = Boolean(parentOverrides[node.key]);
                const descendantCount = layout.descendantCountMap.get(node.key) || 0;
                const isCollapsed = collapsedKeys.has(node.key);
                const matchesFilter = doesNodeMatchFilter(node);
                const isHighlighted = highlightedNodeKey === node.key;

                const isClickable =
                  connectMode
                    ? connectable
                    : nestMode
                    ? movable || (Boolean(nestSourceKey) && Boolean(nestTargetAbility))
                    : node.kind === 'IDEA' ||
                      node.kind === 'ENTRY' ||
                      node.kind === 'INTENT_PINNED' ||
                      node.kind === 'NEXT_STEP' ||
                      node.kind === 'ADD_HINT' ||
                      node.kind === 'PROJECT_LEAF' ||
                      (node.kind === 'HUB' && Boolean(onAddIdea || onAddEntry) && node.key !== 'hub-next');

                return (
                  <div
                    key={node.key}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.w,
                      height: node.h,
                      ...(nestMode && movable ? { WebkitTouchCallout: 'none' as const } : {}),
                    }}
                    onPointerDown={(e) => {
                      if (!nestMode || !movable || (e.pointerType === 'mouse' && e.button !== 0)) return;
                      e.stopPropagation();
                      if (!canvasRef.current) return;
                      const rect = canvasRef.current.getBoundingClientRect();
                      const px = (e.clientX - rect.left) / scale;
                      const py = (e.clientY - rect.top) / scale;
                      setDraggingNest({
                        key: node.key,
                        startClientX: e.clientX,
                        startClientY: e.clientY,
                        origX: node.x,
                        origY: node.y,
                        grabOffsetX: Math.max(12, Math.min(node.w - 12, px - node.x)),
                        grabOffsetY: Math.max(10, Math.min(node.h - 10, py - node.y)),
                        pointerX: px,
                        pointerY: py,
                        moved: false,
                      });
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      // When nestMode + movable, pointerup already handles both click and drag!
                      if (nestMode && movable) return;
                      handleNodeNormalOrModeClick(node);
                    }}
                    className={`group absolute rounded-xl border px-2.5 py-1.5 shadow-2xs flex flex-col justify-center transition ${
                      node.bgClass
                    } ${node.borderClass} ${
                      nestMode && movable
                        ? 'cursor-grab active:cursor-grabbing touch-none select-none hover:border-emerald-500 hover:shadow-md'
                        : isClickable
                        ? 'cursor-pointer hover:shadow-md hover:border-forest-500'
                        : ''
                    } ${isSelected ? 'ring-2 ring-gold-500 shadow-md z-30' : 'z-20'} ${
                      isConnectedToSelected ? 'ring-2 ring-violet-400' : ''
                    } ${isNestSource ? 'ring-2 ring-emerald-600 bg-emerald-50 shadow-md z-30' : ''} ${
                      isConnectSource ? 'ring-2 ring-violet-600 bg-violet-50 shadow-md z-30' : ''
                    } ${isWireTargetNode ? 'ring-2 ring-violet-500 bg-violet-50/40 z-30' : ''} ${
                      isNestHoverTarget ? 'ring-2 ring-emerald-500 bg-emerald-50/70 scale-[1.03] z-30' : ''
                    } ${nestTargetAbility ? 'hover:ring-2 hover:ring-emerald-400' : ''} ${
                      isInvalidNestChoice ? 'opacity-40 cursor-not-allowed' : ''
                    } ${isDraggingThis ? 'opacity-45 border-dashed' : ''} ${
                      hasParentOverride && !isNestSource ? 'border-l-4 border-l-emerald-600' : ''
                    } ${isSearchActive && !matchesFilter ? 'opacity-25' : ''} ${
                      isSearchActive && matchesFilter && node.kind !== 'ROOT' ? 'ring-2 ring-amber-400' : ''
                    } ${isHighlighted ? 'ring-4 ring-amber-500 shadow-lg animate-pulse z-40' : ''}`}
                  >
                    {/* Subtree Collapse / Expand Toggle Badge ([-] / [+N]) */}
                    {!connectMode &&
                      !nestMode &&
                      node.kind !== 'ROOT' &&
                      node.kind !== 'ADD_HINT' &&
                      descendantCount > 0 && (
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
                          className={`absolute -right-2.5 top-1/2 -translate-y-1/2 z-30 h-5 px-1.5 rounded-full border text-[10px] font-mono font-bold shadow-xs transition flex items-center justify-center ${
                            isCollapsed
                              ? 'bg-amber-500 text-white border-amber-700 hover:bg-amber-600 scale-105'
                              : 'bg-white text-charcoal-600 border-ivory-400 opacity-0 group-hover:opacity-100 hover:bg-ivory-100'
                          }`}
                        >
                          {isCollapsed ? `+${descendantCount}` : '−'}
                        </button>
                      )}
                    {/* Hover / Pick Badges for Nest & Connect modes */}
                    {isNestSource && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-bold whitespace-nowrap shadow-xs pointer-events-none">
                        {L('↳ 이동할 자식', '↳ 移動する子', '↳ Selected Child')}
                      </span>
                    )}
                    {isNestHoverTarget && draggingNest && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-emerald-700 text-white text-[10px] font-bold whitespace-nowrap shadow-xs pointer-events-none">
                        {canNestTarget(draggingNest.key, node) === 'DETACH'
                          ? L('↳ 기본 위치로 분리', '↳ 元の位置へ戻す', '↳ Detach to Default')
                          : L('↳ 여기에 종속', '↳ ここに従属', '↳ Nest here')}
                      </span>
                    )}
                    {isConnectSource && (
                      <span className="absolute -top-5 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-full bg-violet-700 text-white text-[10px] font-bold whitespace-nowrap shadow-xs pointer-events-none">
                        {L('🔗 연결 시작점', '🔗 接続元', '🔗 Wire Source')}
                      </span>
                    )}

                    {/* 4-Way Port Handle Dots — shown when Connect Mode is active */}
                    {connectMode &&
                      connectable &&
                      PORT_SIDES.map((side) => {
                        const isHoveredPort =
                          hoveredConnectTarget?.key === node.key && hoveredConnectTarget?.side === side;
                        const isWireSourcePort =
                          connectingWire?.fromKey === node.key && connectingWire?.fromSide === side;
                        const isPendingPort =
                          connectPendingSource?.key === node.key && connectPendingSource?.side === side;
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
                            title={L('클릭 또는 드래그하여 연결', 'クリックまたはドラッグで接続', 'Click or drag to connect')}
                            onPointerDown={(e) => {
                              e.stopPropagation();
                              e.preventDefault();
                              const pt = getPortCoords(node.x, node.y, node.w, node.h, side);
                              setConnectingWire({
                                fromKey: node.key,
                                fromSide: side,
                                startClientX: e.clientX,
                                startClientY: e.clientY,
                                pointerX: pt.x,
                                pointerY: pt.y,
                                moved: false,
                              });
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className={`absolute ${posCls} w-3.5 h-3.5 rounded-full border-2 cursor-crosshair touch-none transition-all z-30 ${
                              isHoveredPort || isWireSourcePort || isPendingPort
                                ? 'bg-violet-600 border-white scale-125 opacity-100 ring-2 ring-violet-400'
                                : connectingWire || connectPendingSource
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
                    ) : node.kind === 'PROJECT_LEAF' && node.projectItem ? (
                      <div className="space-y-0.5 min-w-0 pointer-events-none">
                        <div className="flex items-center justify-between gap-1">
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
                          {node.badge && (
                            <span className="text-[10px] font-mono font-bold text-charcoal-600 shrink-0">
                              {node.badge}
                            </span>
                          )}
                        </div>
                        {node.subtitle && (
                          <div className="text-[10px] text-charcoal-600 truncate">{node.subtitle}</div>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-0.5 min-w-0 pointer-events-none">
                        <div className="flex items-center justify-between gap-1 min-w-0">
                          <span className="font-bold text-xs text-charcoal-900 truncate">
                            {node.title}
                          </span>
                          <div className="flex items-center gap-1 shrink-0">
                            {hasParentOverride && (
                              <span
                                title={L('다른 노드에 종속됨', '他ノードに従属', 'Nested under another node')}
                                className="text-[9px] font-bold px-1 rounded bg-emerald-100 text-emerald-800 border border-emerald-300"
                              >
                                ↳
                              </span>
                            )}
                            {node.badge && (
                              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-white/90 border border-ivory-300 text-charcoal-800 whitespace-nowrap">
                                {node.badge}
                              </span>
                            )}
                          </div>
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

              {/* Trailing Dashed [+] Add Buttons on Each Branch's Last Node & Project Root */}
              {!connectMode &&
                !nestMode &&
                layout.leafAddButtons.map((btn) => (
                  <button
                    key={btn.key}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (btn.isRootSubtopicTrigger) {
                        openComposerForNode(null, 'DIALOGUE_ME', true);
                      } else {
                        openComposerForNode(btn.parentNode);
                      }
                    }}
                    style={{
                      left: btn.x,
                      top: btn.y,
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

              {/* Floating Ghost Preview Card during Drag-and-Drop Nesting */}
              {draggingNest?.moved && draggingGhostNode && (
                <div
                  style={{
                    left: draggingNest.pointerX - draggingNest.grabOffsetX,
                    top: draggingNest.pointerY - draggingNest.grabOffsetY,
                    width: draggingGhostNode.w,
                    height: draggingGhostNode.h,
                  }}
                  className={`fixed-ghost absolute rounded-xl border-2 border-emerald-500 px-2.5 py-1.5 shadow-xl opacity-85 pointer-events-none z-50 flex flex-col justify-center ${draggingGhostNode.bgClass}`}
                >
                  <div className="font-bold text-xs text-charcoal-900 truncate">
                    {draggingGhostNode.title}
                  </div>
                  {draggingGhostNode.subtitle && (
                    <p className="text-[10px] text-charcoal-600 truncate">
                      {draggingGhostNode.subtitle}
                    </p>
                  )}
                </div>
              )}
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
      )}

      {/* Selected Node Inspector & Graph Action Bar */}
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
                    : selectedNode.kind === 'INTENT_PINNED'
                    ? L('최초 의도', '当初の目的', 'Intent')
                    : selectedNode.kind === 'NEXT_STEP'
                    ? L('Next Step', 'Next Step', 'Next Step')
                    : L('노드 상세', 'ノード詳細', 'Node')}
                </span>
                <span className="font-bold text-sm text-charcoal-900">
                  {tr.getText(`jmm-${selectedNode.key}`, 'title', selectedNode.title)}
                </span>
                <TranslateButton
                  size="xs"
                  visible={tr.shouldShowButton(selectedNode.title, selectedNode.subtitle)}
                  translated={tr.isTranslated(`jmm-${selectedNode.key}`)}
                  loading={tr.isTranslating(`jmm-${selectedNode.key}`)}
                  error={tr.getError(`jmm-${selectedNode.key}`)}
                  onClick={() =>
                    tr.toggleTranslate(
                      `jmm-${selectedNode.key}`,
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
                    {tr.getText(`jmm-${selectedNode.key}`, 'subtitle', selectedNode.subtitle)}
                  </p>
                )
              )}

              {/* Active Nest Override Badge + Detach Button */}
              {parentOverrides[selectedNode.key] && (
                <div className="flex items-center gap-2 pt-1 flex-wrap">
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 border border-emerald-300 text-[11px] font-bold">
                    <CornerDownRight className="w-3 h-3" />
                    {parentOverrides[selectedNode.key] === ROOT_SUBTOPIC_KEY
                      ? L('🌿 루트 직결 독립 서브토픽', '🌿 ルート直結サブトピック', '🌿 Root Subtopic')
                      : `${L('종속 상위:', '従属親:', 'Nested under:')} ${
                          layout.nodeMap.get(
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

              {/* Shared Custom Edges connected to this Node */}
              {selectedNodeEdges.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[11px] font-bold text-violet-800 inline-flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    {L('연결선:', '接続線:', 'Wires:')}
                  </span>
                  {selectedNodeEdges.map((edge) => {
                    const fKey = remapMindMapKey(edge.fromKey, duplicateInitialEntryId);
                    const tKey = remapMindMapKey(edge.toKey, duplicateInitialEntryId);
                    const otherKey = fKey === selectedNode.key ? tKey : fKey;
                    const otherNode = layout.nodeMap.get(otherKey);
                    return (
                      <span
                        key={edge.id}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-900 border border-violet-300 text-[11px] font-bold"
                      >
                        <button
                          type="button"
                          onClick={() => selectAndSyncNode(otherKey)}
                          className="hover:underline"
                        >
                          {otherNode?.title || otherKey}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteCustomEdge(edge.id)}
                          title={L('연결선 삭제', '接続線を削除', 'Remove wire')}
                          className="hover:text-rose-700"
                        >
                          <Unlink className="w-3 h-3" />
                        </button>
                      </span>
                    );
                  })}
                </div>
              )}

              {/* Legacy Idea <-> Idea Sibling Links (if any) */}
              {selectedIdea && (selectedIdea.related_idea_ids || []).length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[11px] font-bold text-violet-800 inline-flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    {L('상호 연결 아이디어:', '相互アイデア:', 'Linked Ideas:')}
                  </span>
                  {(selectedIdea.related_idea_ids || []).map((relId) => {
                    const rel = ideas.find((i) => i.id === relId);
                    if (!rel) return null;
                    return (
                      <span
                        key={`rel-${rel.id}`}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-900 border border-violet-300 text-[11px] font-bold"
                      >
                        <button
                          type="button"
                          onClick={() => selectAndSyncNode(`idea-${rel.id}`)}
                          className="hover:underline"
                        >
                          {rel.title}
                        </button>
                        {project && onToggleRelatedIdea && (
                          <button
                            type="button"
                            onClick={() => void onToggleRelatedIdea(selectedIdea.id, rel.id, project.id)}
                            title={L('연결 해제', '接続解除', 'Unlink')}
                            className="hover:text-rose-700"
                          >
                            <Unlink className="w-3 h-3" />
                          </button>
                        )}
                      </span>
                    );
                  })}
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

          {/* Quick Actions Footer */}
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap sm:items-center gap-1.5 pt-2 border-t border-ivory-200">
            {isNodeConnectable(selectedNode) && (
              <button
                type="button"
                onClick={() => {
                  setNestMode(false);
                  setNestSourceKey(null);
                  setConnectMode(true);
                  setConnectPendingSource({ key: selectedNode.key });
                }}
                className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-violet-300 text-violet-800 font-bold hover:bg-violet-50 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
              >
                <Link2 className="w-3.5 h-3.5 shrink-0" />
                <span>{L('이 노드에서 연결 시작', 'ここから接続開始', 'Connect From Here')}</span>
              </button>
            )}

            {isNodeMovable(selectedNode) && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setConnectMode(false);
                    setConnectPendingSource(null);
                    setNestMode(true);
                    setNestSourceKey(selectedNode.key);
                  }}
                  className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-emerald-300 text-emerald-800 font-bold hover:bg-emerald-50 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                >
                  <CornerDownRight className="w-3.5 h-3.5 shrink-0" />
                  <span>{L('다른 노드 아래로 종속', '他ノードへ従属', 'Nest Under Another')}</span>
                </button>
                {project && parentOverrides[selectedNode.key] !== ROOT_SUBTOPIC_KEY && (
                  <button
                    type="button"
                    onClick={() => {
                      pushUndoSnapshot();
                      const nextParents = {
                        ...parentOverrides,
                        [selectedNode.key]: ROOT_SUBTOPIC_KEY,
                      };
                      setParentOverrides(nextParents);
                      persistLayout(customEdges, nextParents);
                    }}
                    className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-purple-300 text-purple-800 font-bold hover:bg-purple-50 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                  >
                    <span aria-hidden="true" className="shrink-0">🌿</span>
                    <span>{L('루트 서브토픽으로 분리', 'ルートサブトピック化', 'Make Root Subtopic')}</span>
                  </button>
                )}
              </>
            )}

            {project && (onAddIdea || onAddEntry) && isNodeMovable(selectedNode) && (
              <button
                type="button"
                onClick={() => openComposerForNode(selectedNode)}
                className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-forest-800 text-white font-bold hover:bg-forest-900 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
              >
                <Plus className="w-3.5 h-3.5 shrink-0" />
                <span>{L('이 노드에서 가지 뻗기', 'ここから分岐を追加', 'Add Child Node')}</span>
              </button>
            )}

            {project && onJumpToTimeline && (selectedEntry || selectedIdea) && (
              <button
                type="button"
                onClick={() => onJumpToTimeline(selectedNode.key)}
                className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-sky-300 text-sky-900 font-bold hover:bg-sky-50 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
              >
                <MessageSquare className="w-3.5 h-3.5 shrink-0" />
                <span>{L('타임라인에서 보기', 'タイムラインで見る', 'View in Timeline')}</span>
              </button>
            )}

            {project && selectedEntry && (
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
                      openComposerForNode(selectedNode, 'PROGRESS', false, `ENTRY:${selectedEntry.id}`)
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

            {project && selectedIdea && (
              <>
                {onPromoteIdea && selectedIdea.status !== 'PROMOTED' && (
                  <button
                    type="button"
                    onClick={() => void onPromoteIdea(selectedIdea)}
                    className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-emerald-600 text-white font-bold hover:bg-emerald-700 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
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
                    className="w-full sm:w-auto min-h-[34px] sm:min-h-0 px-2 sm:px-2.5 py-1.5 sm:py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 font-bold hover:bg-ivory-100 inline-flex items-center justify-center gap-1 text-[11px] sm:text-xs leading-tight text-center break-keep"
                  >
                    {selectedIdea.status === 'ARCHIVED' ? (
                      <>
                        <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                        <span>{L('다시 열기', '再開', 'Reopen')}</span>
                      </>
                    ) : (
                      <>
                        <Archive className="w-3.5 h-3.5 shrink-0" />
                        <span>{L('보관', '保管', 'Archive')}</span>
                      </>
                    )}
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
          </div>
            </>
          );
        };

        return (
          <>
            {!isMobileViewport && selectedNode && (
              <div className="p-3.5 bg-ivory-50 border-t border-ivory-300 space-y-2.5 text-xs">
                {renderSelectedNodeInspector()}
              </div>
            )}
            <MobileNodeBottomSheet
              isOpen={isMobileViewport && Boolean(selectedNode)}
              onClose={() => selectAndSyncNode(null)}
              title={L('노드 상세', 'ノード詳細', 'Node Detail')}
            >
              {selectedNode && (
                <div className="p-3.5 space-y-2.5 text-xs">
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
