import React, { useMemo } from 'react';
import { Bell, Cake, Calendar, Moon, Repeat, Settings, Sun } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { SpaceAnniversary } from '../../types/spaces';
import {
  AnniversaryOccurrence,
  computeAnniversaryDDay,
  formatBaseCalendarBadge,
  formatReminderDayLabel,
} from '../../utils/anniversaryUtils';
import { Button } from '../common/Button';
import { Modal } from '../common/Modal';
import { TranslateButton } from '../common/TranslateButton';

interface AnniversaryDetailModalProps {
  isOpen: boolean;
  onClose: () => void;
  anniversary: SpaceAnniversary | null;
  focusedOccurrence?: AnniversaryOccurrence | null;
  todayStr: string;
  onJumpToDate: (ymd: string) => void;
  onOpenManage: () => void;
}

export const AnniversaryDetailModal: React.FC<AnniversaryDetailModalProps> = ({
  isOpen,
  onClose,
  anniversary,
  focusedOccurrence,
  todayStr,
  onJumpToDate,
  onOpenManage,
}) => {
  const { L } = useLanguage();
  const translator = useContentTranslation();

  const summary = useMemo(() => {
    if (!anniversary) return null;
    return computeAnniversaryDDay(anniversary, todayStr);
  }, [anniversary, todayStr]);

  if (!anniversary || !summary) return null;

  const occ = focusedOccurrence ?? summary.primaryOccurrence;
  const transKey = `anniv-detail-${anniversary.id}`;
  const isTrans = translator.isTranslated(transKey);
  const showTrans = translator.shouldShowButton(anniversary.title, anniversary.memo);
  const dispTitle = translator.getText(transKey, 'title', anniversary.title);
  const dispMemo = translator.getText(transKey, 'memo', anniversary.memo);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="lg"
      title={
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
            <Cake className="w-4 h-4" />
          </span>
          <span className="break-words">{dispTitle}</span>
        </div>
      }
    >
      <div className="space-y-4 text-xs">
        {/* D-Day Highlight Strip */}
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-rose-50 via-white to-amber-50 border border-rose-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`px-2.5 py-1 rounded-full text-xs font-extrabold tabular-nums ${
                summary.primaryDiffDays === 0
                  ? 'bg-rose-600 text-white'
                  : summary.primaryDiffDays > 0
                    ? 'bg-forest-800 text-white'
                    : 'bg-amber-600 text-white'
              }`}
            >
              {summary.primaryLabel}
            </span>
            {summary.elapsedLabel && (
              <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-950 border border-amber-200 text-xs font-bold tabular-nums">
                {L(
                  `기준일 경과 ${summary.elapsedLabel}`,
                  `基準日経過 ${summary.elapsedLabel}`,
                  `Elapsed ${summary.elapsedLabel}`
                )}
              </span>
            )}
            {occ.nthYear !== null && occ.nthYear > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-900 text-[11px] font-bold">
                {L(`${occ.nthYear}주년`, `${occ.nthYear}周年`, `Year ${occ.nthYear}`)}
              </span>
            )}
          </div>

          {showTrans && (
            <TranslateButton
              visible={showTrans}
              translated={isTrans}
              loading={translator.isTranslating(transKey)}
              error={translator.getError(transKey)}
              size="sm"
              onClick={(e) => {
                e.stopPropagation();
                void translator.toggleTranslate(
                  transKey,
                  { title: anniversary.title, memo: anniversary.memo },
                  'shared-calendar-anniversary'
                );
              }}
            />
          )}
        </div>

        {/* Date & Calendar Details */}
        <div className="p-3.5 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md font-bold ${
                anniversary.calendar_type === 'LUNAR'
                  ? 'bg-indigo-100 text-indigo-900'
                  : 'bg-white border border-ivory-300 text-charcoal-800'
              }`}
            >
              {anniversary.calendar_type === 'LUNAR' ? (
                <Moon className="w-3.5 h-3.5" />
              ) : (
                <Sun className="w-3.5 h-3.5" />
              )}
              <span>
                {anniversary.calendar_type === 'LUNAR'
                  ? L('음력 (한국 KARI 기준)', '韓国旧暦 (KARI基準)', 'Korean Lunar (KARI)')
                  : L('양력', '新暦 (太陽暦)', 'Solar Calendar')}
              </span>
            </span>

            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white border border-ivory-300 font-bold text-charcoal-700">
              {anniversary.is_recurring ? (
                <>
                  <Repeat className="w-3.5 h-3.5 text-rose-600" />
                  <span>{L('매년 반복', '毎年繰り返し', 'Repeats yearly')}</span>
                </>
              ) : (
                <>
                  <Calendar className="w-3.5 h-3.5 text-charcoal-600" />
                  <span>{L('1회 기념일', '1回のみ', 'One-time')}</span>
                </>
              )}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px]">
            <div className="p-2 rounded-lg bg-white border border-ivory-200">
              <div className="text-charcoal-400 font-bold">
                {L('등록 기준일', '登録基準日', 'Registered Base Date')}
              </div>
              <div className="font-bold text-charcoal-900 mt-0.5 tabular-nums">
                {anniversary.base_date} ({formatBaseCalendarBadge(anniversary, L)})
              </div>
            </div>

            <div className="p-2 rounded-lg bg-white border border-ivory-200">
              <div className="text-charcoal-400 font-bold">
                {focusedOccurrence
                  ? L('선택 연도 양력 표시일', '該当年の新暦表示日', 'Solar Date (Selected Year)')
                  : anniversary.is_recurring
                    ? L('다음 양력 표시일', '次回の新暦表示日', 'Next Solar Occurrence')
                    : L('양력 표시일', '新暦表示日', 'Solar Date')}
              </div>
              <div className="font-bold text-forest-900 mt-0.5 tabular-nums">{occ.solarDate}</div>
            </div>
          </div>

          {(occ.adjustedFromLeapToNormal || occ.adjustedFrom30To29 || occ.adjustedFromSolarFeb29To28) && (
            <div className="p-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] font-medium space-y-0.5">
              {occ.adjustedFromLeapToNormal && (
                <div>
                  ⚠️{' '}
                  {L(
                    '해당 연도에 같은 윤달이 없어 평달 같은 월·일로 보정되어 표시됩니다.',
                    '該当年に同じ閏月がないため、平月の同月日に補正して表示されています。',
                    'No matching leap month in this year; adjusted to the normal lunar month.'
                  )}
                </div>
              )}
              {occ.adjustedFrom30To29 && (
                <div>
                  ⚠️{' '}
                  {L(
                    '해당 연도 음력 월이 29일까지인 작은달이라 29일로 보정되어 표시됩니다.',
                    '該当年の旧暦月は29日までの小の月のため、29日に補正して表示されています。',
                    'This lunar month has 29 days in this year; adjusted from day 30 to day 29.'
                  )}
                </div>
              )}
              {occ.adjustedFromSolarFeb29To28 && (
                <div>
                  ⚠️{' '}
                  {L(
                    '평년(2월 28일까지)이라 2월 28일로 보정되어 표시됩니다.',
                    '平年（2月28日まで）のため、2月28日に補正して表示されています。',
                    'Non-leap year; adjusted from Feb 29 to Feb 28.'
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Reminders */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 font-bold text-charcoal-700 mr-1">
            <Bell className="w-3.5 h-3.5 text-rose-600" />
            {L('푸시 알림:', 'プッシュ通知:', 'Push reminders:')}
          </span>
          {anniversary.reminder_days.length === 0 ? (
            <span className="text-charcoal-400">{L('없음', 'なし', 'None')}</span>
          ) : (
            anniversary.reminder_days.map((d) => (
              <span
                key={d}
                className="px-2 py-0.5 rounded-full bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-bold"
              >
                {formatReminderDayLabel(d, L)}
              </span>
            ))
          )}
        </div>

        {/* Memo */}
        {anniversary.memo && (
          <div className="p-3 rounded-xl bg-white border border-ivory-200 space-y-1">
            <div className="text-[11px] font-bold text-charcoal-500">
              {L('메모', 'メモ', 'Memo')}
            </div>
            <p className="text-xs text-charcoal-800 whitespace-pre-wrap break-words leading-relaxed">
              {dispMemo}
            </p>
          </div>
        )}

        {/* Creator meta */}
        {anniversary.creator_name && (
          <div className="text-[11px] text-charcoal-400">
            {L(
              `등록자: ${anniversary.creator_name}`,
              `登録者: ${anniversary.creator_name}`,
              `Added by: ${anniversary.creator_name}`
            )}
          </div>
        )}

        {/* Footer Actions */}
        <div className="pt-2 border-t border-ivory-200 flex flex-wrap items-center justify-between gap-2">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              onClose();
              onOpenManage();
            }}
          >
            <Settings className="w-3.5 h-3.5 mr-1" />
            {L('기념일 수정 · 관리', '記念日の編集・管理', 'Edit / Manage')}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                onJumpToDate(occ.solarDate);
                onClose();
              }}
            >
              <Calendar className="w-3.5 h-3.5 mr-1" />
              {L('달력에서 보기', 'カレンダーで見る', 'Jump to Date')}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              {L('닫기', '閉じる', 'Close')}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
};
