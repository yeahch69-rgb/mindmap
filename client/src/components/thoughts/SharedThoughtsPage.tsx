import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  BookMarked,
  Calendar,
  CalendarPlus,
  CheckCircle2,
  Edit2,
  Hash,
  History,
  Lightbulb,
  MessageSquare,
  Pin,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  CollabSpace,
  SharedThought,
  ThoughtStance,
  ThoughtStatus,
} from '../../types/spaces';
import { formatShortDate } from '../../utils/calendarUtils';
import { formatJstTime, getJstDateKey } from '../../utils/dateTime';
import { Button } from '../common/Button';
import { ProposeDateModal } from './ProposeDateModal';
import { SendToMindmapModal } from './SendToMindmapModal';
import { ThoughtDetailModal } from './ThoughtDetailModal';

interface SharedThoughtsPageProps {
  spaces: CollabSpace[];
  activeSpace: CollabSpace | null;
  onSelectSpace: (spaceId: number) => void;
  onOpenCreateSpace: () => void;
  onOpenSpaceSettings: (space: CollabSpace) => void;
  onOpenActivityFeed: () => void;
  onJumpToCalendarEvent: (eventId: number, startDate: string) => void;
  onJumpToMindmapProject: (projectId: number) => void;
  onSpacesNeedRefresh: () => void;
  realtimeTick: number;
  initialFocusThoughtId?: number | null;
  onConsumeInitialFocus?: () => void;
}

export const SharedThoughtsPage: React.FC<SharedThoughtsPageProps> = ({
  spaces,
  activeSpace,
  onSelectSpace,
  onOpenCreateSpace,
  onOpenSpaceSettings,
  onOpenActivityFeed,
  onJumpToCalendarEvent,
  onJumpToMindmapProject,
  onSpacesNeedRefresh,
  realtimeTick,
  initialFocusThoughtId,
  onConsumeInitialFocus,
}) => {
  const { user } = useAuth();
  const { L } = useLanguage();

  const [thoughts, setThoughts] = useState<SharedThought[]>([]);
  const [loading, setLoading] = useState(false);

  // 1-Second Quick Drop Composer
  const [quickContent, setQuickContent] = useState('');
  const [quickTitle, setQuickTitle] = useState('');
  const [quickTagsText, setQuickTagsText] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [posting, setPosting] = useState(false);

  // Filters
  const [statusFilter, setStatusFilter] = useState<'ALL' | ThoughtStatus>('ALL');
  const [selectedTag, setSelectedTag] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [detailThoughtId, setDetailThoughtId] = useState<number | null>(null);
  const [detailInitialEditMode, setDetailInitialEditMode] = useState(false);
  const [proposingThought, setProposingThought] = useState<SharedThought | null>(null);
  const [sendingToMindmapThought, setSendingToMindmapThought] = useState<SharedThought | null>(null);
  const [toastMsg, setToastMsg] = useState('');

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? '' : cur));
    }, 2800);
  }, []);

  const loadThoughts = useCallback(async () => {
    if (!activeSpace) return;
    try {
      const res = await api.get<{ thoughts: SharedThought[] }>(`/spaces/${activeSpace.id}/thoughts`);
      setThoughts(res.thoughts || []);
    } catch {
      // ignore transient error
    }
  }, [activeSpace?.id]);

  useEffect(() => {
    if (!activeSpace) return;
    setLoading(true);
    void loadThoughts().finally(() => setLoading(false));
  }, [activeSpace?.id, loadThoughts]);

  useEffect(() => {
    if (activeSpace && realtimeTick > 0) {
      void loadThoughts();
    }
  }, [realtimeTick, activeSpace?.id, loadThoughts]);

  useEffect(() => {
    if (initialFocusThoughtId) {
      setDetailThoughtId(initialFocusThoughtId);
      onConsumeInitialFocus?.();
    }
  }, [initialFocusThoughtId, onConsumeInitialFocus]);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of thoughts) {
      for (const tag of t.tags) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([tag]) => tag);
  }, [thoughts]);

  const filteredThoughts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return thoughts.filter((t) => {
      if (statusFilter === 'ALL') {
        if (t.status === 'ARCHIVED') return false;
      } else if (t.status !== statusFilter) {
        return false;
      }
      if (selectedTag && !t.tags.includes(selectedTag)) return false;
      if (q) {
        const hay = `${t.title} ${t.content} ${t.author_name} ${t.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [thoughts, statusFilter, selectedTag, searchQuery]);

  const handleQuickPost = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!activeSpace || !quickContent.trim() || posting) return;
    try {
      setPosting(true);
      const tags = quickTagsText
        .split(/[,\s]+/)
        .map((s) => s.replace(/^#/, '').trim())
        .filter(Boolean);
      await api.post(`/spaces/${activeSpace.id}/thoughts`, {
        title: quickTitle.trim(),
        content: quickContent.trim(),
        tags,
      });
      setQuickContent('');
      setQuickTitle('');
      setQuickTagsText('');
      setComposerExpanded(false);
      await loadThoughts();
      onSpacesNeedRefresh();
      showToast(L('새 생각을 스페이스에 공유했습니다!', '新しい思考を共有しました！', 'Shared your thought!'));
    } finally {
      setPosting(false);
    }
  };

  const handleCardReact = async (e: React.MouseEvent, thoughtId: number, stance: ThoughtStance) => {
    e.stopPropagation();
    if (!activeSpace) return;
    const res = await api.post<{ thought: SharedThought }>(`/spaces/${activeSpace.id}/thoughts/${thoughtId}/react`, {
      stance,
    });
    setThoughts((prev) => prev.map((t) => (t.id === thoughtId ? res.thought : t)));
    onSpacesNeedRefresh();
  };

  const handleCardTogglePin = async (e: React.MouseEvent, thought: SharedThought) => {
    e.stopPropagation();
    if (!activeSpace) return;
    const res = await api.patch<{ thought: SharedThought }>(`/spaces/${activeSpace.id}/thoughts/${thought.id}`, {
      is_pinned: !thought.is_pinned,
    });
    setThoughts((prev) =>
      prev
        .map((t) => (t.id === thought.id ? res.thought : t))
        .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned))
    );
    showToast(
      res.thought.is_pinned
        ? L('상단에 고정했습니다.', 'ピン留めしました。', 'Pinned to top.')
        : L('고정을 해제했습니다.', 'ピン留めを解除しました。', 'Unpinned.')
    );
  };

  const handleOpenEditModal = (e: React.MouseEvent, thought: SharedThought) => {
    e.stopPropagation();
    setDetailInitialEditMode(true);
    setDetailThoughtId(thought.id);
  };

  const handleCardDelete = async (e: React.MouseEvent, thought: SharedThought) => {
    e.stopPropagation();
    if (!activeSpace) return;
    const ok = window.confirm(
      L('이 생각 카드를 삭제할까요?', 'このアイデアを削除しますか？', 'Delete this thought?')
    );
    if (!ok) return;
    await api.delete(`/spaces/${activeSpace.id}/thoughts/${thought.id}`);
    setThoughts((prev) => prev.filter((t) => t.id !== thought.id));
    onSpacesNeedRefresh();
    showToast(L('생각 카드를 삭제했습니다.', 'アイデアを削除しました。', 'Thought deleted.'));
  };

  const statusMeta = (status: ThoughtStatus) => {
    switch (status) {
      case 'NEW':
        return {
          label: L('새 생각', '新着', 'New'),
          cls: 'bg-sky-100 text-sky-900 border-sky-200',
        };
      case 'DISCUSSING':
        return {
          label: L('논의중', '議論中', 'Discussing'),
          cls: 'bg-violet-100 text-violet-900 border-violet-200',
        };
      case 'PROPOSED':
        return {
          label: L('일정 제안됨', '日程提案中', 'Date Proposed'),
          cls: 'bg-amber-100 text-amber-950 border-amber-300',
        };
      case 'SCHEDULED':
        return {
          label: L('일정 확정됨', '予定確定', 'Scheduled'),
          cls: 'bg-emerald-100 text-emerald-900 border-emerald-300',
        };
      case 'ARCHIVED':
        return {
          label: L('보관됨', 'アーカイブ', 'Archived'),
          cls: 'bg-ivory-200 text-charcoal-600 border-ivory-300',
        };
    }
  };

  if (!activeSpace) {
    return (
      <div className="py-16 text-center text-xs text-charcoal-500">
        {L('공유 스페이스를 불러오는 중...', '共有スペースを読み込み中...', 'Loading shared space...')}
      </div>
    );
  }

  const counts = {
    ALL: thoughts.filter((t) => t.status !== 'ARCHIVED').length,
    NEW: thoughts.filter((t) => t.status === 'NEW').length,
    DISCUSSING: thoughts.filter((t) => t.status === 'DISCUSSING').length,
    PROPOSED: thoughts.filter((t) => t.status === 'PROPOSED').length,
    SCHEDULED: thoughts.filter((t) => t.status === 'SCHEDULED').length,
  };

  return (
    <div className="space-y-3.5 pb-20 lg:pb-6">
      {toastMsg && (
        <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 sm:left-auto sm:max-w-sm z-50 px-4 py-2.5 rounded-xl bg-charcoal-900 text-white text-xs font-bold shadow-xl break-words">
          {toastMsg}
        </div>
      )}

      {/* Top Header Bar */}
      <div className="bg-white rounded-2xl border border-ivory-300 px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: activeSpace.color }} />
          <select
            value={activeSpace.id}
            onChange={(e) => {
              if (e.target.value === '__NEW__') {
                onOpenCreateSpace();
                return;
              }
              onSelectSpace(Number(e.target.value));
            }}
            className="text-xs sm:text-sm font-bold text-charcoal-900 bg-ivory-50 border border-ivory-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forest-600 max-w-[200px] sm:max-w-[260px]"
          >
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.members.length})
              </option>
            ))}
            <option value="__NEW__">+ {L('새 공유 스페이스 만들기', '新しいスペース作成', 'New Space')}</option>
          </select>

          <span className="hidden md:inline-flex items-center gap-1 text-xs text-charcoal-500">
            <Lightbulb className="w-3.5 h-3.5 text-amber-600" />
            {L('생각을 툭 던지고 함께 다듬어 캘린더로 이어보세요', 'アイデアを投げて、みんなで育てて予定にしよう', 'Drop thoughts, shape together, schedule on calendar')}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenActivityFeed}
            className="relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-ivory-100 hover:bg-ivory-200 text-charcoal-800 text-xs font-bold transition"
          >
            <Bell className="w-4 h-4 text-forest-800" />
            <span className="hidden sm:inline">{L('새 소식', '新着', 'Feed')}</span>
            {activeSpace.unread_count > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-bold flex items-center justify-center">
                {activeSpace.unread_count > 99 ? '99+' : activeSpace.unread_count}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => onOpenSpaceSettings(activeSpace)}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-ivory-100 hover:bg-ivory-200 text-charcoal-800 text-xs font-bold transition"
            title={L('멤버 초대 · 스페이스 설정', 'メンバー招待・設定', 'Invite & Settings')}
          >
            <Users className="w-4 h-4 text-forest-700" />
            <span className="hidden sm:inline">{activeSpace.members.length}</span>
            <Settings className="w-3.5 h-3.5 text-charcoal-500" />
          </button>
        </div>
      </div>

      {/* 1-Second Quick Thought Drop Composer */}
      <form
        onSubmit={handleQuickPost}
        className="bg-white rounded-2xl border-2 border-forest-200 focus-within:border-forest-600 shadow-xs p-3.5 space-y-2.5 transition"
      >
        {composerExpanded && (
          <input
            type="text"
            value={quickTitle}
            onChange={(e) => setQuickTitle(e.target.value)}
            placeholder={L('제목 (비워두어도 괜찮아요)', 'タイトル（省略可）', 'Optional title...')}
            className="w-full px-3 py-1.5 text-xs font-bold rounded-lg bg-ivory-50 border border-ivory-200 focus:outline-none focus:ring-2 focus:ring-forest-500"
          />
        )}

        <textarea
          rows={composerExpanded ? 3 : 2}
          value={quickContent}
          onFocus={() => setComposerExpanded(true)}
          onChange={(e) => setQuickContent(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
              e.preventDefault();
              void handleQuickPost();
            }
          }}
          placeholder={L(
            '지금 머릿속에 떠오른 생각이나 해보고 싶은 아이디어를 부담 없이 툭 던져놓으세요... (Ctrl+Enter로 즉시 공유)',
            '頭に浮かんだアイデアや共有したい考えを気軽に投げてみましょう... (Ctrl+Enterで投稿)',
            'Drop any raw thought or idea for the group to see, react, refine, or schedule... (Ctrl+Enter)'
          )}
          className="w-full px-3 py-2 text-xs sm:text-sm rounded-xl bg-ivory-50/70 border border-ivory-200 focus:outline-none focus:bg-white focus:border-forest-400 resize-none leading-relaxed"
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 flex-1 min-w-[180px]">
            {composerExpanded && (
              <div className="relative flex-1 max-w-xs">
                <Hash className="w-3.5 h-3.5 text-charcoal-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={quickTagsText}
                  onChange={(e) => setQuickTagsText(e.target.value)}
                  placeholder={L('태그 (예: 여행, 아이디어)', 'タグ（カンマ区切り）', 'tags (comma separated)')}
                  className="w-full pl-7 pr-2.5 py-1.5 text-xs rounded-lg bg-ivory-50 border border-ivory-200 focus:outline-none focus:ring-1 focus:ring-forest-500"
                />
              </div>
            )}
            {!composerExpanded && (
              <span className="text-[11px] text-charcoal-400">
                {L(
                  `현재 ${activeSpace.members.length}명과 실시간 공유됩니다`,
                  `現在 ${activeSpace.members.length}人とリアルタイム共有中`,
                  `Shared live with ${activeSpace.members.length} member(s)`
                )}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {composerExpanded && !quickContent.trim() && (
              <button
                type="button"
                onClick={() => setComposerExpanded(false)}
                className="px-2.5 py-1.5 rounded-lg text-xs font-bold text-charcoal-500 hover:bg-ivory-100"
              >
                {L('접기', '閉じる', 'Collapse')}
              </button>
            )}
            <Button type="submit" size="sm" disabled={posting || !quickContent.trim()}>
              <Send className="w-3.5 h-3.5 mr-1" />
              {L('생각 등록', 'アイデア登録', 'Post Thought')}
            </Button>
          </div>
        </div>
      </form>

      {/* Filter Pills & Search */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'ALL', label: L('전체', 'すべて', 'All'), count: counts.ALL },
              { id: 'NEW', label: L('✨ 새 생각', '✨ 新着', '✨ New'), count: counts.NEW },
              { id: 'DISCUSSING', label: L('💬 논의중', '💬 議論中', '💬 Discussing'), count: counts.DISCUSSING },
              { id: 'PROPOSED', label: L('📅 일정 제안됨', '📅 日程提案', '📅 Proposed'), count: counts.PROPOSED },
              { id: 'SCHEDULED', label: L('✅ 확정됨', '✅ 確定済', '✅ Scheduled'), count: counts.SCHEDULED },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-bold border transition inline-flex items-center gap-1 ${
                statusFilter === tab.id
                  ? 'bg-forest-800 text-white border-forest-900 shadow-2xs'
                  : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-50'
              }`}
            >
              <span>{tab.label}</span>
              <span className={`text-[10px] ${statusFilter === tab.id ? 'text-forest-200' : 'text-charcoal-400'}`}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-56">
          <Search className="w-3.5 h-3.5 text-charcoal-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={L('생각·태그·작성자 검색', '検索...', 'Search thoughts...')}
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl bg-white border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-500"
          />
        </div>
      </div>

      {/* Tag Strip */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {selectedTag && (
            <button
              type="button"
              onClick={() => setSelectedTag('')}
              className="px-2 py-0.5 rounded-full bg-charcoal-800 text-white text-[11px] font-bold"
            >
              ✕ #{selectedTag}
            </button>
          )}
          {allTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setSelectedTag((cur) => (cur === tag ? '' : tag))}
              className={`px-2 py-0.5 rounded-full text-[11px] font-bold border transition ${
                selectedTag === tag
                  ? 'bg-forest-800 text-white border-forest-900'
                  : 'bg-white text-forest-800 border-ivory-300 hover:bg-forest-50'
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      {/* Thoughts Card Grid (PC 2-3 cols, Mobile 1 col) */}
      {loading && thoughts.length === 0 ? (
        <div className="py-16 text-center text-xs text-charcoal-500">
          {L('공유된 생각들을 불러오는 중...', '読み込み中...', 'Loading thoughts...')}
        </div>
      ) : filteredThoughts.length === 0 ? (
        <div className="bg-white rounded-2xl border border-dashed border-ivory-300 py-14 px-6 text-center space-y-2">
          <Lightbulb className="w-8 h-8 text-amber-500 mx-auto" />
          <div className="text-sm font-bold text-charcoal-800">
            {L('아직 올려진 생각이 없습니다', 'まだ共有されたアイデアはありません', 'No shared thoughts yet')}
          </div>
          <p className="text-xs text-charcoal-500 max-w-md mx-auto">
            {L(
              '위 입력창에 머릿속 아이디어를 편하게 툭 던져보세요. 멤버들이 [좋다/더 생각해본다/별로다] 피드백을 남기고, 수정 제안이나 캘린더 날짜 제안까지 바로 이어갈 수 있습니다.',
              '上の入力欄にアイデアを気軽に投稿してみてください。メンバー同士でリアクションや修正提案、日程提案までスムーズに連携できます。',
              'Drop your first thought above. Members can react, propose edits/additions, and link dates directly to the shared calendar.'
            )}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3.5">
          {filteredThoughts.map((t) => {
            const st = statusMeta(t.status);
            const good = t.reactions.filter((r) => r.stance === 'GOOD');
            const think = t.reactions.filter((r) => r.stance === 'THINK');
            const bad = t.reactions.filter((r) => r.stance === 'BAD');
            const myStance = t.reactions.find((r) => r.user_id === user?.id)?.stance || null;

            return (
              <article
                key={t.id}
                onClick={() => {
                  setDetailInitialEditMode(false);
                  setDetailThoughtId(t.id);
                }}
                className={`bg-white rounded-2xl border p-4 flex flex-col justify-between gap-3 cursor-pointer transition hover:shadow-md hover:border-forest-400 ${
                  t.is_pinned ? 'border-amber-300 ring-1 ring-amber-200/70' : 'border-ivory-300'
                }`}
              >
                <div className="space-y-2.5">
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${st.cls}`}>
                        {st.label}
                      </span>
                      {t.revision_count > 0 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-violet-50 text-violet-800 border border-violet-200 text-[10px] font-bold">
                          <History className="w-2.5 h-2.5" />
                          {L(`진화 ${t.revision_count}`, `v${t.revision_count + 1}`, `v${t.revision_count + 1}`)}
                        </span>
                      )}
                      <span className="text-[10px] text-charcoal-400">
                        {t.author_name} · {getJstDateKey(t.created_at).slice(5)} {formatJstTime(t.created_at)}
                      </span>
                    </div>

                    <div className="flex items-center gap-0.5 shrink-0">
                      <button
                        type="button"
                        onClick={(e) => void handleCardTogglePin(e, t)}
                        className={`p-1 rounded-lg transition ${
                          t.is_pinned
                            ? 'bg-amber-100 text-amber-800 hover:bg-amber-200'
                            : 'text-charcoal-400 hover:text-amber-700 hover:bg-amber-50'
                        }`}
                        title={t.is_pinned ? L('고정 해제', 'ピン解除', 'Unpin') : L('상단 고정', 'ピン留め', 'Pin')}
                        aria-label={L('고정', 'ピン留め', 'Pin')}
                      >
                        <Pin className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => handleOpenEditModal(e, t)}
                        className="p-1 rounded-lg text-charcoal-400 hover:text-forest-800 hover:bg-ivory-100 transition"
                        title={L('수정', '編集', 'Edit')}
                        aria-label={L('수정', '編集', 'Edit')}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => void handleCardDelete(e, t)}
                        className="p-1 rounded-lg text-charcoal-400 hover:text-rose-700 hover:bg-rose-50 transition"
                        title={L('삭제', '削除', 'Delete')}
                        aria-label={L('삭제', '削除', 'Delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Title & Content */}
                  <div className="space-y-1">
                    {t.title && <h3 className="text-sm font-bold text-charcoal-900 leading-snug">{t.title}</h3>}
                    <p className="text-xs text-charcoal-700 whitespace-pre-wrap line-clamp-4 leading-relaxed">
                      {t.content}
                    </p>
                  </div>

                  {/* Tags */}
                  {t.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {t.tags.map((tag) => (
                        <span
                          key={tag}
                          className="px-2 py-0.5 rounded-full bg-ivory-100 text-forest-800 text-[10px] font-bold"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Linked Calendar Dates & Linked Mindmap Projects */}
                  {(t.linked_events.length > 0 || (t.mindmap_links && t.mindmap_links.length > 0)) && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {t.linked_events.map((ev) => {
                        const isProposed = ev.event_status === 'PROPOSED';
                        const okCnt = ev.votes.filter((v) => v.vote === 'AVAILABLE').length;
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onJumpToCalendarEvent(ev.id, ev.start_date);
                            }}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border transition ${
                              isProposed
                                ? 'bg-amber-50 hover:bg-amber-100 text-amber-950 border-dashed border-amber-400'
                                : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-950 border-emerald-300'
                            }`}
                          >
                            {isProposed ? (
                              <Calendar className="w-3 h-3 text-amber-700 shrink-0" />
                            ) : (
                              <CheckCircle2 className="w-3 h-3 text-emerald-700 shrink-0" />
                            )}
                            <span>{formatShortDate(ev.start_date)}</span>
                            <span>
                              {isProposed
                                ? L(`제안 · 👍${okCnt}`, `提案 · 👍${okCnt}`, `Prop · 👍${okCnt}`)
                                : L('확정됨', '確定', 'Confirmed')}
                            </span>
                          </button>
                        );
                      })}
                      {(t.mindmap_links || []).map((ml) => (
                        <button
                          key={`${ml.entity_type}-${ml.entity_id}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (ml.project_id) onJumpToMindmapProject(ml.project_id);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold border bg-indigo-50 hover:bg-indigo-100 text-indigo-950 border-indigo-200 transition max-w-full"
                        >
                          <BookMarked className="w-3 h-3 text-indigo-700 shrink-0" />
                          <span className="truncate max-w-[140px]">
                            {ml.project_title || ml.title}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Bottom Reactions & Organic Bridge Actions */}
                <div className="space-y-2.5 pt-2 border-t border-ivory-200">
                  {/* 3-Stance Quick Buttons */}
                  <div className="grid grid-cols-3 gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => void handleCardReact(e, t.id, 'GOOD')}
                      className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold border transition text-center ${
                        myStance === 'GOOD'
                          ? 'bg-emerald-700 text-white border-emerald-800'
                          : 'bg-ivory-50 text-charcoal-700 border-ivory-200 hover:bg-emerald-50 hover:border-emerald-300'
                      }`}
                    >
                      👍 {L('좋다', 'いい', 'Good')} {good.length > 0 ? good.length : ''}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => void handleCardReact(e, t.id, 'THINK')}
                      className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold border transition text-center ${
                        myStance === 'THINK'
                          ? 'bg-amber-600 text-white border-amber-700'
                          : 'bg-ivory-50 text-charcoal-700 border-ivory-200 hover:bg-amber-50 hover:border-amber-300'
                      }`}
                    >
                      🤔 {L('고민', '検討', 'Think')} {think.length > 0 ? think.length : ''}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => void handleCardReact(e, t.id, 'BAD')}
                      className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold border transition text-center ${
                        myStance === 'BAD'
                          ? 'bg-rose-700 text-white border-rose-800'
                          : 'bg-ivory-50 text-charcoal-700 border-ivory-200 hover:bg-rose-50 hover:border-rose-300'
                      }`}
                    >
                      👎 {L('별로', '微妙', 'No')} {bad.length > 0 ? bad.length : ''}
                    </button>
                  </div>

                  {/* Transparent Stance Names */}
                  {t.reactions.length > 0 && (
                    <div className="text-[10px] text-charcoal-500 flex flex-wrap gap-x-2 gap-y-0.5">
                      {good.length > 0 && <span>👍 {good.map((r) => r.user_name).join(', ')}</span>}
                      {think.length > 0 && <span>🤔 {think.map((r) => r.user_name).join(', ')}</span>}
                      {bad.length > 0 && <span>👎 {bad.map((r) => r.user_name).join(', ')}</span>}
                    </div>
                  )}

                  {/* Bridge Actions: Propose Date, Send to Mindmap & Open Proposals Thread */}
                  <div className="flex flex-wrap items-center justify-between gap-1.5 pt-1">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setProposingThought(t);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 text-[11px] font-bold transition"
                      >
                        <CalendarPlus className="w-3.5 h-3.5 text-amber-800" />
                        <span>{L('날짜 제안', '日程提案', 'Propose Date')}</span>
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSendingToMindmapThought(t);
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1.5 rounded-xl bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border border-indigo-200 text-[11px] font-bold transition"
                        title={L('프로젝트 마인드맵으로 보내기', 'マインドマップへ送る', 'Send to Mindmap')}
                      >
                        <BookMarked className="w-3.5 h-3.5 text-indigo-700" />
                        <span>{L('마인드맵', 'マップへ', 'Mindmap')}</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDetailInitialEditMode(false);
                        setDetailThoughtId(t.id);
                      }}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-ivory-100 hover:bg-ivory-200 text-charcoal-800 text-[11px] font-bold transition"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-forest-700" />
                      <span>{L(`의견·제안 ${t.comment_count}`, `意見・提案 ${t.comment_count}`, `Thread ${t.comment_count}`)}</span>
                      {t.open_proposal_count > 0 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.2 rounded-full bg-violet-700 text-white text-[9px]">
                          <Sparkles className="w-2.5 h-2.5" />
                          {t.open_proposal_count}
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Propose Date -> Calendar Modal */}
      <ProposeDateModal
        isOpen={Boolean(proposingThought)}
        onClose={() => setProposingThought(null)}
        space={activeSpace}
        thought={proposingThought}
        onProposed={(ev) => {
          void loadThoughts();
          onSpacesNeedRefresh();
          showToast(
            ev.event_status === 'CONFIRMED'
              ? L(`${ev.start_date} 정식 일정으로 등록했습니다!`, `${ev.start_date} に確定予定として登録しました！`, `Confirmed on ${ev.start_date}!`)
              : L(`${ev.start_date} 날짜 제안을 캘린더에 올렸습니다!`, `${ev.start_date} の日程提案をカレンダーに追加しました！`, `Proposed ${ev.start_date} on Calendar!`)
          );
        }}
      />

      {/* Send Thought -> Project Mindmap Modal */}
      <SendToMindmapModal
        isOpen={Boolean(sendingToMindmapThought)}
        onClose={() => setSendingToMindmapThought(null)}
        space={activeSpace}
        thought={sendingToMindmapThought}
        onSent={(res) => {
          void loadThoughts();
          onSpacesNeedRefresh();
          showToast(
            res.mode === 'NEW_PROJECT'
              ? L('새 마인드맵 프로젝트로 연결되었습니다! (실시간 양방향 동기화)', '新規マインドマッププロジェクトに連携しました！', 'Linked to new Mindmap project (live sync)!')
              : L('기존 마인드맵 프로젝트에 연결되었습니다! (실시간 양방향 동기화)', '既存マインドマップに連携しました！', 'Linked to Mindmap project (live sync)!')
          );
        }}
      />

      {/* Thought Detail + Typed Proposals + Merge History Modal */}
      <ThoughtDetailModal
        isOpen={Boolean(detailThoughtId)}
        onClose={() => {
          setDetailThoughtId(null);
          setDetailInitialEditMode(false);
        }}
        space={activeSpace}
        thoughtId={detailThoughtId}
        initialEditMode={detailInitialEditMode}
        realtimeTick={realtimeTick}
        onOpenProposeDate={(th) => setProposingThought(th)}
        onOpenSendToMindmap={(th) => setSendingToMindmapThought(th)}
        onJumpToCalendarEvent={onJumpToCalendarEvent}
        onJumpToMindmapProject={onJumpToMindmapProject}
        onMutated={() => {
          void loadThoughts();
          onSpacesNeedRefresh();
        }}
      />
    </div>
  );
};
