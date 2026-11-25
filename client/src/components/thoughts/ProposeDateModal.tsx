import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Clock, MapPin, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { CalendarEventItem, CollabSpace, SharedThought } from '../../types/spaces';
import { getJstTodayStr } from '../../utils/dateTime';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { EventColorControls } from '../calendar/EventColorControls';

interface ProposeDateModalProps {
  isOpen: boolean;
  onClose: () => void;
  space: CollabSpace;
  thought: SharedThought | null;
  onProposed: (event: CalendarEventItem) => void;
}

export const ProposeDateModal: React.FC<ProposeDateModalProps> = ({
  isOpen,
  onClose,
  space,
  thought,
  onProposed,
}) => {
  const { L } = useLanguage();
  const today = getJstTodayStr();
  const amberLabel =
    space.labels.find((l) => l.key === 'amber') ||
    space.labels[0] || { key: 'amber', color: '#B45309', name: '아이디어 · 제안' };

  const [title, setTitle] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [isAllDay, setIsAllDay] = useState(true);
  const [startTime, setStartTime] = useState('14:00');
  const [endTime, setEndTime] = useState('16:00');
  const [labelKey, setLabelKey] = useState(amberLabel.key);
  const [color, setColor] = useState(amberLabel.color);
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [location, setLocation] = useState('');
  const [note, setNote] = useState('');
  const [confirmImmediately, setConfirmImmediately] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !thought) return;
    setError('');
    setTitle(thought.title || thought.content.slice(0, 40));
    setStartDate(today);
    setEndDate(today);
    setIsAllDay(true);
    setStartTime('14:00');
    setEndTime('16:00');
    setLabelKey(amberLabel.key);
    setColor(amberLabel.color);
    setTextColor('#FFFFFF');
    setLocation('');
    setNote('');
    setConfirmImmediately(false);
  }, [isOpen, thought?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thought) return;
    if (!startDate) {
      setError(L('날짜를 선택해 주세요.', '日付を選択してください。', 'Please pick a date.'));
      return;
    }
    setError('');
    try {
      setSaving(true);
      const res = await api.post<{ event: CalendarEventItem }>(
        `/spaces/${space.id}/thoughts/${thought.id}/propose-date`,
        {
          title: title.trim() || thought.title || thought.content.slice(0, 40),
          description: thought.content,
          start_date: startDate,
          end_date: endDate < startDate ? startDate : endDate,
          is_all_day: isAllDay,
          start_time: isAllDay ? null : startTime,
          end_time: isAllDay ? null : endTime,
          label_key: labelKey,
          color,
          text_color: textColor,
          location: location.trim(),
          note: note.trim(),
          attendee_ids: space.members.map((m) => m.user_id),
          confirmImmediately,
        }
      );
      onProposed(res.event);
      onClose();
    } catch (err: any) {
      setError(err.message || L('날짜 제안에 실패했습니다.', '日程提案に失敗しました。', 'Failed to propose date.'));
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
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-amber-600" />
          <span>{L('캘린더 날짜 제안', 'カレンダー日程提案', 'Propose Calendar Date')}</span>
        </div>
      }
    >
      {thought && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
              {error}
            </div>
          )}

          {/* Source Thought Preview */}
          <div className="p-3 rounded-xl bg-forest-50 border border-forest-200 space-y-1">
            <div className="text-[10px] font-bold text-forest-700 uppercase">
              {L('연결되는 생각', '元となるアイデア', 'Linked Thought')}
            </div>
            {thought.title && <div className="text-xs font-bold text-forest-950">{thought.title}</div>}
            <p className="text-xs text-forest-900 line-clamp-2">{thought.content}</p>
          </div>

          {/* Proposed vs Immediate Confirm Toggle */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setConfirmImmediately(false)}
              className={`p-2.5 rounded-xl border text-left transition ${
                !confirmImmediately
                  ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-200'
                  : 'bg-white border-ivory-300 hover:bg-ivory-50'
              }`}
            >
              <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                {L('제안 일정으로 등록 (추천)', '提案（仮）で登録', 'Propose (Tentative)')}
              </div>
              <div className="text-[10px] text-charcoal-500 mt-0.5">
                {L(
                  '캘린더에 점선 제안 일정으로 뜨고, 멤버들이 가능 여부 투표 후 확정',
                  'カレンダーに仮予定として表示され、合意後に確定できます',
                  'Appears as a dashed proposal on calendar until confirmed'
                )}
              </div>
            </button>

            <button
              type="button"
              onClick={() => setConfirmImmediately(true)}
              className={`p-2.5 rounded-xl border text-left transition ${
                confirmImmediately
                  ? 'bg-forest-50 border-forest-600 ring-2 ring-forest-200'
                  : 'bg-white border-ivory-300 hover:bg-ivory-50'
              }`}
            >
              <div className="text-xs font-bold text-forest-950 flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5 text-forest-700" />
                {L('정식 일정으로 즉시 등록', '確定予定として即登録', 'Confirm Immediately')}
              </div>
              <div className="text-[10px] text-charcoal-500 mt-0.5">
                {L(
                  '별도 승인 없이 캘린더 정식 일정으로 바로 등록하고 생각과 연결',
                  '承認なしで確定予定としてカレンダーに即登録します',
                  'Add directly as a confirmed event linked to this thought'
                )}
              </div>
            </button>
          </div>

          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1">
              {L('캘린더 일정 제목', '予定タイトル', 'Calendar Event Title')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-600"
            />
          </div>

          {/* Date & Time */}
          <div className="p-3 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-charcoal-800 flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-forest-700" />
                {L('제안 날짜 / 시간', '提案日時', 'Proposed Date & Time')}
              </span>
              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-charcoal-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isAllDay}
                  onChange={(e) => setIsAllDay(e.target.checked)}
                  className="rounded text-forest-700"
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
                    setStartDate(e.target.value);
                    if (endDate < e.target.value) setEndDate(e.target.value);
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
                    {L('시작 시간', '開始時刻', 'Start')}
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
                    {L('종료 시간', '終了時刻', 'End')}
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

          {/* Category + Label Color & Text Color */}
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

          {/* Location & Proposal Note */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <div>
              <label className="block text-xs font-bold text-charcoal-700 mb-1 flex items-center gap-1">
                <MapPin className="w-3.5 h-3.5 text-forest-700" />
                {L('장소 (선택)', '場所（任意）', 'Location (optional)')}
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={L('장소 (선택)', '場所（任意）', 'Optional location')}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-ivory-300"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-charcoal-700 mb-1">
                {L('한마디 제안 메모 (일정 채팅에 표시)', '一言メモ（予定チャットに投稿）', 'Short proposal message')}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={L('메모 (선택)', 'メモ（任意）', 'Optional note')}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-ivory-300"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ivory-200">
            <Button type="button" variant="secondary" onClick={onClose}>
              {L('취소', 'キャンセル', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              <Sparkles className="w-3.5 h-3.5 mr-1" />
              {confirmImmediately
                ? L('정식 일정 등록', '確定予定登録', 'Confirm on Calendar')
                : L('날짜 제안', '日程提案', 'Propose Date')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
