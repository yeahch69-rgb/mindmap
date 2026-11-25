import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight,
  Bell,
  BookMarked,
  Calendar,
  CheckCircle2,
  Copy,
  Edit2,
  ExternalLink,
  Lightbulb,
  MapPin,
  MessageSquare,
  Move,
  Repeat,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  CalendarEventComment,
  CalendarEventItem,
  CollabSpace,
} from '../../types/spaces';
import { formatJstTime, getJstDateKey } from '../../utils/dateTime';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { TranslateButton } from '../common/TranslateButton';
import { useContentTranslation } from '../../hooks/useContentTranslation';

interface EventDetailChatModalProps {
  isOpen: boolean;
  onClose: () => void;
  space: CollabSpace;
  eventId: number | null;
  realtimeTick: number;
  onEdit: (event: CalendarEventItem) => void;
  onStartMove: (event: CalendarEventItem) => void;
  onStartCopy: (event: CalendarEventItem) => void;
  onJumpToThought: (thoughtId: number) => void;
  onJumpToMindmapProject: (projectId: number) => void;
  onMutated: () => void;
}

export const EventDetailChatModal: React.FC<EventDetailChatModalProps> = ({
  isOpen,
  onClose,
  space,
  eventId,
  realtimeTick,
  onEdit,
  onStartMove,
  onStartCopy,
  onJumpToThought,
  onJumpToMindmapProject,
  onMutated,
}) => {
  const { user } = useAuth();
  const { L } = useLanguage();
  const translator = useContentTranslation();

  const [event, setEvent] = useState<CalendarEventItem | null>(null);
  const [comments, setComments] = useState<CalendarEventComment[]>([]);
  const [siblingProposals, setSiblingProposals] = useState<Array<{ id: number; start_date: string; title: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [sending, setSending] = useState(false);
  const [cancelOthersOnConfirm, setCancelOthersOnConfirm] = useState(true);
  const chatEndRef = useRef<HTMLDivElement | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!eventId) return;
    try {
      const res = await api.get<{
        event: CalendarEventItem;
        comments: CalendarEventComment[];
        sibling_proposals: Array<{ id: number; start_date: string; title: string }>;
      }>(`/spaces/${space.id}/events/${eventId}`);
      setEvent(res.event);
      setComments(res.comments || []);
      setSiblingProposals(res.sibling_proposals || []);
    } catch {
      // event may have been deleted
    }
  }, [space.id, eventId]);

  useEffect(() => {
    if (!isOpen || !eventId) return;
    setLoading(true);
    void fetchDetail().finally(() => setLoading(false));
  }, [isOpen, eventId, fetchDetail]);

  useEffect(() => {
    if (isOpen && eventId && realtimeTick > 0) {
      void fetchDetail();
    }
  }, [realtimeTick, isOpen, eventId, fetchDetail]);

  useEffect(() => {
    if (comments.length > 0) {
      chatEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [comments.length]);

  const handleSendChat = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!event || !chatInput.trim() || sending) return;
    try {
      setSending(true);
      const res = await api.post<{ comment: CalendarEventComment }>(
        `/spaces/${space.id}/events/${event.id}/comments`,
        { content: chatInput.trim() }
      );
      setComments((prev) => [...prev, res.comment]);
      setChatInput('');
      onMutated();
    } finally {
      setSending(false);
    }
  };

  const handleDeleteComment = async (commentId: number) => {
    if (!event) return;
    await api.delete(`/spaces/${space.id}/events/${event.id}/comments/${commentId}`);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    onMutated();
  };

  const handleVote = async (vote: 'AVAILABLE' | 'UNAVAILABLE') => {
    if (!event) return;
    const res = await api.post<{ event: CalendarEventItem }>(
      `/spaces/${space.id}/events/${event.id}/vote`,
      { vote }
    );
    setEvent(res.event);
    onMutated();
  };

  const handleConfirmProposal = async () => {
    if (!event) return;
    await api.post(`/spaces/${space.id}/events/${event.id}/confirm`, {
      cancelOtherProposals: siblingProposals.length > 0 ? cancelOthersOnConfirm : false,
    });
    await fetchDetail();
    onMutated();
  };

  const handleDeleteEvent = async () => {
    if (!event) return;
    const ok = window.confirm(
      L(`'${event.title}' 일정을 삭제할까요?`, `「${event.title}」を削除しますか？`, `Delete '${event.title}'?`)
    );
    if (!ok) return;
    await api.delete(`/spaces/${space.id}/events/${event.id}`);
    onMutated();
    onClose();
  };

  const labelObj = space.labels.find((l) => l.key === event?.label_key);
  const availableVotes = (event?.votes || []).filter((v) => v.vote === 'AVAILABLE');
  const unavailableVotes = (event?.votes || []).filter((v) => v.vote === 'UNAVAILABLE');
  const myVote = (event?.votes || []).find((v) => v.user_id === user?.id)?.vote || null;

  const attendees = (event?.attendee_ids || [])
    .map((id) => space.members.find((m) => m.user_id === id))
    .filter(Boolean);

  const recurrenceText = (rec?: string) => {
    if (!rec || rec === 'NONE') return '';
    if (rec === 'DAILY') return L('매일 반복', '毎日', 'Daily');
    if (rec === 'WEEKLY') return L('매주 반복', '毎週', 'Weekly');
    if (rec === 'MONTHLY') return L('매월 반복', '毎月', 'Monthly');
    if (rec === 'YEARLY') return L('매년 반복', '毎年', 'Yearly');
    return '';
  };

  const reminderText = (min?: number | null) => {
    if (min === null || min === undefined) return '';
    if (min === 0) return L('시작 시각 알림', '開始時刻', 'At start');
    if (min >= 1440) return L('하루 전 알림', '1日前', '1 day before');
    if (min >= 60) return L(`${Math.round(min / 60)}시간 전 알림`, `${Math.round(min / 60)}時間前`, `${Math.round(min / 60)}h before`);
    return L(`${min}분 전 알림`, `${min}分前`, `${min}m before`);
  };

  const evTransKey = event ? `cal-ev-${event.id}` : 'cal-ev-none';
  const showEventTranslate = event
    ? translator.shouldShowButton(event.title, event.location, event.description)
    : false;
  const displayTitle = event ? translator.getText(evTransKey, 'title', event.title) : '';
  const displayLocation = event ? translator.getText(evTransKey, 'location', event.location) : '';
  const displayDescription = event ? translator.getText(evTransKey, 'description', event.description) : '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="4xl"
      title={
        event ? (
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: event.color }} />
            <span className="truncate">{displayTitle}</span>
            {event.event_status === 'PROPOSED' && (
              <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold shrink-0">
                {L('제안 일정', '提案中', 'Proposed')}
              </span>
            )}
          </div>
        ) : (
          L('일정 상세 & 채팅', '予定詳細・チャット', 'Event & Chat')
        )
      }
    >
      {loading || !event ? (
        <div className="py-12 text-center text-xs text-charcoal-500">
          {L('일정 불러오는 중...', '読み込み中...', 'Loading event...')}
        </div>
      ) : (
        <div className="space-y-4">
          {/* Quick Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-ivory-200">
            <div className="flex flex-wrap items-center gap-1.5">
              {labelObj && (
                <span
                  className="px-2 py-0.5 rounded-full text-[11px] font-bold"
                  style={{ backgroundColor: event.color || labelObj.color, color: event.text_color || '#FFFFFF' }}
                >
                  {labelObj.name}
                </span>
              )}
              <span className="text-[11px] text-charcoal-500">
                {L(`작성: ${event.creator_name}`, `作成: ${event.creator_name}`, `By ${event.creator_name}`)}
              </span>
              <TranslateButton
                visible={showEventTranslate}
                translated={translator.isTranslated(evTransKey)}
                loading={translator.isTranslating(evTransKey)}
                error={translator.getError(evTransKey)}
                onClick={(e) => {
                  e.stopPropagation();
                  void translator.toggleTranslate(
                    evTransKey,
                    { title: event.title, location: event.location, description: event.description },
                    'shared-calendar-event'
                  );
                }}
              />
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartMove(event);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-charcoal-700 hover:bg-ivory-100 border border-ivory-200 transition"
                title={L('다른 날짜로 이동', '別の日に移動', 'Move to another date')}
              >
                <Move className="w-3 h-3" />
                {L('이동', '移動', 'Move')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartCopy(event);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-charcoal-700 hover:bg-ivory-100 border border-ivory-200 transition"
                title={L('다른 날짜에 복사', '別の日にコピー', 'Copy to another date')}
              >
                <Copy className="w-3 h-3" />
                {L('복사', 'コピー', 'Copy')}
              </button>
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onEdit(event);
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-forest-800 hover:bg-forest-50 border border-forest-200 transition"
              >
                <Edit2 className="w-3 h-3" />
                {L('수정', '編集', 'Edit')}
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteEvent()}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-rose-700 hover:bg-rose-50 border border-rose-200 transition"
                title={L('일정 삭제', '予定を削除', 'Delete event')}
              >
                <Trash2 className="w-3 h-3" />
                {L('삭제', '削除', 'Delete')}
              </button>
            </div>
          </div>

          {/* PROPOSAL BANNER (if PROPOSED) */}
          {event.event_status === 'PROPOSED' && (
            <div className="p-3.5 rounded-xl bg-amber-50 border-2 border-dashed border-amber-300 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-0.5">
                  <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-700" />
                    <span>{L('제안 일정 · 참석 여부 투표', '提案日程・参加可否投票', 'Proposed Date · Vote or Confirm')}</span>
                  </div>
                  <p className="text-[11px] text-amber-800">
                    {L(
                      '가능 여부를 표시하고 의견이 모이면 정식 일정으로 확정하세요.',
                      '参加可否を選択し、合意できたら確定予定に変更してください。',
                      'Respond with your availability and confirm once ready.'
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleVote('AVAILABLE')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                    myVote === 'AVAILABLE'
                      ? 'bg-emerald-700 text-white border-emerald-800 shadow-xs'
                      : 'bg-white text-emerald-800 border-emerald-300 hover:bg-emerald-50'
                  }`}
                >
                  <ThumbsUp className="w-3.5 h-3.5" />
                  <span>{L('가능', '参加OK', 'Available')}</span>
                  <span className="font-mono">({availableVotes.length})</span>
                </button>
                <button
                  type="button"
                  onClick={() => void handleVote('UNAVAILABLE')}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                    myVote === 'UNAVAILABLE'
                      ? 'bg-rose-700 text-white border-rose-800 shadow-xs'
                      : 'bg-white text-rose-800 border-rose-300 hover:bg-rose-50'
                  }`}
                >
                  <ThumbsDown className="w-3.5 h-3.5" />
                  <span>{L('어려움', '難しい', 'Unavailable')}</span>
                  <span className="font-mono">({unavailableVotes.length})</span>
                </button>
              </div>

              {(availableVotes.length > 0 || unavailableVotes.length > 0) && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                  {availableVotes.length > 0 && (
                    <span className="text-emerald-900">
                      👍 {availableVotes.map((v) => v.user_name).join(', ')}
                    </span>
                  )}
                  {unavailableVotes.length > 0 && (
                    <span className="text-rose-900">
                      👎 {unavailableVotes.map((v) => v.user_name).join(', ')}
                    </span>
                  )}
                </div>
              )}

              <div className="pt-2 border-t border-amber-200 flex flex-wrap items-center justify-between gap-2">
                {siblingProposals.length > 0 ? (
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-amber-950 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cancelOthersOnConfirm}
                      onChange={(e) => setCancelOthersOnConfirm(e.target.checked)}
                      className="rounded text-forest-700"
                    />
                    <span>
                      {L(
                        `나머지 후보 날짜 제안 ${siblingProposals.length}건 자동 정리`,
                        `他の候補提案 ${siblingProposals.length}件を自動整理`,
                        `Close ${siblingProposals.length} other candidate proposal(s)`
                      )}
                    </span>
                  </label>
                ) : (
                  <span />
                )}

                <Button type="button" size="sm" onClick={() => void handleConfirmProposal()}>
                  <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                  {L('정식 일정 확정', '確定予定にする', 'Confirm Event')}
                </Button>
              </div>
            </div>
          )}

          {/* Event Metadata Card */}
          <div className="p-3.5 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2 text-xs text-charcoal-800">
            <div className="flex items-center gap-2 font-bold">
              <Calendar className="w-4 h-4 text-forest-700 shrink-0" />
              <span>
                {event.start_date}
                {event.end_date !== event.start_date ? ` ~ ${event.end_date}` : ''}
              </span>
              <span className="px-2 py-0.5 rounded bg-white border border-ivory-300 text-[11px] font-bold text-charcoal-700">
                {event.is_all_day
                  ? L('하루 종일', '終日', 'All Day')
                  : `${event.start_time || ''}${event.end_time ? ` ~ ${event.end_time}` : ''}`}
              </span>
            </div>

            {event.recurrence_type !== 'NONE' && (
              <div className="flex items-center gap-2 text-charcoal-600">
                <Repeat className="w-3.5 h-3.5 text-forest-700 shrink-0" />
                <span>
                  {recurrenceText(event.recurrence_type)}
                  {event.recurrence_until ? ` (~ ${event.recurrence_until})` : ''}
                </span>
              </div>
            )}

            {event.reminder_minutes !== null && (
              <div className="flex items-center gap-2 text-charcoal-600">
                <Bell className="w-3.5 h-3.5 text-forest-700 shrink-0" />
                <span>{reminderText(event.reminder_minutes)}</span>
              </div>
            )}

            {event.location && (
              <div className="flex items-center gap-2 text-charcoal-700">
                <MapPin className="w-3.5 h-3.5 text-forest-700 shrink-0" />
                <span>{displayLocation}</span>
              </div>
            )}

            {event.url && (
              <div className="flex items-center gap-2">
                <ExternalLink className="w-3.5 h-3.5 text-sky-700 shrink-0" />
                <a
                  href={event.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sky-700 hover:underline truncate"
                >
                  {event.url}
                </a>
              </div>
            )}

            {attendees.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap pt-1">
                <Users className="w-3.5 h-3.5 text-forest-700 shrink-0" />
                {attendees.map((m) => (
                  <span
                    key={m!.user_id}
                    className="px-2 py-0.5 rounded-full bg-white border border-ivory-300 text-[11px] font-bold text-charcoal-700"
                  >
                    {m!.name}
                  </span>
                ))}
              </div>
            )}

            {event.description && (
              <div className="pt-2 border-t border-ivory-200 whitespace-pre-wrap text-charcoal-700 leading-relaxed">
                {displayDescription}
              </div>
            )}
          </div>

          {/* Linked Shared Thought Card (Organic Bridge!) */}
          {event.linked_thought && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onJumpToThought(event.linked_thought!.id);
              }}
              className="w-full p-3 rounded-xl bg-forest-50 hover:bg-forest-100 border border-forest-200 flex items-center justify-between gap-3 text-left transition group"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="w-8 h-8 rounded-lg bg-forest-800 text-white flex items-center justify-center shrink-0">
                  <Lightbulb className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-[10px] font-bold text-forest-700 uppercase tracking-wide">
                    {L('공유 메모장에서 연결된 생각', '共有メモから連携されたアイデア', 'Linked Shared Thought')}
                  </div>
                  <div className="text-xs font-bold text-forest-950 truncate">
                    {event.linked_thought.title || event.linked_thought.content}
                  </div>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-forest-700 shrink-0 group-hover:translate-x-0.5 transition" />
            </button>
          )}

          {/* Linked Mindmap Project/Idea/Entry Cards (3-Way Live Sync!) */}
          {event.mindmap_links && event.mindmap_links.length > 0 && (
            <div className="space-y-1.5">
              {event.mindmap_links.map((ml) => (
                <button
                  key={`${ml.entity_type}-${ml.entity_id}`}
                  type="button"
                  onClick={() => {
                    if (ml.project_id) {
                      onClose();
                      onJumpToMindmapProject(ml.project_id);
                    }
                  }}
                  className="w-full p-3 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 flex items-center justify-between gap-3 text-left transition group"
                >
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-indigo-700 text-white flex items-center justify-center shrink-0">
                      <BookMarked className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold text-indigo-700 uppercase tracking-wide">
                        {ml.entity_type === 'PROJECT'
                          ? L('마인드맵 프로젝트 · 실시간 양방향 동기화', 'マインドマップ連携（双方向同期）', 'Mindmap Project · Live Sync')
                          : ml.entity_type === 'IDEA'
                            ? L(`마인드맵 아이디어 (${ml.project_title || ''}) · 실시간 동기화`, `アイデア連携 (${ml.project_title || ''})`, `Mindmap Idea · Live Sync`)
                            : L(`마인드맵 기록 (${ml.project_title || ''}) · 실시간 동기화`, `タイムライン連携 (${ml.project_title || ''})`, `Mindmap Entry · Live Sync`)}
                      </div>
                      <div className="text-xs font-bold text-indigo-950 truncate">{ml.title}</div>
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-indigo-700 shrink-0 group-hover:translate-x-0.5 transition" />
                </button>
              ))}
            </div>
          )}

          {/* Per-Event Chat & Activity Stream */}
          <div className="border border-ivory-300 rounded-xl overflow-hidden bg-white flex flex-col">
            <div className="px-3.5 py-2.5 bg-ivory-50 border-b border-ivory-200 flex items-center justify-between">
              <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-800">
                <MessageSquare className="w-4 h-4 text-forest-700" />
                <span>{L('일정 채팅 · 변경 기록', '予定チャット・履歴', 'Event Chat & History')}</span>
              </div>
              <span className="text-[11px] text-charcoal-500">
                {L(
                  `대화 ${comments.filter((c) => !c.is_system).length}건`,
                  `メッセージ ${comments.filter((c) => !c.is_system).length}件`,
                  `${comments.filter((c) => !c.is_system).length} messages`
                )}
              </span>
            </div>

            <div className="p-3 space-y-2.5 max-h-72 overflow-y-auto bg-ivory-50/40">
              {comments.length === 0 ? (
                <div className="py-6 text-center text-xs text-charcoal-400">
                  {L(
                    '이 일정에 대한 준비물, 시간 조율, 메모를 채팅처럼 남겨보세요.',
                    'この予定に関する連絡やメモをチャットのように残せます。',
                    'Leave chat notes or coordinate details for this event.'
                  )}
                </div>
              ) : (
                comments.map((c) => {
                  if (c.is_system) {
                    return (
                      <div key={c.id} className="flex justify-center">
                        <div className="px-3 py-1 rounded-full bg-ivory-200/80 text-[10px] font-medium text-charcoal-600 text-center">
                          {c.content} · {getJstDateKey(c.created_at).slice(5)} {formatJstTime(c.created_at)}
                        </div>
                      </div>
                    );
                  }

                  const isMine = c.author_id === user?.id;
                  const msgTransKey = `ev-cmt-${c.id}`;
                  const showMsgTranslate = translator.shouldShowButton(c.content);
                  const displayMsg = translator.getText(msgTransKey, 'content', c.content);
                  return (
                    <div key={c.id} className={`flex flex-col ${isMine ? 'items-end' : 'items-start'}`}>
                      <div className="flex items-center gap-1.5 mb-0.5 px-1">
                        <span className="text-[10px] font-bold text-charcoal-600">{c.author_name}</span>
                        <span className="text-[10px] text-charcoal-400">
                          {getJstDateKey(c.created_at).slice(5)} {formatJstTime(c.created_at)}
                        </span>
                        <TranslateButton
                          visible={showMsgTranslate}
                          translated={translator.isTranslated(msgTransKey)}
                          loading={translator.isTranslating(msgTransKey)}
                          error={translator.getError(msgTransKey)}
                          onClick={(e) => {
                            e.stopPropagation();
                            void translator.toggleTranslate(msgTransKey, { content: c.content }, 'event-chat');
                          }}
                        />
                      </div>
                      <div className="group flex items-end gap-1 max-w-[85%]">
                        {isMine && (
                          <button
                            type="button"
                            onClick={() => void handleDeleteComment(c.id)}
                            className="opacity-0 group-hover:opacity-100 p-1 text-charcoal-400 hover:text-rose-600 transition"
                            title={L('삭제', '削除', 'Delete')}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        )}
                        <div
                          className={`px-3 py-2 rounded-2xl text-xs whitespace-pre-wrap break-words leading-relaxed shadow-2xs ${
                            isMine
                              ? 'bg-forest-800 text-white rounded-br-sm'
                              : 'bg-white border border-ivory-300 text-charcoal-900 rounded-bl-sm'
                          }`}
                        >
                          {displayMsg}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat Composer */}
            <form onSubmit={handleSendChat} className="p-2.5 bg-white border-t border-ivory-200 flex items-center gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={L('일정 채팅창에 메시지 남기기...', '予定にコメントを送信...', 'Write a message about this event...')}
                className="flex-1 min-w-0 px-3 py-2 text-xs rounded-xl bg-ivory-50 border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-600 focus:bg-white"
              />
              <Button type="submit" size="sm" disabled={sending || !chatInput.trim()}>
                <Send className="w-3.5 h-3.5" />
              </Button>
            </form>
          </div>
        </div>
      )}
    </Modal>
  );
};
