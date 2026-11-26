import React from 'react';
import { Users } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { SpaceMember } from '../../types/spaces';

interface SpaceMemberPickerProps {
  members: SpaceMember[];
  selectedIds: number[];
  onChange: (nextIds: number[]) => void;
  label?: string;
  hint?: string;
  currentUserId?: number | null;
  lockedUserIds?: number[];
  accent?: 'forest' | 'indigo';
}

export const SpaceMemberPicker: React.FC<SpaceMemberPickerProps> = ({
  members,
  selectedIds,
  onChange,
  label,
  hint,
  currentUserId,
  lockedUserIds = [],
  accent = 'forest',
}) => {
  const { L } = useLanguage();
  if (members.length === 0) return null;

  const lockedSet = new Set(lockedUserIds.map(Number));
  const selectedSet = new Set([...selectedIds.map(Number), ...lockedUserIds.map(Number)]);
  const allMemberIds = members.map((m) => Number(m.user_id));
  const allSelected = allMemberIds.every((id) => selectedSet.has(id));
  const hasToggleableSelected = allMemberIds.some((id) => !lockedSet.has(id) && selectedSet.has(id));

  const toggleMember = (uid: number) => {
    if (lockedSet.has(uid)) return;
    if (selectedSet.has(uid)) {
      onChange(Array.from(selectedSet).filter((id) => id !== uid));
    } else {
      onChange([...Array.from(selectedSet), uid]);
    }
  };

  const handleSelectAll = () => {
    onChange(Array.from(new Set([...allMemberIds, ...lockedUserIds.map(Number)])));
  };

  const handleClear = () => {
    onChange(Array.from(new Set(lockedUserIds.map(Number))));
  };

  const activeChipClass =
    accent === 'indigo'
      ? 'bg-indigo-100 text-indigo-900 border-indigo-300'
      : 'bg-forest-100 text-forest-900 border-forest-300';
  const iconClass = accent === 'indigo' ? 'text-indigo-700' : 'text-forest-700';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="text-xs font-bold text-charcoal-700 flex items-center gap-1.5">
          <Users className={`w-3.5 h-3.5 ${iconClass}`} />
          <span>{label || L('참여자', '参加者', 'Attendees')}</span>
          <span className="text-[11px] font-semibold text-charcoal-400">
            ({selectedSet.size}/{members.length})
          </span>
        </div>
        {members.length > 1 && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={allSelected}
              onClick={handleSelectAll}
              className="text-[11px] font-bold text-charcoal-600 hover:text-charcoal-900 disabled:opacity-40 transition"
            >
              {L('전체 선택', 'すべて選択', 'Select All')}
            </button>
            <span className="text-charcoal-300 text-[10px]">|</span>
            <button
              type="button"
              disabled={!hasToggleableSelected}
              onClick={handleClear}
              className="text-[11px] font-bold text-charcoal-500 hover:text-charcoal-800 disabled:opacity-40 transition"
            >
              {lockedUserIds.length > 0
                ? L('본인만', '自分のみ', 'Only Me')
                : L('전체 해제', 'すべて解除', 'Clear')}
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        {members.map((m) => {
          const uid = Number(m.user_id);
          const selected = selectedSet.has(uid);
          const locked = lockedSet.has(uid);
          const isMe = currentUserId !== undefined && currentUserId !== null && Number(currentUserId) === uid;
          return (
            <button
              key={uid}
              type="button"
              disabled={locked}
              onClick={() => toggleMember(uid)}
              className={`px-2.5 py-1 rounded-full text-xs font-bold border transition ${
                selected
                  ? activeChipClass
                  : 'bg-white text-charcoal-500 border-ivory-300 hover:bg-ivory-50'
              } ${locked ? 'cursor-default opacity-90' : ''}`}
            >
              {selected ? '✓ ' : ''}
              {m.name}
              {isMe ? ` (${L('나', '自分', 'Me')})` : ''}
            </button>
          );
        })}
      </div>

      {hint && <p className="text-[11px] text-charcoal-500 leading-relaxed">{hint}</p>}
    </div>
  );
};
