import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowRight,
  BookMarked,
  Calendar,
  CalendarPlus,
  Check,
  CheckCircle2,
  Edit2,
  History,
  MessageSquare,
  Pin,
  Plus,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  CollabSpace,
  SharedThought,
  ThoughtComment,
  ThoughtCommentType,
  ThoughtRevision,
  ThoughtStance,
} from '../../types/spaces';
import { formatJstTime, getJstDateKey } from '../../utils/dateTime';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

interface ThoughtDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  space: CollabSpace;
  thoughtId: number | null;
  initialEditMode?: boolean;
  realtimeTick: number;
  onOpenProposeDate: (thought: SharedThought) => void;
  onOpenSendToMindmap: (thought: SharedThought) => void;
  onJumpToCalendarEvent: (eventId: number, startDate: string) => void;
  onJumpToMindmapProject: (projectId: number) => void;
  onMutated: () => void;
}

export const ThoughtDetailModal: React.FC<ThoughtDetailModalProps> = ({
  isOpen,
  onClose,
  space,
  thoughtId,
  initialEditMode = false,
  realtimeTick,
  onOpenProposeDate,
  onOpenSendToMindmap,
  onJumpToCalendarEvent,
  onJumpToMindmapProject,
  onMutated,
}) => {
  const { user } = useAuth();
  const { L } = useLanguage();

  const [thought, setThought] = useState<SharedThought | null>(null);
  const [comments, setComments] = useState<ThoughtComment[]>([]);
  const [revisions, setRevisions] = useState<ThoughtRevision[]>([]);
  const [loading, setLoading] = useState(false);

  // Edit mode
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editTagsText, setEditTagsText] = useState('');
  const [showRevisions, setShowRevisions] = useState(false);

  // Comment / Proposal composer
  const [commentType, setCommentType] = useState<ThoughtCommentType>('COMMENT');
  const [commentInput, setCommentInput] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Merge preview modal inline
  const [mergingComment, setMergingComment] = useState<ThoughtComment | null>(null);
  const [mergedPreview, setMergedPreview] = useState('');

  const fetchDetail = useCallback(async (autoOpenEdit = false) => {
    if (!thoughtId) return;
    try {
      const res = await api.get<{
        thought: SharedThought;
        comments: ThoughtComment[];
        revisions: ThoughtRevision[];
      }>(`/spaces/${space.id}/thoughts/${thoughtId}`);
      setThought(res.thought);
      setComments(res.comments || []);
      setRevisions(res.revisions || []);
      if (autoOpenEdit && res.thought) {
        setEditTitle(res.thought.title || '');
        setEditContent(res.thought.content);
        setEditTagsText((res.thought.tags || []).join(', '));
        setIsEditing(true);
      }
    } catch {
      // ignore if deleted
    }
  }, [space.id, thoughtId]);

  useEffect(() => {
    if (!isOpen || !thoughtId) return;
    setIsEditing(false);
    setMergingComment(null);
    setShowRevisions(false);
    setLoading(true);
    void fetchDetail(initialEditMode).finally(() => setLoading(false));
  }, [isOpen, thoughtId, initialEditMode, fetchDetail]);

  useEffect(() => {
    if (isOpen && thoughtId && realtimeTick > 0) {
      void fetchDetail();
    }
  }, [realtimeTick, isOpen, thoughtId, fetchDetail]);

  const startEditing = () => {
    if (!thought) return;
    setEditTitle(thought.title || '');
    setEditContent(thought.content);
    setEditTagsText(thought.tags.join(', '));
    setIsEditing(true);
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thought || !editContent.trim()) return;
    const tags = editTagsText
      .split(/[,\s]+/)
      .map((s) => s.replace(/^#/, '').trim())
      .filter(Boolean);
    await api.patch(`/spaces/${space.id}/thoughts/${thought.id}`, {
      title: editTitle.trim(),
      content: editContent.trim(),
      tags,
    });
    setIsEditing(false);
    await fetchDetail();
    onMutated();
  };

  const handleTogglePin = async () => {
    if (!thought) return;
    await api.patch(`/spaces/${space.id}/thoughts/${thought.id}`, {
      is_pinned: !thought.is_pinned,
    });
    await fetchDetail();
    onMutated();
  };

  const handleDelete = async () => {
    if (!thought) return;
    const ok = window.confirm(
      L('이 생각 카드를 삭제할까요?', 'このアイデアを削除しますか？', 'Delete this thought?')
    );
    if (!ok) return;
    await api.delete(`/spaces/${space.id}/thoughts/${thought.id}`);
    onMutated();
    onClose();
  };

  const handleReact = async (stance: ThoughtStance) => {
    if (!thought) return;
    await api.post(`/spaces/${space.id}/thoughts/${thought.id}/react`, { stance });
    await fetchDetail();
    onMutated();
  };

  const handleSubmitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thought || !commentInput.trim() || submitting) return;
    try {
      setSubmitting(true);
      await api.post(`/spaces/${space.id}/thoughts/${thought.id}/comments`, {
        comment_type: commentType,
        content: commentInput.trim(),
      });
      setCommentInput('');
      setCommentType('COMMENT');
      await fetchDetail();
      onMutated();
    } finally {
      setSubmitting(false);
    }
  };

  const openMergePreview = (c: ThoughtComment) => {
    if (!thought) return;
    setMergingComment(c);
    if (c.comment_type === 'EDIT_PROPOSAL') {
      setMergedPreview(c.content);
    } else {
      setMergedPreview(`${thought.content.trim()}\n\n+ [${c.author_name} 추가] ${c.content.trim()}`);
    }
  };

  const confirmMergeProposal = async () => {
    if (!thought || !mergingComment) return;
    await api.post(`/spaces/${space.id}/thoughts/${thought.id}/comments/${mergingComment.id}/apply`, {
      mergedContent: mergedPreview.trim(),
    });
    setMergingComment(null);
    setMergedPreview('');
    await fetchDetail();
    onMutated();
  };

  const handleVoteEvent = async (eventId: number, vote: 'AVAILABLE' | 'UNAVAILABLE') => {
    await api.post(`/spaces/${space.id}/events/${eventId}/vote`, { vote });
    await fetchDetail();
    onMutated();
  };

  const handleConfirmEvent = async (eventId: number, hasOtherProposals: boolean) => {
    await api.post(`/spaces/${space.id}/events/${eventId}/confirm`, {
      cancelOtherProposals: hasOtherProposals,
    });
    await fetchDetail();
    onMutated();
  };

  const goodList = (thought?.reactions || []).filter((r) => r.stance === 'GOOD');
  const thinkList = (thought?.reactions || []).filter((r) => r.stance === 'THINK');
  const badList = (thought?.reactions || []).filter((r) => r.stance === 'BAD');
  const myStance = (thought?.reactions || []).find((r) => r.user_id === user?.id)?.stance || null;

  const proposedLinkedCount = (thought?.linked_events || []).filter((e) => e.event_status === 'PROPOSED').length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      title={
        thought ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">{thought.title || L('공유된 생각', '共有アイデア', 'Shared Thought')}</span>
            {thought.revision_count > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-violet-100 text-violet-900 text-[10px] font-bold shrink-0">
                {L(`진화 ${thought.revision_count}회`, `更新 ${thought.revision_count}回`, `v${thought.revision_count + 1}`)}
              </span>
            )}
          </div>
        ) : (
          L('생각 상세', 'アイデア詳細', 'Thought Detail')
        )
      }
    >
      {loading || !thought ? (
        <div className="py-12 text-center text-xs text-charcoal-500">
          {L('불러오는 중...', '読み込み中...', 'Loading...')}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Top Metadata & Actions */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-ivory-200 text-[11px] text-charcoal-500">
            <div>
              <span className="font-bold text-charcoal-800">{thought.author_name}</span> ·{' '}
              {getJstDateKey(thought.created_at)} {formatJstTime(thought.created_at)}
              {thought.updated_by_name && thought.updated_by !== thought.author_id && (
                <span> · {L(`최근 다듬기: ${thought.updated_by_name}`, `最終更新: ${thought.updated_by_name}`, `Edited by ${thought.updated_by_name}`)}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleTogglePin()}
                className={`p-1.5 rounded-lg border transition ${
                  thought.is_pinned
                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                    : 'text-charcoal-400 hover:bg-ivory-100 border-ivory-200'
                }`}
                title={L('상단 고정', 'ピン留め', 'Pin')}
              >
                <Pin className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={startEditing}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-ivory-200 text-charcoal-700 hover:bg-ivory-100 font-bold transition"
              >
                <Edit2 className="w-3 h-3" />
                {L('수정', '編集', 'Edit')}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="p-1.5 rounded-lg text-charcoal-400 hover:text-rose-700 hover:bg-rose-50 transition"
                title={L('삭제', '削除', 'Delete')}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Thought Body (View or Edit) */}
          {isEditing ? (
            <form onSubmit={handleSaveEdit} className="space-y-2.5 p-3 rounded-xl bg-ivory-50 border border-ivory-300">
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder={L('제목 (선택)', 'タイトル（任意）', 'Title (optional)')}
                className="w-full px-3 py-1.5 text-xs font-bold rounded-lg border border-ivory-300 bg-white"
              />
              <textarea
                rows={4}
                value={editContent}
                onChange={(e) => setEditContent(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-ivory-300 bg-white"
              />
              <input
                type="text"
                value={editTagsText}
                onChange={(e) => setEditTagsText(e.target.value)}
                placeholder={L('태그 (쉼표로 구분, 예: 워크숍, 아이디어)', 'タグ（カンマ区切り）', 'Tags (comma separated)')}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-ivory-300 bg-white"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setIsEditing(false)}>
                  {L('취소', 'キャンセル', 'Cancel')}
                </Button>
                <Button type="submit" size="sm">
                  {L('저장', '保存', 'Save')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="p-4 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2.5">
              <div className="text-sm text-charcoal-900 whitespace-pre-wrap leading-relaxed">{thought.content}</div>
              {thought.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {thought.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 rounded-full bg-white border border-ivory-300 text-[11px] font-bold text-forest-800"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}

              {revisions.length > 0 && (
                <div className="pt-2 border-t border-ivory-200">
                  <button
                    type="button"
                    onClick={() => setShowRevisions((v) => !v)}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-800 hover:underline"
                  >
                    <History className="w-3.5 h-3.5" />
                    {showRevisions
                      ? L('변경 이력 접기', '変更履歴を閉じる', 'Hide revision history')
                      : L(`생각이 다듬어진 이력 보기 (${revisions.length}건)`, `変更履歴を見る (${revisions.length}件)`, `View evolution history (${revisions.length})`)}
                  </button>
                  {showRevisions && (
                    <div className="mt-2 space-y-2 max-h-44 overflow-y-auto">
                      {revisions.map((rev) => (
                        <div key={rev.id} className="p-2.5 rounded-lg bg-white border border-violet-200 text-[11px] space-y-1">
                          <div className="flex items-center justify-between text-violet-900 font-bold">
                            <span>{rev.note || rev.editor_name}</span>
                            <span className="text-[10px] text-charcoal-400">
                              {getJstDateKey(rev.created_at).slice(5)} {formatJstTime(rev.created_at)}
                            </span>
                          </div>
                          <div className="text-charcoal-400 line-through line-clamp-2">{rev.previous_content}</div>
                          <div className="text-charcoal-800 whitespace-pre-wrap line-clamp-3">{rev.new_content}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3-Stance Reaction Bar with Transparent Member Breakdown */}
          <div className="p-3 rounded-xl bg-white border border-ivory-200 space-y-2.5">
            <div className="text-xs font-bold text-charcoal-700">
              {L('멤버들의 생각 피드백', 'メンバーのリアクション', 'Team Stance')}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => void handleReact('GOOD')}
                className={`py-2 px-2 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-0.5 ${
                  myStance === 'GOOD'
                    ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                    : 'bg-emerald-50/50 text-emerald-900 border-emerald-200 hover:bg-emerald-50'
                }`}
              >
                <span>👍 {L('좋다', 'いいね', 'Good')} ({goodList.length})</span>
                {goodList.length > 0 && (
                  <span className={`text-[10px] truncate max-w-full ${myStance === 'GOOD' ? 'text-emerald-100' : 'text-emerald-700'}`}>
                    {goodList.map((r) => r.user_name).join(', ')}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleReact('THINK')}
                className={`py-2 px-2 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-0.5 ${
                  myStance === 'THINK'
                    ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
                    : 'bg-amber-50/60 text-amber-900 border-amber-200 hover:bg-amber-50'
                }`}
              >
                <span>🤔 {L('더 생각해본다', 'もう少し考える', 'Think more')} ({thinkList.length})</span>
                {thinkList.length > 0 && (
                  <span className={`text-[10px] truncate max-w-full ${myStance === 'THINK' ? 'text-amber-100' : 'text-amber-700'}`}>
                    {thinkList.map((r) => r.user_name).join(', ')}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => void handleReact('BAD')}
                className={`py-2 px-2 rounded-xl border text-xs font-bold transition flex flex-col items-center gap-0.5 ${
                  myStance === 'BAD'
                    ? 'bg-rose-700 text-white border-rose-800 shadow-xs'
                    : 'bg-rose-50/50 text-rose-900 border-rose-200 hover:bg-rose-50'
                }`}
              >
                <span>👎 {L('별로다', 'うーん', 'Not keen')} ({badList.length})</span>
                {badList.length > 0 && (
                  <span className={`text-[10px] truncate max-w-full ${myStance === 'BAD' ? 'text-rose-100' : 'text-rose-700'}`}>
                    {badList.map((r) => r.user_name).join(', ')}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* Linked Calendar Proposals & Confirmed Events */}
          <div className="p-3.5 rounded-xl bg-amber-50/50 border border-amber-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-bold text-charcoal-900 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-amber-700" />
                <span>
                  {L(
                    `캘린더 날짜 제안 · 연결된 일정 (${thought.linked_events.length})`,
                    `カレンダー日程提案・連携予定 (${thought.linked_events.length})`,
                    `Calendar Proposals & Events (${thought.linked_events.length})`
                  )}
                </span>
              </div>
              <Button
                type="button"
                size="sm"
                onClick={() => onOpenProposeDate(thought)}
              >
                <CalendarPlus className="w-3.5 h-3.5 mr-1" />
                {L('날짜 제안', '日程提案', 'Propose Date')}
              </Button>
            </div>

            {thought.linked_events.length === 0 ? (
              <p className="text-[11px] text-charcoal-500">
                {L(
                  '아직 캘린더에 연결된 날짜가 없습니다. 마음이 맞았다면 날짜를 제안해 실행으로 옮겨보세요!',
                  'まだカレンダー日程はありません。実行する日程を提案してみましょう！',
                  'No calendar dates proposed yet. Propose a date to turn this thought into action!'
                )}
              </p>
            ) : (
              <div className="space-y-2">
                {thought.linked_events.map((ev) => {
                  const isProposed = ev.event_status === 'PROPOSED';
                  const okVotes = ev.votes.filter((v) => v.vote === 'AVAILABLE');
                  const noVotes = ev.votes.filter((v) => v.vote === 'UNAVAILABLE');
                  const myVote = ev.votes.find((v) => v.user_id === user?.id)?.vote || null;

                  return (
                    <div
                      key={ev.id}
                      className={`p-2.5 rounded-xl border bg-white space-y-2 ${
                        isProposed ? 'border-dashed border-amber-400' : 'border-emerald-300 bg-emerald-50/30'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                              isProposed ? 'bg-amber-100 text-amber-900' : 'bg-emerald-100 text-emerald-900'
                            }`}
                          >
                            {isProposed ? L('제안중', '提案中', 'Proposed') : L('확정됨', '確定済', 'Confirmed')}
                          </span>
                          <span className="text-xs font-bold text-charcoal-900">
                            {ev.start_date}
                            {ev.end_date !== ev.start_date ? ` ~ ${ev.end_date}` : ''}
                            {!ev.is_all_day && ev.start_time ? ` ${ev.start_time}` : ''}
                          </span>
                          <span className="text-xs text-charcoal-600 truncate">{ev.title}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onJumpToCalendarEvent(ev.id, ev.start_date);
                          }}
                          className="inline-flex items-center gap-1 text-[11px] font-bold text-forest-800 hover:underline shrink-0"
                        >
                          <span>{L('캘린더에서 보기', 'カレンダーで見る', 'Open in Calendar')}</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>

                      {isProposed && (
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-ivory-200">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleVoteEvent(ev.id, 'AVAILABLE')}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
                                myVote === 'AVAILABLE'
                                  ? 'bg-emerald-700 text-white border-emerald-800'
                                  : 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50'
                              }`}
                            >
                              <ThumbsUp className="w-3 h-3" />
                              {L('가능', 'OK', 'Yes')} ({okVotes.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleVoteEvent(ev.id, 'UNAVAILABLE')}
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
                                myVote === 'UNAVAILABLE'
                                  ? 'bg-rose-700 text-white border-rose-800'
                                  : 'bg-white text-rose-800 border-rose-300 hover:bg-rose-50'
                              }`}
                            >
                              <ThumbsDown className="w-3 h-3" />
                              {L('어려움', 'NG', 'No')} ({noVotes.length})
                            </button>
                          </div>

                          <button
                            type="button"
                            onClick={() => void handleConfirmEvent(ev.id, proposedLinkedCount > 1)}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-forest-800 hover:bg-forest-900 text-white text-[11px] font-bold transition"
                          >
                            <CheckCircle2 className="w-3 h-3" />
                            {L('일정 확정', '日程確定', 'Confirm Date')}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Mindmap 3-Way Bridge Section */}
          <div className="p-3.5 rounded-xl bg-indigo-50/60 border border-indigo-200 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                <BookMarked className="w-4 h-4 text-indigo-700" />
                <span>
                  {L(
                    `프로젝트 마인드맵 연동 (${thought.mindmap_links?.length || 0})`,
                    `プロジェクトマインドマップ連携 (${thought.mindmap_links?.length || 0})`,
                    `Linked Mindmap Items (${thought.mindmap_links?.length || 0})`
                  )}
                </span>
              </div>
              <button
                type="button"
                onClick={() => onOpenSendToMindmap(thought)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-[11px] font-bold transition"
              >
                <BookMarked className="w-3.5 h-3.5" />
                <span>{L('마인드맵으로 보내기', 'マインドマップへ送る', 'Send to Mindmap')}</span>
              </button>
            </div>

            {thought.mindmap_links && thought.mindmap_links.length > 0 ? (
              <div className="space-y-1.5">
                {thought.mindmap_links.map((ml) => (
                  <button
                    key={`${ml.entity_type}-${ml.entity_id}`}
                    type="button"
                    onClick={() => {
                      if (ml.project_id) {
                        onClose();
                        onJumpToMindmapProject(ml.project_id);
                      }
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-white hover:bg-indigo-100/60 border border-indigo-200 flex items-center justify-between gap-2 text-left transition"
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-indigo-700">
                        {ml.entity_type === 'PROJECT'
                          ? L('프로젝트 · 실시간 양방향 동기화', 'プロジェクト・双方向同期', 'Project · Live Sync')
                          : ml.entity_type === 'IDEA'
                            ? L(`아이디어 (${ml.project_title || ''}) · 실시간 동기화`, `アイデア (${ml.project_title || ''})`, `Idea · Live Sync`)
                            : L(`타임라인 기록 (${ml.project_title || ''}) · 실시간 동기화`, `記録 (${ml.project_title || ''})`, `Entry · Live Sync`)}
                      </div>
                      <div className="text-xs font-bold text-indigo-950 truncate">{ml.title}</div>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-[11px] text-indigo-900/70">
                {L(
                  '채택된 생각을 새 마인드맵 프로젝트로 시작하거나 기존 프로젝트의 아이디어·기록으로 바로 연결할 수 있습니다.',
                  '採用されたアイデアを新規プロジェクトや既存プロジェクトの枝として直接連携できます。',
                  'Promote this thought into a new Mindmap project or attach it to an existing one with live two-way sync.'
                )}
              </p>
            )}
          </div>

          {/* Inline Merge Preview Box (when applying an Edit or Add Proposal) */}
          {mergingComment && (
            <div className="p-3.5 rounded-xl bg-violet-50 border-2 border-violet-300 space-y-2.5">
              <div className="text-xs font-bold text-violet-950 flex items-center gap-1.5">
                <Sparkles className="w-4 h-4 text-violet-700" />
                <span>
                  {L(
                    `${mergingComment.author_name}님의 제안을 본문에 반영하기 (필요하면 문장을 다듬어 저장하세요)`,
                    `${mergingComment.author_name}さんの提案を本文に反映（必要に応じて調整できます）`,
                    `Preview & apply ${mergingComment.author_name}'s suggestion to thought body`
                  )}
                </span>
              </div>
              <textarea
                rows={4}
                value={mergedPreview}
                onChange={(e) => setMergedPreview(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-lg border border-violet-300 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => setMergingComment(null)}>
                  {L('취소', 'キャンセル', 'Cancel')}
                </Button>
                <Button type="button" size="sm" onClick={() => void confirmMergeProposal()}>
                  <Check className="w-3.5 h-3.5 mr-1" />
                  {L('본문에 반영 완료', '本文に反映する', 'Apply to Thought')}
                </Button>
              </div>
            </div>
          )}

          {/* Typed Proposal Thread (Opinions, Edit Proposals, Add Proposals) */}
          <div className="border border-ivory-300 rounded-xl overflow-hidden bg-white">
            <div className="px-3.5 py-2.5 bg-ivory-50 border-b border-ivory-200 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-800">
                <MessageSquare className="w-4 h-4 text-forest-700" />
                <span>{L('의견 · 수정 제안 · 추가 아이디어', '意見・修正提案・追加アイデア', 'Discussion & Proposals')}</span>
              </div>
              <span className="text-[11px] text-charcoal-500">{comments.length}</span>
            </div>

            <div className="p-3 space-y-2.5 max-h-72 overflow-y-auto bg-ivory-50/40">
              {comments.length === 0 ? (
                <div className="py-6 text-center text-xs text-charcoal-400">
                  {L(
                    '첫 의견이나 수정·추가 아이디어를 남겨 생각을 함께 발전시켜 보세요.',
                    '最初の意見や修正・追加提案を残してみましょう。',
                    'Be the first to leave feedback, an edit suggestion, or an addition.'
                  )}
                </div>
              ) : (
                comments.map((c) => {
                  const isProposal = c.comment_type === 'EDIT_PROPOSAL' || c.comment_type === 'ADD_PROPOSAL';
                  const badgeClass =
                    c.comment_type === 'EDIT_PROPOSAL'
                      ? 'bg-sky-100 text-sky-900 border-sky-200'
                      : c.comment_type === 'ADD_PROPOSAL'
                        ? 'bg-violet-100 text-violet-900 border-violet-200'
                        : 'bg-ivory-200 text-charcoal-700 border-ivory-300';
                  const typeLabel =
                    c.comment_type === 'EDIT_PROPOSAL'
                      ? L('✏️ 수정 제안', '✏️ 修正提案', '✏️ Edit Proposal')
                      : c.comment_type === 'ADD_PROPOSAL'
                        ? L('➕ 추가 아이디어', '➕ 追加アイデア', '➕ Add Idea')
                        : L('💬 의견', '💬 意見', '💬 Opinion');

                  return (
                    <div
                      key={c.id}
                      className={`p-3 rounded-xl border bg-white space-y-1.5 ${
                        isProposal && !c.applied_at ? 'border-violet-200 shadow-2xs' : 'border-ivory-200'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${badgeClass}`}>
                            {typeLabel}
                          </span>
                          <span className="text-xs font-bold text-charcoal-800">{c.author_name}</span>
                          <span className="text-[10px] text-charcoal-400">
                            {getJstDateKey(c.created_at).slice(5)} {formatJstTime(c.created_at)}
                          </span>
                        </div>

                        {isProposal && (
                          c.applied_at ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-900 text-[10px] font-bold">
                              <Check className="w-3 h-3" />
                              {L(`반영됨 (${c.applied_by_name || ''})`, `反映済`, 'Applied')}
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => openMergePreview(c)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-violet-700 hover:bg-violet-800 text-white text-[11px] font-bold transition"
                            >
                              <Sparkles className="w-3 h-3" />
                              {L('본문에 반영', '本文に反映', 'Apply to Body')}
                            </button>
                          )
                        )}
                      </div>
                      <div className="text-xs text-charcoal-800 whitespace-pre-wrap leading-relaxed">{c.content}</div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Typed Composer */}
            <form onSubmit={handleSubmitComment} className="p-3 bg-white border-t border-ivory-200 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: 'COMMENT', label: L('💬 일반 의견', '💬 意見', '💬 Opinion') },
                    { id: 'EDIT_PROPOSAL', label: L('✏️ 수정 제안', '✏️ 修正提案', '✏️ Edit Proposal') },
                    { id: 'ADD_PROPOSAL', label: L('➕ 추가 아이디어', '➕ 追加アイデア', '➕ Add Idea') },
                  ] as const
                ).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setCommentType(opt.id)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
                      commentType === opt.id
                        ? 'bg-forest-800 text-white border-forest-900'
                        : 'bg-ivory-50 text-charcoal-600 border-ivory-300 hover:bg-ivory-100'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={commentInput}
                  onChange={(e) => setCommentInput(e.target.value)}
                  placeholder={
                    commentType === 'EDIT_PROPOSAL'
                      ? L('이 생각의 내용을 이렇게 바꿔보면 어떨까요?', 'こう修正するのはどうでしょう？', 'Propose revised wording...')
                      : commentType === 'ADD_PROPOSAL'
                        ? L('여기에 이런 아이디어를 덧붙여보면 어떨까요?', 'こんなアイデアを足しませんか？', 'Propose an additional idea...')
                        : L('생각에 대한 자유로운 의견을 남겨주세요...', '自由に意見を書いてください...', 'Share your thoughts...')
                  }
                  className="flex-1 min-w-0 px-3 py-2 text-xs rounded-xl bg-ivory-50 border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-600 focus:bg-white"
                />
                <Button type="submit" size="sm" disabled={submitting || !commentInput.trim()}>
                  <Send className="w-3.5 h-3.5" />
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </Modal>
  );
};
