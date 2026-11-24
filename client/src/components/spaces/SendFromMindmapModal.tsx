import React, { useEffect, useState } from 'react';
import { Calendar, CheckCircle2, Clock, Hash, Lightbulb, MapPin, RefreshCw, Sparkles } from 'lucide-react';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { CalendarEventItem, CollabSpace, SharedThought } from '../../types/spaces';
import { getJstTodayStr } from '../../utils/dateTime';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { EventColorControls } from '../calendar/EventColorControls';

export interface MindmapSendSource {
  sourceType: 'PROJECT' | 'IDEA' | 'ENTRY';
  sourceId: number;
  projectId: number;
  defaultTitle: string;
  defaultContent: string;
  defaultDate?: string | null;
  initialDestination: 'thought' | 'calendar';
}

interface SendFromMindmapModalProps {
  isOpen: boolean;
  onClose: () => void;
  source: MindmapSendSource | null;
  spaces: CollabSpace[];
  activeSpaceId: number | null;
  onSentThought: (spaceId: number, thought: SharedThought) => void;
  onSentEvent: (spaceId: number, event: CalendarEventItem) => void;
}

export const SendFromMindmapModal: React.FC<SendFromMindmapModalProps> = ({
  isOpen,
  onClose,
  source,
  spaces,
  activeSpaceId,
  onSentThought,
  onSentEvent,
}) => {
  const { L } = useLanguage();
  const today = getJstTodayStr();

  const [dest, setDest] = useState<'thought' | 'calendar'>('thought');
  const [spaceId, setSpaceId] = useState<number>(activeSpaceId || spaces[0]?.id || 0);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [tagsText, setTagsText] = useState('');

  // Calendar fields
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(today);
  const [isAllDay, setIsAllDay] = useState(true);
  const [startTime, setStartTime] = useState('10:00');
  const [endTime, setEndTime] = useState('11:00');
  const [labelKey, setLabelKey] = useState('sky');
  const [color, setColor] = useState('#0369A1');
  const [textColor, setTextColor] = useState('#FFFFFF');
  const [location, setLocation] = useState('');
  const [confirmImmediately, setConfirmImmediately] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const selectedSpace = spaces.find((s) => s.id === spaceId) || spaces[0] || null;

  useEffect(() => {
    if (!isOpen || !source) return;
    setError('');
    setDest(source.initialDestination);
    const sid = activeSpaceId && spaces.some((s) => s.id === activeSpaceId) ? activeSpaceId : spaces[0]?.id || 0;
    setSpaceId(sid);
    setTitle(source.defaultTitle || '');
    setContent(source.defaultContent || '');
    setTagsText('마인드맵');

    const initDate =
      source.defaultDate && /^\d{4}-\d{2}-\d{2}$/.test(source.defaultDate.slice(0, 10))
        ? source.defaultDate.slice(0, 10)
        : today;
    setStartDate(initDate);
    setEndDate(initDate);
    setIsAllDay(true);
    setStartTime('10:00');
    setEndTime('11:00');
    setLocation('');
    setConfirmImmediately(true);

    const sp = spaces.find((s) => s.id === sid) || spaces[0];
    const lb = sp?.labels.find((l) => l.key === 'sky') || sp?.labels[0];
    if (lb) {
      setLabelKey(lb.key);
      setColor(lb.color);
    }
    setTextColor('#FFFFFF');
  }, [isOpen, source, activeSpaceId, spaces.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!source || !spaceId) return;
    setError('');

    try {
      setSaving(true);
      if (dest === 'thought') {
        if (!content.trim() && !title.trim()) {
          setError(L('공유할 내용을 입력해 주세요.', '内容を入力してください。', 'Please enter content.'));
          return;
        }
        const tags = tagsText
          .split(/[,\s]+/)
          .map((s) => s.replace(/^#/, '').trim())
          .filter(Boolean);
        const res = await api.post<{ thought: SharedThought }>('/spaces/from-mindmap/thought', {
          spaceId,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          projectId: source.projectId,
          title: title.trim(),
          content: content.trim() || title.trim(),
          tags,
        });
        onSentThought(spaceId, res.thought);
        onClose();
      } else {
        if (!title.trim()) {
          setError(L('일정 제목을 입력해 주세요.', '予定タイトルを入力してください。', 'Please enter an event title.'));
          return;
        }
        const res = await api.post<{ event: CalendarEventItem }>('/spaces/from-mindmap/event', {
          spaceId,
          sourceType: source.sourceType,
          sourceId: source.sourceId,
          projectId: source.projectId,
          title: title.trim(),
          description: content.trim(),
          start_date: startDate,
          end_date: endDate < startDate ? startDate : endDate,
          is_all_day: isAllDay,
          start_time: isAllDay ? null : startTime,
          end_time: isAllDay ? null : endTime,
          label_key: labelKey,
          color,
          text_color: textColor,
          location: location.trim(),
          confirmImmediately,
        });
        onSentEvent(spaceId, res.event);
        onClose();
      }
    } catch (err: any) {
      setError(err.message || L('전송에 실패했습니다.', '送信に失敗しました。', 'Failed to send.'));
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
          {dest === 'thought' ? (
            <Lightbulb className="w-4 h-4 text-amber-600" />
          ) : (
            <Calendar className="w-4 h-4 text-forest-700" />
          )}
          <span>
            {dest === 'thought'
              ? L('공유 메모장으로 보내기', '共有メモ帳へ送る', 'Send to Shared Thought Pad')
              : L('공유 캘린더에 일정 등록', '共有カレンダーへ予定登録', 'Send to Shared Calendar')}
          </span>
        </div>
      }
    >
      {source && (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-bold">
              {error}
            </div>
          )}

          {/* Destination Switch */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setDest('thought')}
              className={`py-2 px-3 rounded-xl text-xs font-bold border transition inline-flex items-center justify-center gap-1.5 ${
                dest === 'thought'
                  ? 'bg-amber-600 text-white border-amber-700 shadow-xs'
                  : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-50'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" />
              <span>{L('공유 메모장 (의견·투표)', '共有メモ帳（意見・投票）', 'Shared Thought Pad')}</span>
            </button>
            <button
              type="button"
              onClick={() => setDest('calendar')}
              className={`py-2 px-3 rounded-xl text-xs font-bold border transition inline-flex items-center justify-center gap-1.5 ${
                dest === 'calendar'
                  ? 'bg-forest-800 text-white border-forest-900 shadow-xs'
                  : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-50'
              }`}
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>{L('공유 캘린더 (일정 등록)', '共有カレンダー（予定登録）', 'Shared Calendar')}</span>
            </button>
          </div>

          {/* Space Picker */}
          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1">
              {L('대상 공유 스페이스', '送信先共有スペース', 'Target Shared Space')}
            </label>
            <select
              value={spaceId}
              onChange={(e) => setSpaceId(Number(e.target.value))}
              className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-ivory-300 bg-white"
            >
              {spaces.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.members.length}명)
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1">
              {dest === 'thought' ? L('제목 (선택)', 'タイトル（任意）', 'Title (optional)') : L('일정 제목', '予定タイトル', 'Event Title')}
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-600"
            />
          </div>

          {/* Content */}
          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1">
              {dest === 'thought' ? L('공유할 생각 내용', '共有するアイデア内容', 'Thought Content') : L('일정 메모', '予定メモ', 'Event Description')}
            </label>
            <textarea
              rows={3}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-600"
            />
          </div>

          {dest === 'thought' ? (
            <div>
              <label className="block text-xs font-bold text-charcoal-700 mb-1 flex items-center gap-1">
                <Hash className="w-3.5 h-3.5 text-forest-700" />
                {L('태그 (쉼표로 구분)', 'タグ（カンマ区切り）', 'Tags')}
              </label>
              <input
                type="text"
                value={tagsText}
                onChange={(e) => setTagsText(e.target.value)}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-ivory-300"
              />
            </div>
          ) : (
            <div className="space-y-3">
              {/* Confirmed vs Proposed */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmImmediately(true)}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border inline-flex items-center justify-center gap-1 ${
                    confirmImmediately
                      ? 'bg-forest-50 text-forest-950 border-forest-600'
                      : 'bg-white text-charcoal-600 border-ivory-300'
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 text-forest-700" />
                  {L('정식 일정', '確定予定', 'Confirmed')}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmImmediately(false)}
                  className={`py-1.5 px-2.5 rounded-lg text-xs font-bold border inline-flex items-center justify-center gap-1 ${
                    !confirmImmediately
                      ? 'bg-amber-50 text-amber-950 border-amber-500'
                      : 'bg-white text-charcoal-600 border-ivory-300'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5 text-amber-700" />
                  {L('제안 일정 (가확정)', '提案予定（仮）', 'Proposed')}
                </button>
              </div>

              {/* Date & Time */}
              <div className="p-3 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-charcoal-800">{L('날짜 · 시간', '日時', 'Date & Time')}</span>
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

                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => {
                      setStartDate(e.target.value);
                      if (endDate < e.target.value) setEndDate(e.target.value);
                    }}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-ivory-300 bg-white"
                  />
                  <input
                    type="date"
                    value={endDate}
                    min={startDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="px-2.5 py-1.5 text-xs rounded-lg border border-ivory-300 bg-white"
                  />
                </div>

                {!isAllDay && (
                  <div className="grid grid-cols-2 gap-2">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-charcoal-400" />
                      <input
                        type="time"
                        value={startTime}
                        onChange={(e) => setStartTime(e.target.value)}
                        className="flex-1 px-2 py-1 text-xs rounded-lg border border-ivory-300 bg-white"
                      />
                    </div>
                    <input
                      type="time"
                      value={endTime}
                      onChange={(e) => setEndTime(e.target.value)}
                      className="px-2 py-1 text-xs rounded-lg border border-ivory-300 bg-white"
                    />
                  </div>
                )}
              </div>

              {/* Category + Label Color & Text Color */}
              {selectedSpace && (
                <EventColorControls
                  categories={selectedSpace.labels}
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
              )}

              <div>
                <label className="block text-xs font-bold text-charcoal-700 mb-1 flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5 text-forest-700" />
                  {L('장소 (선택)', '場所（任意）', 'Location')}
                </label>
                <input
                  type="text"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-ivory-300"
                />
              </div>
            </div>
          )}

          {/* Live Sync Notice */}
          <div className="p-2.5 rounded-xl bg-indigo-50/70 border border-indigo-200 text-[11px] text-indigo-900 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
            <span>
              {L(
                '실시간 양방향 동기화: 전송 후 어느 한쪽에서 제목·내용을 수정하면 연결된 마인드맵·공유 메모장·공유 캘린더에도 자동 반영됩니다.',
                '双方向リアルタイム同期：どちら側でタイトル・内容を編集しても連携先に自動反映されます。',
                'Live two-way sync: edits on either side automatically update linked items.'
              )}
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ivory-200">
            <Button type="button" variant="secondary" onClick={onClose}>
              {L('취소', 'キャンセル', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving || spaces.length === 0}>
              {dest === 'thought'
                ? L('공유 메모장으로 보내기', '共有メモ帳へ送信', 'Send to Thought Pad')
                : L('공유 캘린더에 등록', '共有カレンダーへ登録', 'Add to Calendar')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
