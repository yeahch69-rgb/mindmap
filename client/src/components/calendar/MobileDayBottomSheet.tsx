import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookMarked,
  CalendarPlus,
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  Lightbulb,
  MessageSquare,
  Move,
  Plus,
  Repeat,
  ThumbsUp,
  X,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { CalendarEventItem } from '../../types/spaces';
import { ExpandedEventInstance, formatShortDate } from '../../utils/calendarUtils';

interface MobileDayBottomSheetProps {
  isOpen: boolean;
  isCardDragging?: boolean;
  onClose: () => void;
  selectedDate: string;
  dayEvents: ExpandedEventInstance[];
  onOpenEventDetail: (eventId: number) => void;
  onOpenNewEvent: (ymd: string) => void;
  onOpenRecentCopy: (ymd: string) => void;
  onStartMove: (event: CalendarEventItem) => void;
  onStartCopy: (event: CalendarEventItem) => void;
  onStartCardDragMove: (
    event: CalendarEventItem,
    clientX: number,
    clientY: number,
    mode: 'touch' | 'pointer'
  ) => void;
  onUpdateCardDragMove: (clientX: number, clientY: number) => void;
  onEndCardDragMove: (clientX?: number, clientY?: number) => void;
  onCancelCardDragMove: () => void;
}

export const MobileDayBottomSheet: React.FC<MobileDayBottomSheetProps> = ({
  isOpen,
  isCardDragging = false,
  onClose,
  selectedDate,
  dayEvents,
  onOpenEventDetail,
  onOpenNewEvent,
  onOpenRecentCopy,
  onStartMove,
  onStartCopy,
  onStartCardDragMove,
  onUpdateCardDragMove,
  onEndCardDragMove,
  onCancelCardDragMove,
}) => {
  const { L } = useLanguage();
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragDeltaY, setDragDeltaY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number | null>(null);
  const cardHoldTimerRef = useRef<number | null>(null);
  const cardHoldStartRef = useRef<{ x: number; y: number; lastX: number; lastY: number } | null>(null);
  const cardDragTriggeredRef = useRef(false);
  const touchDragSessionRef = useRef<{
    touchId: number;
    event: CalendarEventItem;
    startX: number;
    startY: number;
    lastX: number;
    lastY: number;
    dragging: boolean;
  } | null>(null);

  const callbacksRef = useRef({
    onClose,
    onStartCardDragMove,
    onUpdateCardDragMove,
    onEndCardDragMove,
    onCancelCardDragMove,
  });
  callbacksRef.current = {
    onClose,
    onStartCardDragMove,
    onUpdateCardDragMove,
    onEndCardDragMove,
    onCancelCardDragMove,
  };

  const clearCardHold = () => {
    if (cardHoldTimerRef.current !== null) {
      window.clearTimeout(cardHoldTimerRef.current);
      cardHoldTimerRef.current = null;
    }
    cardHoldStartRef.current = null;
  };

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setExpanded(false);
      setDragDeltaY(0);
      const raf = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setVisible(true));
      });
      return () => window.cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      if (isCardDragging) {
        // Keep DOM mounted while touch drag is active so Touch.target stays attached and never cancels mid-drag
        return;
      }
      const timer = window.setTimeout(() => setMounted(false), 260);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, isCardDragging]);

  // Pre-register non-passive touch listeners whenever sheet is mounted so iOS Safari / Android Chrome
  // allow e.preventDefault() immediately once the 360ms long-press transitions into card drag mode.
  useEffect(() => {
    if (!mounted) return;

    const findTouchById = (list: TouchList, id: number): Touch | null => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i];
      }
      return null;
    };

    const onWindowTouchMove = (e: TouchEvent) => {
      const session = touchDragSessionRef.current;
      if (!session) return;
      const t = findTouchById(e.touches, session.touchId);
      if (!t) return;

      session.lastX = t.clientX;
      session.lastY = t.clientY;

      if (!session.dragging) {
        const dx = Math.abs(t.clientX - session.startX);
        const dy = Math.abs(t.clientY - session.startY);
        if (dx > 8 || dy > 8) {
          clearCardHold();
          touchDragSessionRef.current = null;
        }
        return;
      }

      if (e.cancelable) {
        e.preventDefault();
      }
      callbacksRef.current.onUpdateCardDragMove(t.clientX, t.clientY);
    };

    const onWindowTouchEnd = (e: TouchEvent) => {
      const session = touchDragSessionRef.current;
      if (!session) return;

      const stillTouching = findTouchById(e.touches, session.touchId);
      if (stillTouching) return;

      const endedTouch = findTouchById(e.changedTouches, session.touchId);
      const endX = endedTouch ? endedTouch.clientX : session.lastX;
      const endY = endedTouch ? endedTouch.clientY : session.lastY;
      const wasDragging = session.dragging;

      clearCardHold();
      touchDragSessionRef.current = null;

      if (wasDragging) {
        if (e.cancelable) {
          e.preventDefault();
        }
        callbacksRef.current.onEndCardDragMove(endX, endY);
      }
    };

    const onWindowTouchCancel = (e: TouchEvent) => {
      const session = touchDragSessionRef.current;
      if (!session) return;

      const stillTouching = findTouchById(e.touches, session.touchId);
      if (stillTouching) return;

      const wasDragging = session.dragging;
      clearCardHold();
      touchDragSessionRef.current = null;

      if (wasDragging) {
        callbacksRef.current.onCancelCardDragMove();
      }
    };

    const onWindowContextMenu = (e: MouseEvent) => {
      if (touchDragSessionRef.current) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    window.addEventListener('touchmove', onWindowTouchMove, { passive: false });
    window.addEventListener('touchend', onWindowTouchEnd, { passive: false });
    window.addEventListener('touchcancel', onWindowTouchCancel);
    window.addEventListener('contextmenu', onWindowContextMenu, true);

    return () => {
      window.removeEventListener('touchmove', onWindowTouchMove);
      window.removeEventListener('touchend', onWindowTouchEnd);
      window.removeEventListener('touchcancel', onWindowTouchCancel);
      window.removeEventListener('contextmenu', onWindowContextMenu, true);
    };
  }, [mounted]);

  useEffect(() => {
    return () => {
      clearCardHold();
      touchDragSessionRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleDragStart = (clientY: number) => {
    startYRef.current = clientY;
    setIsDragging(true);
    setDragDeltaY(0);
  };

  const handleDragMove = (clientY: number) => {
    if (startYRef.current === null) return;
    const delta = clientY - startYRef.current;
    // Allow slight upward drag for expand, free downward drag for collapse/close
    setDragDeltaY(Math.max(-140, delta));
  };

  const handleDragEnd = () => {
    if (startYRef.current === null) return;
    const delta = dragDeltaY;
    startYRef.current = null;
    setIsDragging(false);
    setDragDeltaY(0);

    if (delta < -45) {
      setExpanded(true);
    } else if (delta > 150) {
      onClose();
    } else if (delta > 55) {
      if (expanded) {
        setExpanded(false);
      } else {
        onClose();
      }
    }
  };

  if (!mounted) return null;

  const targetHeight = expanded ? '88vh' : '56vh';
  const translateStyle = !visible
    ? 'translateY(100%)'
    : isDragging && dragDeltaY > 0
      ? `translateY(${dragDeltaY}px)`
      : 'translateY(0)';

  return createPortal(
    <div
      className={`xl:hidden fixed inset-0 z-40 flex flex-col justify-end ${
        !visible || isCardDragging ? 'pointer-events-none' : ''
      }`}
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-charcoal-950/45 backdrop-blur-[1px] transition-opacity duration-250 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Slide-Up Sheet */}
      <div
        style={{
          height: targetHeight,
          transform: translateStyle,
          transition: isDragging
            ? 'none'
            : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), height 240ms cubic-bezier(0.22, 1, 0.36, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        className="relative z-10 w-full max-w-2xl mx-auto bg-white rounded-t-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.2)] border-t border-ivory-300 flex flex-col overflow-hidden"
      >
        {/* Draggable Top Handle Bar */}
        <div
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            handleDragStart(e.clientY);
          }}
          onPointerMove={(e) => {
            if (isDragging) handleDragMove(e.clientY);
          }}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          className="pt-2.5 pb-1.5 flex flex-col items-center cursor-grab active:cursor-grabbing touch-none select-none shrink-0 bg-ivory-50"
        >
          <div className="w-11 h-1.5 rounded-full bg-charcoal-300" />
        </div>

        {/* Sheet Header (Clean 2-row on narrow smartphones so date never wraps/squishes) */}
        <div className="px-4 py-2.5 bg-ivory-50 border-b border-ivory-200 space-y-2 shrink-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <div className="text-sm font-bold text-forest-900 whitespace-nowrap">{selectedDate}</div>
              <div className="text-[11px] text-charcoal-500 whitespace-nowrap">
                {L(
                  `일정 ${dayEvents.length}건`,
                  `予定 ${dayEvents.length}件`,
                  `${dayEvents.length} event(s)`
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="p-1.5 rounded-xl text-charcoal-500 hover:bg-ivory-200 transition"
                title={expanded ? L('반화면으로', '半画面へ', 'Half height') : L('전체 확장', '全画面へ', 'Expand')}
              >
                {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-xl text-charcoal-500 hover:bg-ivory-200 transition"
                title={L('닫기', '閉じる', 'Close')}
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenRecentCopy(selectedDate);
              }}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-white hover:bg-ivory-100 border border-ivory-300 text-xs font-bold text-charcoal-700 whitespace-nowrap transition"
            >
              <Copy className="w-3.5 h-3.5 text-forest-700 shrink-0" />
              <span>{L('최근 복사', '履歴コピー', 'Recent')}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenNewEvent(selectedDate);
              }}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-forest-800 hover:bg-forest-900 text-white text-xs font-bold whitespace-nowrap transition"
            >
              <Plus className="w-3.5 h-3.5 shrink-0" />
              <span>{L('일정 추가', '追加', 'Add')}</span>
            </button>
          </div>
        </div>

        {/* Scrollable Event List */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-2.5 bg-white">
          {dayEvents.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <p className="text-xs text-charcoal-400">
                {L('이 날짜에 등록된 일정이 없습니다.', 'この日の予定はありません。', 'No events on this day.')}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenNewEvent(selectedDate);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-forest-800 text-white text-xs font-bold"
                >
                  <Plus className="w-4 h-4" />
                  {L('새 일정 추가', '新しい予定を作成', 'New Event')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenRecentCopy(selectedDate);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-ivory-100 text-charcoal-800 text-xs font-bold border border-ivory-300"
                >
                  <CalendarPlus className="w-4 h-4 text-forest-700" />
                  {L('최근 10개 일정에서 복사', '最近の予定10件からコピー', 'Copy from Recent 10')}
                </button>
              </div>
            </div>
          ) : (
            dayEvents.map((inst) => {
              const ev = inst.event;
              const isProposed = ev.event_status === 'PROPOSED';
              const okVotes = ev.votes.filter((v) => v.vote === 'AVAILABLE').length;
              const hasMindmapLink = Boolean(ev.mindmap_links && ev.mindmap_links.length > 0);

              return (
                <div
                  key={inst.instanceKey}
                  draggable={false}
                  style={{
                    WebkitUserSelect: 'none',
                    userSelect: 'none',
                    WebkitTouchCallout: 'none',
                  }}
                  onTouchStart={(e) => {
                    if (e.touches.length !== 1) return;
                    if ((e.target as HTMLElement).closest('button')) return;
                    clearCardHold();
                    cardDragTriggeredRef.current = false;
                    const touch = e.touches[0];
                    const session = {
                      touchId: touch.identifier,
                      event: ev,
                      startX: touch.clientX,
                      startY: touch.clientY,
                      lastX: touch.clientX,
                      lastY: touch.clientY,
                      dragging: false,
                    };
                    touchDragSessionRef.current = session;
                    cardHoldTimerRef.current = window.setTimeout(() => {
                      const cur = touchDragSessionRef.current;
                      if (!cur || cur.touchId !== session.touchId) return;
                      cur.dragging = true;
                      cardDragTriggeredRef.current = true;
                      try {
                        navigator.vibrate?.(30);
                      } catch {}
                      callbacksRef.current.onClose();
                      callbacksRef.current.onStartCardDragMove(ev, cur.lastX, cur.lastY, 'touch');
                    }, 360);
                  }}
                  onPointerDown={(e) => {
                    if (e.pointerType === 'touch') return;
                    if (e.pointerType === 'mouse' && e.button !== 0) return;
                    if ((e.target as HTMLElement).closest('button')) return;
                    clearCardHold();
                    cardDragTriggeredRef.current = false;
                    const startX = e.clientX;
                    const startY = e.clientY;
                    cardHoldStartRef.current = { x: startX, y: startY, lastX: startX, lastY: startY };
                    cardHoldTimerRef.current = window.setTimeout(() => {
                      const cur = cardHoldStartRef.current;
                      const dragX = cur ? cur.lastX : startX;
                      const dragY = cur ? cur.lastY : startY;
                      cardHoldStartRef.current = null;
                      cardDragTriggeredRef.current = true;
                      try {
                        navigator.vibrate?.(30);
                      } catch {}
                      callbacksRef.current.onClose();
                      callbacksRef.current.onStartCardDragMove(ev, dragX, dragY, 'pointer');
                    }, 360);
                  }}
                  onPointerMove={(e) => {
                    if (e.pointerType === 'touch') return;
                    if (!cardHoldStartRef.current) return;
                    cardHoldStartRef.current.lastX = e.clientX;
                    cardHoldStartRef.current.lastY = e.clientY;
                    const dx = Math.abs(e.clientX - cardHoldStartRef.current.x);
                    const dy = Math.abs(e.clientY - cardHoldStartRef.current.y);
                    if (dx > 10 || dy > 10) clearCardHold();
                  }}
                  onPointerUp={(e) => {
                    if (e.pointerType === 'touch') return;
                    clearCardHold();
                  }}
                  onPointerCancel={(e) => {
                    if (e.pointerType === 'touch') return;
                    clearCardHold();
                  }}
                  onContextMenu={(e) => e.preventDefault()}
                  onClick={() => {
                    if (cardDragTriggeredRef.current) {
                      cardDragTriggeredRef.current = false;
                      return;
                    }
                    onClose();
                    onOpenEventDetail(ev.id);
                  }}
                  className={`p-3.5 rounded-2xl border transition cursor-pointer active:scale-[0.99] select-none ${
                    isProposed
                      ? 'bg-amber-50/70 border-dashed border-amber-300'
                      : 'bg-white border-ivory-200 hover:border-forest-300 shadow-2xs'
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className="w-1.5 self-stretch rounded-full shrink-0"
                      style={{ backgroundColor: ev.color }}
                    />
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm font-bold text-charcoal-900 truncate flex items-center gap-1.5">
                          {isProposed && (
                            <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 text-[10px] font-bold shrink-0">
                              {L('제안', '提案', 'Proposed')}
                            </span>
                          )}
                          <span className="truncate">{ev.title}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onClose();
                              onStartMove(ev);
                            }}
                            className="p-1.5 rounded-lg bg-ivory-100 text-charcoal-600"
                            title={L('이동', '移動', 'Move')}
                          >
                            <Move className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onClose();
                              onStartCopy(ev);
                            }}
                            className="p-1.5 rounded-lg bg-ivory-100 text-charcoal-600"
                            title={L('복사', 'コピー', 'Copy')}
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-xs text-charcoal-500">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" />
                          {ev.is_all_day
                            ? L('하루 종일', '終日', 'All Day')
                            : `${ev.start_time || ''}${ev.end_time ? ` ~ ${ev.end_time}` : ''}`}
                        </span>
                        {ev.end_date !== ev.start_date && (
                          <span>
                            ({formatShortDate(inst.startDate)} ~ {formatShortDate(inst.endDate)})
                          </span>
                        )}
                        {ev.recurrence_type !== 'NONE' && <Repeat className="w-3.5 h-3.5 text-forest-700" />}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        {ev.comment_count > 0 && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
                            <MessageSquare className="w-3 h-3" />
                            {ev.comment_count}
                          </span>
                        )}
                        {isProposed && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded-full">
                            <ThumbsUp className="w-3 h-3" />
                            {okVotes}
                          </span>
                        )}
                        {ev.linked_thought_id && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-forest-800 bg-forest-50 px-2 py-0.5 rounded-full">
                            <Lightbulb className="w-3 h-3" />
                            {L('생각 연결', 'メモ連携', 'Thought')}
                          </span>
                        )}
                        {hasMindmapLink && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded-full">
                            <BookMarked className="w-3 h-3" />
                            {L('마인드맵 연동', 'マインドマップ連携', 'Mindmap')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          {dayEvents.length > 0 && (
            <div className="pt-1 text-center text-[11px] text-charcoal-400">
              💡 {L('일정 카드를 꾹 눌러 달력의 다른 날짜로 드래그해 이동·복사할 수 있습니다.', '予定カードを長押しして別の日へドラッグすると移動・コピーできます。', 'Long-press any card and drag onto another date to Move or Copy.')}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
};
