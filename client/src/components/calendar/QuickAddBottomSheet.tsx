import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, ChevronDown, ChevronUp, Copy, Plus, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { CalendarEventItem } from '../../types/spaces';
import { Button } from '../common/Button';

interface QuickAddBottomSheetProps {
  targetDate: string | null;
  onClose: () => void;
  recentEvents: CalendarEventItem[];
  onCreateNewEvent: (ymd: string) => void;
  onCopyRecentEvent: (event: CalendarEventItem, targetDate: string) => void;
}

export const QuickAddBottomSheet: React.FC<QuickAddBottomSheetProps> = ({
  targetDate,
  onClose,
  recentEvents,
  onCreateNewEvent,
  onCopyRecentEvent,
}) => {
  const { L } = useLanguage();
  const isOpen = Boolean(targetDate);
  const [renderedDate, setRenderedDate] = useState<string>('');
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragDeltaY, setDragDeltaY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen && targetDate) {
      setRenderedDate(targetDate);
      setMounted(true);
      setExpanded(false);
      setDragDeltaY(0);
      const raf = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setVisible(true));
      });
      return () => window.cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const timer = window.setTimeout(() => setMounted(false), 260);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen, targetDate]);

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
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-charcoal-950/45 backdrop-blur-[1px] transition-opacity duration-250 ${
          visible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* Slide-Up Sheet (Identical dimensions & drag behavior to MobileDayBottomSheet) */}
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

        {/* Sheet Header */}
        <div className="px-4 py-2.5 bg-ivory-50 border-b border-ivory-200 flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <CalendarPlus className="w-4 h-4 text-forest-700 shrink-0" />
            <div className="min-w-0">
              <div className="text-sm font-bold text-forest-900 truncate">
                {renderedDate} · {L('빠른 일정 추가', 'クイック追加', 'Quick Add Event')}
              </div>
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

        {/* Sheet Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-white">
          <Button
            type="button"
            className="w-full py-2.5"
            onClick={() => {
              const dt = renderedDate;
              onClose();
              onCreateNewEvent(dt);
            }}
          >
            <Plus className="w-4 h-4 mr-1.5" />
            {L(`${renderedDate}에 새 일정 추가`, `${renderedDate} に新しい予定を追加`, `Add New Event on ${renderedDate}`)}
          </Button>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-charcoal-700">
              <span>
                {L(
                  '최근 추가한 10개 일정에서 바로 복사',
                  '最近追加した10件の予定からコピー',
                  'Quick-copy from last 10 created events'
                )}
              </span>
              <span className="text-[11px] text-charcoal-400">{recentEvents.length}/10</span>
            </div>

            {recentEvents.length === 0 ? (
              <div className="py-10 text-center text-xs text-charcoal-400 bg-ivory-50 rounded-2xl border border-ivory-200">
                {L('최근 추가한 일정이 아직 없습니다.', '最近の予定はまだありません。', 'No recent events yet.')}
              </div>
            ) : (
              <div className="divide-y divide-ivory-200 border border-ivory-200 rounded-2xl overflow-hidden bg-white">
                {recentEvents.map((rev) => (
                  <button
                    key={rev.id}
                    type="button"
                    onClick={() => {
                      const dt = renderedDate;
                      onClose();
                      onCopyRecentEvent(rev, dt);
                    }}
                    className="w-full px-3.5 py-3 flex items-center justify-between gap-2.5 text-left hover:bg-forest-50 active:bg-forest-100 transition"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: rev.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-charcoal-900 truncate">{rev.title}</div>
                        <div className="text-[11px] text-charcoal-500 flex items-center gap-1.5">
                          <span>
                            {rev.is_all_day
                              ? L('하루 종일', '終日', 'All Day')
                              : `${rev.start_time || ''}${rev.end_time ? `~${rev.end_time}` : ''}`}
                          </span>
                          <span>·</span>
                          <span>{rev.start_date}</span>
                        </div>
                      </div>
                    </div>
                    <span className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-ivory-100 text-forest-800 text-[11px] font-bold">
                      <Copy className="w-3 h-3" />
                      {L('복사', 'コピー', 'Copy')}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
