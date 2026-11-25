import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  BookMarked,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  Edit2,
  Lightbulb,
  MessageSquare,
  Move,
  Plus,
  Repeat,
  Settings,
  Sparkles,
  ThumbsUp,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { CalendarEventItem, CollabSpace } from '../../types/spaces';
import {
  buildMonthGrid,
  ExpandedEventInstance,
  expandEventsForRange,
  formatShortDate,
  layoutWeekBars,
  MonthCell,
  parseYmd,
} from '../../utils/calendarUtils';
import { getJstTodayStr } from '../../utils/dateTime';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { TranslateButton } from '../common/TranslateButton';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { EventEditorModal } from './EventEditorModal';
import { EventDetailChatModal } from './EventDetailChatModal';
import { MobileDayBottomSheet } from './MobileDayBottomSheet';
import { QuickAddBottomSheet } from './QuickAddBottomSheet';

interface SharedCalendarPageProps {
  spaces: CollabSpace[];
  activeSpace: CollabSpace | null;
  onSelectSpace: (spaceId: number) => void;
  onOpenCreateSpace: () => void;
  onOpenSpaceSettings: (space: CollabSpace) => void;
  onOpenActivityFeed: () => void;
  onJumpToThought: (thoughtId: number) => void;
  onJumpToMindmapProject: (projectId: number) => void;
  onSpacesNeedRefresh: () => void;
  realtimeTick: number;
  initialFocusEventId?: number | null;
  initialFocusDate?: string | null;
  onConsumeInitialFocus?: () => void;
}

const WEEKDAYS_KO = ['일', '월', '화', '수', '목', '금', '토'];
const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土'];
const WEEKDAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface YearMonth {
  year: number;
  month0: number;
}

function shiftYearMonth(year: number, month0: number, delta: number): YearMonth {
  const total = year * 12 + month0 + delta;
  const nextYear = Math.floor(total / 12);
  const nextMonth0 = ((total % 12) + 12) % 12;
  return { year: nextYear, month0: nextMonth0 };
}

interface CalendarMonthPaneProps {
  weeks: MonthCell[][];
  expandedInstances: ExpandedEventInstance[];
  weekdays: string[];
  todayStr: string;
  selectedDate: string;
  isActive: boolean;
  dragOverDate: string | null;
  cardDragHoveredDate: string | null;
  dropChoiceTargetDate: string | null;
  hasPendingAction: boolean;
  isCoarsePointer: boolean;
  isDraggingEvent: boolean;
  onDateCellClick?: (ymd: string) => void;
  onDateContextMenu?: (e: React.MouseEvent, ymd: string) => void;
  onDatePointerDown?: (e: React.PointerEvent, ymd: string) => void;
  onPointerMoveLongPress?: (e: React.PointerEvent) => void;
  onClearLongPress?: () => void;
  onDateDragOver?: (e: React.DragEvent, ymd: string) => void;
  onDateDragLeave?: (ymd: string) => void;
  onDateDrop?: (e: React.DragEvent, ymd: string) => void;
  onEventDragStart?: (e: React.DragEvent, ev: CalendarEventItem) => void;
  onEventDragEnd?: () => void;
  onEventClick?: (e: React.MouseEvent, ev: CalendarEventItem, startDate: string, colYmd: string | undefined) => void;
  onEventContextMenu?: (e: React.MouseEvent, ev: CalendarEventItem) => void;
  onEventPointerDown?: (e: React.PointerEvent, ev: CalendarEventItem) => void;
}

const CalendarMonthPane = React.memo<CalendarMonthPaneProps>(
  ({
    weeks,
    expandedInstances,
    weekdays,
    todayStr,
    selectedDate,
    isActive,
    dragOverDate,
    cardDragHoveredDate,
    dropChoiceTargetDate,
    hasPendingAction,
    isCoarsePointer,
    isDraggingEvent,
    onDateCellClick,
    onDateContextMenu,
    onDatePointerDown,
    onPointerMoveLongPress,
    onClearLongPress,
    onDateDragOver,
    onDateDragLeave,
    onDateDrop,
    onEventDragStart,
    onEventDragEnd,
    onEventClick,
    onEventContextMenu,
    onEventPointerDown,
  }) => {
    return (
      <>
        {/* Weekday Header */}
        <div className="grid grid-cols-7 border-b border-ivory-200 bg-ivory-50">
          {weekdays.map((wd, idx) => (
            <div
              key={wd}
              className={`py-2 text-center text-[11px] font-bold ${
                idx === 0 ? 'text-rose-600' : idx === 6 ? 'text-sky-700' : 'text-charcoal-600'
              }`}
            >
              {wd}
            </div>
          ))}
        </div>

        {/* Week Rows with Multi-day Spanning Bars */}
        <div className="divide-y divide-ivory-200">
          {weeks.map((week, wIdx) => {
            const barPlacements = layoutWeekBars(week, expandedInstances);
            const MAX_VISIBLE_LANES = 4;
            const visibleBars = barPlacements.filter((b) => b.lane < MAX_VISIBLE_LANES);
            const overflowByCol = [0, 0, 0, 0, 0, 0, 0];
            for (const b of barPlacements) {
              if (b.lane >= MAX_VISIBLE_LANES) {
                for (let c = b.colStart; c < b.colStart + b.colSpan; c++) {
                  overflowByCol[c]++;
                }
              }
            }

            return (
              <div key={wIdx} className="relative min-h-[104px] sm:min-h-[124px]">
                {/* Background 7 Date Cells */}
                <div className="grid grid-cols-7 divide-x divide-ivory-200 absolute inset-0">
                  {week.map((cell, cIdx) => {
                    const isToday = cell.ymd === todayStr;
                    const isSelected = cell.ymd === selectedDate;
                    const isDragOver =
                      isActive &&
                      (dragOverDate === cell.ymd ||
                        cardDragHoveredDate === cell.ymd ||
                        dropChoiceTargetDate === cell.ymd);

                    return (
                      <div
                        key={cell.ymd}
                        data-calendar-date={isActive ? cell.ymd : undefined}
                        style={{
                          WebkitUserSelect: 'none',
                          userSelect: 'none',
                          WebkitTouchCallout: 'none',
                        }}
                        onClick={isActive ? () => onDateCellClick?.(cell.ymd) : undefined}
                        onContextMenu={isActive ? (e) => onDateContextMenu?.(e, cell.ymd) : undefined}
                        onPointerDown={isActive ? (e) => onDatePointerDown?.(e, cell.ymd) : undefined}
                        onPointerMove={isActive ? onPointerMoveLongPress : undefined}
                        onPointerUp={isActive ? onClearLongPress : undefined}
                        onPointerCancel={isActive ? onClearLongPress : undefined}
                        onPointerLeave={isActive ? onClearLongPress : undefined}
                        onDragOver={
                          isActive && isDraggingEvent ? (e) => onDateDragOver?.(e, cell.ymd) : undefined
                        }
                        onDragLeave={isActive && isDraggingEvent ? () => onDateDragLeave?.(cell.ymd) : undefined}
                        onDrop={isActive && isDraggingEvent ? (e) => onDateDrop?.(e, cell.ymd) : undefined}
                        className={`p-1 sm:p-1.5 transition cursor-pointer flex flex-col justify-between ${
                          !cell.inCurrentMonth ? 'bg-ivory-50/70' : 'bg-white'
                        } ${isSelected ? 'ring-2 ring-inset ring-forest-700 bg-forest-50/40' : 'hover:bg-ivory-50'} ${
                          isDragOver ? 'ring-2 ring-inset ring-sky-600 bg-sky-50' : ''
                        } ${hasPendingAction ? 'hover:bg-emerald-50 hover:ring-2 hover:ring-inset hover:ring-emerald-600' : ''}`}
                      >
                        <div className="flex items-center justify-between">
                          <span
                            className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold ${
                              isToday
                                ? 'bg-forest-800 text-white'
                                : !cell.inCurrentMonth
                                  ? 'text-charcoal-300'
                                  : cIdx === 0
                                    ? 'text-rose-600'
                                    : cIdx === 6
                                      ? 'text-sky-700'
                                      : 'text-charcoal-800'
                            }`}
                          >
                            {cell.day}
                          </span>
                        </div>

                        {overflowByCol[cIdx] > 0 && (
                          <div className="text-[10px] font-bold text-charcoal-500 px-1 truncate">
                            +{overflowByCol[cIdx]}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Spanning Event Bars Overlay */}
                <div className="relative pt-7 sm:pt-8 pb-4 pointer-events-none">
                  <div className="grid grid-cols-7 gap-y-0.5 px-0.5">
                    {Array.from({
                      length: Math.min(MAX_VISIBLE_LANES, Math.max(0, ...visibleBars.map((b) => b.lane + 1))),
                    }).map((_, laneIdx) => {
                      const laneBars = visibleBars.filter((b) => b.lane === laneIdx);
                      return (
                        <div key={laneIdx} className="col-span-7 grid grid-cols-7 h-[20px] sm:h-[22px] items-center">
                          {laneBars.map((bar) => {
                            const ev = bar.instance.event;
                            const isProposed = ev.event_status === 'PROPOSED';

                            return (
                              <div
                                key={bar.instance.instanceKey}
                                style={{
                                  gridColumn: `${bar.colStart + 1} / span ${bar.colSpan}`,
                                  WebkitUserSelect: 'none',
                                  userSelect: 'none',
                                  WebkitTouchCallout: 'none',
                                  ...(isProposed
                                    ? {
                                        borderColor: ev.color,
                                        backgroundColor: `${ev.color}18`,
                                        color:
                                          ev.text_color && ev.text_color.toUpperCase() !== '#FFFFFF'
                                            ? ev.text_color
                                            : ev.color,
                                      }
                                    : {
                                        backgroundColor: ev.color,
                                        color: ev.text_color || '#ffffff',
                                      }),
                                }}
                                draggable={isActive && !hasPendingAction && !isCoarsePointer}
                                onDragStart={isActive ? (e) => onEventDragStart?.(e, ev) : undefined}
                                onDragEnd={isActive ? onEventDragEnd : undefined}
                                onClick={
                                  isActive
                                    ? (e) => onEventClick?.(e, ev, bar.instance.startDate, week[bar.colStart]?.ymd)
                                    : undefined
                                }
                                onContextMenu={isActive ? (e) => onEventContextMenu?.(e, ev) : undefined}
                                onPointerDown={isActive ? (e) => onEventPointerDown?.(e, ev) : undefined}
                                onPointerMove={isActive ? onPointerMoveLongPress : undefined}
                                onPointerUp={isActive ? onClearLongPress : undefined}
                                onPointerCancel={isActive ? onClearLongPress : undefined}
                                onPointerLeave={isActive ? onClearLongPress : undefined}
                                title={isActive ? `${ev.title}${ev.is_all_day ? '' : ` (${ev.start_time})`}` : undefined}
                                className={`${isActive ? 'pointer-events-auto cursor-pointer hover:brightness-95' : 'pointer-events-none'} mx-[1px] px-1 h-[19px] sm:h-[20px] flex items-center gap-0.5 text-[10px] sm:text-[11px] font-bold overflow-hidden whitespace-nowrap [text-overflow:clip] transition ${
                                  bar.continuesBefore ? 'rounded-l-none' : 'rounded-l-md'
                                } ${bar.continuesAfter ? 'rounded-r-none' : 'rounded-r-md'} ${
                                  isProposed ? 'border border-dashed' : ''
                                }`}
                              >
                                {isProposed && <span className="shrink-0">?</span>}
                                {!ev.is_all_day && ev.start_time && !bar.continuesBefore && (
                                  <span className="opacity-85 shrink-0 hidden sm:inline text-[9px]">
                                    {ev.start_time}
                                  </span>
                                )}
                                <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [text-overflow:clip]">
                                  {ev.title}
                                </span>
                                {ev.recurrence_type !== 'NONE' && (
                                  <Repeat className="w-2.5 h-2.5 shrink-0 opacity-80 hidden sm:inline" />
                                )}
                                {ev.comment_count > 0 && (
                                  <span className="ml-auto shrink-0 hidden sm:inline-flex items-center gap-0.5 text-[9px] opacity-90">
                                    <MessageSquare className="w-2.5 h-2.5" />
                                    {ev.comment_count}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </>
    );
  }
);
CalendarMonthPane.displayName = 'CalendarMonthPane';

export const SharedCalendarPage: React.FC<SharedCalendarPageProps> = ({
  spaces,
  activeSpace,
  onSelectSpace,
  onOpenCreateSpace,
  onOpenSpaceSettings,
  onOpenActivityFeed,
  onJumpToThought,
  onJumpToMindmapProject,
  onSpacesNeedRefresh,
  realtimeTick,
  initialFocusEventId,
  initialFocusDate,
  onConsumeInitialFocus,
}) => {
  const { L, language } = useLanguage();
  const translator = useContentTranslation();
  const todayStr = useMemo(() => getJstTodayStr(), []);
  const todayParsed = useMemo(() => parseYmd(todayStr), [todayStr]);
  const isCoarsePointer = useMemo(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(pointer: coarse)').matches),
    []
  );

  const [viewYear, setViewYear] = useState(todayParsed.year);
  const [viewMonth0, setViewMonth0] = useState(todayParsed.month - 1);
  const [selectedDate, setSelectedDate] = useState(todayStr);

  const [events, setEvents] = useState<CalendarEventItem[]>([]);
  const [recentEvents, setRecentEvents] = useState<CalendarEventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [toastMsg, setToastMsg] = useState('');

  // Modals & TimeTree Popups
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorInitialDate, setEditorInitialDate] = useState(todayStr);
  const [editingEvent, setEditingEvent] = useState<CalendarEventItem | null>(null);
  const [detailEventId, setDetailEventId] = useState<number | null>(null);

  // Long-press / Right-click popups & Mobile slide-up bottom sheet
  const [quickAddDate, setQuickAddDate] = useState<string | null>(null);
  const [eventActionTarget, setEventActionTarget] = useState<CalendarEventItem | null>(null);
  const [mobileDaySheetOpen, setMobileDaySheetOpen] = useState(false);

  // Move / Copy target-selection mode (TimeTree style — works across months too!)
  const [pendingAction, setPendingAction] = useState<{
    type: 'move' | 'copy';
    event: CalendarEventItem;
  } | null>(null);

  // PC Drag & Drop state
  const [draggingEvent, setDraggingEvent] = useState<CalendarEventItem | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);

  // Mobile/Tablet & Pointer Long-Press Card Drag-and-Drop state (from Bottom Sheet onto Calendar)
  const [cardDragState, setCardDragState] = useState<{
    event: CalendarEventItem;
    x: number;
    y: number;
    hoveredDate: string | null;
    mode: 'touch' | 'pointer';
  } | null>(null);
  const cardDragRef = useRef<{
    event: CalendarEventItem;
    hoveredDate: string | null;
    mode: 'touch' | 'pointer';
  } | null>(null);
  const cardDragEndedAtRef = useRef<number>(0);
  const ghostPillRef = useRef<HTMLDivElement | null>(null);

  // Floating [Move / Copy] choice popover right above the dropped date cell
  const [dropChoice, setDropChoice] = useState<{
    event: CalendarEventItem;
    targetDate: string;
    x: number;
    y: number;
  } | null>(null);

  // Long-press pointer refs
  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressFiredRef = useRef(false);

  // Month touch-swipe & slide-fade transition refs / state
  const swipeViewportRef = useRef<HTMLDivElement | null>(null);
  const prevPaneRef = useRef<HTMLDivElement | null>(null);
  const currPaneRef = useRef<HTMLDivElement | null>(null);
  const nextPaneRef = useRef<HTMLDivElement | null>(null);
  const viewYMRef = useRef<YearMonth>({ year: viewYear, month0: viewMonth0 });
  viewYMRef.current = { year: viewYear, month0: viewMonth0 };

  const [animTargetYM, setAnimTargetYM] = useState<YearMonth | null>(null);
  const animRef = useRef<{
    type: 'commit' | 'snapback';
    delta: -1 | 0 | 1;
    targetYM: YearMonth;
    timerId: number;
    cleanupTransitionEnd: (() => void) | null;
  } | null>(null);
  const queuedDeltaRef = useRef<number>(0);
  const swipeActiveRef = useRef<boolean>(false);
  const lastSwipeEndedAtRef = useRef<number>(0);
  const touchSessionRef = useRef<{
    touchId: number;
    startX: number;
    startY: number;
    lastX: number;
    width: number;
    lock: 'undecided' | 'horizontal' | 'vertical';
    samples: Array<{ x: number; t: number }>;
  } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => {
      setToastMsg((cur) => (cur === msg ? '' : cur));
    }, 2800);
  }, []);

  const loadEvents = useCallback(async () => {
    if (!activeSpace) return;
    try {
      const res = await api.get<{ events: CalendarEventItem[]; recentEvents: CalendarEventItem[] }>(
        `/spaces/${activeSpace.id}/events`
      );
      setEvents(res.events || []);
      setRecentEvents(res.recentEvents || []);
    } catch {
      // ignore transient error
    }
  }, [activeSpace?.id]);

  useEffect(() => {
    if (!activeSpace) return;
    setLoading(true);
    void loadEvents().finally(() => setLoading(false));
  }, [activeSpace?.id, loadEvents]);

  useEffect(() => {
    if (activeSpace && realtimeTick > 0) {
      void loadEvents();
    }
  }, [realtimeTick, activeSpace?.id, loadEvents]);

  const resetPaneStylesImmediate = useCallback(() => {
    const prevEl = prevPaneRef.current;
    const currEl = currPaneRef.current;
    const nextEl = nextPaneRef.current;

    if (currEl) {
      currEl.style.transition = 'none';
      currEl.style.transform = '';
      currEl.style.opacity = '1';
      currEl.style.willChange = '';
    }
    if (prevEl) {
      prevEl.style.transition = 'none';
      prevEl.style.transform = 'translate3d(-100%, 0, 0)';
      prevEl.style.opacity = '0';
      prevEl.style.visibility = 'hidden';
      prevEl.style.willChange = '';
    }
    if (nextEl) {
      nextEl.style.transition = 'none';
      nextEl.style.transform = 'translate3d(100%, 0, 0)';
      nextEl.style.opacity = '0';
      nextEl.style.visibility = 'hidden';
      nextEl.style.willChange = '';
    }
  }, []);

  const clearActiveAnimation = useCallback(() => {
    const active = animRef.current;
    if (!active) return;
    window.clearTimeout(active.timerId);
    active.cleanupTransitionEnd?.();
    animRef.current = null;
  }, []);

  const jumpToYearMonth = useCallback(
    (year: number, month0: number) => {
      clearActiveAnimation();
      queuedDeltaRef.current = 0;
      touchSessionRef.current = null;
      swipeActiveRef.current = false;
      setAnimTargetYM(null);
      if (viewYMRef.current.year === year && viewYMRef.current.month0 === month0) {
        resetPaneStylesImmediate();
      } else {
        setViewYear(year);
        setViewMonth0(month0);
      }
    },
    [clearActiveAnimation, resetPaneStylesImmediate]
  );

  // Handle deep link / jump from Shared Thought or Activity Feed
  useEffect(() => {
    if (initialFocusDate && /^\d{4}-\d{2}-\d{2}$/.test(initialFocusDate)) {
      const parsed = parseYmd(initialFocusDate);
      jumpToYearMonth(parsed.year, parsed.month - 1);
      setSelectedDate(initialFocusDate);
    }
    if (initialFocusEventId) {
      setDetailEventId(initialFocusEventId);
    }
    if (initialFocusDate || initialFocusEventId) {
      onConsumeInitialFocus?.();
    }
  }, [initialFocusEventId, initialFocusDate, onConsumeInitialFocus, jumpToYearMonth]);

  const prevYM = useMemo(() => shiftYearMonth(viewYear, viewMonth0, -1), [viewYear, viewMonth0]);
  const nextYM = useMemo(() => shiftYearMonth(viewYear, viewMonth0, 1), [viewYear, viewMonth0]);

  const prevWeeks = useMemo(() => buildMonthGrid(prevYM.year, prevYM.month0), [prevYM.year, prevYM.month0]);
  const weeks = useMemo(() => buildMonthGrid(viewYear, viewMonth0), [viewYear, viewMonth0]);
  const nextWeeks = useMemo(() => buildMonthGrid(nextYM.year, nextYM.month0), [nextYM.year, nextYM.month0]);

  const prevExpandedInstances = useMemo(
    () => expandEventsForRange(events, prevWeeks[0][0].ymd, prevWeeks[prevWeeks.length - 1][6].ymd),
    [events, prevWeeks]
  );
  const expandedInstances = useMemo(
    () => expandEventsForRange(events, weeks[0][0].ymd, weeks[weeks.length - 1][6].ymd),
    [events, weeks]
  );
  const nextExpandedInstances = useMemo(
    () => expandEventsForRange(events, nextWeeks[0][0].ymd, nextWeeks[nextWeeks.length - 1][6].ymd),
    [events, nextWeeks]
  );

  const selectedDayEvents = useMemo(() => {
    return expandedInstances
      .filter((inst) => inst.startDate <= selectedDate && inst.endDate >= selectedDate)
      .sort((a, b) => {
        if (a.event.event_status !== b.event.event_status) {
          return a.event.event_status === 'PROPOSED' ? -1 : 1;
        }
        if (a.event.is_all_day !== b.event.is_all_day) return a.event.is_all_day ? -1 : 1;
        return (a.event.start_time || '').localeCompare(b.event.start_time || '');
      });
  }, [expandedInstances, selectedDate]);

  const proposedEventsInSpace = useMemo(
    () => events.filter((e) => e.event_status === 'PROPOSED'),
    [events]
  );

  const applyDragFrame = useCallback((dx: number, width: number) => {
    const prevEl = prevPaneRef.current;
    const currEl = currPaneRef.current;
    const nextEl = nextPaneRef.current;
    if (!currEl || !prevEl || !nextEl) return;

    const clampedDx = Math.max(-width, Math.min(width, dx));
    const progress = Math.min(1, Math.abs(clampedDx) / Math.max(1, width));
    const currOpacity = Math.max(0.12, 1 - progress * 0.88);
    const incomingOpacity = Math.min(1, 0.18 + progress * 0.82);

    currEl.style.transition = 'none';
    currEl.style.willChange = 'transform, opacity';
    currEl.style.transform = `translate3d(${clampedDx}px, 0, 0)`;
    currEl.style.opacity = String(currOpacity);

    if (clampedDx > 0) {
      prevEl.style.transition = 'none';
      prevEl.style.willChange = 'transform, opacity';
      prevEl.style.visibility = 'visible';
      prevEl.style.transform = `translate3d(${clampedDx - width}px, 0, 0)`;
      prevEl.style.opacity = String(incomingOpacity);

      nextEl.style.transition = 'none';
      nextEl.style.visibility = 'hidden';
      nextEl.style.opacity = '0';
      nextEl.style.transform = `translate3d(${width}px, 0, 0)`;
    } else if (clampedDx < 0) {
      nextEl.style.transition = 'none';
      nextEl.style.willChange = 'transform, opacity';
      nextEl.style.visibility = 'visible';
      nextEl.style.transform = `translate3d(${clampedDx + width}px, 0, 0)`;
      nextEl.style.opacity = String(incomingOpacity);

      prevEl.style.transition = 'none';
      prevEl.style.visibility = 'hidden';
      prevEl.style.opacity = '0';
      prevEl.style.transform = `translate3d(${-width}px, 0, 0)`;
    } else {
      prevEl.style.transition = 'none';
      prevEl.style.visibility = 'hidden';
      prevEl.style.opacity = '0';
      prevEl.style.transform = `translate3d(${-width}px, 0, 0)`;

      nextEl.style.transition = 'none';
      nextEl.style.visibility = 'hidden';
      nextEl.style.opacity = '0';
      nextEl.style.transform = `translate3d(${width}px, 0, 0)`;
    }
  }, []);

  const startCommitSlide = useCallback(
    (delta: -1 | 1, durationMs: number, fromScratch: boolean) => {
      const viewport = swipeViewportRef.current;
      const prevEl = prevPaneRef.current;
      const currEl = currPaneRef.current;
      const nextEl = nextPaneRef.current;
      const targetYM = shiftYearMonth(viewYMRef.current.year, viewYMRef.current.month0, delta);

      const width = viewport?.offsetWidth || 0;
      const reducedMotion =
        typeof window !== 'undefined' &&
        Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

      if (!currEl || !prevEl || !nextEl || width <= 0 || reducedMotion) {
        clearActiveAnimation();
        setAnimTargetYM(null);
        setViewYear(targetYM.year);
        setViewMonth0(targetYM.month0);
        resetPaneStylesImmediate();
        return;
      }

      clearActiveAnimation();

      const incomingEl = delta === -1 ? prevEl : nextEl;
      const otherEl = delta === -1 ? nextEl : prevEl;
      const exitX = delta === -1 ? width : -width;
      const enterStartX = delta === -1 ? -width : width;

      if (fromScratch) {
        currEl.style.transition = 'none';
        currEl.style.willChange = 'transform, opacity';
        currEl.style.transform = 'translate3d(0px, 0, 0)';
        currEl.style.opacity = '1';

        incomingEl.style.transition = 'none';
        incomingEl.style.willChange = 'transform, opacity';
        incomingEl.style.visibility = 'visible';
        incomingEl.style.transform = `translate3d(${enterStartX}px, 0, 0)`;
        incomingEl.style.opacity = '0.18';

        otherEl.style.transition = 'none';
        otherEl.style.visibility = 'hidden';
        otherEl.style.opacity = '0';
        otherEl.style.transform = `translate3d(${-enterStartX}px, 0, 0)`;

        // Force reflow so the browser registers the starting frame before transitioning
        void currEl.offsetWidth;
      } else {
        otherEl.style.transition = 'none';
        otherEl.style.visibility = 'hidden';
        otherEl.style.opacity = '0';
        incomingEl.style.visibility = 'visible';
      }

      const easing = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${durationMs}ms ease-out`;
      currEl.style.transition = easing;
      incomingEl.style.transition = easing;

      currEl.style.transform = `translate3d(${exitX}px, 0, 0)`;
      currEl.style.opacity = '0.12';
      incomingEl.style.transform = 'translate3d(0px, 0, 0)';
      incomingEl.style.opacity = '1';

      setAnimTargetYM(targetYM);

      let finished = false;
      const complete = () => {
        if (finished) return;
        finished = true;
        clearActiveAnimation();
        setAnimTargetYM(null);
        setViewYear(targetYM.year);
        setViewMonth0(targetYM.month0);
      };

      const onTransitionEnd = (e: TransitionEvent) => {
        if (e.target === currEl && e.propertyName === 'transform') {
          complete();
        }
      };
      currEl.addEventListener('transitionend', onTransitionEnd);
      const timerId = window.setTimeout(complete, durationMs + 50);

      animRef.current = {
        type: 'commit',
        delta,
        targetYM,
        timerId,
        cleanupTransitionEnd: () => currEl.removeEventListener('transitionend', onTransitionEnd),
      };
    },
    [clearActiveAnimation, resetPaneStylesImmediate]
  );

  const startSnapBackSlide = useCallback(
    (width: number, dxSign: number) => {
      const prevEl = prevPaneRef.current;
      const currEl = currPaneRef.current;
      const nextEl = nextPaneRef.current;
      if (!currEl || !prevEl || !nextEl || width <= 0 || dxSign === 0) {
        clearActiveAnimation();
        resetPaneStylesImmediate();
        return;
      }

      clearActiveAnimation();

      const durationMs = 220;
      const easing = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${durationMs}ms ease-out`;

      currEl.style.transition = easing;
      currEl.style.transform = 'translate3d(0px, 0, 0)';
      currEl.style.opacity = '1';

      if (dxSign > 0) {
        prevEl.style.transition = easing;
        prevEl.style.transform = `translate3d(${-width}px, 0, 0)`;
        prevEl.style.opacity = '0.18';
      } else {
        nextEl.style.transition = easing;
        nextEl.style.transform = `translate3d(${width}px, 0, 0)`;
        nextEl.style.opacity = '0.18';
      }

      let finished = false;
      const complete = () => {
        if (finished) return;
        finished = true;
        clearActiveAnimation();
        resetPaneStylesImmediate();
      };

      const onTransitionEnd = (e: TransitionEvent) => {
        if (e.target === currEl && e.propertyName === 'transform') {
          complete();
        }
      };
      currEl.addEventListener('transitionend', onTransitionEnd);
      const timerId = window.setTimeout(complete, durationMs + 50);

      animRef.current = {
        type: 'snapback',
        delta: 0,
        targetYM: viewYMRef.current,
        timerId,
        cleanupTransitionEnd: () => currEl.removeEventListener('transitionend', onTransitionEnd),
      };
    },
    [clearActiveAnimation, resetPaneStylesImmediate]
  );

  // Synchronously reset pane transforms right after React commits a new month (zero flicker)
  useLayoutEffect(() => {
    resetPaneStylesImmediate();

    if (queuedDeltaRef.current !== 0) {
      const nextStep: -1 | 1 = queuedDeltaRef.current > 0 ? 1 : -1;
      queuedDeltaRef.current -= nextStep;
      startCommitSlide(nextStep, 200, true);
    }
  }, [viewYear, viewMonth0, resetPaneStylesImmediate, startCommitSlide]);

  useEffect(() => {
    return () => {
      clearActiveAnimation();
      queuedDeltaRef.current = 0;
    };
  }, [clearActiveAnimation]);

  const triggerMonthStep = useCallback(
    (delta: -1 | 1) => {
      if (swipeActiveRef.current) return;
      const active = animRef.current;
      if (active) {
        if (active.type === 'commit') {
          if (delta === -active.delta) {
            // Reversing mid-flight smoothly snaps back to current month
            const width = swipeViewportRef.current?.offsetWidth || 360;
            queuedDeltaRef.current = 0;
            setAnimTargetYM(null);
            startSnapBackSlide(width, active.delta === -1 ? 1 : -1);
            return;
          }
          // Rapid repeated click in same direction: commit in-flight month and queue follow-up
          const target = active.targetYM;
          clearActiveAnimation();
          queuedDeltaRef.current = delta;
          setAnimTargetYM(shiftYearMonth(target.year, target.month0, delta));
          setViewYear(target.year);
          setViewMonth0(target.month0);
          return;
        }
        clearActiveAnimation();
        resetPaneStylesImmediate();
      }
      startCommitSlide(delta, 260, true);
    },
    [clearActiveAnimation, resetPaneStylesImmediate, startCommitSlide, startSnapBackSlide]
  );

  const goPrevMonth = () => triggerMonthStep(-1);

  const goNextMonth = () => triggerMonthStep(1);

  const goToday = () => {
    jumpToYearMonth(todayParsed.year, todayParsed.month - 1);
    setSelectedDate(todayStr);
  };

  // Execute Move or Copy onto targetDate
  const executeMoveOrCopy = async (type: 'move' | 'copy', event: CalendarEventItem, targetDate: string) => {
    if (!activeSpace) return;
    try {
      if (type === 'move') {
        await api.post(`/spaces/${activeSpace.id}/events/${event.id}/move`, { targetDate });
        showToast(
          L(
            `'${event.title}' 일정을 ${targetDate}로 이동했습니다.`,
            `「${event.title}」を ${targetDate} に移動しました。`,
            `Moved '${event.title}' to ${targetDate}.`
          )
        );
      } else {
        await api.post(`/spaces/${activeSpace.id}/events/${event.id}/copy`, { targetDate });
        showToast(
          L(
            `'${event.title}' 일정을 ${targetDate}에 복사했습니다.`,
            `「${event.title}」を ${targetDate} にコピーしました。`,
            `Copied '${event.title}' to ${targetDate}.`
          )
        );
      }
      setSelectedDate(targetDate);
      setPendingAction(null);
      await loadEvents();
      onSpacesNeedRefresh();
    } catch (err: any) {
      showToast(err.message || L('처리에 실패했습니다.', '処理に失敗しました。', 'Failed.'));
    }
  };

  const handleDeleteEventQuick = async (event: CalendarEventItem) => {
    if (!activeSpace) return;
    const ok = window.confirm(
      L(`'${event.title}' 일정을 삭제할까요?`, `「${event.title}」を削除しますか？`, `Delete '${event.title}'?`)
    );
    if (!ok) return;
    await api.delete(`/spaces/${activeSpace.id}/events/${event.id}`);
    setEventActionTarget(null);
    await loadEvents();
    onSpacesNeedRefresh();
    showToast(L('일정을 삭제했습니다.', '予定を削除しました。', 'Event deleted.'));
  };

  // Long-press helpers
  const clearLongPress = useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    longPressStartRef.current = null;
  }, []);

  const isCardDragBlocking = useCallback(
    () => Boolean(cardDragRef.current) || performance.now() - cardDragEndedAtRef.current < 400,
    []
  );

  const isSwipeBlocking = useCallback(
    () => swipeActiveRef.current || performance.now() - lastSwipeEndedAtRef.current < 350,
    []
  );

  // Native touch-swipe listeners on calendar viewport (non-passive touchmove for iOS Safari / Android Chrome)
  useEffect(() => {
    const viewport = swipeViewportRef.current;
    if (!viewport) return;

    const findTouchById = (list: TouchList, id: number): Touch | null => {
      for (let i = 0; i < list.length; i++) {
        if (list[i].identifier === id) return list[i];
      }
      return null;
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      if (isCardDragBlocking() || animRef.current) return;

      const t = e.touches[0];
      const now = performance.now();
      touchSessionRef.current = {
        touchId: t.identifier,
        startX: t.clientX,
        startY: t.clientY,
        lastX: t.clientX,
        width: viewport.offsetWidth || 360,
        lock: 'undecided',
        samples: [{ x: t.clientX, t: now }],
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      const session = touchSessionRef.current;
      if (!session) return;

      if (e.touches.length !== 1 || isCardDragBlocking()) {
        if (session.lock === 'horizontal') {
          const dx = session.lastX - session.startX;
          swipeActiveRef.current = false;
          lastSwipeEndedAtRef.current = performance.now();
          startSnapBackSlide(session.width, dx);
        }
        touchSessionRef.current = null;
        return;
      }

      const t = findTouchById(e.touches, session.touchId);
      if (!t) return;

      const dx = t.clientX - session.startX;
      const dy = t.clientY - session.startY;

      if (session.lock === 'undecided') {
        if (longPressFiredRef.current) {
          touchSessionRef.current = null;
          return;
        }
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;

        if (Math.abs(dx) > Math.abs(dy) * 1.15) {
          session.lock = 'horizontal';
          swipeActiveRef.current = true;
          clearLongPress();
        } else {
          session.lock = 'vertical';
          return;
        }
      }

      if (session.lock !== 'horizontal') return;

      if (e.cancelable) {
        e.preventDefault();
      }

      const now = performance.now();
      session.lastX = t.clientX;
      session.samples.push({ x: t.clientX, t: now });
      while (session.samples.length > 6 || (session.samples.length > 1 && now - session.samples[0].t > 120)) {
        session.samples.shift();
      }

      applyDragFrame(dx, session.width);
    };

    const finishTouch = (e: TouchEvent, cancelled: boolean) => {
      const session = touchSessionRef.current;
      if (!session) return;

      // Ignore if tracked finger is still touching
      if (findTouchById(e.touches, session.touchId)) return;

      touchSessionRef.current = null;
      if (session.lock !== 'horizontal') return;

      const endedTouch = findTouchById(e.changedTouches, session.touchId);
      const endX = endedTouch ? endedTouch.clientX : session.lastX;
      const dx = endX - session.startX;
      const width = session.width;

      swipeActiveRef.current = false;
      lastSwipeEndedAtRef.current = performance.now();

      if (cancelled) {
        startSnapBackSlide(width, dx);
        return;
      }

      const now = performance.now();
      const lastSample = session.samples[session.samples.length - 1];
      let velocityPxPerMs = 0;
      if (lastSample && now - lastSample.t <= 90) {
        const recent = session.samples.filter((s) => now - s.t <= 120);
        const oldest = recent[0] ?? lastSample;
        const dt = Math.max(8, now - oldest.t);
        velocityPxPerMs = (endX - oldest.x) / dt;
      }

      const absDx = Math.abs(dx);
      const absV = Math.abs(velocityPxPerMs);
      const sameDir = velocityPxPerMs === 0 || Math.sign(velocityPxPerMs) === Math.sign(dx);
      const reversingFlick = absV >= 0.35 && Math.sign(velocityPxPerMs) !== Math.sign(dx);

      const passDistance = absDx >= width * 0.25 && !reversingFlick;
      const passFlick = absDx >= 35 && absV >= 0.35 && sameDir;

      if (passDistance || passFlick) {
        const delta: -1 | 1 = dx > 0 ? -1 : 1;
        const remaining = 1 - Math.min(1, absDx / Math.max(1, width));
        let durationMs = Math.round(Math.max(170, Math.min(270, 140 + remaining * 140)));
        if (absV > 0.7) {
          durationMs = Math.min(durationMs, 210);
        }
        startCommitSlide(delta, durationMs, false);
      } else {
        startSnapBackSlide(width, dx);
      }
    };

    const onTouchEnd = (e: TouchEvent) => finishTouch(e, false);
    const onTouchCancel = (e: TouchEvent) => finishTouch(e, true);

    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return () => {
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchCancel);
    };
  }, [Boolean(activeSpace), applyDragFrame, clearLongPress, isCardDragBlocking, startCommitSlide, startSnapBackSlide]);

  const startLongPress = (e: React.PointerEvent, onTrigger: () => void) => {
    if (isCardDragBlocking() || isSwipeBlocking()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    clearLongPress();
    longPressFiredRef.current = false;
    longPressStartRef.current = { x: e.clientX, y: e.clientY };
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true;
      try {
        navigator.vibrate?.(25);
      } catch {}
      onTrigger();
    }, 450);
  };

  const handlePointerMoveLongPress = (e: React.PointerEvent) => {
    if (!longPressStartRef.current) return;
    const dx = Math.abs(e.clientX - longPressStartRef.current.x);
    const dy = Math.abs(e.clientY - longPressStartRef.current.y);
    if (dx > 10 || dy > 10) {
      clearLongPress();
    }
  };

  const findCalendarDateAtPoint = useCallback((clientX: number, clientY: number): string | null => {
    const els = document.elementsFromPoint(clientX, clientY);
    for (const el of els) {
      const cell = (el as HTMLElement).closest?.('[data-calendar-date]') as HTMLElement | null;
      const ymd = cell?.getAttribute('data-calendar-date');
      if (ymd) return ymd;
    }
    return null;
  }, []);

  const openDropChoiceAtDate = useCallback((event: CalendarEventItem, targetDate: string) => {
    const cellEl = document.querySelector(`[data-calendar-date="${targetDate}"]`) as HTMLElement | null;
    if (cellEl) {
      const rect = cellEl.getBoundingClientRect();
      const halfSafe = Math.min(120, Math.max(100, window.innerWidth / 2 - 12));
      const clampedX = Math.min(window.innerWidth - halfSafe, Math.max(halfSafe, rect.left + rect.width / 2));
      const clampedY = Math.max(104, rect.top);
      setDropChoice({ event, targetDate, x: clampedX, y: clampedY });
    } else {
      setDropChoice({
        event,
        targetDate,
        x: window.innerWidth / 2,
        y: window.innerHeight / 2,
      });
    }
  }, []);

  useEffect(() => {
    if (!dropChoice) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDropChoice(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dropChoice]);

  const handleStartCardDragMove = useCallback(
    (event: CalendarEventItem, clientX: number, clientY: number, mode: 'touch' | 'pointer') => {
      const initialHover = findCalendarDateAtPoint(clientX, clientY);
      cardDragRef.current = { event, hoveredDate: initialHover, mode };
      setCardDragState({ event, x: clientX, y: clientY, hoveredDate: initialHover, mode });
    },
    [findCalendarDateAtPoint]
  );

  const handleUpdateCardDragMove = useCallback(
    (clientX: number, clientY: number) => {
      if (!cardDragRef.current) return;
      const hoveredDate = findCalendarDateAtPoint(clientX, clientY);
      cardDragRef.current.hoveredDate = hoveredDate;
      setCardDragState((prev) => (prev ? { ...prev, x: clientX, y: clientY, hoveredDate } : null));
    },
    [findCalendarDateAtPoint]
  );

  const handleEndCardDragMove = useCallback(
    (clientX?: number, clientY?: number) => {
      const current = cardDragRef.current;
      cardDragRef.current = null;
      cardDragEndedAtRef.current = performance.now();
      setCardDragState(null);
      if (!current) return;
      const finalHoveredDate =
        typeof clientX === 'number' && typeof clientY === 'number'
          ? findCalendarDateAtPoint(clientX, clientY) ?? current.hoveredDate
          : current.hoveredDate;
      if (finalHoveredDate && finalHoveredDate !== current.event.start_date) {
        openDropChoiceAtDate(current.event, finalHoveredDate);
      }
    },
    [findCalendarDateAtPoint, openDropChoiceAtDate]
  );

  const handleCancelCardDragMove = useCallback(() => {
    cardDragRef.current = null;
    cardDragEndedAtRef.current = performance.now();
    setCardDragState(null);
  }, []);

  // Pointer (mouse / pen) drag listeners — strictly ignore touch so spurious mobile pointercancel never cancels touch drag
  useEffect(() => {
    if (!cardDragState || cardDragState.mode !== 'pointer') return;

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      handleUpdateCardDragMove(e.clientX, e.clientY);
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      handleEndCardDragMove(e.clientX, e.clientY);
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      handleCancelCardDragMove();
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [cardDragState?.mode, handleUpdateCardDragMove, handleEndCardDragMove, handleCancelCardDragMove]);

  // Prevent background overscroll / pull-to-refresh and OS contextmenu while card drag is active
  useEffect(() => {
    if (!cardDragState) return;
    const prevOverscroll = document.body.style.overscrollBehavior;
    const prevUserSelect = document.body.style.userSelect;
    document.body.style.overscrollBehavior = 'none';
    document.body.style.userSelect = 'none';
    const suppressContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('contextmenu', suppressContextMenu, true);
    return () => {
      document.body.style.overscrollBehavior = prevOverscroll;
      document.body.style.userSelect = prevUserSelect;
      window.removeEventListener('contextmenu', suppressContextMenu, true);
    };
  }, [Boolean(cardDragState)]);

  // Clamp ghost pill strictly inside viewport bounds with constant layout width (left:0; top:0 + translate3d)
  useLayoutEffect(() => {
    if (!cardDragState || !ghostPillRef.current) return;
    const el = ghostPillRef.current;
    const margin = 12;
    const fingerOffsetY = 28;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const maxLeft = Math.max(margin, vw - w - margin);
    const maxTop = Math.max(margin, vh - h - margin);
    const clampedLeft = Math.min(Math.max(margin, cardDragState.x - w / 2), maxLeft);
    const clampedTop = Math.min(Math.max(margin, cardDragState.y - h - fingerOffsetY), maxTop);
    el.style.transform = `translate3d(${Math.round(clampedLeft)}px, ${Math.round(clampedTop)}px, 0)`;
  }, [cardDragState]);

  const handleDateCellClick = (ymd: string) => {
    if (isCardDragBlocking() || isSwipeBlocking()) return;
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (pendingAction) {
      void executeMoveOrCopy(pendingAction.type, pendingAction.event, ymd);
      return;
    }
    setSelectedDate(ymd);
    if (window.innerWidth < 1280) {
      setMobileDaySheetOpen(true);
    }
  };

  const handleDateContextMenu = (e: React.MouseEvent, ymd: string) => {
    e.preventDefault();
    if (isCardDragBlocking() || isSwipeBlocking()) return;
    setSelectedDate(ymd);
    setQuickAddDate(ymd);
  };

  const handleDatePointerDown = (e: React.PointerEvent, ymd: string) => {
    startLongPress(e, () => {
      setSelectedDate(ymd);
      setQuickAddDate(ymd);
    });
  };

  const handleDateDragOver = (e: React.DragEvent, ymd: string) => {
    if (!draggingEvent) return;
    e.preventDefault();
    if (dragOverDate !== ymd) setDragOverDate(ymd);
  };

  const handleDateDragLeave = (ymd: string) => {
    if (dragOverDate === ymd) setDragOverDate(null);
  };

  const handleDateDrop = (e: React.DragEvent, ymd: string) => {
    e.preventDefault();
    setDragOverDate(null);
    if (draggingEvent && draggingEvent.start_date !== ymd) {
      openDropChoiceAtDate(draggingEvent, ymd);
    }
    setDraggingEvent(null);
  };

  const handleEventDragStart = (e: React.DragEvent, ev: CalendarEventItem) => {
    clearLongPress();
    setDraggingEvent(ev);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(ev.id));
  };

  const handleEventDragEnd = () => {
    setDraggingEvent(null);
    setDragOverDate(null);
  };

  const handleEventClick = (
    e: React.MouseEvent,
    ev: CalendarEventItem,
    startDate: string,
    colYmd: string | undefined
  ) => {
    e.stopPropagation();
    if (isCardDragBlocking() || isSwipeBlocking()) return;
    if (longPressFiredRef.current) {
      longPressFiredRef.current = false;
      return;
    }
    if (pendingAction) {
      if (colYmd) {
        void executeMoveOrCopy(pendingAction.type, pendingAction.event, colYmd);
      }
      return;
    }
    setSelectedDate(startDate);
    setDetailEventId(ev.id);
  };

  const handleEventContextMenu = (e: React.MouseEvent, ev: CalendarEventItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (isCardDragBlocking() || isSwipeBlocking()) return;
    setEventActionTarget(ev);
  };

  const handleEventPointerDown = (e: React.PointerEvent, ev: CalendarEventItem) => {
    e.stopPropagation();
    startLongPress(e, () => setEventActionTarget(ev));
  };

  const openNewEventForDate = (ymd: string) => {
    setEditingEvent(null);
    setEditorInitialDate(ymd);
    setEditorOpen(true);
  };

  const weekdays = language === 'ja' ? WEEKDAYS_JA : language === 'en' ? WEEKDAYS_EN : WEEKDAYS_KO;
  const headerYM = animTargetYM ?? { year: viewYear, month0: viewMonth0 };

  if (!activeSpace) {
    return (
      <div className="py-16 text-center text-xs text-charcoal-500">
        {L('공유 스페이스를 불러오는 중...', '共有スペースを読み込み中...', 'Loading shared space...')}
      </div>
    );
  }

  return (
    <div className="space-y-3 pb-20 lg:pb-6">
      {/* Toast feedback */}
      {toastMsg && (
        <div className="fixed bottom-20 lg:bottom-6 left-4 right-4 sm:left-auto sm:max-w-sm z-50 px-4 py-2.5 rounded-xl bg-charcoal-900 text-white text-xs font-bold shadow-xl flex items-center gap-2 break-words">
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Top Toolbar */}
      <div className="bg-white rounded-2xl border border-ivory-300 px-3 sm:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shadow-2xs">
        {/* Left: Space Switcher (especially handy on mobile/tablet!) + Month controls */}
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          <div className="flex items-center gap-1.5">
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
              className="text-xs sm:text-sm font-bold text-charcoal-900 bg-ivory-50 border border-ivory-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-forest-600 max-w-[180px] sm:max-w-[240px]"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.members.length})
                </option>
              ))}
              <option value="__NEW__">+ {L('새 공유 스페이스 만들기', '新しいスペース作成', 'New Space')}</option>
            </select>
          </div>

          <div className="flex items-center gap-1 bg-ivory-100 rounded-xl p-0.5 border border-ivory-200">
            <button
              type="button"
              onClick={goPrevMonth}
              className="p-1.5 rounded-lg hover:bg-white text-charcoal-700 transition"
              title={L('이전 달', '前月', 'Previous month')}
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="px-2 text-xs sm:text-sm font-bold text-charcoal-900 tabular-nums whitespace-nowrap">
              {language === 'en'
                ? `${headerYM.year}-${String(headerYM.month0 + 1).padStart(2, '0')}`
                : `${headerYM.year}년 ${headerYM.month0 + 1}월`}
            </span>
            <button
              type="button"
              onClick={goNextMonth}
              className="p-1.5 rounded-lg hover:bg-white text-charcoal-700 transition"
              title={L('다음 달', '翌月', 'Next month')}
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <button
            type="button"
            onClick={goToday}
            className="px-2.5 py-1 rounded-lg bg-white hover:bg-ivory-100 border border-ivory-300 text-xs font-bold text-charcoal-700 transition"
          >
            {L('오늘', '今日', 'Today')}
          </button>
        </div>

        {/* Right: Actions (Add Event, Feed Bell, Space Settings) */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onOpenActivityFeed}
            className="relative inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-ivory-100 hover:bg-ivory-200 text-charcoal-800 text-xs font-bold transition"
            title={L('새 소식 피드', '新着フィード', 'Activity Feed')}
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
            title={L('멤버 초대 · 라벨 · 스페이스 설정', '招待・ラベル・設定', 'Invite & Settings')}
          >
            <Users className="w-4 h-4 text-forest-700" />
            <span className="hidden sm:inline">{activeSpace.members.length}</span>
            <Settings className="w-3.5 h-3.5 text-charcoal-500" />
          </button>

          <Button size="sm" onClick={() => openNewEventForDate(selectedDate)}>
            <Plus className="w-4 h-4 sm:mr-1" />
            <span className="hidden sm:inline">{L('일정 추가', '予定追加', 'Add Event')}</span>
          </Button>
        </div>
      </div>

      {/* Active Move / Copy Mode Banner */}
      {pendingAction && (
        <div className="p-3 rounded-xl bg-forest-800 text-white flex flex-wrap items-center justify-between gap-2 shadow-md animate-pulse">
          <div className="flex items-center gap-2 text-xs font-bold">
            {pendingAction.type === 'move' ? <Move className="w-4 h-4 shrink-0" /> : <Copy className="w-4 h-4 shrink-0" />}
            <span>
              {pendingAction.type === 'move'
                ? L(
                    `'${pendingAction.event.title}' 일정을 이동할 날짜를 달력에서 선택하세요 (다른 달 이동 가능)`,
                    `「${pendingAction.event.title}」の移動先の日付をタップしてください`,
                    `Click any date to MOVE '${pendingAction.event.title}' (you can switch months)`
                  )
                : L(
                    `'${pendingAction.event.title}' 일정을 복사할 날짜를 달력에서 선택하세요 (다른 달 이동 가능)`,
                    `「${pendingAction.event.title}」のコピー先の日付をタップしてください`,
                    `Click any date to COPY '${pendingAction.event.title}' (you can switch months)`
                  )}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setPendingAction(null)}
            className="px-3 py-1 rounded-lg bg-white/20 hover:bg-white/30 text-white text-xs font-bold transition"
          >
            {L('취소', 'キャンセル', 'Cancel')}
          </button>
        </div>
      )}

      {/* Proposed Events Quick Strip (if any proposals exist in this space!) */}
      {proposedEventsInSpace.length > 0 && !pendingAction && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-2 overflow-x-auto">
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-900 shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-amber-700" />
            {L(`조율 중인 제안 일정 (${proposedEventsInSpace.length})`, `調整中の提案 (${proposedEventsInSpace.length})`, `Proposals (${proposedEventsInSpace.length})`)}:
          </span>
          {proposedEventsInSpace.map((pe) => {
            const okCount = pe.votes.filter((v) => v.vote === 'AVAILABLE').length;
            return (
              <button
                key={pe.id}
                type="button"
                onClick={() => {
                  const p = parseYmd(pe.start_date);
                  jumpToYearMonth(p.year, p.month - 1);
                  setSelectedDate(pe.start_date);
                  setDetailEventId(pe.id);
                }}
                className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white hover:bg-amber-100 border border-amber-300 text-[11px] font-bold text-amber-950 transition"
              >
                <span>{formatShortDate(pe.start_date)}</span>
                <span className="truncate max-w-[140px]">{pe.title}</span>
                <span className="text-emerald-700">👍{okCount}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Split: Calendar Grid (max 1100px) + Selected Day Agenda (absorbs all extra width on wide monitors / collapsed sidebar) */}
      <div className="grid grid-cols-1 xl:grid-cols-[min(1100px,calc(100%_-_436px))_minmax(420px,1fr)] gap-4 items-start">
        {/* Monthly Calendar Grid Card */}
        <div className="bg-white rounded-2xl border border-ivory-300 overflow-hidden shadow-2xs select-none">
          {/* Swipeable 3-Pane Viewport (Weekday Header + Week Rows) */}
          <div
            ref={swipeViewportRef}
            className="relative overflow-hidden bg-white"
            style={{ touchAction: 'pan-y' }}
          >
            {/* Previous Month Preview Pane */}
            <div
              ref={prevPaneRef}
              aria-hidden="true"
              className="absolute inset-x-0 top-0 pointer-events-none bg-white"
              style={{
                transform: 'translate3d(-100%, 0, 0)',
                opacity: 0,
                visibility: 'hidden',
              }}
            >
              <CalendarMonthPane
                weeks={prevWeeks}
                expandedInstances={prevExpandedInstances}
                weekdays={weekdays}
                todayStr={todayStr}
                selectedDate={selectedDate}
                isActive={false}
                dragOverDate={null}
                cardDragHoveredDate={null}
                dropChoiceTargetDate={null}
                hasPendingAction={false}
                isCoarsePointer={isCoarsePointer}
                isDraggingEvent={false}
              />
            </div>

            {/* Active Current Month Pane */}
            <div ref={currPaneRef} className="relative bg-white">
              <CalendarMonthPane
                weeks={weeks}
                expandedInstances={expandedInstances}
                weekdays={weekdays}
                todayStr={todayStr}
                selectedDate={selectedDate}
                isActive={true}
                dragOverDate={dragOverDate}
                cardDragHoveredDate={cardDragState?.hoveredDate ?? null}
                dropChoiceTargetDate={dropChoice?.targetDate ?? null}
                hasPendingAction={Boolean(pendingAction)}
                isCoarsePointer={isCoarsePointer}
                isDraggingEvent={Boolean(draggingEvent)}
                onDateCellClick={handleDateCellClick}
                onDateContextMenu={handleDateContextMenu}
                onDatePointerDown={handleDatePointerDown}
                onPointerMoveLongPress={handlePointerMoveLongPress}
                onClearLongPress={clearLongPress}
                onDateDragOver={handleDateDragOver}
                onDateDragLeave={handleDateDragLeave}
                onDateDrop={handleDateDrop}
                onEventDragStart={handleEventDragStart}
                onEventDragEnd={handleEventDragEnd}
                onEventClick={handleEventClick}
                onEventContextMenu={handleEventContextMenu}
                onEventPointerDown={handleEventPointerDown}
              />
            </div>

            {/* Next Month Preview Pane */}
            <div
              ref={nextPaneRef}
              aria-hidden="true"
              className="absolute inset-x-0 top-0 pointer-events-none bg-white"
              style={{
                transform: 'translate3d(100%, 0, 0)',
                opacity: 0,
                visibility: 'hidden',
              }}
            >
              <CalendarMonthPane
                weeks={nextWeeks}
                expandedInstances={nextExpandedInstances}
                weekdays={weekdays}
                todayStr={todayStr}
                selectedDate={selectedDate}
                isActive={false}
                dragOverDate={null}
                cardDragHoveredDate={null}
                dropChoiceTargetDate={null}
                hasPendingAction={false}
                isCoarsePointer={isCoarsePointer}
                isDraggingEvent={false}
              />
            </div>
          </div>

          {/* Subtle TimeTree Gesture Hint Footer */}
          <div className="px-3 py-2 bg-ivory-50 border-t border-ivory-200 text-[11px] text-charcoal-500 flex flex-wrap items-center justify-between gap-2">
            <span>
              💡{' '}
              {L(
                '일정 길게 누르기(PC 우클릭/드래그) → 이동·복사 · 빈 날짜 길게 누르기(PC 우클릭) → 최근 10개 일정에서 빠른 복사',
                '予定を長押し(右クリック/ドラッグ)で移動・コピー・空き日を長押しで最近の予定10件からコピー',
                'Long-press / right-click event to Move or Copy · Long-press / right-click date to quick-copy from last 10 events'
              )}
            </span>
            {loading && <span className="font-bold text-forest-700">{L('동기화 중...', '同期中...', 'Syncing...')}</span>}
          </div>
        </div>

        {/* Selected Day Agenda Sidebar (Desktop >= 1280px; Mobile/Tablet uses Slide-Up Bottom Sheet) */}
        <div className="hidden xl:block xl:sticky xl:top-16 bg-white rounded-2xl border border-ivory-300 overflow-hidden shadow-2xs">
          <div className="px-4 py-3 bg-ivory-50 border-b border-ivory-200 flex items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-forest-800">{selectedDate}</div>
              <div className="text-[11px] text-charcoal-500">
                {L(
                  `선택한 날짜의 일정 ${selectedDayEvents.length}건`,
                  `選択日の予定 ${selectedDayEvents.length}件`,
                  `${selectedDayEvents.length} event(s) on this day`
                )}
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setQuickAddDate(selectedDate)}
                className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-white hover:bg-ivory-100 border border-ivory-300 text-[11px] font-bold text-charcoal-700 transition"
                title={L('최근 10개 일정에서 복사', '最近の予定からコピー', 'Copy from recent 10')}
              >
                <Copy className="w-3.5 h-3.5 text-forest-700" />
                <span>{L('최근 복사', '履歴コピー', 'Recent')}</span>
              </button>
              <button
                type="button"
                onClick={() => openNewEventForDate(selectedDate)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-forest-800 hover:bg-forest-900 text-white text-[11px] font-bold transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{L('추가', '追加', 'Add')}</span>
              </button>
            </div>
          </div>

          <div className="p-3.5 space-y-2.5 max-h-[calc(100vh-12rem)] overflow-y-auto">
            {selectedDayEvents.length === 0 ? (
              <div className="py-10 text-center space-y-2">
                <p className="text-xs text-charcoal-400">
                  {L('이 날에 등록된 일정이 없습니다.', 'この日の予定はありません。', 'No events on this day.')}
                </p>
                <button
                  type="button"
                  onClick={() => setQuickAddDate(selectedDate)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-ivory-100 hover:bg-ivory-200 text-xs font-bold text-charcoal-700 transition"
                >
                  <CalendarPlus className="w-3.5 h-3.5 text-forest-700" />
                  {L('새 일정 추가 또는 최근 일정 복사', '新規作成・最近の予定からコピー', 'Add or copy recent event')}
                </button>
              </div>
            ) : (
              selectedDayEvents.map((inst) => {
                const ev = inst.event;
                const isProposed = ev.event_status === 'PROPOSED';
                const okVotes = ev.votes.filter((v) => v.vote === 'AVAILABLE').length;
                const cardKey = `cal-ev-${ev.id}`;
                const cardTranslated = translator.isTranslated(cardKey);
                const showCardTrans = translator.shouldShowButton(ev.title, ev.location, ev.description);
                const dispTitle = translator.getText(cardKey, 'title', ev.title);
                const dispLocation = translator.getText(cardKey, 'location', ev.location);
                const dispDesc = translator.getText(cardKey, 'description', ev.description);
                return (
                  <div
                    key={inst.instanceKey}
                    onClick={() => setDetailEventId(ev.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setEventActionTarget(ev);
                    }}
                    className={`p-3 rounded-xl border transition cursor-pointer group ${
                      isProposed
                        ? 'bg-amber-50/70 border-dashed border-amber-300 hover:bg-amber-50'
                        : 'bg-white border-ivory-200 hover:border-forest-300 hover:bg-ivory-50/40'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <span
                        className="w-1.5 self-stretch rounded-full shrink-0"
                        style={{ backgroundColor: ev.color }}
                      />
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="text-xs sm:text-[13px] font-bold text-charcoal-900 leading-snug break-words flex items-start gap-1.5 min-w-0">
                            {isProposed && (
                              <span className="px-1.5 py-0.5 rounded bg-amber-200 text-amber-950 text-[10px] font-bold shrink-0 mt-0.5">
                                {L('제안', '提案', 'Prop')}
                              </span>
                            )}
                            <span className="break-words">{dispTitle}</span>
                          </div>
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingAction({ type: 'move', event: ev });
                              }}
                              className="p-1 rounded hover:bg-ivory-200 text-charcoal-500"
                              title={L('이동', '移動', 'Move')}
                            >
                              <Move className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPendingAction({ type: 'copy', event: ev });
                              }}
                              className="p-1 rounded hover:bg-ivory-200 text-charcoal-500"
                              title={L('복사', 'コピー', 'Copy')}
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 text-[11px] text-charcoal-500">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {ev.is_all_day
                              ? L('하루 종일', '終日', 'All Day')
                              : `${ev.start_time || ''}${ev.end_time ? `~${ev.end_time}` : ''}`}
                          </span>
                          {ev.end_date !== ev.start_date && (
                            <span>
                              ({formatShortDate(inst.startDate)}~{formatShortDate(inst.endDate)})
                            </span>
                          )}
                          {ev.location && (
                            <span className={`text-charcoal-600 ${cardTranslated ? 'break-words' : 'truncate max-w-[200px]'}`}>
                              📍 {dispLocation}
                            </span>
                          )}
                          {ev.recurrence_type !== 'NONE' && <Repeat className="w-3 h-3 text-forest-700" />}
                        </div>

                        {ev.description && (
                          <p
                            className={`text-[11px] text-charcoal-600 whitespace-pre-wrap leading-relaxed ${
                              cardTranslated ? '' : 'line-clamp-2'
                            }`}
                          >
                            {dispDesc}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                          <TranslateButton
                            visible={showCardTrans}
                            translated={cardTranslated}
                            loading={translator.isTranslating(cardKey)}
                            error={translator.getError(cardKey)}
                            onClick={(e) => {
                              e.stopPropagation();
                              void translator.toggleTranslate(
                                cardKey,
                                { title: ev.title, location: ev.location, description: ev.description },
                                'shared-calendar-event'
                              );
                            }}
                          />
                          {ev.comment_count > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.5 rounded-full">
                              <MessageSquare className="w-2.5 h-2.5" />
                              {ev.comment_count}
                            </span>
                          )}
                          {isProposed && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-800 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                              <ThumbsUp className="w-2.5 h-2.5" />
                              {okVotes}
                            </span>
                          )}
                          {ev.linked_thought_id && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-forest-800 bg-forest-50 px-1.5 py-0.5 rounded-full">
                              <Lightbulb className="w-2.5 h-2.5" />
                              {L('생각 연결됨', 'メモ連携', 'Thought linked')}
                            </span>
                          )}
                          {ev.mindmap_links && ev.mindmap_links.length > 0 && (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-indigo-800 bg-indigo-50 px-1.5 py-0.5 rounded-full">
                              <BookMarked className="w-2.5 h-2.5" />
                              {L('마인드맵 연동', 'マインドマップ', 'Mindmap')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Empty-Date Long-Press Slide-Up Sheet: New Event + Recent 10 Events Quick Copy */}
      <QuickAddBottomSheet
        targetDate={quickAddDate}
        onClose={() => setQuickAddDate(null)}
        recentEvents={recentEvents}
        onCreateNewEvent={(dt) => openNewEventForDate(dt)}
        onCopyRecentEvent={(rev, dt) => void executeMoveOrCopy('copy', rev, dt)}
      />

      {/* TimeTree Event Long-Press / Right-Click Action Popup */}
      <Modal
        isOpen={Boolean(eventActionTarget)}
        onClose={() => setEventActionTarget(null)}
        size="lg"
        title={
          eventActionTarget ? (
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: eventActionTarget.color }} />
              <span className="truncate">{eventActionTarget.title}</span>
            </div>
          ) : (
            ''
          )
        }
      >
        {eventActionTarget && (
          <div className="space-y-2">
            <div className="text-[11px] text-charcoal-500 pb-1">
              {eventActionTarget.start_date}
              {eventActionTarget.end_date !== eventActionTarget.start_date ? ` ~ ${eventActionTarget.end_date}` : ''}{' '}
              ·{' '}
              {eventActionTarget.is_all_day
                ? L('하루 종일', '終日', 'All Day')
                : `${eventActionTarget.start_time || ''}~${eventActionTarget.end_time || ''}`}
            </div>

            <button
              type="button"
              onClick={() => {
                const target = eventActionTarget;
                setEventActionTarget(null);
                setPendingAction({ type: 'move', event: target });
              }}
              className="w-full px-3.5 py-2.5 rounded-xl bg-forest-50 hover:bg-forest-100 border border-forest-200 text-forest-950 text-xs font-bold flex items-center gap-2.5 transition"
            >
              <Move className="w-4 h-4 text-forest-700" />
              <span>{L('다른 날짜로 이동', '別の日に移動', 'Move to another date')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const target = eventActionTarget;
                setEventActionTarget(null);
                setPendingAction({ type: 'copy', event: target });
              }}
              className="w-full px-3.5 py-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 border border-sky-200 text-sky-950 text-xs font-bold flex items-center gap-2.5 transition"
            >
              <Copy className="w-4 h-4 text-sky-700" />
              <span>{L('다른 날짜에 복사', '別の日にコピー', 'Copy to another date')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const id = eventActionTarget.id;
                setEventActionTarget(null);
                setDetailEventId(id);
              }}
              className="w-full px-3.5 py-2.5 rounded-xl bg-white hover:bg-ivory-100 border border-ivory-300 text-charcoal-800 text-xs font-bold flex items-center gap-2.5 transition"
            >
              <MessageSquare className="w-4 h-4 text-charcoal-600" />
              <span>{L('상세 · 채팅 열기', '詳細・チャットを開く', 'Open details & chat')}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const target = eventActionTarget;
                setEventActionTarget(null);
                setEditingEvent(target);
                setEditorInitialDate(target.start_date);
                setEditorOpen(true);
              }}
              className="w-full px-3.5 py-2.5 rounded-xl bg-white hover:bg-ivory-100 border border-ivory-300 text-charcoal-800 text-xs font-bold flex items-center gap-2.5 transition"
            >
              <Edit2 className="w-4 h-4 text-charcoal-600" />
              <span>{L('일정 수정', '予定を編集', 'Edit event')}</span>
            </button>

            <button
              type="button"
              onClick={() => void handleDeleteEventQuick(eventActionTarget)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-800 text-xs font-bold flex items-center gap-2.5 transition"
            >
              <Trash2 className="w-4 h-4 text-rose-700" />
              <span>{L('일정 삭제', '予定を削除', 'Delete event')}</span>
            </button>
          </div>
        )}
      </Modal>

      {/* Event Editor Modal */}
      <EventEditorModal
        isOpen={editorOpen}
        onClose={() => {
          setEditorOpen(false);
          setEditingEvent(null);
        }}
        space={activeSpace}
        initialDate={editorInitialDate}
        editingEvent={editingEvent}
        onSaved={(saved) => {
          setSelectedDate(saved.start_date);
          void loadEvents();
          onSpacesNeedRefresh();
        }}
      />

      {/* Mobile / Tablet Draggable Slide-Up Day Bottom Sheet */}
      <MobileDayBottomSheet
        isOpen={mobileDaySheetOpen}
        isCardDragging={Boolean(cardDragState)}
        onClose={() => setMobileDaySheetOpen(false)}
        selectedDate={selectedDate}
        dayEvents={selectedDayEvents}
        onOpenEventDetail={(id) => setDetailEventId(id)}
        onOpenNewEvent={(ymd) => openNewEventForDate(ymd)}
        onOpenRecentCopy={(ymd) => setQuickAddDate(ymd)}
        onStartMove={(ev) => setPendingAction({ type: 'move', event: ev })}
        onStartCopy={(ev) => setPendingAction({ type: 'copy', event: ev })}
        onStartCardDragMove={handleStartCardDragMove}
        onUpdateCardDragMove={handleUpdateCardDragMove}
        onEndCardDragMove={handleEndCardDragMove}
        onCancelCardDragMove={handleCancelCardDragMove}
      />

      {/* Floating Ghost Pill during Mobile/Touch Card Drag-and-Drop */}
      {cardDragState && (
        <div
          ref={ghostPillRef}
          style={{ left: 0, top: 0 }}
          className="fixed z-[70] pointer-events-none select-none w-max max-w-[min(220px,calc(100vw-24px))]"
        >
          <div className="px-3.5 py-2 rounded-2xl bg-charcoal-900/95 text-white shadow-2xl border border-white/20 flex items-center gap-2 text-xs font-bold whitespace-nowrap">
            <span
              className="w-2.5 h-2.5 rounded-full shrink-0"
              style={{ backgroundColor: cardDragState.event.color }}
            />
            <span className="truncate">{cardDragState.event.title}</span>
          </div>
        </div>
      )}

      {/* Floating [Move / Copy] Choice Popover anchored right above the dropped date cell */}
      {dropChoice && (
        <>
          <div
            onClick={() => setDropChoice(null)}
            className="fixed inset-0 z-[65] bg-transparent"
            aria-hidden="true"
          />
          <div
            style={{
              left: 0,
              top: 0,
              transform: `translate3d(calc(${dropChoice.x}px - 50%), calc(${dropChoice.y - 8}px - 100%), 0)`,
            }}
            className="fixed z-[70] bg-white rounded-2xl shadow-2xl border border-ivory-300 px-3 py-2.5 w-max min-w-[200px] max-w-[min(240px,calc(100vw-24px))]"
          >
            <div className="text-[11px] font-bold text-charcoal-500 text-center mb-2 truncate max-w-[210px]">
              {dropChoice.targetDate} · {dropChoice.event.title}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const { event, targetDate } = dropChoice;
                  setDropChoice(null);
                  void executeMoveOrCopy('move', event, targetDate);
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-forest-800 hover:bg-forest-900 text-white text-xs font-bold whitespace-nowrap transition shadow-xs"
              >
                <Move className="w-3.5 h-3.5 shrink-0" />
                <span>{L('이동', '移動', 'Move')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const { event, targetDate } = dropChoice;
                  setDropChoice(null);
                  void executeMoveOrCopy('copy', event, targetDate);
                }}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-sky-700 hover:bg-sky-800 text-white text-xs font-bold whitespace-nowrap transition shadow-xs"
              >
                <Copy className="w-3.5 h-3.5 shrink-0" />
                <span>{L('복사', 'コピー', 'Copy')}</span>
              </button>
            </div>
            {/* Downward pointer caret */}
            <div className="w-3 h-3 bg-white border-r border-b border-ivory-300 rotate-45 absolute left-1/2 -translate-x-1/2 -bottom-1.5" />
          </div>
        </>
      )}

      {/* Event Detail + Chat Modal */}
      <EventDetailChatModal
        isOpen={Boolean(detailEventId)}
        onClose={() => setDetailEventId(null)}
        space={activeSpace}
        eventId={detailEventId}
        realtimeTick={realtimeTick}
        onEdit={(ev) => {
          setEditingEvent(ev);
          setEditorInitialDate(ev.start_date);
          setEditorOpen(true);
        }}
        onStartMove={(ev) => setPendingAction({ type: 'move', event: ev })}
        onStartCopy={(ev) => setPendingAction({ type: 'copy', event: ev })}
        onJumpToThought={onJumpToThought}
        onJumpToMindmapProject={onJumpToMindmapProject}
        onMutated={() => {
          void loadEvents();
          onSpacesNeedRefresh();
        }}
      />

      {/* Floating Mobile Quick Close for Move/Copy if needed */}
      {pendingAction && (
        <button
          type="button"
          onClick={() => setPendingAction(null)}
          className="lg:hidden fixed bottom-16 right-4 z-40 w-10 h-10 rounded-full bg-charcoal-900 text-white shadow-lg flex items-center justify-center"
          title={L('취소', 'キャンセル', 'Cancel')}
        >
          <X className="w-5 h-5" />
        </button>
      )}
    </div>
  );
};
