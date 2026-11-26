import React, { useEffect, useState } from 'react';
import { BookMarked, FolderPlus, GitBranch, ListPlus, RefreshCw } from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { CollabSpace, SharedThought, SPACE_COLOR_PRESETS } from '../../types/spaces';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { SpaceMemberPicker } from '../spaces/SpaceMemberPicker';

interface MindmapProjectOption {
  id: number;
  title: string;
  mode: string;
  color?: string;
}

interface SendToMindmapModalProps {
  isOpen: boolean;
  onClose: () => void;
  space: CollabSpace;
  thought: SharedThought | null;
  onSent: (result: { mode: string; projectId: number }) => void;
}

export const SendToMindmapModal: React.FC<SendToMindmapModalProps> = ({
  isOpen,
  onClose,
  space,
  thought,
  onSent,
}) => {
  const { user } = useAuth();
  const { L } = useLanguage();

  const [mode, setMode] = useState<'NEW_PROJECT' | 'EXISTING_IDEA' | 'EXISTING_ENTRY'>('NEW_PROJECT');
  const [projects, setProjects] = useState<MindmapProjectOption[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(false);

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [color, setColor] = useState(space.color || '#1B4D3E');
  const [selectedMemberIds, setSelectedMemberIds] = useState<number[]>([]);
  const [entryType, setEntryType] = useState<'INTENT' | 'PROGRESS'>('INTENT');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!isOpen || !thought) return;
    setError('');
    setMode('NEW_PROJECT');
    setTitle(thought.title || thought.content.slice(0, 48));
    setContent(thought.content);
    setColor(space.color || '#1B4D3E');
    const myId = user ? Number(user.id) : 0;
    setSelectedMemberIds(myId && space.members.some((m) => Number(m.user_id) === myId) ? [myId] : []);
    setEntryType('INTENT');

    setLoadingProjects(true);
    api
      .get<{ projects: MindmapProjectOption[] }>('/journal/overview')
      .then((res) => {
        const list = res.projects || [];
        setProjects(list);
        if (list.length > 0) setSelectedProjectId(String(list[0].id));
      })
      .catch(() => setProjects([]))
      .finally(() => setLoadingProjects(false));
  }, [isOpen, thought?.id, space.id, user?.id]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!thought) return;
    setError('');

    if (mode !== 'NEW_PROJECT' && !selectedProjectId) {
      setError(L('추가할 기존 마인드맵 프로젝트를 선택해 주세요.', '追加先のプロジェクトを選択してください。', 'Please select a project.'));
      return;
    }

    try {
      setSaving(true);
      const res = await api.post<{ mode: string; projectId: number }>(
        `/spaces/${space.id}/thoughts/${thought.id}/send-to-mindmap`,
        mode === 'NEW_PROJECT'
          ? {
              mode: 'NEW_PROJECT',
              title: title.trim() || thought.title || thought.content.slice(0, 48),
              intent: content.trim(),
              color,
              memberIds: selectedMemberIds.filter((id) => id !== Number(user?.id || 0)),
            }
          : mode === 'EXISTING_IDEA'
            ? {
                mode: 'EXISTING_IDEA',
                projectId: Number(selectedProjectId),
                title: title.trim() || thought.title || thought.content.slice(0, 48),
                note: content.trim(),
              }
            : {
                mode: 'EXISTING_ENTRY',
                projectId: Number(selectedProjectId),
                entryType,
                content: content.trim(),
              }
      );
      onSent(res);
      onClose();
    } catch (err: any) {
      setError(err.message || L('마인드맵 전송에 실패했습니다.', '送信に失敗しました。', 'Failed to send to Mindmap.'));
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
          <BookMarked className="w-4 h-4 text-indigo-700" />
          <span>{L('프로젝트 마인드맵으로 보내기', 'プロジェクトマインドマップへ送る', 'Send to Project Mindmap')}</span>
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

          {/* Mode Selector */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {(
              [
                {
                  id: 'NEW_PROJECT',
                  icon: FolderPlus,
                  label: L('새 프로젝트로 시작', '新規プロジェクト作成', 'New Project'),
                  desc: L('이 생각을 새 마인드맵으로 출발', 'この思考から新規開始', 'Start a new project'),
                },
                {
                  id: 'EXISTING_IDEA',
                  icon: GitBranch,
                  label: L('기존 프로젝트 아이디어', '既存にアイデア追加', 'Add as Idea Node'),
                  desc: L('기존 마인드맵 가지로 추가', '既存プロジェクトの枝に', 'Attach as an idea branch'),
                },
                {
                  id: 'EXISTING_ENTRY',
                  icon: ListPlus,
                  label: L('기존 프로젝트 기록', '既存に記録追加', 'Add as Timeline Entry'),
                  desc: L('타임라인 의도·진행 기록으로 추가', 'タイムライン記録に追加', 'Append to project log'),
                },
              ] as const
            ).map((opt) => {
              const Icon = opt.icon;
              const active = mode === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setMode(opt.id)}
                  className={`p-2.5 rounded-xl border text-left transition ${
                    active
                      ? 'bg-indigo-50 border-indigo-500 ring-2 ring-indigo-200'
                      : 'bg-white border-ivory-300 hover:bg-ivory-50'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-900 whitespace-nowrap">
                    <Icon className={`w-3.5 h-3.5 shrink-0 ${active ? 'text-indigo-700' : 'text-charcoal-500'}`} />
                    <span>{opt.label}</span>
                  </div>
                  <div className="text-[10px] text-charcoal-500 mt-0.5">{opt.desc}</div>
                </button>
              );
            })}
          </div>

          {/* Target Project Picker (for existing modes) */}
          {mode !== 'NEW_PROJECT' && (
            <div>
              <label className="block text-xs font-bold text-charcoal-700 mb-1">
                {L('대상 마인드맵 프로젝트', '対象プロジェクト', 'Target Mindmap Project')}
              </label>
              {loadingProjects ? (
                <div className="text-xs text-charcoal-400 py-2">
                  {L('프로젝트 목록 불러오는 중...', '読み込み中...', 'Loading projects...')}
                </div>
              ) : projects.length === 0 ? (
                <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-900">
                  {L('기존 프로젝트가 없습니다. "새 프로젝트로 시작"을 선택해 주세요.', '既存プロジェクトがありません。', 'No existing projects. Choose New Project.')}
                </div>
              ) : (
                <select
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-ivory-300 bg-white"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title} ({p.mode === 'COLLAB' ? L('협업', '共同', 'Collab') : L('개인', '個人', 'Solo')})
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          {/* Title (for NEW_PROJECT or EXISTING_IDEA) */}
          {mode !== 'EXISTING_ENTRY' && (
            <div>
              <label className="block text-xs font-bold text-charcoal-700 mb-1">
                {mode === 'NEW_PROJECT'
                  ? L('새 프로젝트 제목', 'プロジェクト名', 'Project Title')
                  : L('아이디어 노드 제목', 'アイデアタイトル', 'Idea Title')}
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 text-xs font-bold rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          )}

          {/* Entry type for EXISTING_ENTRY */}
          {mode === 'EXISTING_ENTRY' && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setEntryType('INTENT')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold border ${
                  entryType === 'INTENT'
                    ? 'bg-forest-800 text-white border-forest-900'
                    : 'bg-white text-charcoal-600 border-ivory-300'
                }`}
              >
                {L('의도 · 결정 기록', '意図・決定', 'Intent / Decision')}
              </button>
              <button
                type="button"
                onClick={() => setEntryType('PROGRESS')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold border ${
                  entryType === 'PROGRESS'
                    ? 'bg-forest-800 text-white border-forest-900'
                    : 'bg-white text-charcoal-600 border-ivory-300'
                }`}
              >
                {L('진행 · 완료 기록', '進捗・完了', 'Progress')}
              </button>
            </div>
          )}

          {/* Content */}
          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1">
              {mode === 'NEW_PROJECT'
                ? L('프로젝트 핵심 의도 · 메모', 'プロジェクト意図・メモ', 'Project Intent')
                : mode === 'EXISTING_IDEA'
                  ? L('아이디어 상세 메모', 'アイデア詳細', 'Idea Note')
                  : L('타임라인 기록 내용', '記録内容', 'Entry Content')}
            </label>
            <textarea
              rows={4}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          {/* New Project Color & Space Member Inclusion */}
          {mode === 'NEW_PROJECT' && (
            <div className="space-y-3 p-3 rounded-xl bg-ivory-50 border border-ivory-200">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-charcoal-700">{L('프로젝트 색상', 'カラー', 'Color')}</span>
                <div className="flex items-center gap-1.5">
                  {SPACE_COLOR_PRESETS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      onClick={() => setColor(c)}
                      className={`w-5 h-5 rounded-full transition ${
                        color === c ? 'ring-2 ring-offset-2 ring-charcoal-900 scale-110' : ''
                      }`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              {space.members.length > 1 && (() => {
                const otherSelectedCount = selectedMemberIds.filter((id) => id !== Number(user?.id || 0)).length;
                return (
                  <div className="pt-2 border-t border-ivory-200">
                    <SpaceMemberPicker
                      members={space.members}
                      selectedIds={selectedMemberIds}
                      onChange={setSelectedMemberIds}
                      currentUserId={user?.id}
                      lockedUserIds={user ? [Number(user.id)] : []}
                      accent="indigo"
                      label={L('새 프로젝트 참여 멤버', '新規プロジェクト参加メンバー', 'New Project Members')}
                      hint={
                        otherSelectedCount === 0
                          ? L(
                              '나만 참여하는 개인 프로젝트로 생성됩니다. (다른 멤버에게 푸시 알림 미발송)',
                              '自分のみの個人プロジェクトとして作成されます。（他メンバーへ通知なし）',
                              'Creates a solo project for yourself only (no push sent to other members).'
                            )
                          : L(
                              `선택한 ${otherSelectedCount}명과 협업 프로젝트로 생성되며, 선택된 멤버에게만 푸시 알림이 발송됩니다.`,
                              `選択した${otherSelectedCount}名との共同プロジェクトとして作成され、選択メンバーにのみ通知されます。`,
                              `Creates a collaborative project with ${otherSelectedCount} selected member(s); only they receive push notifications.`
                            )
                      }
                    />
                  </div>
                );
              })()}
            </div>
          )}

          {/* Live Sync Notice */}
          <div className="p-2.5 rounded-xl bg-indigo-50/70 border border-indigo-200 text-[11px] text-indigo-900 flex items-center gap-2">
            <RefreshCw className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
            <span>
              {L(
                '실시간 양방향 동기화: 전송 후 어느 한쪽에서 제목·내용을 수정하면 연결된 마인드맵·메모장·캘린더에도 자동 반영됩니다.',
                '双方向リアルタイム同期：どちら側でタイトル・内容を編集しても連携先に自動反映されます。',
                'Live two-way sync: edits to title or content on either side automatically stay in sync.'
              )}
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ivory-200">
            <Button type="button" variant="secondary" onClick={onClose}>
              {L('취소', 'キャンセル', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving || (mode !== 'NEW_PROJECT' && projects.length === 0)}>
              <BookMarked className="w-3.5 h-3.5 mr-1" />
              {L('마인드맵으로 보내기', 'マインドマップへ送信', 'Send to Mindmap')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
};
