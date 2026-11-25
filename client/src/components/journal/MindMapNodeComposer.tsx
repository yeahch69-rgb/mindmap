import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { getJstTodayStr } from '../../utils/dateTime';
import {
  EntryType,
  JournalEntry,
  JournalIdea,
  JournalParticipant,
  JournalProject,
} from './types';
import { CreateJournalEntryPayload, CreateJournalIdeaPayload } from './mindmapUtils';

interface MindMapNodeComposerProps {
  project: JournalProject;
  entries: JournalEntry[];
  ideas: JournalIdea[];
  initialKind: EntryType | 'IDEA';
  initialCompletedTarget?: string;
  parentNodeKey: string | null;
  parentNodeTitle?: string | null;
  parentIdeaId: number | null;
  onAddIdea?: (payload: CreateJournalIdeaPayload) => Promise<JournalIdea | null | void>;
  onAddEntry?: (payload: CreateJournalEntryPayload) => Promise<JournalEntry | null | void>;
  onSetNextStep?: (projectId: number, nextAction: string, nextActionDate: string | null) => Promise<void>;
  onCreatedNode: (newKey: string, parentKey: string | null) => void;
  onClose: () => void;
}

export const MindMapNodeComposer: React.FC<MindMapNodeComposerProps> = ({
  project,
  entries,
  ideas,
  initialKind,
  initialCompletedTarget = '',
  parentNodeKey,
  parentNodeTitle,
  parentIdeaId,
  onAddIdea,
  onAddEntry,
  onSetNextStep,
  onCreatedNode,
  onClose,
}) => {
  const { L } = useLanguage();
  const isSettingUnsetNextStep =
    parentNodeKey === 'next-step' && !project.next_action && Boolean(onSetNextStep);

  const [kind, setKind] = useState<EntryType | 'IDEA'>(initialKind);
  const [nextStepTitle, setNextStepTitle] = useState('');
  const [ideaTitle, setIdeaTitle] = useState('');
  const [ideaNote, setIdeaNote] = useState('');

  const [content, setContent] = useState('');
  const [speaker, setSpeaker] = useState('');
  const [speakerCustomInput, setSpeakerCustomInput] = useState(false);
  const [entryDate, setEntryDate] = useState(() => getJstTodayStr());
  const [entryTime, setEntryTime] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [completedTarget, setCompletedTarget] = useState(initialCompletedTarget);
  const [autoSwitchTurn, setAutoSwitchTurn] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setKind(initialKind);
    setCompletedTarget(initialCompletedTarget);
    setAutoSwitchTurn(false);
  }, [initialKind, initialCompletedTarget, parentNodeKey]);

  const speakerPresets = useMemo<JournalParticipant[]>(() => {
    const list: JournalParticipant[] = [...(project.participants || [])];
    if (
      project.resolved_partner_name &&
      !list.some((p) => p.name.toLowerCase() === project.resolved_partner_name!.toLowerCase())
    ) {
      list.unshift({ name: project.resolved_partner_name });
    }
    return list;
  }, [project.participants, project.resolved_partner_name]);

  const progressTargetOptions = useMemo(() => {
    const items: Array<{ key: string; tag: string; date: string; text: string }> = [];
    for (const en of entries) {
      if (en.entry_type === 'PROGRESS') continue;
      const tag =
        en.entry_type === 'DIALOGUE_ME'
          ? L('🗣️ 나', '🗣️ 自分', '🗣️ Me')
          : en.entry_type === 'DIALOGUE_THEM'
          ? `👤 ${en.speaker_name || L('상대방', '相手', 'Partner')}`
          : L('🧭 의도·결정', '🧭 意図', '🧭 Intent');
      items.push({
        key: `ENTRY:${en.id}`,
        tag,
        date: en.entry_date || '',
        text: en.content,
      });
    }
    for (const idea of ideas) {
      if (idea.status === 'ARCHIVED') continue;
      items.push({
        key: `IDEA:${idea.id}`,
        tag: L('💡 아이디어', '💡 アイデア', '💡 Idea'),
        date: (idea.created_at || '').slice(0, 10),
        text: idea.title,
      });
    }
    return items.slice(-10).reverse();
  }, [entries, ideas, L]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (isSettingUnsetNextStep && onSetNextStep) {
      if (!nextStepTitle.trim()) return;
      try {
        setIsSubmitting(true);
        await onSetNextStep(project.id, nextStepTitle.trim(), dueDate || null);
        onClose();
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (kind === 'IDEA') {
      if (!onAddIdea || !ideaTitle.trim()) return;
      try {
        setIsSubmitting(true);
        const created = await onAddIdea({
          projectId: project.id,
          title: ideaTitle.trim(),
          note: ideaNote.trim() || null,
          parent_idea_id: parentIdeaId,
          parent_node_key: parentIdeaId ? null : parentNodeKey,
        });
        const newKey = created && 'id' in created ? `idea-${created.id}` : '';
        if (newKey) {
          // If parent wasn't an IDEA (parentIdeaId === null), caller attaches via parentOverrides
          onCreatedNode(newKey, parentIdeaId ? null : parentNodeKey);
        }
        setIdeaTitle('');
        setIdeaNote('');
        onClose();
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (!onAddEntry || !content.trim()) return;
    let completed_target_type: 'ENTRY' | 'IDEA' | null = null;
    let completed_target_id: number | null = null;
    if (kind === 'PROGRESS' && completedTarget) {
      const [tType, tIdStr] = completedTarget.split(':');
      const tId = Number(tIdStr);
      if ((tType === 'ENTRY' || tType === 'IDEA') && Number.isInteger(tId) && tId > 0) {
        completed_target_type = tType;
        completed_target_id = tId;
      }
    }

    try {
      setIsSubmitting(true);
      const created = await onAddEntry({
        projectId: project.id,
        entry_type: kind,
        speaker_name:
          kind === 'DIALOGUE_THEM'
            ? speaker.trim() || project.resolved_partner_name || null
            : null,
        content: content.trim(),
        entry_date: entryDate || '',
        entry_time: entryTime || null,
        due_date: dueDate || null,
        due_time: dueTime || null,
        completed_target_type,
        completed_target_id,
        parent_node_key: parentNodeKey,
        ...(autoSwitchTurn && kind === 'DIALOGUE_ME'
          ? { next_turn_state: 'THEIR_TURN' as const }
          : autoSwitchTurn && kind === 'DIALOGUE_THEM'
          ? { next_turn_state: 'MY_TURN' as const }
          : {}),
      });
      const newKey = created && 'id' in created ? `entry-${created.id}` : '';
      if (newKey) {
        onCreatedNode(newKey, parentNodeKey);
      }
      setContent('');
      setSpeaker('');
      setDueDate('');
      setDueTime('');
      setCompletedTarget('');
      onClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const kindButtons: Array<{ id: EntryType | 'IDEA'; label: string; activeCls: string }> = [
    { id: 'DIALOGUE_ME', label: L('🗣️ 나', '🗣️ 自分', '🗣️ Me'), activeCls: 'bg-forest-700 text-white border-forest-800' },
    { id: 'DIALOGUE_THEM', label: L('👤 상대방', '👤 相手', '👤 Partner'), activeCls: 'bg-sky-600 text-white border-sky-700' },
    { id: 'IDEA', label: L('💡 아이디어', '💡 アイデア', '💡 Idea'), activeCls: 'bg-yellow-500 text-stone-950 border-yellow-600' },
    { id: 'INTENT', label: L('🧭 내 의도·결정', '🧭 意図・決定', '🧭 Intent'), activeCls: 'bg-amber-500 text-white border-amber-600' },
    { id: 'PROGRESS', label: L('✅ 완료 기록', '✅ 完了記録', '✅ Done'), activeCls: 'bg-emerald-600 text-white border-emerald-700' },
  ];

  const availableButtons = kindButtons.filter((b) => (b.id === 'IDEA' ? Boolean(onAddIdea) : Boolean(onAddEntry)));

  return (
    <form
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
          e.preventDefault();
          void handleSubmit(e as unknown as React.FormEvent);
        }
      }}
      className="p-3 bg-ivory-50/90 border-b border-ivory-300 space-y-2.5 text-xs"
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="px-2 py-0.5 rounded bg-forest-100 border border-forest-300 text-forest-900 font-bold whitespace-nowrap">
            {isSettingUnsetNextStep
              ? L('🎯 다음 할 일 지정 (미지정 노드 변경)', '🎯 次の行動を設定（未定ノードを更新）', '🎯 Set Next Step (Replaces Unset Node)')
              : parentNodeKey && parentNodeTitle
              ? `${L('가지 뻗기 →', '子ノード追加 →', 'Branch from:')} ${parentNodeTitle}`
              : L('새 타임라인 노드 추가', '新規ノード追加', 'New Timeline Node')}
          </span>
          {!isSettingUnsetNextStep &&
            availableButtons.map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setKind(btn.id)}
              className={`px-2 py-1 rounded-lg border font-bold transition whitespace-nowrap ${
                kind === btn.id ? btn.activeCls : 'bg-white text-charcoal-700 border-ivory-300 hover:bg-ivory-100'
              }`}
            >
              {btn.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg bg-white border border-ivory-300 text-charcoal-600 hover:bg-ivory-100 shrink-0"
          title={L('닫기', '閉じる', 'Close')}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {isSettingUnsetNextStep ? (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            autoFocus
            value={nextStepTitle}
            onChange={(e) => setNextStepTitle(e.target.value)}
            placeholder={L('다음 할 일(Next Step)을 입력하세요...', '次の行動(Next Step)を入力...', 'Enter Next Step...')}
            className="flex-1 p-1.5 bg-white border border-ivory-300 rounded-lg font-bold text-charcoal-900"
          />
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="p-1.5 bg-white border border-ivory-300 rounded-lg text-charcoal-800 shrink-0"
            title={L('목표일 (선택)', '期限 (任意)', 'Target date (optional)')}
          />
          <button
            type="submit"
            disabled={isSubmitting || !nextStepTitle.trim()}
            className="px-3 py-1.5 rounded-lg bg-forest-800 text-white font-bold disabled:opacity-50 hover:bg-forest-900 shrink-0"
          >
            {isSubmitting ? L('저장 중...', '保存中...', 'Saving...') : L('다음 할 일 지정', '次の行動を設定', 'Set Next Step')}
          </button>
        </div>
      ) : kind === 'IDEA' ? (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <input
            type="text"
            autoFocus
            value={ideaTitle}
            onChange={(e) => setIdeaTitle(e.target.value)}
            placeholder={L('뻗어나갈 아이디어 제목...', 'アイデア名...', 'Idea title...')}
            className="flex-1 p-1.5 bg-white border border-ivory-300 rounded-lg font-bold text-charcoal-900"
          />
          <input
            type="text"
            value={ideaNote}
            onChange={(e) => setIdeaNote(e.target.value)}
            placeholder={L('세부 메모 (선택)', 'メモ (任意)', 'Note (optional)')}
            className="flex-1 p-1.5 bg-white border border-ivory-300 rounded-lg text-charcoal-800"
          />
          <button
            type="submit"
            disabled={isSubmitting || !ideaTitle.trim()}
            className="px-3 py-1.5 rounded-lg bg-forest-800 text-white font-bold disabled:opacity-50 hover:bg-forest-900 shrink-0"
          >
            {L('아이디어 추가', 'アイデア追加', 'Add Idea')}
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {/* Occurrence Date & Time */}
            <div className="p-1.5 rounded-lg bg-white border border-ivory-200 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-charcoal-700 shrink-0">
                📅 {L('발생 일시', '発生日時', 'Date')}
              </span>
              <input
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="flex-1 min-w-[115px] p-1 bg-ivory-50 border border-ivory-300 rounded font-mono font-bold text-[11px]"
              />
              <input
                type="time"
                value={entryTime}
                onChange={(e) => setEntryTime(e.target.value)}
                className="w-[95px] p-1 bg-ivory-50 border border-ivory-300 rounded font-mono font-bold text-[11px]"
              />
              {(entryDate || entryTime) && (
                <button
                  type="button"
                  onClick={() => {
                    setEntryDate('');
                    setEntryTime('');
                  }}
                  className="text-[10px] font-bold text-charcoal-500 hover:text-rose-600 px-1"
                >
                  {L('비우기', 'クリア', 'Clear')}
                </button>
              )}
            </div>

            {/* Deadline Date & Time */}
            <div className="p-1.5 rounded-lg bg-amber-50/50 border border-amber-200/80 flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-amber-900 shrink-0">
                ⏰ {L('마감 (선택)', '期限 (任意)', 'Due')}
              </span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="flex-1 min-w-[115px] p-1 bg-white border border-amber-300 rounded font-mono font-bold text-[11px]"
              />
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                className="w-[95px] p-1 bg-white border border-amber-300 rounded font-mono font-bold text-[11px]"
              />
              {(dueDate || dueTime) && (
                <button
                  type="button"
                  onClick={() => {
                    setDueDate('');
                    setDueTime('');
                  }}
                  className="text-[10px] font-bold text-amber-700 hover:text-rose-600 px-1"
                >
                  {L('비우기', 'クリア', 'Clear')}
                </button>
              )}
            </div>
          </div>

          {/* Partner Speaker Picker */}
          {kind === 'DIALOGUE_THEM' && (
            <div className="flex flex-wrap items-center gap-1.5">
              {speakerPresets.length > 0 && !speakerCustomInput ? (
                <>
                  {speakerPresets.map((person) => {
                    const active = speaker === person.name;
                    return (
                      <button
                        key={`mm-spk-${person.name}`}
                        type="button"
                        onClick={() => setSpeaker(active ? '' : person.name)}
                        className={`px-2 py-0.5 rounded-full border text-[11px] font-bold transition ${
                          active
                            ? 'bg-sky-600 text-white border-sky-700'
                            : 'bg-white text-charcoal-800 border-ivory-300 hover:border-sky-400'
                        }`}
                      >
                        👤 {person.name}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => setSpeakerCustomInput(true)}
                    className="px-2 py-0.5 rounded-full bg-white text-charcoal-600 border border-ivory-300 text-[11px] font-bold hover:bg-ivory-100"
                  >
                    {L('+ 직접 입력', '+ 直接入力', '+ Custom')}
                  </button>
                </>
              ) : (
                <>
                  <input
                    type="text"
                    value={speaker}
                    onChange={(e) => setSpeaker(e.target.value)}
                    placeholder={project.resolved_partner_name || L('상대방 이름 입력...', '相手名...', 'Speaker name...')}
                    className="p-1.5 bg-white border border-ivory-300 rounded-lg font-bold text-xs min-w-[160px]"
                  />
                  {speakerPresets.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSpeakerCustomInput(false)}
                      className="px-2 py-1 rounded-lg bg-white border border-ivory-300 text-charcoal-700 text-[11px] font-bold hover:bg-ivory-100"
                    >
                      {L('명단 선택', 'リスト選択', 'Presets')}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Completion Target Picker for PROGRESS */}
          {kind === 'PROGRESS' && progressTargetOptions.length > 0 && (
            <select
              value={completedTarget}
              onChange={(e) => setCompletedTarget(e.target.value)}
              className="w-full p-1.5 bg-white border border-emerald-300 rounded-lg text-xs font-bold text-charcoal-900"
            >
              <option value="">
                {L('── 완료 대상 미지정 (일반 완료 기록) ──', '── 指定なし（一般完了記録） ──', '── None (General Completion Log) ──')}
              </option>
              {progressTargetOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {`[${opt.tag}] ${opt.date} · ${opt.text.length > 52 ? opt.text.slice(0, 52) + '...' : opt.text}`}
                </option>
              ))}
            </select>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <input
              type="text"
              autoFocus
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={
                kind === 'DIALOGUE_ME'
                  ? L('내가 전한 말 / 결정사항 기록...', '自分の発言・対応メモ...', 'What I said / decided...')
                  : kind === 'DIALOGUE_THEM'
                  ? L('상대방의 핵심 발언·요청 기록...', '相手の主な発言・要望...', 'Key quote / request from partner...')
                  : kind === 'PROGRESS'
                  ? L('완료한 내용이나 결과 요약...', '完了内容・結果の要約...', 'Completion summary...')
                  : L('의도 · 결정 맥락 기록...', '意図・決定文脈...', 'Intent / decision context...')
              }
              className="flex-1 p-1.5 bg-white border border-ivory-300 rounded-lg font-medium text-charcoal-900"
            />
            <button
              type="submit"
              disabled={isSubmitting || !content.trim()}
              className="px-3 py-1.5 rounded-lg bg-forest-800 text-white font-bold disabled:opacity-50 hover:bg-forest-900 shrink-0"
            >
              {L('기록 추가', '記録を追加', 'Save Log')}
            </button>
          </div>

          {(kind === 'DIALOGUE_ME' || kind === 'DIALOGUE_THEM') && (
            <label className="inline-flex items-center gap-1.5 text-[11px] font-bold text-charcoal-700 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoSwitchTurn}
                onChange={(e) => setAutoSwitchTurn(e.target.checked)}
                className="rounded border-ivory-400 text-forest-700 focus:ring-forest-600"
              />
              <span>
                {kind === 'DIALOGUE_ME'
                  ? L("저장 후 '⏳ 상대 턴'으로 함께 전환", "保存と同時に「⏳ 相手ターン」へ切替", "Also switch to '⏳ Their Turn' on save")
                  : L("저장 후 '🔥 내 턴'으로 함께 전환", "保存と同時に「🔥 自分ターン」へ切替", "Also switch to '🔥 My Turn' on save")}
              </span>
            </label>
          )}
        </div>
      )}
    </form>
  );
};
