import React from 'react';
import {
  BookMarked,
  CalendarDays,
  Lightbulb,
  Link2,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Users,
  Lock,
  Settings,
} from 'lucide-react';
import { CollabSpace, MainNavTab } from '../../types/spaces';
import { useLanguage } from '../../context/LanguageContext';

interface DesktopSidebarProps {
  activeTab: MainNavTab;
  onSelectTab: (tab: MainNavTab) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  spaces: CollabSpace[];
  activeSpaceId: number | null;
  onSelectSpace: (spaceId: number) => void;
  onOpenCreateSpace: () => void;
  onOpenSpaceSettings: (space: CollabSpace) => void;
}

export const DesktopSidebar: React.FC<DesktopSidebarProps> = ({
  activeTab,
  onSelectTab,
  collapsed,
  onToggleCollapse,
  spaces,
  activeSpaceId,
  onSelectSpace,
  onOpenCreateSpace,
  onOpenSpaceSettings,
}) => {
  const { L } = useLanguage();
  const totalUnread = spaces.reduce((sum, s) => sum + (s.unread_count || 0), 0);
  const totalProposed = spaces.reduce((sum, s) => sum + (s.proposed_event_count || 0), 0);

  const navItems: Array<{
    id: MainNavTab;
    label: string;
    desc: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }> = [
    {
      id: 'mindmap',
      label: L('프로젝트 마인드맵', 'マインドマップ', 'Mindmap'),
      desc: L('맥락 · 턴 · 타임라인', '文脈・ターン・記録', 'Context & Turns'),
      icon: BookMarked,
    },
    {
      id: 'calendar',
      label: L('공유 캘린더', '共有カレンダー', 'Calendar'),
      desc: L('공유 일정 · 실시간 채팅', '共有予定・チャット', 'Team Calendar & Chat'),
      icon: CalendarDays,
      badge: totalProposed > 0 ? totalProposed : undefined,
    },
    {
      id: 'thoughts',
      label: L('공유 메모장', '共有メモ帳', 'Thought Pad'),
      desc: L('생각 공유 · 제안 · 투표', '思考共有・提案・投票', 'Ideas & Consensus'),
      icon: Lightbulb,
      badge: totalUnread > 0 ? totalUnread : undefined,
    },
  ];

  return (
    <aside
      className={`hidden lg:flex flex-col shrink-0 sticky top-12 h-[calc(100vh-3rem)] bg-white border-r border-ivory-300 transition-all duration-200 z-20 ${
        collapsed ? 'w-[68px]' : 'w-64'
      }`}
    >
      {/* Top toggle row */}
      <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-3 py-2.5 border-b border-ivory-200`}>
        {!collapsed && (
          <span className="text-[11px] font-bold uppercase tracking-wider text-charcoal-400">
            {L('워크스페이스 메뉴', 'メニュー', 'Workspace')}
          </span>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-charcoal-500 hover:text-charcoal-900 hover:bg-ivory-100 transition"
          title={
            collapsed
              ? L('사이드메뉴 펼치기', 'メニューを展開', 'Expand sidebar')
              : L('사이드메뉴 접기', 'メニューを折りたたむ', 'Collapse sidebar')
          }
        >
          {collapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>
      </div>

      {/* Main 3 navigation tabs */}
      <nav className="p-2 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              title={collapsed ? item.label : undefined}
              className={`w-full flex items-center gap-2.5 rounded-xl transition text-left relative ${
                collapsed ? 'justify-center px-2 py-2.5' : 'px-3 py-2.5'
              } ${
                isActive
                  ? 'bg-forest-800 text-white shadow-xs'
                  : 'text-charcoal-700 hover:bg-ivory-100 hover:text-charcoal-900'
              }`}
            >
              <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-white' : 'text-forest-700'}`} />
              {!collapsed && (
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold leading-tight truncate">{item.label}</div>
                  <div
                    className={`text-[10px] leading-tight truncate mt-0.5 ${
                      isActive ? 'text-forest-100' : 'text-charcoal-400'
                    }`}
                  >
                    {item.desc}
                  </div>
                </div>
              )}
              {item.badge !== undefined && item.badge > 0 && (
                <span
                  className={`${
                    collapsed ? 'absolute top-1 right-1 min-w-[16px] h-4 px-1 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'
                  } rounded-full font-bold inline-flex items-center justify-center ${
                    isActive ? 'bg-amber-400 text-charcoal-950' : 'bg-rose-600 text-white'
                  }`}
                >
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Shared Spaces Section */}
      <div className="mt-2 pt-3 border-t border-ivory-200 flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className={`flex items-center ${collapsed ? 'justify-center' : 'justify-between'} px-3 pb-2`}>
          {!collapsed && (
            <span className="text-[11px] font-bold uppercase tracking-wider text-charcoal-400">
              {L('공유 스페이스', '共有スペース', 'Shared Spaces')}
            </span>
          )}
          <button
            type="button"
            onClick={onOpenCreateSpace}
            className="p-1 rounded-md text-forest-700 hover:bg-forest-50 transition"
            title={L('새 공유 스페이스 만들기', '新規スペース作成', 'Create Shared Space')}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-1">
          {spaces.map((space) => {
            const selected = space.id === activeSpaceId;
            return (
              <div
                key={space.id}
                className={`group flex items-center gap-2 rounded-xl transition ${
                  collapsed ? 'justify-center p-1.5' : 'px-2.5 py-2'
                } ${
                  selected && activeTab !== 'mindmap'
                    ? 'bg-forest-50 border border-forest-200 text-forest-950'
                    : 'hover:bg-ivory-100 text-charcoal-700 border border-transparent'
                }`}
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectSpace(space.id);
                    if (activeTab === 'mindmap') {
                      onSelectTab('calendar');
                    }
                  }}
                  title={collapsed ? `${space.name} (${space.members.length})` : undefined}
                  className={`flex items-center gap-2 min-w-0 flex-1 text-left ${collapsed ? 'justify-center' : ''}`}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 ring-2 ring-white shadow-xs"
                    style={{ backgroundColor: space.color }}
                  />
                  {!collapsed && (
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold truncate">{space.name}</span>
                        {((space.linked_project_count || 0) > 0 || space.linked_project) && (
                          <Link2
                            className="w-3 h-3 text-indigo-600 shrink-0"
                            aria-label={L('프로젝트 연동됨', 'プロジェクト連携中', 'Linked to project')}
                          />
                        )}
                        {space.members.length > 1 ? (
                          <Users className="w-3 h-3 text-charcoal-400 shrink-0" />
                        ) : (
                          <Lock className="w-2.5 h-2.5 text-charcoal-400 shrink-0" />
                        )}
                      </div>
                      <div className="text-[10px] text-charcoal-400 flex items-center gap-1.5 flex-wrap">
                        <span>{L(`${space.members.length}명`, `${space.members.length}人`, `${space.members.length}`)}</span>
                        {(space.pending_join_request_count || 0) > 0 && (
                          <span className="text-amber-700 font-bold">
                            · {L(`승인대기 ${space.pending_join_request_count}`, `承認待ち ${space.pending_join_request_count}`, `${space.pending_join_request_count} pending`)}
                          </span>
                        )}
                        {space.proposed_event_count > 0 && (
                          <span className="text-amber-700 font-bold">
                            · {L(`제안 ${space.proposed_event_count}`, `提案 ${space.proposed_event_count}`, `${space.proposed_event_count} prop`)}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </button>

                {!collapsed && space.unread_count > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[10px] font-bold shrink-0">
                    {space.unread_count > 99 ? '99+' : space.unread_count}
                  </span>
                )}

                {!collapsed && (
                  <button
                    type="button"
                    onClick={() => onOpenSpaceSettings(space)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-charcoal-400 hover:text-charcoal-800 hover:bg-white transition shrink-0"
                    title={L('스페이스 설정 · 초대', 'スペース設定・招待', 'Space Settings')}
                  >
                    <Settings className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
};

interface MobileBottomNavProps {
  activeTab: MainNavTab;
  onSelectTab: (tab: MainNavTab) => void;
  unreadCount: number;
  proposedCount: number;
}

export const MobileBottomNav: React.FC<MobileBottomNavProps> = ({
  activeTab,
  onSelectTab,
  unreadCount,
  proposedCount,
}) => {
  const { L } = useLanguage();

  const items: Array<{
    id: MainNavTab;
    label: string;
    icon: React.FC<{ className?: string }>;
    badge?: number;
  }> = [
    {
      id: 'mindmap',
      label: L('마인드맵', 'マインドマップ', 'Mindmap'),
      icon: BookMarked,
    },
    {
      id: 'calendar',
      label: L('공유 캘린더', 'カレンダー', 'Calendar'),
      icon: CalendarDays,
      badge: proposedCount > 0 ? proposedCount : undefined,
    },
    {
      id: 'thoughts',
      label: L('공유 메모장', '共有メモ', 'Thoughts'),
      icon: Lightbulb,
      badge: unreadCount > 0 ? unreadCount : undefined,
    },
  ];

  return (
    <nav
      data-mobile-nav="true"
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t border-ivory-300 shadow-[0_-4px_16px_rgba(0,0,0,0.06)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
    >
      <div className="grid grid-cols-3 h-14 max-w-2xl mx-auto">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onSelectTab(item.id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 transition ${
                isActive ? 'text-forest-800' : 'text-charcoal-500 hover:text-charcoal-800'
              }`}
            >
              {isActive && <span className="absolute top-0 inset-x-6 h-0.5 rounded-b-full bg-forest-800" />}
              <div className="relative">
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.3]' : ''}`} />
                {item.badge !== undefined && item.badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                )}
              </div>
              <span className={`text-[10px] leading-tight ${isActive ? 'font-bold' : 'font-medium'}`}>
                {item.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
