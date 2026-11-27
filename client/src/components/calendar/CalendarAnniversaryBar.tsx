import React, { useMemo, useState } from 'react';
import { Bell, Cake, ChevronDown, ChevronUp, Moon, Plus, Repeat, Settings, Sun } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { SpaceAnniversary } from '../../types/spaces';
import {
  AnniversaryDDaySummary,
  computeAnniversaryDDay,
  formatBaseCalendarBadge,
  sortAnniversaryDDays,
} from '../../utils/anniversaryUtils';
import { TranslateButton } from '../common/TranslateButton';

const DDAY_BAR_COLLAPSED_STORAGE_KEY = 'pj_calendar_dday_bar_collapsed';

function readInitialCollapsed(): boolean {
  try {
    return localStorage.getItem(DDAY_BAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

interface CalendarAnniversaryBarProps {
  anniversaries: SpaceAnniversary[];
  todayStr: string;
  onSelectAnniversary: (summary: AnniversaryDDaySummary) => void;
  onManageAnniversaries: () => void;
}

export const CalendarAnniversaryBar: React.FC<CalendarAnniversaryBarProps> = ({
  anniversaries,
  todayStr,
  onSelectAnniversary,
  onManageAnniversaries,
}) => {
  const { L } = useLanguage();
  const translator = useContentTranslation();
  const [collapsed, setCollapsed] = useState<boolean>(readInitialCollapsed);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(DDAY_BAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  };

  const summaries = useMemo(() => {
    const list = anniversaries
      .map((ann) => computeAnniversaryDDay(ann, todayStr))
      .filter((item): item is AnniversaryDDaySummary => item !== null);
    return sortAnniversaryDDays(list);
  }, [anniversaries, todayStr]);

  const topSummary = summaries[0] ?? null;

  return (
    <div className="bg-gradient-to-r from-rose-50/85 via-white to-amber-50/60 rounded-2xl border border-rose-200/90 shadow-2xs overflow-hidden">
      {/* Header Row (Always Visible — Collapsible Toggle) */}
      <div className="px-3 sm:px-4 py-2 flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={toggleCollapsed}
          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
          aria-expanded={!collapsed}
        >
          <span className="w-6 h-6 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
            <Cake className="w-3.5 h-3.5" />
          </span>
          <span className="text-xs font-bold text-rose-950 shrink-0">
            {L('기념일 · D-Day', '記念日・D-Day', 'Anniversaries · D-Day')}
          </span>
          <span className="px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[10px] font-bold shrink-0">
            {summaries.length}
          </span>

          {/* Compact preview when collapsed */}
          {collapsed && topSummary && (
            <div className="flex items-center gap-1.5 min-w-0 ml-1">
              <span
                className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                  topSummary.primaryDiffDays === 0
                    ? 'bg-rose-600 text-white'
                    : topSummary.primaryDiffDays > 0
                      ? 'bg-forest-800 text-white'
                      : 'bg-amber-600 text-white'
                }`}
              >
                {topSummary.primaryLabel}
              </span>
              {topSummary.elapsedLabel && (
                <span className="hidden sm:inline-flex px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold shrink-0">
                  {topSummary.elapsedLabel}
                </span>
              )}
              <span className="text-xs font-semibold text-charcoal-800 truncate">
                {translator.getText(
                  `dday-bar-${topSummary.anniversary.id}`,
                  'title',
                  topSummary.anniversary.title
                )}
              </span>
              <span className="hidden md:inline text-[11px] text-charcoal-400 shrink-0 tabular-nums">
                ({topSummary.primaryOccurrence.solarDate})
              </span>
            </div>
          )}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onManageAnniversaries}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/90 hover:bg-rose-100/80 border border-rose-200 text-[11px] font-bold text-rose-800 transition"
            title={L('기념일 추가 · 관리', '記念日の追加・管理', 'Manage anniversaries')}
          >
            <Settings className="w-3 h-3" />
            <span className="hidden sm:inline">{L('관리', '管理', 'Manage')}</span>
          </button>
          <button
            type="button"
            onClick={toggleCollapsed}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-white/90 hover:bg-ivory-100 border border-ivory-300 text-[11px] font-bold text-charcoal-700 transition"
            title={collapsed ? L('펼치기', '展開する', 'Expand') : L('접기', '折りたたむ', 'Collapse')}
          >
            {collapsed ? (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{L('펼치기', '展開', 'Expand')}</span>
              </>
            ) : (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{L('접기', '閉じる', 'Collapse')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Expanded Body */}
      {!collapsed && (
        <div className="px-3 sm:px-4 pb-2.5 pt-1 border-t border-rose-100/90">
          {summaries.length === 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-2 py-1 text-xs text-charcoal-500">
              <span>
                {L(
                  '등록된 기념일이 없습니다. 생일·결혼기념일·음력 기념일을 등록해 D-Day를 한눈에 확인해 보세요.',
                  '登録された記念日はありません。誕生日や旧暦の記念日を登録してD-Dayを確認しましょう。',
                  'No anniversaries yet. Add Solar or Korean Lunar anniversaries to track D-Days here.'
                )}
              </span>
              <button
                type="button"
                onClick={onManageAnniversaries}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold transition shrink-0"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{L('기념일 등록', '記念日を登録', 'Add Anniversary')}</span>
              </button>
            </div>
          ) : (
            <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
              {summaries.map((item) => {
                const ann = item.anniversary;
                const occ = item.primaryOccurrence;
                const transKey = `dday-bar-${ann.id}`;
                const isTrans = translator.isTranslated(transKey);
                const showTrans = translator.shouldShowButton(ann.title, ann.memo);
                const dispTitle = translator.getText(transKey, 'title', ann.title);

                return (
                  <div
                    key={ann.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onSelectAnniversary(item)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onSelectAnniversary(item);
                      }
                    }}
                    className={`shrink-0 rounded-xl border px-3 py-2 bg-white hover:border-rose-400 hover:shadow-xs transition cursor-pointer flex flex-col justify-between gap-1.5 ${
                      isTrans ? 'min-w-[200px] max-w-[300px]' : 'min-w-[178px] max-w-[230px]'
                    } ${
                      item.primaryDiffDays === 0
                        ? 'border-rose-400 ring-1 ring-rose-200 bg-rose-50/40'
                        : 'border-rose-200/80'
                    }`}
                  >
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-1">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold tabular-nums shrink-0 ${
                            item.primaryDiffDays === 0
                              ? 'bg-rose-600 text-white'
                              : item.primaryDiffDays > 0
                                ? 'bg-forest-800 text-white'
                                : 'bg-amber-600 text-white'
                          }`}
                        >
                          {item.primaryLabel}
                        </span>
                        {item.elapsedLabel && (
                          <span
                            className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-950 text-[10px] font-bold tabular-nums shrink-0"
                            title={L(
                              `기준일(${item.baseSolarDate}) 기준 경과일`,
                              `基準日(${item.baseSolarDate})からの経過日数`,
                              `Days elapsed since ${item.baseSolarDate}`
                            )}
                          >
                            {item.elapsedLabel}
                          </span>
                        )}
                        {ann.is_recurring && (
                          <Repeat
                            className="w-3 h-3 text-rose-500 shrink-0 ml-auto"
                            aria-label={L('매년 반복', '毎年繰り返し', 'Yearly')}
                          />
                        )}
                        {ann.reminder_days.length > 0 && (
                          <Bell
                            className="w-3 h-3 text-amber-600 shrink-0"
                            aria-label={L('푸시 알림 설정됨', '通知設定あり', 'Push reminders enabled')}
                          />
                        )}
                      </div>

                      <div
                        className={`text-xs font-bold text-charcoal-900 leading-snug ${
                          isTrans ? 'break-words whitespace-normal' : 'truncate'
                        }`}
                      >
                        {dispTitle}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-charcoal-500">
                      <div className="flex flex-wrap items-center gap-1 min-w-0">
                        <span className="font-semibold tabular-nums text-charcoal-700">
                          {occ.solarDate}
                        </span>
                        <span
                          className={`inline-flex items-center gap-0.5 px-1 py-0.2 rounded font-bold ${
                            ann.calendar_type === 'LUNAR'
                              ? 'bg-indigo-50 text-indigo-800'
                              : 'bg-ivory-100 text-charcoal-600'
                          }`}
                        >
                          {ann.calendar_type === 'LUNAR' ? (
                            <Moon className="w-2.5 h-2.5" />
                          ) : (
                            <Sun className="w-2.5 h-2.5" />
                          )}
                          <span>{formatBaseCalendarBadge(ann, L)}</span>
                        </span>
                      </div>

                      {showTrans && (
                        <TranslateButton
                          visible={showTrans}
                          translated={isTrans}
                          loading={translator.isTranslating(transKey)}
                          error={translator.getError(transKey)}
                          onClick={(e) => {
                            e.stopPropagation();
                            void translator.toggleTranslate(
                              transKey,
                              { title: ann.title, memo: ann.memo },
                              'shared-calendar-anniversary'
                            );
                          }}
                        />
                      )}
                    </div>
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
