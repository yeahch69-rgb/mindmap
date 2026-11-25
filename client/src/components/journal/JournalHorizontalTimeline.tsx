import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLanguage } from '../../context/LanguageContext';
import { TranslateButton } from '../common/TranslateButton';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { getJstTodayStr } from '../../utils/dateTime';
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Compass,
  ExternalLink,
  Focus,
  Lock,
  MessageCircle,
  MessageSquare,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { EntryType, JournalEntry, JournalProject, TurnState } from './types';

interface JournalHorizontalTimelineProps {
  projects: JournalProject[];
  todayJst?: string;
  onSelectProject: (projectId: number) => void;
}

const ZOOM_STEPS = [28, 38, 52, 68];

function parseYmdUtc(ymd: string): Date | null {
  const clean = String(ymd || '').slice(0, 10);
  const parts = clean.split('-').map(Number);
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return null;
  return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

function addDaysYmd(ymd: string, offsetDays: number): string {
  const dt = parseYmdUtc(ymd);
  if (!dt) return ymd;
  dt.setUTCDate(dt.getUTCDate() + offsetDays);
  // jst-ignore: pure YYYY-MM-DD calendar arithmetic
  return dt.toISOString().slice(0, 10);
}

function clampYmd(ymd: string, minBound: string, maxBound: string): string {
  if (ymd < minBound) return minBound;
  if (ymd > maxBound) return maxBound;
  return ymd;
}

export const JournalHorizontalTimeline: React.FC<JournalHorizontalTimelineProps> = ({
  projects,
  todayJst: propTodayJst,
  onSelectProject,
}) => {
  const { L, language } = useLanguage();
  const tr = useContentTranslation();
  const todayJst = propTodayJst || getJstTodayStr();

  const [zoomIdx, setZoomIdx] = useState(1); // 38px default
  const dayWidth = ZOOM_STEPS[zoomIdx] || 38;
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [selectedDayInfo, setSelectedDayInfo] = useState<{
    project: JournalProject;
    date: string;
    entries: JournalEntry[];
    isNextStep?: boolean;
  } | null>(null);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Build safe date axis bounded around todayJst
  const { dates, monthGroups, todayIndex } = useMemo(() => {
    const hardMin = addDaysYmd(todayJst, -90);
    const hardMax = addDaysYmd(todayJst, 90);

    let minDate = addDaysYmd(todayJst, -14);
    let maxDate = addDaysYmd(todayJst, 14);

    for (const p of projects) {
      const entries = p.timeline_entries || [];
      for (const e of entries) {
        const d = String(e.entry_date || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          const clamped = clampYmd(d, hardMin, hardMax);
          if (clamped < minDate) minDate = clamped;
          if (clamped > maxDate) maxDate = clamped;
        }
      }
      const lastAct = String(p.last_activity_at || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(lastAct)) {
        const clamped = clampYmd(lastAct, hardMin, hardMax);
        if (clamped < minDate) minDate = clamped;
        if (clamped > maxDate) maxDate = clamped;
      }
      const nextDt = String(p.next_action_date || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(nextDt)) {
        const clamped = clampYmd(nextDt, hardMin, hardMax);
        if (clamped < minDate) minDate = clamped;
        if (clamped > maxDate) maxDate = clamped;
      }
    }

    minDate = addDaysYmd(minDate, -2);
    maxDate = addDaysYmd(maxDate, 3);

    const startUtc = parseYmdUtc(minDate)!;
    const endUtc = parseYmdUtc(maxDate)!;
    const list: Array<{ ymd: string; monthKey: string; day: number; dow: number }> = [];
    const cursor = new Date(startUtc.getTime());
    let safety = 0;

    while (cursor.getTime() <= endUtc.getTime() && safety < 220) {
      // jst-ignore: pure YYYY-MM-DD calendar arithmetic
      const ymd = cursor.toISOString().slice(0, 10);
      list.push({
        ymd,
        monthKey: ymd.slice(0, 7),
        day: cursor.getUTCDate(),
        dow: cursor.getUTCDay(),
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      safety += 1;
    }

    const months: Array<{ monthKey: string; label: string; count: number }> = [];
    for (const d of list) {
      const last = months[months.length - 1];
      if (last && last.monthKey === d.monthKey) {
        last.count += 1;
      } else {
        const [yy, mm] = d.monthKey.split('-');
        months.push({
          monthKey: d.monthKey,
          label: `${yy}.${mm}`,
          count: 1,
        });
      }
    }

    const tIdx = list.findIndex((d) => d.ymd === todayJst);
    return { dates: list, monthGroups: months, todayIndex: tIdx };
  }, [projects, todayJst]);

  const dateIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    dates.forEach((d, idx) => map.set(d.ymd, idx));
    return map;
  }, [dates]);

  const scrollToToday = (behavior: ScrollBehavior = 'smooth') => {
    const el = scrollContainerRef.current;
    if (!el || todayIndex < 0) return;
    const targetLeft = Math.max(0, todayIndex * dayWidth - el.clientWidth * 0.55);
    el.scrollTo({ left: targetLeft, behavior });
  };

  useEffect(() => {
    const timer = setTimeout(() => scrollToToday('auto'), 40);
    return () => clearTimeout(timer);
  }, [todayIndex, dayWidth]);

  const dowLabels = useMemo(() => {
    if (language === 'ja') return ['日', '月', '火', '水', '木', '金', '土'];
    if (language === 'en') return ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    return ['일', '월', '화', '수', '목', '금', '토'];
  }, [language]);

  const getTurnShortBadge = (turn: TurnState) => {
    if (turn === 'MY_TURN') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 border border-rose-200 text-[10px] font-bold whitespace-nowrap">
          {L('내 턴', '自分', 'My Turn')}
        </span>
      );
    }
    if (turn === 'THEIR_TURN') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 border border-sky-200 text-[10px] font-bold whitespace-nowrap">
          {L('상대 턴', '相手', 'Waiting')}
        </span>
      );
    }
    if (turn === 'HOLD') {
      return (
        <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold whitespace-nowrap">
          {L('보류', '保留', 'Hold')}
        </span>
      );
    }
    return (
      <span className="px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-800 border border-emerald-200 text-[10px] font-bold whitespace-nowrap">
        {L('완료', '完了', 'Done')}
      </span>
    );
  };

  const getEntryDotMeta = (type: EntryType) => {
    switch (type) {
      case 'DIALOGUE_ME':
        return {
          bg: 'bg-forest-700 border-forest-900 text-white',
          label: L('나', '自分', 'Me'),
          icon: <MessageSquare className="w-3.5 h-3.5" />,
        };
      case 'DIALOGUE_THEM':
        return {
          bg: 'bg-sky-600 border-sky-800 text-white',
          label: L('상대방', '相手', 'Partner'),
          icon: <MessageCircle className="w-3.5 h-3.5" />,
        };
      case 'PROGRESS':
        return {
          bg: 'bg-emerald-600 border-emerald-800 text-white',
          label: L('완료', '完了', 'Done'),
          icon: <Check className="w-3.5 h-3.5 stroke-[2.5]" />,
        };
      case 'INTENT':
      default:
        return {
          bg: 'bg-amber-500 border-amber-700 text-white',
          label: L('의도·결정', '意図', 'Intent'),
          icon: <Compass className="w-3.5 h-3.5" />,
        };
    }
  };

  const totalGridWidth = dates.length * dayWidth;

  return (
    <div className="bg-white rounded-xl border border-ivory-300 shadow-2xs overflow-hidden">
      {/* Header Toolbar */}
      <div className="px-3 py-2.5 bg-ivory-50 border-b border-ivory-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="px-2 py-1 rounded-lg bg-white border border-ivory-300 text-xs font-bold text-charcoal-700 hover:bg-ivory-100 inline-flex items-center gap-1"
            title={L('목록 패널 접기/펼치기', 'リストパネル切替', 'Toggle project panel')}
          >
            {sidebarOpen ? <ChevronLeft className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">{L('프로젝트 목록', '一覧', 'Projects')}</span>
          </button>

          <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-900">
            <Calendar className="w-4 h-4 text-forest-700" />
            <span>{L('가로 날짜 타임라인', '横型日付タイムライン', 'Horizontal Date Timeline')}</span>
          </div>

          {/* Legend */}
          <div className="hidden lg:flex items-center gap-2 text-[11px] font-bold text-charcoal-600 pl-2 border-l border-ivory-300">
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-forest-700 inline-block" />
              {L('나', '自分', 'Me')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-600 inline-block" />
              {L('상대', '相手', 'Partner')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" />
              {L('의도·결정', '意図', 'Intent')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 inline-block" />
              {L('완료', '完了', 'Done')}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2.5 h-2.5 rotate-45 bg-amber-500 border border-amber-700 inline-block" />
              {L('Next Step 예정', 'Next Step予定', 'Next Step')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setZoomIdx((z) => Math.max(0, z - 1))}
            disabled={zoomIdx === 0}
            className="p-1.5 rounded-lg bg-white border border-ivory-300 text-charcoal-700 disabled:opacity-40 hover:bg-ivory-100"
            title={L('축소', '縮小', 'Zoom out')}
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setZoomIdx((z) => Math.min(ZOOM_STEPS.length - 1, z + 1))}
            disabled={zoomIdx === ZOOM_STEPS.length - 1}
            className="p-1.5 rounded-lg bg-white border border-ivory-300 text-charcoal-700 disabled:opacity-40 hover:bg-ivory-100"
            title={L('확대', '拡大', 'Zoom in')}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => scrollToToday('smooth')}
            className="px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 inline-flex items-center gap-1"
          >
            <Focus className="w-3.5 h-3.5" />
            <span>{L('오늘로', '今日へ', 'Today')}</span>
          </button>
        </div>
      </div>

      {projects.length === 0 ? (
        <div className="py-12 text-center text-xs text-charcoal-400">
          {L('표시할 프로젝트가 없습니다.', '表示できるプロジェクトがありません。', 'No projects to visualize.')}
        </div>
      ) : (
        <div className="flex relative">
          {/* Collapsible Left Project Panel */}
          {sidebarOpen && (
            <div className="w-52 sm:w-64 shrink-0 border-r border-ivory-300 bg-white z-10">
              {/* Matches right month + day header height (24px + 34px = 58px) */}
              <div className="h-[58px] px-3 border-b border-ivory-300 bg-ivory-50 flex items-center justify-between text-[11px] font-bold text-charcoal-600">
                <span>{L(`프로젝트 (${projects.length})`, `プロジェクト (${projects.length})`, `Projects (${projects.length})`)}</span>
                <span>{L('경과/턴', '経過/ターン', 'Status')}</span>
              </div>

              <div>
                {projects.map((p) => (
                  <div
                    key={`tl-side-${p.id}`}
                    onClick={() => onSelectProject(p.id)}
                    className="h-16 px-3 py-1.5 border-b border-ivory-200 hover:bg-ivory-50 cursor-pointer flex flex-col justify-between transition"
                  >
                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                        {p.mode === 'SOLO' || p.is_private === 1 ? (
                          <Lock className="w-3 h-3 text-charcoal-400 shrink-0" />
                        ) : (
                          <Users className="w-3 h-3 text-sky-600 shrink-0" />
                        )}
                        <span className="text-xs font-bold text-charcoal-900 truncate">{p.title}</span>
                      </div>
                      {p.is_stale && (
                        <span className="text-[10px] font-mono font-bold text-rose-700 shrink-0">
                          D+{p.days_since_update}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center justify-between gap-1.5 min-w-0">
                      {getTurnShortBadge(p.turn_state)}
                      <span className="text-[10px] text-charcoal-500 truncate">
                        {p.next_action || L('Next Step 미지정', 'Next Step未定', 'No next step')}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Right Scrollable Date Grid */}
          <div ref={scrollContainerRef} className="flex-1 overflow-x-auto relative bg-white">
            <div style={{ width: totalGridWidth, minWidth: '100%' }} className="relative">
              {/* Month Band (24px) */}
              <div className="h-6 flex border-b border-ivory-200 bg-ivory-50 text-[11px] font-mono font-bold text-charcoal-700">
                {monthGroups.map((m) => (
                  <div
                    key={m.monthKey}
                    style={{ width: m.count * dayWidth }}
                    className="shrink-0 px-2 flex items-center border-r border-ivory-200"
                  >
                    {m.label}
                  </div>
                ))}
              </div>

              {/* Day Header (34px) */}
              <div className="h-[34px] flex border-b border-ivory-300 bg-ivory-50/70">
                {dates.map((d) => {
                  const isToday = d.ymd === todayJst;
                  const isWeekend = d.dow === 0 || d.dow === 6;
                  return (
                    <div
                      key={d.ymd}
                      style={{ width: dayWidth }}
                      className={`shrink-0 flex flex-col items-center justify-center border-r border-ivory-200/70 text-[10px] leading-tight ${
                        isToday
                          ? 'bg-rose-600 text-white font-bold'
                          : isWeekend
                          ? 'bg-stone-100/70 text-charcoal-500'
                          : 'text-charcoal-700'
                      }`}
                    >
                      <span className="font-mono font-bold">{d.day}</span>
                      <span className="text-[9px] opacity-80">{dowLabels[d.dow]}</span>
                    </div>
                  );
                })}
              </div>

              {/* Today Vertical Marker */}
              {todayIndex >= 0 && (
                <div
                  style={{ left: todayIndex * dayWidth + dayWidth / 2 }}
                  className="absolute top-[58px] bottom-0 w-0.5 border-l-2 border-dashed border-rose-500/70 pointer-events-none z-10"
                />
              )}

              {/* Project Rows */}
              <div>
                {projects.map((p) => {
                  const entries = p.timeline_entries || [];
                  const entriesByDate = new Map<string, JournalEntry[]>();
                  for (const en of entries) {
                    const dt = String(en.entry_date || '').slice(0, 10);
                    const arr = entriesByDate.get(dt) || [];
                    arr.push(en);
                    entriesByDate.set(dt, arr);
                  }

                  const entryDateIndices: Array<{ date: string; idx: number; items: JournalEntry[] }> = [];
                  entriesByDate.forEach((items, dt) => {
                    const idx = dateIndexMap.get(dt);
                    if (idx !== undefined) {
                      entryDateIndices.push({ date: dt, idx, items });
                    }
                  });
                  entryDateIndices.sort((a, b) => a.idx - b.idx);

                  const firstIdx = entryDateIndices.length > 0 ? entryDateIndices[0].idx : todayIndex;
                  const lastIdx =
                    entryDateIndices.length > 0 ? entryDateIndices[entryDateIndices.length - 1].idx : todayIndex;

                  const nextStepYmd = p.next_action_date ? String(p.next_action_date).slice(0, 10) : '';
                  const nextStepIdx = nextStepYmd ? dateIndexMap.get(nextStepYmd) : undefined;

                  return (
                    <div
                      key={`tl-row-${p.id}`}
                      className="h-16 relative border-b border-ivory-200 flex"
                    >
                      {/* Background Day Grid Cells */}
                      {dates.map((d) => {
                        const isToday = d.ymd === todayJst;
                        const isWeekend = d.dow === 0 || d.dow === 6;
                        return (
                          <div
                            key={`${p.id}-${d.ymd}`}
                            style={{ width: dayWidth }}
                            className={`shrink-0 h-full border-r border-ivory-100 ${
                              isToday ? 'bg-rose-50/40' : isWeekend ? 'bg-stone-50/50' : ''
                            }`}
                          />
                        );
                      })}

                      {/* Active History Solid Span (First Log -> Last Log) */}
                      {entryDateIndices.length >= 2 && (
                        <div
                          style={{
                            left: firstIdx * dayWidth + dayWidth / 2,
                            width: Math.max(4, (lastIdx - firstIdx) * dayWidth),
                            backgroundColor: p.color || '#1B4D3E',
                          }}
                          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full opacity-55 pointer-events-none"
                        />
                      )}

                      {/* Idle / Wait Span (Last Log -> Today) */}
                      {entryDateIndices.length > 0 && todayIndex > lastIdx && (
                        <div
                          style={{
                            left: lastIdx * dayWidth + dayWidth / 2,
                            width: (todayIndex - lastIdx) * dayWidth,
                          }}
                          className={`absolute top-1/2 -translate-y-1/2 border-t-2 border-dashed pointer-events-none ${
                            p.is_stale ? 'border-rose-500' : 'border-emerald-600/50'
                          }`}
                        />
                      )}

                      {/* Connector to Future Next Step */}
                      {nextStepIdx !== undefined && p.next_action && (
                        (() => {
                          const anchorIdx = Math.max(lastIdx >= 0 ? lastIdx : 0, todayIndex >= 0 ? todayIndex : 0);
                          if (nextStepIdx <= anchorIdx) return null;
                          return (
                            <div
                              style={{
                                left: anchorIdx * dayWidth + dayWidth / 2,
                                width: (nextStepIdx - anchorIdx) * dayWidth,
                              }}
                              className="absolute top-1/2 -translate-y-1/2 border-t-2 border-dotted border-amber-500 pointer-events-none"
                            />
                          );
                        })()
                      )}

                      {/* Recorded Log Nodes per Date */}
                      {entryDateIndices.map(({ date, idx, items }) => {
                        const latestItem = items[items.length - 1];
                        const meta = getEntryDotMeta(latestItem.entry_type);
                        const isSelected =
                          selectedDayInfo?.project.id === p.id &&
                          selectedDayInfo?.date === date &&
                          !selectedDayInfo?.isNextStep;

                        return (
                          <button
                            key={`${p.id}-node-${date}`}
                            type="button"
                            onClick={() => setSelectedDayInfo({ project: p, date, entries: items })}
                            style={{ left: idx * dayWidth + dayWidth / 2 }}
                            title={`${p.title} (${date}) · ${items.length}`}
                            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-7 h-7 rounded-full border-2 shadow-xs flex items-center justify-center transition hover:scale-110 ${
                              meta.bg
                            } ${isSelected ? 'ring-2 ring-gold-500 scale-110' : ''}`}
                          >
                            {meta.icon}
                            {items.length > 1 && (
                              <span className="absolute -top-1.5 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-charcoal-900 text-white border border-white text-[9px] font-mono font-bold flex items-center justify-center leading-none">
                                {items.length}
                              </span>
                            )}
                          </button>
                        );
                      })}

                      {/* Future Next Step Diamond Marker */}
                      {nextStepIdx !== undefined && p.next_action && (
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedDayInfo({
                              project: p,
                              date: nextStepYmd,
                              entries: entriesByDate.get(nextStepYmd) || [],
                              isNextStep: true,
                            })
                          }
                          style={{ left: nextStepIdx * dayWidth + dayWidth / 2 }}
                          title={`Next Step (${nextStepYmd}): ${p.next_action}`}
                          className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 w-6 h-6 rotate-45 border-2 shadow-xs flex items-center justify-center transition hover:scale-110 ${
                            p.is_overdue_next_action
                              ? 'bg-rose-600 border-rose-800 text-white'
                              : 'bg-amber-400 border-amber-700 text-black'
                          }`}
                        >
                          <span className="-rotate-45 text-[10px] font-bold">★</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Selected Day / Next Step Inspector Bar */}
      {selectedDayInfo && (
        <div className="p-3.5 bg-ivory-50 border-t border-ivory-300 space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: selectedDayInfo.project.color }}
              />
              <span
                className={`font-bold text-xs text-charcoal-900 ${
                  tr.isTranslated(`jht-proj-${selectedDayInfo.project.id}`) ? 'break-words' : 'truncate'
                }`}
              >
                {tr.getText(`jht-proj-${selectedDayInfo.project.id}`, 'title', selectedDayInfo.project.title)}
              </span>
              <span className="px-2 py-0.5 rounded bg-white border border-ivory-300 font-mono text-[11px] font-bold text-charcoal-700">
                {selectedDayInfo.date}
              </span>
              {selectedDayInfo.isNextStep && selectedDayInfo.project.next_action && (
                <span className="px-2 py-0.5 rounded bg-amber-100 border border-amber-300 text-amber-900 text-[11px] font-bold">
                  {L('Next Step 예정:', 'Next Step予定:', 'Next Step:')}{' '}
                  {tr.getText(`jht-proj-${selectedDayInfo.project.id}`, 'next_action', selectedDayInfo.project.next_action)}
                </span>
              )}
              <TranslateButton
                size="xs"
                visible={tr.shouldShowButton(selectedDayInfo.project.title, selectedDayInfo.project.next_action)}
                translated={tr.isTranslated(`jht-proj-${selectedDayInfo.project.id}`)}
                loading={tr.isTranslating(`jht-proj-${selectedDayInfo.project.id}`)}
                error={tr.getError(`jht-proj-${selectedDayInfo.project.id}`)}
                onClick={() =>
                  tr.toggleTranslate(
                    `jht-proj-${selectedDayInfo.project.id}`,
                    {
                      title: selectedDayInfo.project.title || '',
                      next_action: selectedDayInfo.project.next_action || '',
                    },
                    'journal'
                  )
                }
              />
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onSelectProject(selectedDayInfo.project.id)}
                className="px-2.5 py-1 rounded-lg bg-forest-800 text-white text-xs font-bold hover:bg-forest-900 inline-flex items-center gap-1"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>{L('상세 열기', '詳細を開く', 'Open Project')}</span>
              </button>
              <button
                type="button"
                onClick={() => setSelectedDayInfo(null)}
                className="p-1 rounded-lg hover:bg-ivory-200 text-charcoal-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {selectedDayInfo.entries.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {selectedDayInfo.entries.map((en) => {
                const meta = getEntryDotMeta(en.entry_type);
                return (
                  <div
                    key={`insp-${en.id}`}
                    className="p-2.5 rounded-lg bg-white border border-ivory-200 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${meta.bg}`}>
                        {en.entry_type === 'DIALOGUE_THEM' && en.speaker_name ? en.speaker_name : meta.label}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <TranslateButton
                          size="xs"
                          visible={tr.shouldShowButton(en.content)}
                          translated={tr.isTranslated(`jht-entry-${en.id}`)}
                          loading={tr.isTranslating(`jht-entry-${en.id}`)}
                          error={tr.getError(`jht-entry-${en.id}`)}
                          onClick={() => tr.toggleTranslate(`jht-entry-${en.id}`, { content: en.content }, 'journal')}
                        />
                        <span className="text-[10px] font-mono text-charcoal-400">
                          {en.entry_time || ''}
                        </span>
                      </div>
                    </div>
                    <p className="text-charcoal-800 whitespace-pre-wrap leading-relaxed">
                      {tr.getText(`jht-entry-${en.id}`, 'content', en.content)}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
