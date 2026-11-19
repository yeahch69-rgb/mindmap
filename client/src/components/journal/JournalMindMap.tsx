import React, { useMemo, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import {
  Archive,
  ExternalLink,
  GitBranch,
  Link2,
  Lock,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  Unlink,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { EntryType, IdeaStatus, JournalEntry, JournalIdea, JournalProject, TurnState } from './types';

interface JournalMindMapProps {
  /** Single-project mode when provided; workspace overview mode when null */
  project: JournalProject | null;
  entries?: JournalEntry[];
  ideas?: JournalIdea[];
  /** Workspace overview mode project list */
  allProjects?: JournalProject[];
  /** Select a project inside global Mind Map view */
  onFocusProject?: (projectId: number | null) => void;
  /** Open full project detail view */
  onOpenProjectDetail?: (projectId: number) => void;
  /** Idea CRUD callbacks (required for interactive editing in single-project mode) */
  onAddIdea?: (payload: { projectId: number; title: string; note: string | null; parent_idea_id: number | null }) => Promise<void>;
  onToggleRelatedIdea?: (ideaId: number, targetIdeaId: number, projectId: number) => Promise<void>;
  onPromoteIdea?: (idea: JournalIdea) => Promise<void>;
  onUpdateIdeaStatus?: (idea: JournalIdea, status: IdeaStatus) => Promise<void>;
  onDeleteIdea?: (idea: JournalIdea) => Promise<void>;
}

interface PositionedNode {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
  parentKey?: string;
  edgeColor: string;
  kind: 'ROOT' | 'HUB' | 'INTENT_LEAF' | 'DIALOGUE_LEAF' | 'IDEA' | 'NEXT_STEP' | 'ADD_HINT' | 'TURN_HUB' | 'PROJECT_LEAF';
  title: string;
  subtitle?: string;
  badge?: string;
  accentColor: string;
  bgClass: string;
  borderClass: string;
  idea?: JournalIdea;
  projectItem?: JournalProject;
}

const ZOOM_LEVELS = [0.75, 0.9, 1, 1.15, 1.3];

export const JournalMindMap: React.FC<JournalMindMapProps> = ({
  project,
  entries = [],
  ideas = [],
  allProjects = [],
  onFocusProject,
  onOpenProjectDetail,
  onAddIdea,
  onToggleRelatedIdea,
  onPromoteIdea,
  onUpdateIdeaStatus,
  onDeleteIdea,
}) => {
  const { L } = useLanguage();

  const [zoomIdx, setZoomIdx] = useState(2); // 1.0 default
  const scale = ZOOM_LEVELS[zoomIdx] || 1;

  const [selectedIdeaId, setSelectedIdeaId] = useState<number | null>(null);
  const [linkingSourceId, setLinkingSourceId] = useState<number | null>(null);

  // Quick Idea Composer state inside Mind Map
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerParentId, setComposerParentId] = useState<number | null>(null);
  const [composerTitle, setComposerTitle] = useState('');
  const [composerNote, setComposerNote] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedIdea = useMemo(
    () => ideas.find((i) => i.id === selectedIdeaId) || null,
    [ideas, selectedIdeaId]
  );

  const linkingSourceIdea = useMemo(
    () => ideas.find((i) => i.id === linkingSourceId) || null,
    [ideas, linkingSourceId]
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
    return L('🧭 의도', '🧭 意図', '🧭 Intent');
  };

  // Compute Layout (either Workspace Overview OR Single-Project Tree)
  const layout = useMemo(() => {
    const nodes: PositionedNode[] = [];
    const crossLinks: Array<{ fromKey: string; toKey: string; fromId: number; toId: number }> = [];
    const promotedLinks: Array<{ fromKey: string; toKey: string }> = [];

    const V_GAP = 16;

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
        return { nodes: [], crossLinks: [], promotedLinks: [], width: 700, height: 240 };
      }

      const LEAF_H = 66;
      const HUB_H = 48;
      let cursorY = 28;
      const hubPositions: Array<{ turn: TurnState; y: number; h: number; items: JournalProject[] }> = [];

      for (const t of activeBuckets) {
        const items = grouped.get(t) || [];
        const branchHeight = Math.max(HUB_H, items.length * LEAF_H + Math.max(0, items.length - 1) * V_GAP);
        const hubY = cursorY + (branchHeight - HUB_H) / 2;
        hubPositions.push({ turn: t, y: hubY, h: branchHeight, items });

        let leafCursorY = cursorY;
        const meta = getTurnMeta(t);
        for (const p of items) {
          nodes.push({
            key: `proj-${p.id}`,
            x: 530,
            y: leafCursorY,
            w: 270,
            h: LEAF_H,
            parentKey: `hub-${t}`,
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
          leafCursorY += LEAF_H + V_GAP;
        }

        nodes.push({
          key: `hub-${t}`,
          x: 280,
          y: hubY,
          w: 180,
          h: HUB_H,
          parentKey: 'ws-root',
          edgeColor: meta.color,
          kind: 'TURN_HUB',
          title: `${meta.label} (${items.length})`,
          accentColor: meta.color,
          bgClass: meta.bg,
          borderClass: meta.border,
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

      return { nodes, crossLinks, promotedLinks, width: 860, height: totalH };
    }

    // ---------------------------------------------------------
    // MODE B: SINGLE-PROJECT RECURSIVE TREE MIND MAP
    // ---------------------------------------------------------
    const turnMeta = getTurnMeta(project.turn_state);

    // Prepare children of the 4 main branches:
    // 1. INTENT branch
    const intentEntries = entries.filter((e) => e.entry_type === 'INTENT').slice(-4);
    const intentLeaves: Array<{ title: string; subtitle?: string; badge?: string }> = [];
    if (project.intent_summary) {
      intentLeaves.push({
        title: L('최초 의도 (Pinned)', '当初の目的 (Pinned)', 'Pinned Intent'),
        subtitle: project.intent_summary,
      });
    }
    for (const en of intentEntries) {
      intentLeaves.push({
        title: `${en.entry_date ? `${en.entry_date.slice(5)} ` : ''}${L('의도·결정', '意図・決定', 'Intent')}`,
        subtitle: en.content,
      });
    }
    if (intentLeaves.length === 0) {
      intentLeaves.push({
        title: L('기록된 의도 없음', '意図の記録なし', 'No intent logs yet'),
      });
    }

    // 2. DIALOGUE / PROGRESS branch
    const dialogueEntries = entries.filter((e) => e.entry_type !== 'INTENT').slice(-5);
    const dialogueLeaves: Array<{ title: string; subtitle?: string; edgeColor: string }> = dialogueEntries.map((en) => ({
      title: `${en.entry_date ? `${en.entry_date.slice(5)} · ` : ''}${getEntryLabel(en.entry_type, en.speaker_name)}`,
      subtitle: en.content,
      edgeColor:
        en.entry_type === 'DIALOGUE_ME'
          ? '#1B4D3E'
          : en.entry_type === 'DIALOGUE_THEM'
          ? '#0284C7'
          : '#059669',
    }));
    if (dialogueLeaves.length === 0) {
      dialogueLeaves.push({
        title: L('대화·진행 기록 없음', '対話・進捗記録なし', 'No dialogue logs yet'),
        edgeColor: '#0284C7',
      });
    }

    // 3. RECURSIVE IDEA TREE
    const ideaMap = new Map<number, JournalIdea>();
    const childrenMap = new Map<number, JournalIdea[]>();
    const rootIdeas: JournalIdea[] = [];
    for (const idea of ideas) {
      ideaMap.set(idea.id, idea);
    }
    for (const idea of ideas) {
      if (idea.parent_idea_id && ideaMap.has(idea.parent_idea_id) && idea.parent_idea_id !== idea.id) {
        const arr = childrenMap.get(idea.parent_idea_id) || [];
        arr.push(idea);
        childrenMap.set(idea.parent_idea_id, arr);
      } else {
        rootIdeas.push(idea);
      }
    }

    const IDEA_W = 225;
    const IDEA_H = 66;
    const IDEA_X0 = 540;
    const IDEA_DX = 260;
    let maxCanvasX = 820;

    // Recursive subtree height calculator (guard against cycles via visited set)
    const subtreeHCache = new Map<number, number>();
    const calcIdeaSubtreeHeight = (ideaId: number, visited: Set<number>): number => {
      if (visited.has(ideaId)) return IDEA_H;
      visited.add(ideaId);
      const kids = (childrenMap.get(ideaId) || []).filter((k) => !visited.has(k.id));
      if (kids.length === 0) {
        subtreeHCache.set(ideaId, IDEA_H);
        return IDEA_H;
      }
      let sum = 0;
      kids.forEach((k, idx) => {
        sum += calcIdeaSubtreeHeight(k.id, new Set(visited));
        if (idx < kids.length - 1) sum += V_GAP;
      });
      const total = Math.max(IDEA_H, sum);
      subtreeHCache.set(ideaId, total);
      return total;
    };

    for (const r of rootIdeas) {
      calcIdeaSubtreeHeight(r.id, new Set());
    }

    const ideaNodePosMap = new Map<number, { x: number; y: number; w: number; h: number }>();

    const placeIdeaSubtree = (idea: JournalIdea, depth: number, topY: number, parentNodeKey: string, visited: Set<number>) => {
      if (visited.has(idea.id)) return;
      visited.add(idea.id);

      const x = IDEA_X0 + depth * IDEA_DX;
      maxCanvasX = Math.max(maxCanvasX, x + IDEA_W + 80);

      const totalH = subtreeHCache.get(idea.id) || IDEA_H;
      const y = topY + (totalH - IDEA_H) / 2;
      const nodeKey = `idea-${idea.id}`;

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

      nodes.push({
        key: nodeKey,
        x,
        y,
        w: IDEA_W,
        h: IDEA_H,
        parentKey: parentNodeKey,
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

      ideaNodePosMap.set(idea.id, { x, y, w: IDEA_W, h: IDEA_H });

      const kids = (childrenMap.get(idea.id) || []).filter((k) => !visited.has(k.id));
      let childTop = topY;
      for (const k of kids) {
        const kidH = subtreeHCache.get(k.id) || IDEA_H;
        placeIdeaSubtree(k, depth + 1, childTop, nodeKey, new Set(visited));
        childTop += kidH + V_GAP;
      }
    };

    // Place the 4 vertical sections cleanly
    const HUB_X = 295;
    const HUB_W = 180;
    const HUB_H = 44;
    const LEAF_X = 540;
    const LEAF_W = 230;
    const LEAF_H = 56;
    const SECTION_GAP = 26;

    let cursorY = 24;

    // Section 1: INTENT
    const intentSpanH = Math.max(HUB_H, intentLeaves.length * LEAF_H + (intentLeaves.length - 1) * V_GAP);
    const intentHubY = cursorY + (intentSpanH - HUB_H) / 2;
    nodes.push({
      key: 'hub-intent',
      x: HUB_X,
      y: intentHubY,
      w: HUB_W,
      h: HUB_H,
      parentKey: 'proj-root',
      edgeColor: '#D97706',
      kind: 'HUB',
      title: L('🧭 의도 · 결정 맥락', '🧭 意図・決定文脈', '🧭 Intent & Decisions'),
      accentColor: '#D97706',
      bgClass: 'bg-amber-50',
      borderClass: 'border-amber-300',
    });
    intentLeaves.forEach((leaf, idx) => {
      nodes.push({
        key: `intent-leaf-${idx}`,
        x: LEAF_X,
        y: cursorY + idx * (LEAF_H + V_GAP),
        w: LEAF_W,
        h: LEAF_H,
        parentKey: 'hub-intent',
        edgeColor: '#D97706',
        kind: 'INTENT_LEAF',
        title: leaf.title,
        subtitle: leaf.subtitle,
        accentColor: '#D97706',
        bgClass: 'bg-white',
        borderClass: 'border-amber-200',
      });
    });
    cursorY += intentSpanH + SECTION_GAP;

    // Section 2: DIALOGUE & PROGRESS
    const dialSpanH = Math.max(HUB_H, dialogueLeaves.length * LEAF_H + (dialogueLeaves.length - 1) * V_GAP);
    const dialHubY = cursorY + (dialSpanH - HUB_H) / 2;
    nodes.push({
      key: 'hub-dialogue',
      x: HUB_X,
      y: dialHubY,
      w: HUB_W,
      h: HUB_H,
      parentKey: 'proj-root',
      edgeColor: '#0284C7',
      kind: 'HUB',
      title: L(`💬 대화 · 진행 (${entries.length})`, `💬 対話・進捗 (${entries.length})`, `💬 Dialogue (${entries.length})`),
      accentColor: '#0284C7',
      bgClass: 'bg-sky-50',
      borderClass: 'border-sky-300',
    });
    dialogueLeaves.forEach((leaf, idx) => {
      nodes.push({
        key: `dial-leaf-${idx}`,
        x: LEAF_X,
        y: cursorY + idx * (LEAF_H + V_GAP),
        w: LEAF_W,
        h: LEAF_H,
        parentKey: 'hub-dialogue',
        edgeColor: leaf.edgeColor,
        kind: 'DIALOGUE_LEAF',
        title: leaf.title,
        subtitle: leaf.subtitle,
        accentColor: leaf.edgeColor,
        bgClass: 'bg-white',
        borderClass: 'border-sky-200',
      });
    });
    cursorY += dialSpanH + SECTION_GAP;

    // Section 3: IDEA TREE
    const ideasTotalH =
      rootIdeas.length > 0
        ? rootIdeas.reduce((acc, r, i) => acc + (subtreeHCache.get(r.id) || IDEA_H) + (i > 0 ? V_GAP : 0), 0)
        : 58;
    const ideasSpanH = Math.max(HUB_H, ideasTotalH);
    const ideasHubY = cursorY + (ideasSpanH - HUB_H) / 2;
    nodes.push({
      key: 'hub-ideas',
      x: HUB_X,
      y: ideasHubY,
      w: HUB_W,
      h: HUB_H,
      parentKey: 'proj-root',
      edgeColor: '#B45309',
      kind: 'HUB',
      title: L(`💡 아이디어 가지 (${ideas.length})`, `💡 アイデア分岐 (${ideas.length})`, `💡 Idea Tree (${ideas.length})`),
      accentColor: '#B45309',
      bgClass: 'bg-amber-50',
      borderClass: 'border-amber-400',
    });

    if (rootIdeas.length === 0) {
      nodes.push({
        key: 'idea-add-hint',
        x: LEAF_X,
        y: cursorY,
        w: LEAF_W,
        h: 56,
        parentKey: 'hub-ideas',
        edgeColor: '#D97706',
        kind: 'ADD_HINT',
        title: L('+ 첫 아이디어 가지 추가', '+ 最初のアイデアを追加', '+ Add first idea branch'),
        subtitle: L('클릭해서 가지를 뻗어보세요', 'クリックして分岐を追加', 'Click to start branching'),
        accentColor: '#D97706',
        bgClass: 'bg-amber-50/50 border-dashed',
        borderClass: 'border-amber-400',
      });
    } else {
      let ideaTop = cursorY;
      for (const r of rootIdeas) {
        const subH = subtreeHCache.get(r.id) || IDEA_H;
        placeIdeaSubtree(r, 0, ideaTop, 'hub-ideas', new Set());
        ideaTop += subH + V_GAP;
      }
    }
    cursorY += ideasSpanH + SECTION_GAP;

    // Section 4: NEXT STEP TARGET
    const NEXT_H = 62;
    const nextHubY = cursorY + (NEXT_H - HUB_H) / 2;
    nodes.push({
      key: 'hub-next',
      x: HUB_X,
      y: nextHubY,
      w: HUB_W,
      h: HUB_H,
      parentKey: 'proj-root',
      edgeColor: project.next_action ? '#059669' : '#E11D48',
      kind: 'HUB',
      title: L('🎯 다음 할 일 (Next)', '🎯 次の行動 (Next)', '🎯 Next Step'),
      accentColor: project.next_action ? '#059669' : '#E11D48',
      bgClass: project.next_action ? 'bg-emerald-50' : 'bg-rose-50',
      borderClass: project.next_action ? 'border-emerald-300' : 'border-rose-300',
    });
    nodes.push({
      key: 'next-step-target',
      x: LEAF_X,
      y: cursorY,
      w: 245,
      h: NEXT_H,
      parentKey: 'hub-next',
      edgeColor: project.next_action ? '#059669' : '#E11D48',
      kind: 'NEXT_STEP',
      title: project.next_action || L('Next Step 미지정 (방치 위험)', 'Next Step未定 (放置リスク)', 'No Next Step set'),
      subtitle: project.next_action_date ? `📅 ${project.next_action_date}` : undefined,
      accentColor: project.next_action ? '#059669' : '#E11D48',
      bgClass: project.next_action ? 'bg-emerald-50/90' : 'bg-rose-50/90',
      borderClass: project.next_action ? 'border-emerald-400' : 'border-rose-300',
    });
    cursorY += NEXT_H + 30;

    // Root Project Node centered across hubs
    const rootH = 74;
    const rootY = (intentHubY + nextHubY + HUB_H) / 2 - rootH / 2;
    nodes.push({
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
    });

    // Cross-branch Idea <-> Idea links (deduplicated idA < idB)
    const seenPairs = new Set<string>();
    for (const idea of ideas) {
      for (const targetId of idea.related_idea_ids || []) {
        if (targetId === idea.id || !ideaNodePosMap.has(targetId)) continue;
        const a = Math.min(idea.id, targetId);
        const b = Math.max(idea.id, targetId);
        const pairKey = `${a}-${b}`;
        if (!seenPairs.has(pairKey)) {
          seenPairs.add(pairKey);
          crossLinks.push({
            fromKey: `idea-${a}`,
            toKey: `idea-${b}`,
            fromId: a,
            toId: b,
          });
        }
      }
      if (idea.status === 'PROMOTED') {
        promotedLinks.push({
          fromKey: `idea-${idea.id}`,
          toKey: 'next-step-target',
        });
      }
    }

    return {
      nodes,
      crossLinks,
      promotedLinks,
      width: Math.max(850, maxCanvasX),
      height: Math.max(360, cursorY),
    };
  }, [project, allProjects, entries, ideas, L]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, PositionedNode>();
    for (const n of layout.nodes) m.set(n.key, n);
    return m;
  }, [layout.nodes]);

  const openComposerForParent = (parentId: number | null) => {
    setComposerParentId(parentId);
    setComposerTitle('');
    setComposerNote('');
    setComposerOpen(true);
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

  const handleIdeaCardClick = async (idea: JournalIdea) => {
    if (linkingSourceId !== null && project && onToggleRelatedIdea) {
      if (linkingSourceId === idea.id) {
        setLinkingSourceId(null);
        return;
      }
      await onToggleRelatedIdea(linkingSourceId, idea.id, project.id);
      return;
    }
    setSelectedIdeaId((prev) => (prev === idea.id ? null : idea.id));
  };

  return (
    <div className="bg-white rounded-xl border border-ivory-300 shadow-2xs overflow-hidden">
      {/* Mind Map Top Toolbar */}
      <div className="px-3 py-2.5 bg-ivory-50 border-b border-ivory-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-900">
            <GitBranch className="w-4 h-4 text-forest-700" />
            <span>
              {project
                ? L(`마인드맵 · ${project.title}`, `マインドマップ · ${project.title}`, `Mind Map · ${project.title}`)
                : L('전체 프로젝트 관계 마인드맵', '全体プロジェクト・マインドマップ', 'Workspace Mind Map')}
            </span>
          </div>

          <div className="hidden md:flex items-center gap-2 text-[11px] font-bold text-charcoal-600 pl-2 border-l border-ivory-300">
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 bg-amber-600 inline-block" />
              {L('가지 분기', '分岐', 'Branch')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-violet-600 inline-block" />
              {L('상호 연결 🔗', '相互リンク 🔗', 'Cross-Link')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-3 h-0.5 border-t-2 border-dashed border-emerald-600 inline-block" />
              {L('Next Step 승격 ✨', 'Next Step昇格 ✨', 'Promoted')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 flex-wrap">
          {project && onAddIdea && (
            <button
              type="button"
              onClick={() => openComposerForParent(null)}
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
        </div>
      </div>

      {/* Link Mode Banner */}
      {linkingSourceIdea && (
        <div className="px-3 py-2 bg-violet-50 border-b border-violet-200 flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 font-bold text-violet-900">
            <Link2 className="w-4 h-4 text-violet-700 shrink-0" />
            <span>
              {L(
                `[${linkingSourceIdea.title}] 와 연결·해제할 다른 아이디어 노드를 클릭하세요.`,
                `「${linkingSourceIdea.title}」と接続・解除する他のアイデアをクリックしてください。`,
                `Click another idea node to link or unlink with "${linkingSourceIdea.title}".`
              )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setLinkingSourceId(null)}
            className="px-2.5 py-1 rounded-lg bg-violet-700 text-white font-bold hover:bg-violet-800 shrink-0"
          >
            {L('연결 완료', '接続終了', 'Done')}
          </button>
        </div>
      )}

      {/* Inline Sub-Idea / Root-Idea Composer */}
      {composerOpen && project && onAddIdea && (
        <form
          onSubmit={handleSubmitIdea}
          className="p-3 bg-amber-50/60 border-b border-amber-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2 text-xs"
        >
          <div className="px-2 py-1 rounded bg-amber-100 border border-amber-300 text-amber-900 font-bold whitespace-nowrap shrink-0">
            {composerParentId
              ? `${L('하위 가지 →', '子ノード →', 'Child of:')} ${
                  ideas.find((i) => i.id === composerParentId)?.title || ''
                }`
              : L('루트 아이디어', 'ルートアイデア', 'Root Idea')}
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

      {/* Mind Map Canvas */}
      {layout.nodes.length === 0 ? (
        <div className="py-12 text-center text-xs text-charcoal-400">
          {L('마인드맵에 표시할 프로젝트가 없습니다.', 'マインドマップに表示するプロジェクトがありません。', 'No projects to display on mind map.')}
        </div>
      ) : (
        <div className="overflow-auto bg-ivory-50/40 relative max-h-[680px]">
          <div
            style={{
              width: layout.width * scale,
              height: layout.height * scale,
            }}
            className="relative"
          >
            <div
              style={{
                width: layout.width,
                height: layout.height,
                transform: `scale(${scale})`,
                transformOrigin: 'top left',
              }}
              className="relative"
            >
              {/* SVG Edges Layer */}
              <svg
                width={layout.width}
                height={layout.height}
                className="absolute inset-0 pointer-events-none"
              >
                {/* Structural Parent -> Child Bezier Curves */}
                {layout.nodes.map((node) => {
                  if (!node.parentKey) return null;
                  const parent = nodeMap.get(node.parentKey);
                  if (!parent) return null;
                  const x1 = parent.x + parent.w;
                  const y1 = parent.y + parent.h / 2;
                  const x2 = node.x;
                  const y2 = node.y + node.h / 2;
                  const cx = (x1 + x2) / 2;
                  return (
                    <path
                      key={`edge-${node.key}`}
                      d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke={node.edgeColor}
                      strokeWidth={2}
                      strokeOpacity={0.55}
                    />
                  );
                })}

                {/* Promoted Idea -> Next Step Curved Links */}
                {layout.promotedLinks.map((lnk, idx) => {
                  const from = nodeMap.get(lnk.fromKey);
                  const to = nodeMap.get(lnk.toKey);
                  if (!from || !to) return null;
                  const x1 = from.x + from.w;
                  const y1 = from.y + from.h / 2;
                  const x2 = to.x + to.w;
                  const y2 = to.y + to.h / 2;
                  const archX = Math.max(x1, x2) + 52;
                  return (
                    <path
                      key={`promo-${idx}`}
                      d={`M ${x1} ${y1} C ${archX} ${y1}, ${archX} ${y2}, ${x2} ${y2}`}
                      fill="none"
                      stroke="#059669"
                      strokeWidth={2.2}
                      strokeDasharray="6 4"
                      strokeOpacity={0.85}
                    />
                  );
                })}

                {/* Cross-Branch Idea <-> Idea Dashed Curves */}
                {layout.crossLinks.map((lnk) => {
                  const from = nodeMap.get(lnk.fromKey);
                  const to = nodeMap.get(lnk.toKey);
                  if (!from || !to) return null;
                  const x1 = from.x + from.w;
                  const y1 = from.y + from.h / 2;
                  const x2 = to.x + to.w;
                  const y2 = to.y + to.h / 2;
                  const archX = Math.max(x1, x2) + 46;
                  const midY = (y1 + y2) / 2;
                  const midX = 0.125 * x1 + 0.75 * archX + 0.125 * x2;
                  return (
                    <g key={`cross-${lnk.fromId}-${lnk.toId}`}>
                      <path
                        d={`M ${x1} ${y1} C ${archX} ${y1}, ${archX} ${y2}, ${x2} ${y2}`}
                        fill="none"
                        stroke="#7C3AED"
                        strokeWidth={2.2}
                        strokeDasharray="5 4"
                        strokeOpacity={0.85}
                      />
                      <circle cx={midX} cy={midY} r={10} fill="#F5F3FF" stroke="#7C3AED" strokeWidth={1.5} />
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
              </svg>

              {/* Interactive Nodes Layer */}
              {layout.nodes.map((node) => {
                const isSelectedIdea = node.kind === 'IDEA' && node.idea?.id === selectedIdeaId;
                const isLinkingSource = node.kind === 'IDEA' && node.idea?.id === linkingSourceId;
                const isLinkedToSource =
                  Boolean(
                    linkingSourceIdea &&
                      node.kind === 'IDEA' &&
                      node.idea &&
                      linkingSourceIdea.related_idea_ids?.includes(node.idea.id)
                  );
                const isClickable =
                  node.kind === 'IDEA' ||
                  node.kind === 'ADD_HINT' ||
                  node.kind === 'PROJECT_LEAF' ||
                  (node.kind === 'HUB' && node.key === 'hub-ideas' && Boolean(onAddIdea));

                return (
                  <div
                    key={node.key}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.w,
                      height: node.h,
                    }}
                    onClick={() => {
                      if (node.kind === 'IDEA' && node.idea) {
                        void handleIdeaCardClick(node.idea);
                      } else if (
                        (node.kind === 'ADD_HINT' || (node.kind === 'HUB' && node.key === 'hub-ideas')) &&
                        onAddIdea
                      ) {
                        openComposerForParent(null);
                      } else if (node.kind === 'PROJECT_LEAF' && node.projectItem) {
                        if (onFocusProject) {
                          onFocusProject(node.projectItem.id);
                        } else if (onOpenProjectDetail) {
                          onOpenProjectDetail(node.projectItem.id);
                        }
                      }
                    }}
                    className={`absolute rounded-xl border px-2.5 py-1.5 shadow-2xs flex flex-col justify-center transition ${
                      node.bgClass
                    } ${node.borderClass} ${
                      isClickable ? 'cursor-pointer hover:shadow-md hover:border-forest-500' : ''
                    } ${isSelectedIdea ? 'ring-2 ring-gold-500 shadow-md' : ''} ${
                      isLinkingSource ? 'ring-2 ring-violet-600 bg-violet-50' : ''
                    } ${isLinkedToSource ? 'ring-2 ring-violet-400' : ''}`}
                  >
                    {node.kind === 'ROOT' ? (
                      <div className="space-y-0.5 min-w-0">
                        <div className="font-bold text-xs leading-snug line-clamp-2">{node.title}</div>
                        {node.subtitle && (
                          <div className="text-[10px] opacity-85 truncate">{node.subtitle}</div>
                        )}
                      </div>
                    ) : node.kind === 'PROJECT_LEAF' && node.projectItem ? (
                      <div className="space-y-0.5 min-w-0">
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
                      <div className="space-y-0.5 min-w-0">
                        <div className="flex items-center justify-between gap-1 min-w-0">
                          <span className="font-bold text-xs text-charcoal-900 truncate">
                            {node.title}
                          </span>
                          {node.badge && (
                            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-white/90 border border-ivory-300 text-charcoal-800 whitespace-nowrap shrink-0">
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
        </div>
      )}

      {/* Selected Idea Inspector & Graph Action Bar */}
      {project && selectedIdea && (
        <div className="p-3.5 bg-ivory-50 border-t border-ivory-300 space-y-2.5 text-xs">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div className="space-y-1 min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                  {L('선택된 아이디어', '選択中アイデア', 'Selected Idea')}
                </span>
                <span className="font-bold text-sm text-charcoal-900">{selectedIdea.title}</span>
              </div>
              {selectedIdea.note && (
                <p className="text-charcoal-700 whitespace-pre-wrap">{selectedIdea.note}</p>
              )}

              {/* Connected Sibling Idea Chips */}
              {(selectedIdea.related_idea_ids || []).length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  <span className="text-[11px] font-bold text-violet-800 inline-flex items-center gap-1">
                    <Link2 className="w-3 h-3" />
                    {L('연결된 아이디어:', '接続アイデア:', 'Linked:')}
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
                          onClick={() => setSelectedIdeaId(rel.id)}
                          className="hover:underline"
                        >
                          {rel.title}
                        </button>
                        {onToggleRelatedIdea && (
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

            <button
              type="button"
              onClick={() => setSelectedIdeaId(null)}
              className="p-1 rounded-lg hover:bg-ivory-200 text-charcoal-500"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-ivory-200">
            {onAddIdea && (
              <button
                type="button"
                onClick={() => openComposerForParent(selectedIdea.id)}
                className="px-2.5 py-1 rounded-lg bg-forest-800 text-white font-bold hover:bg-forest-900 inline-flex items-center gap-1"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{L('하위 아이디어 뻗기', '子アイデア追加', 'Add Sub-Idea')}</span>
              </button>
            )}

            {onToggleRelatedIdea && (
              <button
                type="button"
                onClick={() =>
                  setLinkingSourceId((prev) => (prev === selectedIdea.id ? null : selectedIdea.id))
                }
                className={`px-2.5 py-1 rounded-lg border font-bold inline-flex items-center gap-1 ${
                  linkingSourceId === selectedIdea.id
                    ? 'bg-violet-700 text-white border-violet-800'
                    : 'bg-white text-violet-800 border-violet-300 hover:bg-violet-50'
                }`}
              >
                <Link2 className="w-3.5 h-3.5" />
                <span>
                  {linkingSourceId === selectedIdea.id
                    ? L('연결 대상 선택 중...', '対象を選択中...', 'Selecting target...')
                    : L('다른 아이디어와 연결', '他アイデアと接続', 'Link to Idea')}
                </span>
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
                {selectedIdea.status === 'ARCHIVED' ? (
                  <>
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>{L('다시 열기', '再開', 'Reopen')}</span>
                  </>
                ) : (
                  <>
                    <Archive className="w-3.5 h-3.5" />
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
                  setSelectedIdeaId(null);
                  if (linkingSourceId === selectedIdea.id) setLinkingSourceId(null);
                }}
                className="px-2.5 py-1 rounded-lg bg-white border border-rose-200 text-rose-700 font-bold hover:bg-rose-50 inline-flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{L('삭제', '削除', 'Delete')}</span>
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
