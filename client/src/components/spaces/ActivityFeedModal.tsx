import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  CalendarDays,
  CheckCheck,
  Lightbulb,
  MessageSquare,
  Sparkles,
  Users,
} from 'lucide-react';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';
import { CollabSpace, SpaceActivity } from '../../types/spaces';
import { formatJstTime, getJstDateKey } from '../../utils/dateTime';
import { Modal } from '../common/Modal';

interface ActivityFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  space: CollabSpace | null;
  onJumpToEvent: (eventId: number, startDate?: string) => void;
  onJumpToThought: (thoughtId: number) => void;
  onMarkedRead: () => void;
}

export const ActivityFeedModal: React.FC<ActivityFeedModalProps> = ({
  isOpen,
  onClose,
  space,
  onJumpToEvent,
  onJumpToThought,
  onMarkedRead,
}) => {
  const { L } = useLanguage();
  const [activities, setActivities] = useState<SpaceActivity[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || !space) return;
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const res = await api.get<{ activities: SpaceActivity[] }>(`/spaces/${space.id}/activities`);
        if (active) setActivities(res.activities || []);
        await api.post(`/spaces/${space.id}/activities/read`);
        onMarkedRead();
      } catch {
        // ignore
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [isOpen, space?.id]);

  const renderIcon = (act: SpaceActivity) => {
    if (act.activity_type === 'EVENT_COMMENT') return <MessageSquare className="w-4 h-4 text-sky-700" />;
    if (act.activity_type === 'EVENT_PROPOSED' || act.activity_type === 'EVENT_CONFIRMED')
      return <Sparkles className="w-4 h-4 text-amber-700" />;
    if (act.target_type === 'EVENT') return <CalendarDays className="w-4 h-4 text-forest-700" />;
    if (act.target_type === 'THOUGHT') {
      if (act.meta?.isImportant) return <AlertCircle className="w-4 h-4 text-rose-600" />;
      return <Lightbulb className="w-4 h-4 text-amber-600" />;
    }
    return <Users className="w-4 h-4 text-charcoal-600" />;
  };

  const formatActivitySummary = (act: SpaceActivity) => {
    if (act.activity_type === 'THOUGHT_CREATED' && act.meta && typeof act.meta.title === 'string') {
      const actor = String(act.meta.actorName || act.actor_name || '');
      const title = act.meta.title;
      if (act.meta.isImportant) {
        return L(
          `[중요 메모] ${actor}님이 중요 메모를 등록했습니다: "${title}"`,
          `[重要メモ] ${actor}さんが重要メモを投稿しました：「${title}」`,
          `[Important] ${actor} posted an important note: "${title}"`
        );
      }
      return L(
        `${actor}님이 새 생각을 던졌습니다: "${title}"`,
        `${actor}さんが新しいメモを投稿しました：「${title}」`,
        `${actor} dropped a new thought: "${title}"`
      );
    }
    return act.summary;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      size="2xl"
      title={
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-forest-700" />
          <span>
            {space?.name} · {L('새 소식 (활동 피드)', '新着フィード', 'Activity Feed')}
          </span>
        </div>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between text-[11px] text-charcoal-500">
          <span>
            {L(
              '스페이스의 일정 변경·채팅·생각·날짜 제안 이력을 최신순으로 확인합니다.',
              'スペースの予定変更・チャット・メモ・日程提案の履歴を表示します。',
              'Recent events, chats, thoughts, and date proposals in this space.'
            )}
          </span>
          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold shrink-0">
            <CheckCheck className="w-3.5 h-3.5" />
            {L('읽음 처리됨', '既読', 'Read')}
          </span>
        </div>

        {loading ? (
          <div className="py-10 text-center text-xs text-charcoal-500">
            {L('불러오는 중...', '読み込み中...', 'Loading...')}
          </div>
        ) : activities.length === 0 ? (
          <div className="py-12 text-center text-xs text-charcoal-400">
            {L('아직 기록된 활동이 없습니다.', 'まだアクティビティはありません。', 'No activity yet.')}
          </div>
        ) : (
          <div className="divide-y divide-ivory-200 border border-ivory-200 rounded-xl overflow-hidden bg-white">
            {activities.map((act) => {
              const clickable = (act.target_type === 'EVENT' || act.target_type === 'THOUGHT') && act.target_id;
              return (
                <button
                  key={act.id}
                  type="button"
                  disabled={!clickable}
                  onClick={() => {
                    if (!act.target_id) return;
                    if (act.target_type === 'EVENT') {
                      onJumpToEvent(act.target_id, typeof act.meta?.startDate === 'string' ? act.meta.startDate : undefined);
                      onClose();
                    } else if (act.target_type === 'THOUGHT') {
                      onJumpToThought(act.target_id);
                      onClose();
                    }
                  }}
                  className={`w-full flex items-start gap-3 px-3.5 py-3 text-left transition ${
                    act.is_unread ? 'bg-amber-50/60' : 'bg-white'
                  } ${clickable ? 'hover:bg-ivory-50 cursor-pointer' : 'cursor-default'}`}
                >
                  <div className="w-8 h-8 rounded-full bg-ivory-100 border border-ivory-200 flex items-center justify-center shrink-0 mt-0.5">
                    {renderIcon(act)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs text-charcoal-900 font-medium leading-snug break-words">
                      {act.is_unread && (
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-rose-600 mr-1.5 align-middle" />
                      )}
                      {formatActivitySummary(act)}
                    </div>
                    <div className="text-[10px] text-charcoal-400 mt-1">
                      {getJstDateKey(act.created_at)} {formatJstTime(act.created_at)}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};
