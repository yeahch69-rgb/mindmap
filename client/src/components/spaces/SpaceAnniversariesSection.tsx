import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  Cake,
  Calendar,
  Check,
  Edit2,
  Moon,
  Plus,
  Repeat,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { AnniversaryCalendarType, SpaceAnniversary } from '../../types/spaces';
import {
  ANNIVERSARY_REMINDER_OPTIONS,
  computeAnniversaryDDay,
  formatBaseCalendarBadge,
  formatReminderDayLabel,
  formatYmdParts,
  hasKoreanLunarLeapMonth,
  KARI_MAX_LUNAR_YEAR,
  KARI_MIN_LUNAR_YEAR,
  parseYmdStrict,
  resolveKoreanLunarToSolar,
  sortAnniversaryDDays,
} from '../../utils/anniversaryUtils';
import { getJstTodayStr } from '../../utils/dateTime';
import { Button } from '../common/Button';
import { TranslateButton } from '../common/TranslateButton';

interface SpaceAnniversariesSectionProps {
  spaceId: number;
  isOpen: boolean;
  onChanged: () => Promise<void> | void;
}

export const SpaceAnniversariesSection: React.FC<SpaceAnniversariesSectionProps> = ({
  spaceId,
  isOpen,
  onChanged,
}) => {
  const { L } = useLanguage();
  const translator = useContentTranslation();
  const todayStr = useMemo(() => getJstTodayStr(), []);
  const todayParts = useMemo(() => parseYmdStrict(todayStr) || { year: 2026, month: 1, day: 1 }, [todayStr]);

  const [anniversaries, setAnniversaries] = useState<SpaceAnniversary[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Form state (closed by default unless user clicks "+ 추가" or edits an item)
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [calendarType, setCalendarType] = useState<AnniversaryCalendarType>('SOLAR');
  const [baseDate, setBaseDate] = useState(todayStr);
  const [lunarYear, setLunarYear] = useState(todayParts.year);
  const [lunarMonth, setLunarMonth] = useState(todayParts.month);
  const [lunarDay, setLunarDay] = useState(Math.min(30, todayParts.day));
  const [isLeapMonth, setIsLeapMonth] = useState(false);
  const [isRecurring, setIsRecurring] = useState(true);
  const [reminderDays, setReminderDays] = useState<number[]>([0]);

  // Inline delete confirmation (no native window.confirm!)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  const loadAnniversaries = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get<{ anniversaries: SpaceAnniversary[] }>(`/spaces/${spaceId}/anniversaries`);
      setAnniversaries(res.anniversaries || []);
    } catch (err: any) {
      setErrorMsg(
        err?.message || L('기념일 목록을 불러오지 못했습니다.', '記念日一覧の読み込みに失敗しました。', 'Failed to load anniversaries.')
      );
    } finally {
      setLoading(false);
    }
  }, [spaceId, L]);

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setFeedbackMsg('');
    setFormOpen(false);
    setEditingId(null);
    setConfirmDeleteId(null);
    void loadAnniversaries();
  }, [isOpen, spaceId, loadAnniversaries]);

  const sortedSummaries = useMemo(() => {
    const computed = anniversaries
      .map((ann) => computeAnniversaryDDay(ann, todayStr))
      .filter((item): item is NonNullable<typeof item> => item !== null);
    return sortAnniversaryDDays(computed);
  }, [anniversaries, todayStr]);

  const openCreateForm = () => {
    setErrorMsg('');
    setFeedbackMsg('');
    setEditingId(null);
    setTitle('');
    setMemo('');
    setCalendarType('SOLAR');
    setBaseDate(todayStr);
    setLunarYear(todayParts.year);
    setLunarMonth(todayParts.month);
    setLunarDay(Math.min(30, todayParts.day));
    setIsLeapMonth(false);
    setIsRecurring(true);
    setReminderDays([0]);
    setFormOpen(true);
  };

  const openEditForm = (ann: SpaceAnniversary) => {
    setErrorMsg('');
    setFeedbackMsg('');
    setEditingId(ann.id);
    setTitle(ann.title);
    setMemo(ann.memo || '');
    setCalendarType(ann.calendar_type);
    setBaseDate(ann.base_date);
    const parsed = parseYmdStrict(ann.base_date) || todayParts;
    setLunarYear(Math.min(KARI_MAX_LUNAR_YEAR, Math.max(KARI_MIN_LUNAR_YEAR, parsed.year)));
    setLunarMonth(Math.min(12, Math.max(1, parsed.month)));
    setLunarDay(Math.min(30, Math.max(1, parsed.day)));
    setIsLeapMonth(ann.calendar_type === 'LUNAR' ? ann.is_leap_month : false);
    setIsRecurring(ann.is_recurring);
    setReminderDays([...ann.reminder_days]);
    setFormOpen(true);
  };

  const handleCalendarTypeSwitch = (nextType: AnniversaryCalendarType) => {
    if (nextType === calendarType) return;
    setCalendarType(nextType);
    if (nextType === 'LUNAR') {
      const p = parseYmdStrict(baseDate) || todayParts;
      const clampedYear = Math.min(KARI_MAX_LUNAR_YEAR, Math.max(KARI_MIN_LUNAR_YEAR, p.year));
      const clampedDay = Math.min(30, Math.max(1, p.day));
      setLunarYear(clampedYear);
      setLunarMonth(p.month);
      setLunarDay(clampedDay);
      setBaseDate(formatYmdParts(clampedYear, p.month, clampedDay));
    } else {
      setIsLeapMonth(false);
      // Clamp day to valid Gregorian month day
      const lastSolarDay = new Date(Date.UTC(lunarYear, lunarMonth, 0)).getUTCDate();
      setBaseDate(formatYmdParts(lunarYear, lunarMonth, Math.min(lunarDay, lastSolarDay)));
    }
  };

  const toggleReminderDay = (day: number) => {
    setReminderDays((prev) => {
      if (prev.includes(day)) {
        return prev.filter((d) => d !== day);
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  };

  const effectiveBaseDate = useMemo(() => {
    if (calendarType === 'SOLAR') return baseDate;
    return formatYmdParts(lunarYear, lunarMonth, lunarDay);
  }, [calendarType, baseDate, lunarYear, lunarMonth, lunarDay]);

  const lunarPreview = useMemo(() => {
    if (calendarType !== 'LUNAR') return null;
    const resolved = resolveKoreanLunarToSolar(lunarYear, lunarMonth, lunarDay, isLeapMonth);
    const yearHasLeapForMonth = hasKoreanLunarLeapMonth(lunarYear, lunarMonth);
    return { resolved, yearHasLeapForMonth };
  }, [calendarType, lunarYear, lunarMonth, lunarDay, isLeapMonth]);

  const formDDayPreview = useMemo(() => {
    const tempAnn: SpaceAnniversary = {
      id: editingId ?? -1,
      space_id: spaceId,
      title: title || 'Preview',
      memo,
      calendar_type: calendarType,
      base_date: effectiveBaseDate,
      is_leap_month: calendarType === 'LUNAR' ? isLeapMonth : false,
      is_recurring: isRecurring,
      reminder_days: reminderDays,
      created_by: 0,
      creator_name: '',
      updated_by: null,
      created_at: '',
      updated_at: '',
    };
    return computeAnniversaryDDay(tempAnn, todayStr);
  }, [editingId, spaceId, title, memo, calendarType, effectiveBaseDate, isLeapMonth, isRecurring, reminderDays, todayStr]);

  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');
    setFeedbackMsg('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setErrorMsg(L('기념일 제목을 입력해 주세요.', '記念日のタイトルを入力してください。', 'Please enter an anniversary title.'));
      return;
    }

    if (calendarType === 'LUNAR') {
      if (lunarYear < KARI_MIN_LUNAR_YEAR || lunarYear > KARI_MAX_LUNAR_YEAR) {
        setErrorMsg(
          L(
            `한국 음력 연도는 ${KARI_MIN_LUNAR_YEAR}~${KARI_MAX_LUNAR_YEAR}년 범위만 지원합니다.`,
            `韓国旧暦の年は ${KARI_MIN_LUNAR_YEAR}〜${KARI_MAX_LUNAR_YEAR}年の範囲に対応しています。`,
            `Korean lunar years must be between ${KARI_MIN_LUNAR_YEAR} and ${KARI_MAX_LUNAR_YEAR}.`
          )
        );
        return;
      }
      if (!lunarPreview?.resolved) {
        setErrorMsg(L('해당 음력 날짜를 양력으로 변환할 수 없습니다.', 'この旧暦日付は変換できません。', 'Unable to convert this lunar date.'));
        return;
      }
    }

    const payload = {
      title: trimmedTitle,
      memo: memo.trim(),
      calendar_type: calendarType,
      base_date: effectiveBaseDate,
      is_leap_month: calendarType === 'LUNAR' ? isLeapMonth : false,
      is_recurring: isRecurring,
      reminder_days: reminderDays,
    };

    try {
      setSaving(true);
      if (editingId !== null) {
        await api.patch(`/spaces/${spaceId}/anniversaries/${editingId}`, payload);
        setFeedbackMsg(L('기념일을 수정했습니다.', '記念日を更新しました。', 'Anniversary updated.'));
      } else {
        await api.post(`/spaces/${spaceId}/anniversaries`, payload);
        setFeedbackMsg(L('기념일을 등록했습니다.', '記念日を登録しました。', 'Anniversary added.'));
      }
      setFormOpen(false);
      setEditingId(null);
      await loadAnniversaries();
      await onChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || L('기념일 저장에 실패했습니다.', '記念日の保存に失敗しました。', 'Failed to save anniversary.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (annId: number) => {
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      setSaving(true);
      await api.delete(`/spaces/${spaceId}/anniversaries/${annId}`);
      setConfirmDeleteId(null);
      if (editingId === annId) {
        setFormOpen(false);
        setEditingId(null);
      }
      setFeedbackMsg(L('기념일을 삭제했습니다.', '記念日を削除しました。', 'Anniversary deleted.'));
      await loadAnniversaries();
      await onChanged();
    } catch (err: any) {
      setErrorMsg(err?.message || L('기념일 삭제에 실패했습니다.', '記念日の削除に失敗しました。', 'Failed to delete anniversary.'));
    } finally {
      setSaving(false);
    }
  };

  const editPreviewKey = editingId !== null ? `anniv-edit-preview-${editingId}` : 'anniv-new-preview';
  const showEditPreviewTrans = translator.shouldShowButton(title, memo);
  const isEditPreviewTranslated = translator.isTranslated(editPreviewKey);

  return (
    <div id="space-settings-anniversaries" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Cake className="w-4 h-4 text-rose-600 shrink-0" />
          <span className="text-xs font-bold text-charcoal-900">
            {L(
              `공유 캘린더 기념일 & D-Day (${anniversaries.length})`,
              `共有カレンダー記念日・D-Day (${anniversaries.length})`,
              `Shared Calendar Anniversaries & D-Day (${anniversaries.length})`
            )}
          </span>
        </div>
        {!formOpen && (
          <Button type="button" size="sm" onClick={openCreateForm}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            {L('기념일 추가', '記念日を追加', 'Add Anniversary')}
          </Button>
        )}
      </div>

      <p className="text-[11px] text-charcoal-500">
        {L(
          '양력·한국 음력(KARI 기준) 기념일을 스페이스 멤버 누구나 등록·수정·삭제할 수 있습니다. 캘린더 날짜 셀과 상단 D-Day 바에 자동 표시됩니다.',
          '新暦・韓国旧暦(KARI基準)の記念日をメンバー全員で登録・編集・削除できます。カレンダーと上部のD-Dayバーに自動表示されます。',
          'Any space member can add, edit, or delete Solar & Korean Lunar (KARI) anniversaries. They appear on calendar cells and the top D-Day bar.'
        )}
      </p>

      {errorMsg && (
        <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
          {errorMsg}
        </div>
      )}
      {feedbackMsg && (
        <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
          {feedbackMsg}
        </div>
      )}

      {/* Add / Edit Anniversary Form */}
      {formOpen && (
        <form
          onSubmit={handleSubmitForm}
          className="p-3.5 rounded-xl bg-rose-50/50 border border-rose-200 space-y-3"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-bold text-rose-950">
              {editingId !== null
                ? L('기념일 수정', '記念日を編集', 'Edit Anniversary')
                : L('새 기념일 등록', '新しい記念日を登録', 'New Anniversary')}
            </span>
            <div className="flex items-center gap-1.5">
              {showEditPreviewTrans && (
                <TranslateButton
                  visible={showEditPreviewTrans}
                  translated={isEditPreviewTranslated}
                  loading={translator.isTranslating(editPreviewKey)}
                  error={translator.getError(editPreviewKey)}
                  onClick={(e) => {
                    e.stopPropagation();
                    void translator.toggleTranslate(
                      editPreviewKey,
                      { title, memo },
                      'shared-calendar-anniversary'
                    );
                  }}
                />
              )}
              <button
                type="button"
                onClick={() => {
                  setFormOpen(false);
                  setEditingId(null);
                }}
                className="p-1 rounded-lg text-charcoal-500 hover:bg-white transition"
                aria-label={L('닫기', '閉じる', 'Close')}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Non-destructive translation preview inside edit form */}
          {isEditPreviewTranslated && (
            <div className="p-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-xs space-y-1">
              <div className="text-[10px] font-bold text-emerald-800">
                {L('번역 미리보기 (원문 입력값은 변경되지 않습니다)', '翻訳プレビュー（原文入力は変更されません）', 'Translation Preview (original inputs unchanged)')}
              </div>
              {title.trim() && (
                <div className="font-bold text-charcoal-900 break-words">
                  {translator.getText(editPreviewKey, 'title', title)}
                </div>
              )}
              {memo.trim() && (
                <div className="text-[11px] text-charcoal-700 whitespace-pre-wrap break-words">
                  {translator.getText(editPreviewKey, 'memo', memo)}
                </div>
              )}
            </div>
          )}

          {/* Title */}
          <div>
            <label className="block text-[11px] font-bold text-charcoal-700 mb-1">
              {L('기념일 제목', '記念日タイトル', 'Title')} *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder={L('예: 엄마 생신, 결혼기념일, 창립일', '例：母の誕生日、結婚記念日', 'e.g. Mom’s Birthday, Wedding Anniversary')}
              className="w-full px-3 py-2 text-xs rounded-lg border border-ivory-300 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
            />
          </div>

          {/* Calendar Type (Solar vs Korean Lunar) & Recurring Toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-charcoal-700 mb-1">
                {L('달력 기준', '暦の種類', 'Calendar System')}
              </label>
              <div className="grid grid-cols-2 gap-1 bg-white p-1 rounded-lg border border-ivory-300">
                <button
                  type="button"
                  onClick={() => handleCalendarTypeSwitch('SOLAR')}
                  className={`inline-flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-bold transition ${
                    calendarType === 'SOLAR'
                      ? 'bg-forest-800 text-white shadow-2xs'
                      : 'text-charcoal-600 hover:bg-ivory-100'
                  }`}
                >
                  <Sun className="w-3.5 h-3.5" />
                  <span>{L('양력', '新暦', 'Solar')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCalendarTypeSwitch('LUNAR')}
                  className={`inline-flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-bold transition ${
                    calendarType === 'LUNAR'
                      ? 'bg-indigo-700 text-white shadow-2xs'
                      : 'text-charcoal-600 hover:bg-ivory-100'
                  }`}
                >
                  <Moon className="w-3.5 h-3.5" />
                  <span>{L('음력 (한국)', '韓国旧暦', 'Korean Lunar')}</span>
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-bold text-charcoal-700 mb-1">
                {L('반복 설정', '繰り返し', 'Recurrence')}
              </label>
              <div className="grid grid-cols-2 gap-1 bg-white p-1 rounded-lg border border-ivory-300">
                <button
                  type="button"
                  onClick={() => setIsRecurring(true)}
                  className={`inline-flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-bold transition ${
                    isRecurring
                      ? 'bg-rose-600 text-white shadow-2xs'
                      : 'text-charcoal-600 hover:bg-ivory-100'
                  }`}
                >
                  <Repeat className="w-3.5 h-3.5" />
                  <span>{L('매년 반복', '毎年繰り返し', 'Yearly')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setIsRecurring(false)}
                  className={`inline-flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-bold transition ${
                    !isRecurring
                      ? 'bg-charcoal-800 text-white shadow-2xs'
                      : 'text-charcoal-600 hover:bg-ivory-100'
                  }`}
                >
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{L('1회 (반복 없음)', '1回のみ', 'One-time')}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Base Date Input */}
          <div>
            <label className="block text-[11px] font-bold text-charcoal-700 mb-1">
              {calendarType === 'LUNAR'
                ? L('기준 음력 날짜 (한국 천문연구원 KARI 기준)', '基準旧暦日付（韓国天文研究院 KARI基準）', 'Base Korean Lunar Date (KARI)')
                : L('기준 날짜 (양력)', '基準日付（新暦）', 'Base Solar Date')} *
            </label>

            {calendarType === 'SOLAR' ? (
              <input
                type="date"
                value={baseDate}
                onChange={(e) => setBaseDate(e.target.value)}
                className="w-full sm:w-56 px-3 py-2 text-xs rounded-lg border border-ivory-300 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={KARI_MIN_LUNAR_YEAR}
                      max={KARI_MAX_LUNAR_YEAR}
                      value={lunarYear}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        if (Number.isFinite(v)) setLunarYear(v);
                      }}
                      className="w-24 px-2.5 py-2 text-xs rounded-lg border border-ivory-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                      aria-label={L('음력 연도', '旧暦年', 'Lunar year')}
                    />
                    <span className="text-xs font-bold text-charcoal-600">{L('년', '年', 'Y')}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <select
                      value={lunarMonth}
                      onChange={(e) => setLunarMonth(Number(e.target.value))}
                      className="px-2.5 py-2 text-xs rounded-lg border border-ivory-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                      aria-label={L('음력 월', '旧暦月', 'Lunar month')}
                    >
                      {Array.from({ length: 12 }, (_, idx) => idx + 1).map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs font-bold text-charcoal-600">{L('월', '月', 'M')}</span>
                  </div>

                  <div className="flex items-center gap-1">
                    <select
                      value={lunarDay}
                      onChange={(e) => setLunarDay(Number(e.target.value))}
                      className="px-2.5 py-2 text-xs rounded-lg border border-ivory-300 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 tabular-nums"
                      aria-label={L('음력 일', '旧暦日', 'Lunar day')}
                    >
                      {Array.from({ length: 30 }, (_, idx) => idx + 1).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <span className="text-xs font-bold text-charcoal-600">{L('일', '日', 'D')}</span>
                  </div>

                  <label className="inline-flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-white border border-indigo-200 text-xs font-bold text-indigo-900 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={isLeapMonth}
                      onChange={(e) => setIsLeapMonth(e.target.checked)}
                      className="rounded accent-indigo-700"
                    />
                    <span>{L('윤달', '閏月', 'Leap month')}</span>
                  </label>
                </div>

                {/* Live KARI Lunar -> Solar Preview */}
                {lunarPreview?.resolved ? (
                  <div className="px-2.5 py-1.5 rounded-lg bg-indigo-50 border border-indigo-200 text-[11px] text-indigo-950 space-y-0.5">
                    <div className="font-bold">
                      {L(
                        `양력 환산 기준일: ${lunarPreview.resolved.solarDate}`,
                        `新暦換算基準日: ${lunarPreview.resolved.solarDate}`,
                        `Converted Solar base date: ${lunarPreview.resolved.solarDate}`
                      )}
                    </div>
                    {lunarPreview.resolved.adjustedFromLeapToNormal && (
                      <div className="text-amber-800 font-medium">
                        ⚠️{' '}
                        {L(
                          `${lunarYear}년 음력 ${lunarMonth}월은 윤달이 없어 평달(${lunarMonth}월 ${lunarPreview.resolved.lunarDay}일)로 보정됩니다.`,
                          `${lunarYear}年旧暦${lunarMonth}月には閏月がないため、平月(${lunarMonth}/${lunarPreview.resolved.lunarDay})に補正されます。`,
                          `No leap month ${lunarMonth} in ${lunarYear}; adjusted to normal month (${lunarMonth}/${lunarPreview.resolved.lunarDay}).`
                        )}
                      </div>
                    )}
                    {lunarPreview.resolved.adjustedFrom30To29 && (
                      <div className="text-amber-800 font-medium">
                        ⚠️{' '}
                        {L(
                          `${lunarYear}년 음력 ${lunarMonth}월은 29일까지인 작은달이라 29일로 보정됩니다.`,
                          `${lunarYear}年旧暦${lunarMonth}月は29日までの小の月のため、29日に補正されます。`,
                          `Lunar month ${lunarMonth} in ${lunarYear} has 29 days; adjusted to day 29.`
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 font-medium">
                    {L(
                      `지원 범위(${KARI_MIN_LUNAR_YEAR}~${KARI_MAX_LUNAR_YEAR}년) 내의 음력 날짜를 입력해 주세요.`,
                      `対応範囲(${KARI_MIN_LUNAR_YEAR}〜${KARI_MAX_LUNAR_YEAR}年)の旧暦日付を入力してください。`,
                      `Enter a lunar year within ${KARI_MIN_LUNAR_YEAR}–${KARI_MAX_LUNAR_YEAR}.`
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Live D-Day Preview */}
            {formDDayPreview && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px] text-charcoal-600">
                <span className="px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 font-bold">
                  {formDDayPreview.primaryLabel}
                </span>
                {formDDayPreview.elapsedLabel && (
                  <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 font-bold">
                    {L(`기준일 경과 ${formDDayPreview.elapsedLabel}`, `基準日から ${formDDayPreview.elapsedLabel}`, `Elapsed ${formDDayPreview.elapsedLabel}`)}
                  </span>
                )}
                <span>
                  {isRecurring
                    ? L(
                        `다음 표시일: ${formDDayPreview.primaryOccurrence.solarDate}`,
                        `次回表示日: ${formDDayPreview.primaryOccurrence.solarDate}`,
                        `Next date: ${formDDayPreview.primaryOccurrence.solarDate}`
                      )
                    : L(
                        `표시일: ${formDDayPreview.primaryOccurrence.solarDate}`,
                        `表示日: ${formDDayPreview.primaryOccurrence.solarDate}`,
                        `Date: ${formDDayPreview.primaryOccurrence.solarDate}`
                      )}
                </span>
              </div>
            )}
          </div>

          {/* Memo */}
          <div>
            <label className="block text-[11px] font-bold text-charcoal-700 mb-1">
              {L('메모 (선택)', 'メモ（任意）', 'Memo (optional)')}
            </label>
            <textarea
              rows={2}
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              maxLength={1000}
              placeholder={L('선물 아이디어, 축하 메모 등을 적어보세요', 'プレゼント案やメモを入力', 'Add optional notes or gift ideas')}
              className="w-full px-3 py-2 text-xs rounded-lg border border-ivory-300 bg-white focus:outline-none focus:ring-2 focus:ring-rose-500 resize-y"
            />
          </div>

          {/* Push Reminder Selector */}
          <div className="space-y-1.5">
            <label className="flex items-center gap-1.5 text-[11px] font-bold text-charcoal-700">
              <Bell className="w-3.5 h-3.5 text-rose-600" />
              <span>{L('웹 푸시 알림 시점 (복수 선택 가능 · JST 오전 9시 이후 발송)', 'Webプッシュ通知タイミング（複数選択可・JST 9時以降）', 'Web Push Reminders (multi-select · sent after 09:00 JST)')}</span>
            </label>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setReminderDays([])}
                className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
                  reminderDays.length === 0
                    ? 'bg-charcoal-800 text-white border-charcoal-800'
                    : 'bg-white text-charcoal-600 border-ivory-300 hover:bg-ivory-100'
                }`}
              >
                {L('없음', 'なし', 'None')}
              </button>
              {ANNIVERSARY_REMINDER_OPTIONS.map((day) => {
                const active = reminderDays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => toggleReminderDay(day)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
                      active
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-rose-50 hover:border-rose-300'
                    }`}
                  >
                    {active && <Check className="w-3 h-3" />}
                    <span>{formatReminderDayLabel(day, L)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => {
                setFormOpen(false);
                setEditingId(null);
              }}
            >
              {L('취소', 'キャンセル', 'Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={saving}>
              <Check className="w-3.5 h-3.5 mr-1" />
              {editingId !== null
                ? L('기념일 수정 저장', '更新を保存', 'Save Update')
                : L('기념일 등록', '登録する', 'Add Anniversary')}
            </Button>
          </div>
        </form>
      )}

      {/* Anniversaries List */}
      {loading ? (
        <div className="py-6 text-center text-xs text-charcoal-500">
          {L('기념일을 불러오는 중...', '記念日を読み込み中...', 'Loading anniversaries...')}
        </div>
      ) : sortedSummaries.length === 0 ? (
        <div className="py-5 px-3 rounded-xl bg-ivory-50 border border-dashed border-ivory-300 text-center text-xs text-charcoal-500">
          {L(
            '등록된 기념일이 아직 없습니다. 생일·결혼기념일·중요 기준일을 추가해 보세요.',
            '登録された記念日はありません。誕生日や大切な記念日を追加してみましょう。',
            'No anniversaries yet. Add birthdays, wedding dates, or milestones.'
          )}
        </div>
      ) : (
        <div className="divide-y divide-ivory-200 border border-ivory-200 rounded-xl overflow-hidden bg-white">
          {sortedSummaries.map((item) => {
            const ann = item.anniversary;
            const occ = item.primaryOccurrence;
            const transKey = `space-settings-anniv-${ann.id}`;
            const isTrans = translator.isTranslated(transKey);
            const showTrans = translator.shouldShowButton(ann.title, ann.memo);
            const dispTitle = translator.getText(transKey, 'title', ann.title);
            const dispMemo = translator.getText(transKey, 'memo', ann.memo);

            return (
              <div key={ann.id} className="px-3 py-2.5 flex items-start justify-between gap-2.5 text-xs">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                        item.primaryDiffDays === 0
                          ? 'bg-rose-600 text-white'
                          : item.primaryDiffDays > 0
                            ? 'bg-forest-100 text-forest-900'
                            : 'bg-amber-100 text-amber-900'
                      }`}
                    >
                      {item.primaryLabel}
                    </span>
                    {item.elapsedLabel && (
                      <span className="px-1.5 py-0.5 rounded-full bg-amber-50 border border-amber-200 text-amber-900 text-[10px] font-bold shrink-0">
                        {item.elapsedLabel}
                      </span>
                    )}
                    <span className={`font-bold text-charcoal-900 ${isTrans ? 'break-words' : 'truncate'}`}>
                      {dispTitle}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-charcoal-500">
                    <span
                      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                        ann.calendar_type === 'LUNAR'
                          ? 'bg-indigo-50 text-indigo-800 border border-indigo-200'
                          : 'bg-ivory-100 text-charcoal-700 border border-ivory-200'
                      }`}
                    >
                      {ann.calendar_type === 'LUNAR' ? <Moon className="w-2.5 h-2.5" /> : <Sun className="w-2.5 h-2.5" />}
                      <span>{formatBaseCalendarBadge(ann, L)}</span>
                    </span>
                    <span className="tabular-nums">
                      {L(`기준 ${ann.base_date}`, `基準 ${ann.base_date}`, `Base ${ann.base_date}`)}
                    </span>
                    {ann.calendar_type === 'LUNAR' && (
                      <span className="tabular-nums text-indigo-700 font-medium">
                        → {occ.solarDate}
                        {(occ.adjustedFromLeapToNormal || occ.adjustedFrom30To29) && (
                          <span className="ml-1 text-amber-700">
                            (
                            {[
                              occ.adjustedFromLeapToNormal ? L('평달 보정', '平月補正', 'normal mo.') : '',
                              occ.adjustedFrom30To29 ? L('29일 보정', '29日補正', 'day 29') : '',
                            ]
                              .filter(Boolean)
                              .join(' · ')}
                            )
                          </span>
                        )}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-ivory-100 text-charcoal-600 text-[10px] font-bold">
                      {ann.is_recurring ? L('매년 반복', '毎年', 'Yearly') : L('1회', '1回', 'Once')}
                    </span>
                    {ann.reminder_days.length > 0 && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.5 rounded">
                        <Bell className="w-2.5 h-2.5" />
                        {ann.reminder_days.map((d) => formatReminderDayLabel(d, L)).join(' · ')}
                      </span>
                    )}
                  </div>

                  {ann.memo && (
                    <p
                      className={`text-[11px] text-charcoal-600 whitespace-pre-wrap break-words ${
                        isTrans ? '' : 'line-clamp-2'
                      }`}
                    >
                      {dispMemo}
                    </p>
                  )}

                  {showTrans && (
                    <div className="pt-0.5">
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
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {confirmDeleteId === ann.id ? (
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleDelete(ann.id)}
                        className="px-2 py-1 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold transition disabled:opacity-50"
                      >
                        {L('삭제 확인', '削除する', 'Confirm')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(null)}
                        className="px-2 py-1 rounded-lg bg-ivory-100 hover:bg-ivory-200 text-charcoal-700 text-[10px] font-bold transition"
                      >
                        {L('취소', 'キャンセル', 'Cancel')}
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => openEditForm(ann)}
                        className="p-1.5 rounded-lg text-charcoal-500 hover:text-forest-800 hover:bg-ivory-100 transition"
                        title={L('수정', '編集', 'Edit')}
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDeleteId(ann.id)}
                        className="p-1.5 rounded-lg text-charcoal-400 hover:text-rose-700 hover:bg-rose-50 transition"
                        title={L('삭제', '削除', 'Delete')}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
