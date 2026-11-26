import React, { useEffect, useState } from 'react';
import { Bell, Calendar, Clock, Link2, MapPin, Repeat, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  CalendarEventItem,
  CollabSpace,
  EventStatus,
  RecurrenceType,
} from '../../types/spaces';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { TranslateButton } from '../common/TranslateButton';
import { useContentTranslation } from '../../hooks/useContentTranslation';
import { EventColorControls } from './EventColorControls';
import { SpaceMemberPicker } from '../spaces/SpaceMemberPicker';

interface EventEditorModalProps {
  isOpen: boolean;
  onClose: () => void;
  space: CollabSpace;
  initialDate: string;
  editingEvent?: CalendarEventItem | null;
  onSaved: (event: CalendarEventItem) => void;
}

export const EventEditorModal: React.FC<EventEditorModalProps> = ({
  isOpen,
  onClose,
  space,
  initialDate,
  editingEvent,
  onSaved,
}) => {
  const { user } = useAuth();
  const { L } = useLanguage();
  const translator = useContentTranslation();

  const defaultLabel = space.labels[0] || { key: 'emerald', color: '#1B4D3E', name: '기본 일정' };

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(initialDate);
  const [endDate, setEndDate] = useState(initialDate);
  const [isAllDay, setIsAllDay] = useState(true);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [labelKey, setLabelKey] = useState(defaultLabel.key);
  const [color, setColor] = useState(defaultLabel.color);
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [location, setLocation] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [attendeeIds, setAttendeeIds] = useState<number[]>([]);
  const [recurrenceType, setRecurrenceType] = useState<RecurrenceType>('NONE');
  const [recurrenceUntil, setRecurrenceUntil] = useState('');
  const [reminderMinutes, setReminderMinutes] = useState<string>('');
  const [eventStatus, setEventStatus] = useState<EventStatus>('CONFIRMED');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    if (editingEvent) {
      setTitle(editingEvent.title);
      setStartDate(editingEvent.start_date);
      setEndDate(editingEvent.end_date);
      setIsAllDay(editingEvent.is_all_day);
      setStartTime(editingEvent.start_time || '10:00');
      setEndTime(editingEvent.end_time || '11:00');
      setLabelKey(editingEvent.label_key || defaultLabel.key);
      setColor(editingEvent.color || defaultLabel.color);
      setTextColor(editingEvent.text_color || '#FFFFFF');
      setLocation(editingEvent.location || '');
      setUrl(editingEvent.url || '');
      setDescription(editingEvent.description || '');
      setAttendeeIds(editingEvent.attendee_ids || []);
      setRecurrenceType(editingEvent.recurrence_type || 'NONE');
      setRecurrenceUntil(editingEvent.recurrence_until || '');
      setReminderMinutes(
        editingEvent.reminder_minutes !== null && editingEvent.reminder_minutes !== undefined
          ? String(editingEvent.reminder_minutes)
          : ''
      );
      setEventStatus(editingEvent.event_status || 'CONFIRMED');
    } else {
      setTitle('');
      setStartDate(initialDate);
      setEndDate(initialDate);
      setIsAllDay(true);
      setStartTime('10:00');
      setEndTime('11:00');
      setLabelKey(defaultLabel.key);
      setColor(defaultLabel.color);
      setTextColor('#FFFFFF');
      setLocation('');
      setUrl('');
      setDescription('');
      setAttendeeIds(space.members.map((m) => m.user_id));
      setRecurrenceType('NONE');
      setRecurrenceUntil('');
      setReminderMinutes('30');
      setEventStatus('CONFIRMED');
    }
  }, [isOpen, editingEvent, initialDate, space.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(L('일정 제목을 입력해 주세요.', '予定タイトルを入力してください。', 'Please enter a title.'));
      return;
    }
    setError('');
    try {
      setSaving(true);
      const payload = {
        title: title.trim(),
        start_date: startDate,
        end_date: endDate < startDate ? startDate : endDate,
        is_all_day: isAllDay,
        start_time: isAllDay ? null : startTime,
        end_time: isAllDay ? null : endTime,
        label_key: labelKey,
        color,
        text_color: textColor,
        location: location.trim(),
        url: url.trim(),
        description: description.trim(),
        attendee_ids: attendeeIds,
        recurrence_type: recurrenceType,
        recurrence_until: recurrenceType !== 'NONE' && recurrenceUntil ? recurrenceUntil : null,
        reminder_minutes: reminderMinutes === '' ? null : Number(reminderMinutes),
        event_status: eventStatus,
      };

      if (editingEvent) {
        const res = await api.patch<{ event: CalendarEventItem }>(
          `/spaces/${space.id}/events/${editingEvent.id}`,
          payload
        );
        onSaved(res.event);
      } else {
        const res = await api.post<{ event: CalendarEventItem }>(`/spaces/${space.id}/events`, payload);
        onSaved(res.event);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || L('저장에 실패했습니다.', '保存に失敗しました。', 'Failed to save event.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      title={
        editingEvent
          ? L('일정 수정', '予定を編集', 'Edit Event')
          : L('새 일정 추가', '新しい予定を追加', 'New Event')
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
            {error}
          </div>
        )}

        {/* Non-destructive Translation Preview when Editing */}
        {editingEvent && (() => {
          const editPreviewId = `cal-ev-edit-${editingEvent.id}`;
          const canTranslatePreview = translator.shouldShowButton(title, location, description);
          const previewTranslated = translator.isTranslated(editPreviewId);
          if (!canTranslatePreview) return null;
          return (
            <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold text-emerald-900">
                  {L('원문 입력을 덮어쓰지 않고 번역 미리보기', '原文を保持したまま翻訳プレビュー', 'Non-destructive translation preview')}
                </span>
                <TranslateButton
                  visible={canTranslatePreview}
                  translated={previewTranslated}
                  loading={translator.isTranslating(editPreviewId)}
                  error={translator.getError(editPreviewId)}
                  onClick={(e) => {
                    e.preventDefault();
                    void translator.toggleTranslate(
                      editPreviewId,
                      { title, location, description },
                      'shared-calendar-event-edit'
                    );
                  }}
                />
              </div>
              {previewTranslated && (
                <div className="p-2.5 rounded-lg bg-white border border-emerald-200 text-xs space-y-1 text-charcoal-800">
                  <div className="font-bold">{translator.getText(editPreviewId, 'title', title)}</div>
                  {location && (
                    <div className="text-[11px] text-charcoal-600">
                      📍 {translator.getText(editPreviewId, 'location', location)}
                    </div>
                  )}
                  {description && (
                    <div className="whitespace-pre-wrap text-charcoal-700 pt-1 border-t border-ivory-200">
                      {translator.getText(editPreviewId, 'description', description)}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* Title */}
        <div>
          <input
            type="text"
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={L('일정 제목을 입력하세요', 'タイトルを入力', 'Event title')}
            className="w-full px-3.5 py-2.5 text-sm font-bold rounded-xl border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-600"
          />
        </div>

        {/* Status toggle on create */}
        {!editingEvent && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEventStatus('CONFIRMED')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold border transition ${
                eventStatus === 'CONFIRMED'
                  ? 'bg-forest-800 text-white border-forest-900'
                  : 'bg-white text-charcoal-600 border-ivory-300 hover:bg-ivory-50'
              }`}
            >
              {L('정식 일정', '確定予定', 'Confirmed Event')}
            </button>
            <button
              type="button"
              onClick={() => setEventStatus('PROPOSED')}
              className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold border transition inline-flex items-center justify-center gap-1 ${
                eventStatus === 'PROPOSED'
                  ? 'bg-amber-600 text-white border-amber-700'
                  : 'bg-white text-charcoal-600 border-ivory-300 hover:bg-ivory-50'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              {L('제안 일정', '提案予定', 'Proposed')}
            </button>
          </div>
        )}

        {/* Category + Independent Label Color & Text Color Pickers */}
        <EventColorControls
          categories={space.labels}
          categoryKey={labelKey}
          onSelectCategory={(cat) => {
            setLabelKey(cat.key);
            setColor(cat.color);
          }}
          bgColor={color}
          onChangeBgColor={setColor}
          textColor={textColor}
          onChangeTextColor={setTextColor}
          previewTitle={title}
        />

        {/* Date & Time */}
        <div className="p-3 rounded-xl bg-ivory-50 border border-ivory-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-charcoal-800 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-forest-700" />
              {L('날짜 및 시간', '日時', 'Date & Time')}
            </span>
            <label className="inline-flex items-center gap-1.5 text-xs font-bold text-charcoal-700 cursor-pointer">
              <input
                type="checkbox"
                checked={isAllDay}
                onChange={(e) => setIsAllDay(e.target.checked)}
                className="rounded text-forest-700 focus:ring-forest-600"
              />
              <span>{L('하루 종일', '終日', 'All Day')}</span>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="block text-[11px] font-bold text-charcoal-500 mb-1">
                {L('시작일', '開始日', 'Start Date')}
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  const val = e.target.value;
                  setStartDate(val);
                  if (endDate < val) setEndDate(val);
                }}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-ivory-300 bg-white"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-charcoal-500 mb-1">
                {L('종료일', '終了日', 'End Date')}
              </label>
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-ivory-300 bg-white"
              />
            </div>
          </div>

          {!isAllDay && (
            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-bold text-charcoal-500 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {L('시작 시간', '開始時刻', 'Start Time')}
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-ivory-300 bg-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold text-charcoal-500 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {L('종료 시간', '終了時刻', 'End Time')}
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-ivory-300 bg-white"
                />
              </div>
            </div>
          )}
        </div>

        {/* Recurrence & Reminder */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1 flex items-center gap-1">
              <Repeat className="w-3.5 h-3.5 text-forest-700" />
              {L('반복 설정', '繰り返し', 'Repeat')}
            </label>
            <select
              value={recurrenceType}
              onChange={(e) => setRecurrenceType(e.target.value as RecurrenceType)}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-ivory-300 bg-white"
            >
              <option value="NONE">{L('반복 안 함', '繰り返しなし', 'Does not repeat')}</option>
              <option value="DAILY">{L('매일', '毎日', 'Daily')}</option>
              <option value="WEEKLY">{L('매주', '毎週', 'Weekly')}</option>
              <option value="MONTHLY">{L('매월', '毎月', 'Monthly')}</option>
              <option value="YEARLY">{L('매년', '毎年', 'Yearly')}</option>
            </select>
            {recurrenceType !== 'NONE' && (
              <div className="mt-1.5">
                <label className="block text-[10px] font-bold text-charcoal-500 mb-0.5">
                  {L('반복 종료일 (선택)', '終了日（任意）', 'Repeat until (optional)')}
                </label>
                <input
                  type="date"
                  value={recurrenceUntil}
                  min={startDate}
                  onChange={(e) => setRecurrenceUntil(e.target.value)}
                  className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-ivory-300 bg-white"
                />
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1 flex items-center gap-1">
              <Bell className="w-3.5 h-3.5 text-forest-700" />
              {L('푸시 알림 리마인더', 'リマインダー通知', 'Reminder Push')}
            </label>
            <select
              value={reminderMinutes}
              onChange={(e) => setReminderMinutes(e.target.value)}
              className="w-full px-2.5 py-2 text-xs rounded-lg border border-ivory-300 bg-white"
            >
              <option value="">{L('알림 없음', '通知なし', 'No reminder')}</option>
              <option value="0">{L('일정 시작 시각', '開始時刻', 'At time of event')}</option>
              <option value="10">{L('10분 전', '10分前', '10 minutes before')}</option>
              <option value="30">{L('30분 전', '30分前', '30 minutes before')}</option>
              <option value="60">{L('1시간 전', '1時間前', '1 hour before')}</option>
              <option value="1440">{L('하루 전', '1日前', '1 day before')}</option>
            </select>
          </div>
        </div>

        {/* Attendees */}
        <SpaceMemberPicker
          members={space.members}
          selectedIds={attendeeIds}
          onChange={setAttendeeIds}
          currentUserId={user?.id}
          hint={L(
            '선택된 참여자에게만 일정 등록·수정·댓글·리마인더 푸시 알림이 발송됩니다.',
            '選択された参加者にのみ予定・コメント・リマインダー通知が送信されます。',
            'Only selected attendees receive event, comment, and reminder push notifications.'
          )}
        />

        {/* Location & URL */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-forest-700" />
              {L('장소', '場所', 'Location')}
            </label>
            <input
              type="text"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder={L('장소를 입력하세요', '場所を入力', 'Location')}
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-ivory-300"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1 flex items-center gap-1">
              <Link2 className="w-3.5 h-3.5 text-forest-700" />
              URL
            </label>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={L('URL을 입력하세요', 'URLを入力', 'Enter URL')}
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-ivory-300"
            />
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="block text-xs font-bold text-charcoal-700 mb-1">
            {L('메모', 'メモ', 'Notes')}
          </label>
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={L('일정에 대한 상세 메모나 준비물을 적어주세요', '詳細メモを入力', 'Event notes...')}
            className="w-full px-3 py-2 text-xs rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-500"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-ivory-200">
          <Button type="button" variant="secondary" onClick={onClose}>
            {L('취소', 'キャンセル', 'Cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {editingEvent ? L('수정 저장', '変更を保存', 'Save') : L('일정 등록', '予定を追加', 'Create')}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
