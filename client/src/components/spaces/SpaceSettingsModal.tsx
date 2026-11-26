import React, { useEffect, useMemo, useState } from 'react';
import {
  BookMarked,
  Check,
  Clock,
  Copy,
  ExternalLink,
  Link2,
  Lock,
  Mail,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Unlink2,
  UserMinus,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { CollabSpace, SPACE_COLOR_PRESETS, SpaceLabelPreset } from '../../types/spaces';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';

const DEFAULT_LABELS: SpaceLabelPreset[] = [
  { key: 'emerald', color: '#1B4D3E', name: '기본 일정' },
  { key: 'sky', color: '#0369A1', name: '업무 · 미팅' },
  { key: 'rose', color: '#BE123C', name: '중요 · 약속' },
  { key: 'amber', color: '#B45309', name: '아이디어 · 제안' },
  { key: 'violet', color: '#6D28D9', name: '개인 · 취미' },
  { key: 'slate', color: '#475569', name: '기타 메모' },
];

interface SpaceSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'create' | 'edit';
  space?: CollabSpace | null;
  onJumpToLinkedProject?: (projectId: number) => void;
  onSaved: (createdOrUpdatedSpaceId?: number) => Promise<void> | void;
  onDeleted?: () => Promise<void> | void;
}

export const SpaceSettingsModal: React.FC<SpaceSettingsModalProps> = ({
  isOpen,
  onClose,
  mode,
  space,
  onJumpToLinkedProject,
  onSaved,
  onDeleted,
}) => {
  const { user } = useAuth();
  const { L } = useLanguage();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#1B4D3E');
  const [labels, setLabels] = useState<SpaceLabelPreset[]>(DEFAULT_LABELS);
  const [inviteToken, setInviteToken] = useState('');
  const [memberInviteToken, setMemberInviteToken] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [copiedKind, setCopiedKind] = useState<'owner' | 'member' | null>(null);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const [resolvingReqId, setResolvingReqId] = useState<number | null>(null);
  const [unlinkingProjId, setUnlinkingProjId] = useState<number | null>(null);

  const managedLinkedProjects = useMemo(() => {
    if (!space) return [];
    if (space.managed_linked_projects && space.managed_linked_projects.length > 0) {
      return space.managed_linked_projects;
    }
    if (space.linked_projects && space.linked_projects.length > 0) {
      return space.linked_projects;
    }
    return space.linked_project ? [space.linked_project] : [];
  }, [space]);

  const isLinkedSpace = (space?.linked_project_count || managedLinkedProjects.length) > 0;
  const isOwner = space?.my_role === 'OWNER';
  const pendingRequests = space?.pending_join_requests || [];

  useEffect(() => {
    if (!isOpen) return;
    setErrorMsg('');
    setFeedbackMsg('');
    setCopiedKind(null);
    setInviteEmail('');
    if (mode === 'edit' && space) {
      setName(space.name);
      setDescription(space.description || '');
      setColor(space.color || '#1B4D3E');
      setLabels(space.labels && space.labels.length > 0 ? space.labels : DEFAULT_LABELS);
      setInviteToken(space.invite_token || '');
      setMemberInviteToken(space.member_invite_token || '');
    } else {
      setName('');
      setDescription('');
      setColor('#1B4D3E');
      setLabels(DEFAULT_LABELS);
      setInviteToken('');
      setMemberInviteToken('');
    }
  }, [isOpen, mode, space?.id]);

  useEffect(() => {
    if (!isOpen || mode !== 'edit' || !space) return;
    setInviteToken(space.invite_token || '');
    setMemberInviteToken(space.member_invite_token || '');
  }, [isOpen, mode, space?.invite_token, space?.member_invite_token]);

  const inviteUrl = inviteToken
    ? `${window.location.origin}/?spaceInvite=${encodeURIComponent(inviteToken)}`
    : '';
  const memberInviteUrl = memberInviteToken
    ? `${window.location.origin}/?spaceInvite=${encodeURIComponent(memberInviteToken)}`
    : '';

  const handleCopyInvite = async (kind: 'owner' | 'member') => {
    const url = kind === 'member' ? memberInviteUrl : inviteUrl;
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedKind(kind);
      setTimeout(() => setCopiedKind(null), 2000);
    } catch {
      setErrorMsg(L('클립보드 복사에 실패했습니다.', 'コピーに失敗しました。', 'Copy failed.'));
    }
  };

  const handleRegenerateInvite = async (kind: 'owner' | 'member' = 'owner') => {
    if (!space) return;
    try {
      const res = await api.post<{ invite_token: string; member_invite_token?: string }>(
        `/spaces/${space.id}/regenerate-invite`,
        { kind }
      );
      if (res.invite_token) setInviteToken(res.invite_token);
      if (res.member_invite_token) setMemberInviteToken(res.member_invite_token);
      setFeedbackMsg(
        kind === 'member'
          ? L('새 멤버용 초대 링크가 발급되었습니다.', '新しいメンバー用招待リンクを発行しました。', 'Member invite link regenerated.')
          : L('새 초대 링크가 발급되었습니다.', '新しい招待リンクを発行しました。', 'Invite link regenerated.')
      );
      await onSaved(space.id);
    } catch (err: any) {
      setErrorMsg(err.message || L('재발급에 실패했습니다.', '再発行に失敗しました。', 'Failed.'));
    }
  };

  const handleInviteByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!space || !inviteEmail.trim()) return;
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      setSaving(true);
      const res = await api.post<{
        member: { name: string; email: string };
        pendingApproval?: boolean;
        alreadyPending?: boolean;
      }>(`/spaces/${space.id}/invite-email`, {
        email: inviteEmail.trim(),
      });
      setInviteEmail('');
      if (res.pendingApproval) {
        setFeedbackMsg(
          res.alreadyPending
            ? L(
                `${res.member.name}님은 이미 방장 승인 대기 중입니다.`,
                `${res.member.name}さんはすでにオーナー承認待ちです。`,
                `${res.member.name} already has a pending approval request.`
              )
            : L(
                `${res.member.name}님의 스페이스 초대 승인 요청을 방장에게 보냈습니다! 승인 후 공유 스페이스에 합류됩니다(프로젝트 자동 투입 안 함).`,
                `${res.member.name}さんのスペース招待承認リクエストをオーナーへ送信しました！`,
                `Sent space invite approval request for ${res.member.name} to the space owner!`
              )
        );
      } else {
        setFeedbackMsg(
          isLinkedSpace
            ? L(
                `${res.member.name}님을 공유 스페이스에 초대했습니다! (연결된 프로젝트에는 자동 투입되지 않으며, 프로젝트에서 원클릭으로 추가할 수 있습니다.)`,
                `${res.member.name}さんを共有スペースに招待しました！（連携プロジェクトには自動追加されません。）`,
                `Invited ${res.member.name} to this Shared Space! (Not auto-added to linked projects.)`
              )
            : L(
                `${res.member.name}님을 스페이스에 초대했습니다!`,
                `${res.member.name}さんを招待しました！`,
                `Invited ${res.member.name}!`
              )
        );
      }
      await onSaved(space.id);
    } catch (err: any) {
      setErrorMsg(err.message || L('초대에 실패했습니다.', '招待に失敗しました。', 'Invite failed.'));
    } finally {
      setSaving(false);
    }
  };

  const handleResolveJoinRequest = async (requestId: number, decision: 'approve' | 'reject') => {
    if (!space || resolvingReqId !== null) return;
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      setResolvingReqId(requestId);
      await api.post(`/spaces/${space.id}/join-requests/${requestId}/${decision}`);
      setFeedbackMsg(
        decision === 'approve'
          ? L('초대 요청을 승인했습니다!', '招待申請を承認しました！', 'Approved the join request!')
          : L('초대 요청을 거절했습니다.', '招待申請を却下しました。', 'Declined the invite request.')
      );
      await onSaved(space.id);
    } catch (err: any) {
      setErrorMsg(err.message || L('처리에 실패했습니다.', '処理に失敗しました。', 'Action failed.'));
    } finally {
      setResolvingReqId(null);
    }
  };

  const handleUnlinkProject = async (projectId: number, projectTitle: string) => {
    if (!space || unlinkingProjId !== null) return;
    const ok = window.confirm(
      L(
        `'${projectTitle}' 프로젝트의 스페이스 연동을 해제할까요? 양쪽 데이터와 기존 멤버는 모두 보존됩니다.`,
        `「${projectTitle}」プロジェクトのスペース連携を解除しますか？双方のデータとメンバーは保持されます。`,
        `Unlink project '${projectTitle}' from this space? All data and existing members will be preserved.`
      )
    );
    if (!ok) return;
    setErrorMsg('');
    setFeedbackMsg('');
    try {
      setUnlinkingProjId(projectId);
      await api.delete(`/spaces/${space.id}/linked-projects/${projectId}`);
      setFeedbackMsg(
        L(
          `'${projectTitle}' 프로젝트 연동을 해제했습니다.`,
          `「${projectTitle}」の連携を解除しました。`,
          `Unlinked '${projectTitle}'.`
        )
      );
      await onSaved(space.id);
    } catch (err: any) {
      setErrorMsg(err.message || L('연동 해제에 실패했습니다.', '連携解除に失敗しました。', 'Failed to unlink project.'));
    } finally {
      setUnlinkingProjId(null);
    }
  };

  const handleRemoveMember = async (memberUserId: number, memberName: string) => {
    if (!space) return;
    const isSelf = memberUserId === user?.id;
    const ok = window.confirm(
      isSelf
        ? isLinkedSpace
          ? L(
              '이 공유 스페이스에서 나가시겠습니까? 연결된 타인 소유 프로젝트에서도 함께 제거되며, 본인 소유 프로젝트는 데이터 보존 후 연동만 자동 해제됩니다.',
              'このスペースから退出しますか？連携された他メンバー所有プロジェクトからも除外され、自身の所有プロジェクトは連携のみ自動解除されます。',
              'Leave this space? You will also be removed from linked projects owned by others, while projects you own will be auto-unlinked with data preserved.'
            )
          : L('이 공유 스페이스에서 나가시겠습니까?', 'このスペースから退出しますか？', 'Leave this space?')
        : isLinkedSpace
          ? L(
              `${memberName}님을 스페이스에서 내보낼까요? 연결된 타인 소유 프로젝트에서도 함께 제거되며, 해당 멤버 소유 프로젝트는 연동만 자동 해제됩니다.`,
              `${memberName}さんをスペースから退出させますか？連携プロジェクトからも除外され、本人所有プロジェクトは連携のみ自動解除されます。`,
              `Remove ${memberName} from this space? They will also be removed from linked projects owned by others, while projects they own will be auto-unlinked.`
            )
          : L(`${memberName}님을 스페이스에서 내보낼까요?`, `${memberName}さんを退出させますか？`, `Remove ${memberName}?`)
    );
    if (!ok) return;
    try {
      await api.delete(`/spaces/${space.id}/members/${memberUserId}`);
      if (isSelf) {
        await onDeleted?.();
        onClose();
      } else {
        await onSaved(space.id);
      }
    } catch (err: any) {
      setErrorMsg(err.message || L('처리에 실패했습니다.', '処理に失敗しました。', 'Action failed.'));
    }
  };

  const handleDeleteSpace = async () => {
    if (!space) return;
    const ok = window.confirm(
      L(
        `'${space.name}' 스페이스와 안의 모든 일정·공유 메모를 영구 삭제할까요?`,
        `「${space.name}」と全ての予定・メモを完全に削除しますか？`,
        `Permanently delete '${space.name}' and all its events & thoughts?`
      )
    );
    if (!ok) return;
    try {
      setSaving(true);
      await api.delete(`/spaces/${space.id}`);
      await onDeleted?.();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || L('삭제에 실패했습니다.', '削除に失敗しました。', 'Delete failed.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setErrorMsg(L('스페이스 이름을 입력해 주세요.', 'スペース名を入力してください。', 'Please enter a space name.'));
      return;
    }
    setErrorMsg('');
    try {
      setSaving(true);
      if (mode === 'create') {
        const res = await api.post<{ id: number }>('/spaces', {
          name: name.trim(),
          description: description.trim(),
          color,
          labels,
        });
        await onSaved(res.id);
        onClose();
      } else if (space) {
        await api.patch(`/spaces/${space.id}`, {
          name: name.trim(),
          description: description.trim(),
          color,
          labels,
        });
        await onSaved(space.id);
        onClose();
      }
    } catch (err: any) {
      setErrorMsg(err.message || L('저장에 실패했습니다.', '保存に失敗しました。', 'Save failed.'));
    } finally {
      setSaving(false);
    }
  };

  const updateLabelName = (index: number, nextName: string) => {
    setLabels((prev) => prev.map((lb, idx) => (idx === index ? { ...lb, name: nextName } : lb)));
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="3xl"
      title={
        mode === 'create'
          ? L('새 공유 스페이스 만들기', '新しい共有スペースを作成', 'Create Shared Space')
          : L('공유 스페이스 설정 & 멤버 초대', 'スペース設定・メンバー招待', 'Space Settings & Members')
      }
    >
      <div className="space-y-5">
        {mode === 'edit' && managedLinkedProjects.length > 0 && (
          <div className="p-3 rounded-xl bg-indigo-50 border border-indigo-200 space-y-2.5 text-xs">
            <div className="flex items-start gap-2">
              <Link2 className="w-4 h-4 text-indigo-700 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-bold text-indigo-950">
                  {L(
                    `연동된 협업 프로젝트 (${managedLinkedProjects.length}개)`,
                    `連携中の協業プロジェクト (${managedLinkedProjects.length}件)`,
                    `Linked Collaboration Projects (${managedLinkedProjects.length})`
                  )}
                </div>
                <div className="text-[11px] text-indigo-700">
                  {L(
                    '스페이스에 멤버를 추가해도 프로젝트에 자동 투입되지 않으며, 스페이스 이탈 시 타인 소유 연결 프로젝트에서도 함께 제거됩니다.',
                    'スペースにメンバーを追加してもプロジェクトへ自動追加されません。スペース退出時は他者所有の連携プロジェクトからも除外されます。',
                    'New space members are not auto-added to linked projects. Leaving removes membership from linked projects owned by others.'
                  )}
                </div>
              </div>
            </div>
            <div className="divide-y divide-indigo-200/70 rounded-lg border border-indigo-200 bg-white overflow-hidden">
              {managedLinkedProjects.map((proj) => {
                const isMember = proj.is_member !== false;
                const canUnlink = isOwner || Number(proj.created_by) === Number(user?.id);
                return (
                  <div key={proj.id} className="px-3 py-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: proj.color || '#1B4D3E' }}
                      />
                      <div className="min-w-0">
                        <div className="font-bold text-charcoal-900 flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{proj.title}</span>
                          {!isMember && (
                            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-charcoal-100 text-charcoal-600 text-[10px] font-bold">
                              <Lock className="w-2.5 h-2.5" />
                              {L('비공개 · 미참여', '非公開・未参加', 'Private · Not joined')}
                            </span>
                          )}
                        </div>
                        {proj.owner_name && (
                          <div className="text-[10px] text-charcoal-500">
                            {L(`소유자: ${proj.owner_name}`, `オーナー: ${proj.owner_name}`, `Owner: ${proj.owner_name}`)}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {isMember && onJumpToLinkedProject ? (
                        <button
                          type="button"
                          onClick={() => {
                            onClose();
                            onJumpToLinkedProject(proj.id);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-indigo-700 hover:bg-indigo-800 text-white text-[11px] font-bold transition"
                        >
                          <BookMarked className="w-3 h-3" />
                          <span>{L('열기', '開く', 'Open')}</span>
                          <ExternalLink className="w-2.5 h-2.5" />
                        </button>
                      ) : !isMember ? (
                        <span
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-ivory-100 text-charcoal-400 text-[11px] font-bold cursor-not-allowed"
                          title={L('미참여 프로젝트 본문은 열람할 수 없습니다.', '未参加プロジェクトの本文は閲覧できません。', 'Cannot view content of projects you are not a member of.')}
                        >
                          <Lock className="w-3 h-3" />
                          <span>{L('열람 불가', '閲覧不可', 'No Access')}</span>
                        </span>
                      ) : null}
                      {canUnlink && (
                        <button
                          type="button"
                          disabled={unlinkingProjId === proj.id}
                          onClick={() => void handleUnlinkProject(proj.id, proj.title)}
                          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold transition disabled:opacity-50"
                        >
                          <Unlink2 className="w-3 h-3" />
                          <span>{L('연동 해제', '連携解除', 'Unlink')}</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

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

        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-charcoal-700 mb-1">
                {L('스페이스 이름', 'スペース名', 'Space Name')} *
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={L('스페이스 이름을 입력하세요', 'スペース名を入力', 'Enter space name')}
                className="w-full px-3 py-2 text-xs rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-charcoal-700 mb-1">
                {L('대표 색상', 'テーマカラー', 'Theme Color')}
              </label>
              <div className="flex items-center gap-2 py-1.5">
                {SPACE_COLOR_PRESETS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    className={`w-6 h-6 rounded-full transition transform ${
                      color === c ? 'ring-2 ring-offset-2 ring-charcoal-900 scale-110' : 'hover:scale-105'
                    }`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-charcoal-700 mb-1">
              {L('설명 (선택)', '説明（任意）', 'Description (optional)')}
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={L('이 공간의 목적을 짧게 적어보세요', 'このスペースの目的を入力', 'What is this space for?')}
              className="w-full px-3 py-2 text-xs rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-500"
            />
          </div>

          {/* Custom Label Names */}
          <div className="p-3 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-charcoal-800">
              <Tag className="w-3.5 h-3.5 text-forest-700" />
              <span>{L('캘린더 커스텀 카테고리명', 'カスタムカテゴリー名', 'Custom Calendar Categories')}</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {labels.map((lb, idx) => (
                <div key={lb.key} className="flex items-center gap-2 bg-white px-2.5 py-1.5 rounded-lg border border-ivory-200">
                  <span className="w-3.5 h-3.5 rounded-full shrink-0" style={{ backgroundColor: lb.color }} />
                  <input
                    type="text"
                    value={lb.name}
                    onChange={(e) => updateLabelName(idx, e.target.value)}
                    className="flex-1 min-w-0 text-xs bg-transparent focus:outline-none text-charcoal-800 font-medium"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              {L('취소', 'キャンセル', 'Cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              <Plus className="w-3.5 h-3.5 mr-1" />
              {mode === 'create' ? L('스페이스 만들기', '作成する', 'Create Space') : L('변경사항 저장', '変更を保存', 'Save Changes')}
            </Button>
          </div>
        </form>

        {/* Invite & Members Section (Edit Mode only) */}
        {mode === 'edit' && space && (
          <div className="pt-4 border-t border-ivory-200 space-y-4">
            {/* Invite Links */}
            {isLinkedSpace ? (
              <div className="space-y-3">
                {/* Owner Instant Invite Link (Owner Only) */}
                {isOwner && inviteUrl && (
                  <div className="p-3 rounded-xl bg-forest-50/70 border border-forest-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-forest-950 flex items-center gap-1.5">
                        <Link2 className="w-3.5 h-3.5 text-forest-700" />
                        {L('방장 전용 초대 링크 (즉시 합류)', 'オーナー専用招待リンク（即時参加）', 'Owner Invite Link (Instant Join)')}
                      </span>
                      <button
                        type="button"
                        onClick={() => void handleRegenerateInvite('owner')}
                        className="text-[11px] font-bold text-charcoal-600 hover:text-forest-800 inline-flex items-center gap-1"
                      >
                        <RefreshCw className="w-3 h-3" />
                        {L('재발급', '再発行', 'Regenerate')}
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={inviteUrl}
                        className="flex-1 min-w-0 px-3 py-1.5 text-[11px] font-mono bg-white border border-forest-200 rounded-lg text-charcoal-700"
                      />
                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopyInvite('owner')}>
                        {copiedKind === 'owner' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                        <span className="ml-1">{copiedKind === 'owner' ? L('복사됨', 'コピー済', 'Copied') : L('복사', 'コピー', 'Copy')}</span>
                      </Button>
                    </div>
                  </div>
                )}

                {/* Member Approval-Required Invite Link (Visible to both Owner & Member) */}
                {memberInviteUrl && (
                  <div className="p-3 rounded-xl bg-amber-50/70 border border-amber-200 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-700" />
                        {L('멤버용 초대 링크 (방장 승인 후 합류)', 'メンバー用招待リンク（オーナー承認制）', 'Member Invite Link (Owner Approval)')}
                      </span>
                      {isOwner && (
                        <button
                          type="button"
                          onClick={() => void handleRegenerateInvite('member')}
                          className="text-[11px] font-bold text-amber-800 hover:text-amber-950 inline-flex items-center gap-1"
                        >
                          <RefreshCw className="w-3 h-3" />
                          {L('재발급', '再発行', 'Regenerate')}
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        readOnly
                        value={memberInviteUrl}
                        className="flex-1 min-w-0 px-3 py-1.5 text-[11px] font-mono bg-white border border-amber-200 rounded-lg text-charcoal-700"
                      />
                      <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopyInvite('member')}>
                        {copiedKind === 'member' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                        <span className="ml-1">{copiedKind === 'member' ? L('복사됨', 'コピー済', 'Copied') : L('복사', 'コピー', 'Copy')}</span>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-charcoal-800 flex items-center gap-1.5">
                    <Link2 className="w-3.5 h-3.5 text-forest-700" />
                    {L('초대 링크로 멤버 초대', '招待リンクで招待', 'Invite via Link')}
                  </span>
                  {isOwner && (
                    <button
                      type="button"
                      onClick={() => void handleRegenerateInvite('owner')}
                      className="text-[11px] font-bold text-charcoal-500 hover:text-forest-800 inline-flex items-center gap-1"
                    >
                      <RefreshCw className="w-3 h-3" />
                      {L('링크 재발급', '再発行', 'Regenerate')}
                    </button>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    readOnly
                    value={inviteUrl}
                    className="flex-1 min-w-0 px-3 py-1.5 text-[11px] font-mono bg-ivory-50 border border-ivory-300 rounded-lg text-charcoal-700"
                  />
                  <Button type="button" size="sm" variant="secondary" onClick={() => void handleCopyInvite('owner')}>
                    {copiedKind === 'owner' ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                    <span className="ml-1">{copiedKind === 'owner' ? L('복사됨', 'コピー済', 'Copied') : L('복사', 'コピー', 'Copy')}</span>
                  </Button>
                </div>
              </div>
            )}

            {/* Invite by Email */}
            <form onSubmit={handleInviteByEmail} className="space-y-1.5">
              <label className="text-xs font-bold text-charcoal-800 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-forest-700" />
                {isLinkedSpace && !isOwner
                  ? L('가입된 회원 이메일로 초대 요청 (방장 승인 필요)', '登録済みメールで招待申請（オーナー承認制）', 'Request Invite by Email (Owner Approval)')
                  : L('가입된 회원 이메일로 바로 초대', '登録済みメールで直接招待', 'Direct Invite by Email')}
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder={L('초대할 이메일 또는 아이디를 입력하세요', '招待するメールまたはIDを入力', 'Enter email or ID to invite')}
                  className="flex-1 min-w-0 px-3 py-1.5 text-xs rounded-lg border border-ivory-300 focus:outline-none focus:ring-2 focus:ring-forest-500"
                />
                <Button type="submit" size="sm" disabled={saving || !inviteEmail.trim()}>
                  {isLinkedSpace && !isOwner ? L('승인 요청', '承認申請', 'Request') : L('초대', '招待', 'Invite')}
                </Button>
              </div>
            </form>

            {/* Pending Join Requests (Space Owner Approval) */}
            {pendingRequests.length > 0 && (
              <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 space-y-2">
                <div className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-amber-700" />
                  <span>
                    {L(
                      `스페이스 방장 승인 대기 목록 (${pendingRequests.length}건)`,
                      `スペースオーナー承認待ち (${pendingRequests.length}件)`,
                      `Pending Space Owner Approval (${pendingRequests.length})`
                    )}
                  </span>
                </div>
                <div className="divide-y divide-amber-200 border border-amber-200 rounded-xl overflow-hidden bg-white">
                  {pendingRequests.map((req) => (
                    <div key={req.id} className="px-3 py-2 flex items-center justify-between gap-2 text-xs">
                      <div className="min-w-0">
                        <div className="font-bold text-charcoal-900 flex items-center gap-1.5 flex-wrap">
                          <span className="truncate">{req.target_user_name}</span>
                          <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-900 text-[10px] font-bold">
                            {req.scope === 'SPACE_AND_PROJECT' && req.project_title
                              ? L(
                                  `스페이스+프로젝트: ${req.project_title}`,
                                  `スペース+PJ: ${req.project_title}`,
                                  `Space + Project: ${req.project_title}`
                                )
                              : L('스페이스 합류', 'スペース参加', 'Space Join')}
                          </span>
                        </div>
                        <div className="text-[11px] text-charcoal-500 truncate">
                          {req.invited_by_name
                            ? L(`요청자: ${req.invited_by_name}`, `申請者: ${req.invited_by_name}`, `Requested by: ${req.invited_by_name}`)
                            : L('멤버용 초대 링크 신청', 'メンバー用リンク経由', 'Via member invite link')}
                          {req.target_user_email ? ` · ${req.target_user_email}` : ''}
                        </div>
                      </div>
                      {req.can_resolve || isOwner ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            disabled={resolvingReqId === req.id}
                            onClick={() => void handleResolveJoinRequest(req.id, 'approve')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[11px] font-bold disabled:opacity-50"
                          >
                            <Check className="w-3 h-3" />
                            <span>{L('승인', '承認', 'Approve')}</span>
                          </button>
                          <button
                            type="button"
                            disabled={resolvingReqId === req.id}
                            onClick={() => void handleResolveJoinRequest(req.id, 'reject')}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-[11px] font-bold disabled:opacity-50"
                          >
                            <X className="w-3 h-3" />
                            <span>{L('거절', '却下', 'Decline')}</span>
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] font-bold text-amber-700 shrink-0">
                          {L('스페이스 방장 대기', 'スペースオーナー待ち', 'Awaiting space owner')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Members List */}
            <div className="space-y-2">
              <div className="text-xs font-bold text-charcoal-800 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-forest-700" />
                {L(`참여 멤버 (${space.members.length}명)`, `メンバー (${space.members.length}人)`, `Members (${space.members.length})`)}
              </div>
              <div className="divide-y divide-ivory-200 border border-ivory-200 rounded-xl overflow-hidden bg-white">
                {space.members.map((m) => (
                  <div key={m.user_id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                    <div className="min-w-0">
                      <div className="font-bold text-charcoal-900 flex items-center gap-1.5">
                        <span className="truncate">{m.name}</span>
                        {m.role === 'OWNER' && (
                          <span className="px-1.5 py-0.5 rounded bg-forest-100 text-forest-900 text-[10px] font-bold">
                            {L('방장', 'オーナー', 'Owner')}
                          </span>
                        )}
                        {m.user_id === user?.id && (
                          <span className="text-[10px] text-charcoal-400">({L('나', '自分', 'Me')})</span>
                        )}
                      </div>
                      <div className="text-[11px] text-charcoal-500 truncate">{m.email}</div>
                    </div>

                    {m.role !== 'OWNER' && (space.my_role === 'OWNER' || m.user_id === user?.id) && (
                      <button
                        type="button"
                        onClick={() => void handleRemoveMember(m.user_id, m.name)}
                        className="p-1.5 rounded-lg text-charcoal-400 hover:text-rose-700 hover:bg-rose-50 transition"
                        title={m.user_id === user?.id ? L('나가기', '退出', 'Leave') : L('내보내기', '削除', 'Remove')}
                      >
                        <UserMinus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Danger Zone */}
            {space.my_role === 'OWNER' && (
              <div className="pt-3 border-t border-ivory-200 flex justify-between items-center">
                <span className="text-[11px] text-charcoal-500">
                  {isLinkedSpace
                    ? L(
                        '스페이스를 삭제해도 연결된 모든 프로젝트와 기록은 유지되며 연동만 일괄 해제됩니다.',
                        'スペースを削除しても連携中のすべてのプロジェクトと記録は保持され、連携のみ解除されます。',
                        'Deleting this space only unlinks all linked projects; their logs and members are preserved.'
                      )
                    : L('방장 권한으로 스페이스를 영구 삭제할 수 있습니다.', 'オーナーはスペースを削除できます。', 'Owner can permanently delete this space.')}
                </span>
                <button
                  type="button"
                  onClick={() => void handleDeleteSpace()}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold text-rose-700 hover:bg-rose-50 border border-rose-200 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  {L('스페이스 삭제', 'スペース削除', 'Delete Space')}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};
