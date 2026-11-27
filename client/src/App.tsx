import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Bell, BookMarked, Download, LogOut, Shield, SlidersHorizontal } from 'lucide-react';
import { api, getStoredToken } from './api/client';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthScreen } from './components/auth/AuthScreen';
import { AdminModalTab, AdminUsersModal } from './components/common/AdminUsersModal';
import {
  BeforeInstallPromptEvent,
  ProfileModal,
} from './components/common/ProfileModal';
import { DesktopSidebar, MobileBottomNav } from './components/layout/AppNavigation';
import { SpaceSettingsModal } from './components/spaces/SpaceSettingsModal';
import { ActivityFeedModal } from './components/spaces/ActivityFeedModal';
import { SharedCalendarPage } from './components/calendar/SharedCalendarPage';
import { SharedThoughtsPage } from './components/thoughts/SharedThoughtsPage';
import { ProjectJournal } from './pages/ProjectJournal';
import { CollabSpace, MainNavTab, MyPendingJoinRequest } from './types/spaces';

const ACTIVE_TAB_KEY = 'pj_active_tab';
const ACTIVE_SPACE_KEY = 'pj_active_space_id';
const SIDEBAR_COLLAPSED_KEY = 'pj_sidebar_collapsed';

const AppShell: React.FC = () => {
  const { user, isLoading, logout } = useAuth();
  const { L, language, setLanguage } = useLanguage();

  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('invite');
    } catch {
      return null;
    }
  });

  const [pendingSpaceInviteToken, setPendingSpaceInviteToken] = useState<string | null>(() => {
    try {
      return new URLSearchParams(window.location.search).get('spaceInvite');
    } catch {
      return null;
    }
  });

  const [initialProjectId, setInitialProjectId] = useState<number | null>(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get('project');
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  });

  const [activeTab, setActiveTabState] = useState<MainNavTab>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTab = params.get('tab');
      if (urlTab === 'calendar' || urlTab === 'thoughts' || urlTab === 'mindmap') {
        return urlTab;
      }
      if (params.get('spaceInvite')) return 'calendar';
      const saved = localStorage.getItem(ACTIVE_TAB_KEY);
      if (saved === 'calendar' || saved === 'thoughts' || saved === 'mindmap') return saved;
    } catch {}
    return 'mindmap';
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1';
    } catch {
      return false;
    }
  });

  const [spaces, setSpaces] = useState<CollabSpace[]>([]);
  const [myPendingJoinRequests, setMyPendingJoinRequests] = useState<MyPendingJoinRequest[]>([]);
  const [activeSpaceId, setActiveSpaceIdState] = useState<number | null>(() => {
    try {
      const urlSpace = Number(new URLSearchParams(window.location.search).get('space'));
      if (Number.isFinite(urlSpace) && urlSpace > 0) return urlSpace;
      const saved = Number(localStorage.getItem(ACTIVE_SPACE_KEY));
      if (Number.isFinite(saved) && saved > 0) return saved;
    } catch {}
    return null;
  });

  // Bidirectional jump focus targets (Calendar <-> Thoughts <-> Activity Feed <-> Push)
  const [calendarFocusEventId, setCalendarFocusEventId] = useState<number | null>(() => {
    try {
      const raw = Number(new URLSearchParams(window.location.search).get('event'));
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    } catch {
      return null;
    }
  });
  const [calendarFocusDate, setCalendarFocusDate] = useState<string | null>(() => {
    try {
      const raw = new URLSearchParams(window.location.search).get('date');
      return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
    } catch {
      return null;
    }
  });
  const [thoughtFocusId, setThoughtFocusId] = useState<number | null>(() => {
    try {
      const raw = Number(new URLSearchParams(window.location.search).get('thought'));
      return Number.isFinite(raw) && raw > 0 ? raw : null;
    } catch {
      return null;
    }
  });

  // SSE realtime tick
  const [realtimeTick, setRealtimeTick] = useState(0);

  // Modals
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isAdminUsersOpen, setIsAdminUsersOpen] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState<AdminModalTab>('users');
  const [spaceModalMode, setSpaceModalMode] = useState<'create' | 'edit' | null>(null);
  const [spaceModalTarget, setSpaceModalTarget] = useState<CollabSpace | null>(null);
  const [activityFeedOpen, setActivityFeedOpen] = useState(false);
  const [spaceJoinBanner, setSpaceJoinBanner] = useState('');

  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  const setActiveTab = useCallback((tab: MainNavTab) => {
    setActiveTabState(tab);
    try {
      localStorage.setItem(ACTIVE_TAB_KEY, tab);
    } catch {}
  }, []);

  const setActiveSpaceId = useCallback((spaceId: number | null) => {
    setActiveSpaceIdState(spaceId);
    try {
      if (spaceId) localStorage.setItem(ACTIVE_SPACE_KEY, String(spaceId));
      else localStorage.removeItem(ACTIVE_SPACE_KEY);
    } catch {}
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_KEY, next ? '1' : '0');
      } catch {}
      return next;
    });
  }, []);

  // Clean URL params after initial capture
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const keys = ['invite', 'spaceInvite', 'project', 'tab', 'space', 'event', 'thought', 'date'];
      let changed = false;
      for (const k of keys) {
        if (url.searchParams.has(k)) {
          url.searchParams.delete(k);
          changed = true;
        }
      }
      if (changed) {
        window.history.replaceState({ ...(window.history.state || {}) }, '', url.pathname + url.search);
      }
    } catch {}
  }, []);

  // Load spaces whenever logged in
  const loadSpaces = useCallback(
    async (preferSpaceId?: number) => {
      if (!user) return;
      try {
        const res = await api.get<{
          spaces: CollabSpace[];
          my_pending_join_requests?: MyPendingJoinRequest[];
        }>('/spaces');
        const list = res.spaces || [];
        setSpaces(list);
        setMyPendingJoinRequests(res.my_pending_join_requests || []);
        setActiveSpaceIdState((cur) => {
          const desired = preferSpaceId || cur;
          if (desired && list.some((s) => s.id === desired)) {
            try {
              localStorage.setItem(ACTIVE_SPACE_KEY, String(desired));
            } catch {}
            return desired;
          }
          const fallback = list[0]?.id ?? null;
          if (fallback) {
            try {
              localStorage.setItem(ACTIVE_SPACE_KEY, String(fallback));
            } catch {}
          }
          return fallback;
        });
      } catch {
        // ignore transient error
      }
    },
    [user?.id]
  );

  useEffect(() => {
    if (user) {
      void loadSpaces();
    } else {
      setSpaces([]);
    }
  }, [user?.id, loadSpaces]);

  // Handle pending Space Invite Token right after login
  useEffect(() => {
    if (!user || !pendingSpaceInviteToken) return;
    let active = true;
    const joinSpace = async () => {
      try {
        const res = await api.post<{
          spaceId: number;
          name: string;
          pendingApproval?: boolean;
          alreadyPending?: boolean;
        }>(`/spaces/join/${encodeURIComponent(pendingSpaceInviteToken)}`);
        if (!active) return;
        setPendingSpaceInviteToken(null);
        if (res.pendingApproval) {
          await loadSpaces();
          setSpaceJoinBanner(
            res.alreadyPending
              ? L(
                  `'${res.name}' 스페이스 참여 요청이 이미 방장 승인 대기 중입니다.`,
                  `「${res.name}」への参加申請はすでにオーナー承認待ちです。`,
                  `Your join request for '${res.name}' is already awaiting owner approval.`
                )
              : L(
                  `'${res.name}' 스페이스 참여 요청을 보냈습니다! 스페이스 방장이 승인하면 공유 스페이스에 합류됩니다.`,
                  `「${res.name}」への参加申請を送信しました！オーナー承認後に共有スペースへ参加します。`,
                  `Join request sent for '${res.name}'! You will join the shared space once the owner approves.`
                )
          );
          window.setTimeout(() => setSpaceJoinBanner(''), 6000);
          return;
        }
        await loadSpaces(res.spaceId);
        setActiveTab('calendar');
        setSpaceJoinBanner(
          L(
            `'${res.name}' 공유 스페이스에 참여했습니다!`,
            `「${res.name}」共有スペースに参加しました！`,
            `Joined shared space '${res.name}'!`
          )
        );
        window.setTimeout(() => setSpaceJoinBanner(''), 4000);
      } catch (err: any) {
        if (!active) return;
        setPendingSpaceInviteToken(null);
        setSpaceJoinBanner(err.message || L('스페이스 초대에 실패했습니다.', '招待の参加に失敗しました。', 'Invite failed.'));
        window.setTimeout(() => setSpaceJoinBanner(''), 4000);
      }
    };
    void joinSpace();
    return () => {
      active = false;
    };
  }, [user?.id, pendingSpaceInviteToken, loadSpaces, setActiveTab, L]);

  // Subscribe to SSE realtime stream for the active space
  useEffect(() => {
    if (!user || !activeSpaceId) return;
    const token = getStoredToken();
    if (!token) return;

    const es = new EventSource(`/api/spaces/${activeSpaceId}/stream?token=${encodeURIComponent(token)}`);
    const onSpaceUpdate = () => {
      setRealtimeTick((t) => t + 1);
      void loadSpaces();
    };
    es.addEventListener('space_update', onSpaceUpdate);

    const onWindowFocus = () => {
      setRealtimeTick((t) => t + 1);
      void loadSpaces();
    };
    window.addEventListener('focus', onWindowFocus);

    return () => {
      es.removeEventListener('space_update', onSpaceUpdate);
      es.close();
      window.removeEventListener('focus', onWindowFocus);
    };
  }, [user?.id, activeSpaceId, loadSpaces]);

  // PWA Install Prompt
  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => setDeferredInstallPrompt(null);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  // Service Worker Push Notification Click Navigation
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'MINDMAP_OPEN_PROJECT' && event.data?.url) {
        try {
          const parsedUrl = new URL(event.data.url, window.location.origin);
          const pid = Number(parsedUrl.searchParams.get('project'));
          const tab = parsedUrl.searchParams.get('tab');
          const space = Number(parsedUrl.searchParams.get('space'));
          const evId = Number(parsedUrl.searchParams.get('event'));
          const thId = Number(parsedUrl.searchParams.get('thought'));
          const focusDate = parsedUrl.searchParams.get('date');

          if (tab === 'calendar' || tab === 'thoughts') {
            setActiveTab(tab);
            if (Number.isFinite(space) && space > 0) setActiveSpaceId(space);
            if (focusDate && /^\d{4}-\d{2}-\d{2}$/.test(focusDate)) setCalendarFocusDate(focusDate);
            if (Number.isFinite(evId) && evId > 0) setCalendarFocusEventId(evId);
            if (Number.isFinite(thId) && thId > 0) setThoughtFocusId(thId);
          } else if (Number.isFinite(pid) && pid > 0) {
            setActiveTab('mindmap');
            setInitialProjectId(pid);
          }
        } catch {
          // ignore invalid url
        }
      }
    };
    navigator.serviceWorker.addEventListener('message', onSwMessage);
    return () => {
      navigator.serviceWorker.removeEventListener('message', onSwMessage);
    };
  }, [setActiveTab, setActiveSpaceId]);

  const handleInstallPwa = useCallback(async (): Promise<boolean> => {
    if (!deferredInstallPrompt) return false;
    try {
      await deferredInstallPrompt.prompt();
      const choice = await deferredInstallPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredInstallPrompt(null);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, [deferredInstallPrompt]);

  const handleConsumePendingInvite = useCallback(() => setPendingInviteToken(null), []);
  const handleConsumeInitialProjectId = useCallback(() => setInitialProjectId(null), []);
  const handleConsumeCalendarFocus = useCallback(() => {
    setCalendarFocusEventId(null);
    setCalendarFocusDate(null);
  }, []);
  const handleConsumeThoughtFocus = useCallback(() => setThoughtFocusId(null), []);

  const handleJumpToCalendarEvent = useCallback(
    (eventId: number, startDate?: string) => {
      if (startDate) setCalendarFocusDate(startDate);
      setCalendarFocusEventId(eventId);
      setActiveTab('calendar');
    },
    [setActiveTab]
  );

  const handleJumpToSpaceEvent = useCallback(
    (spaceId: number, eventId: number, startDate?: string) => {
      setActiveSpaceId(spaceId);
      if (startDate) setCalendarFocusDate(startDate);
      setCalendarFocusEventId(eventId);
      setActiveTab('calendar');
    },
    [setActiveSpaceId, setActiveTab]
  );

  const handleJumpToThought = useCallback(
    (thoughtId: number) => {
      setThoughtFocusId(thoughtId);
      setActiveTab('thoughts');
    },
    [setActiveTab]
  );

  const handleJumpToSpaceThought = useCallback(
    (spaceId: number, thoughtId: number) => {
      setActiveSpaceId(spaceId);
      setThoughtFocusId(thoughtId);
      setActiveTab('thoughts');
    },
    [setActiveSpaceId, setActiveTab]
  );

  const handleJumpToMindmapProject = useCallback(
    (projectId: number) => {
      setInitialProjectId(projectId);
      setActiveTab('mindmap');
    },
    [setActiveTab]
  );

  const handleJumpToLinkedSpace = useCallback(
    (spaceId: number) => {
      setActiveSpaceId(spaceId);
      setActiveTab('calendar');
      void loadSpaces(spaceId);
    },
    [setActiveSpaceId, setActiveTab, loadSpaces]
  );

  const liveSpaceModalTarget = useMemo(() => {
    if (!spaceModalTarget) return null;
    return spaces.find((s) => s.id === spaceModalTarget.id) || spaceModalTarget;
  }, [spaces, spaceModalTarget]);

  const activeSpace = useMemo(
    () => spaces.find((s) => s.id === activeSpaceId) || spaces[0] || null,
    [spaces, activeSpaceId]
  );

  const totalUnread = useMemo(() => spaces.reduce((sum, s) => sum + (s.unread_count || 0), 0), [spaces]);
  const totalProposed = useMemo(() => spaces.reduce((sum, s) => sum + (s.proposed_event_count || 0), 0), [spaces]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ivory-100 flex items-center justify-center text-xs font-bold text-charcoal-500">
        {L('워크스페이스 불러오는 중...', '読み込み中...', 'Loading workspace...')}
      </div>
    );
  }

  if (!user) {
    return (
      <AuthScreen
        pendingInviteToken={pendingInviteToken}
        pendingSpaceInviteToken={pendingSpaceInviteToken}
      />
    );
  }

  return (
    <div className="min-h-screen bg-white lg:bg-ivory-100 flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-ivory-300">
        <div className="px-3 sm:px-5 h-12 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-forest-800 text-white flex items-center justify-center shrink-0">
              <BookMarked className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm text-charcoal-900 truncate">
              {activeTab === 'calendar'
                ? L('공유 캘린더', '共有カレンダー', 'Shared Calendar')
                : activeTab === 'thoughts'
                  ? L('공유 메모장', '共有メモ帳', 'Shared Thought Pad')
                  : L('프로젝트 마인드맵', 'プロジェクトマインドマップ', 'Project Mindmap')}
            </span>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <div className="hidden sm:flex items-center bg-ivory-100 border border-ivory-300 rounded-lg p-0.5 text-[11px] font-bold">
              {(['ko', 'ja', 'en'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  className={`px-2 py-0.5 rounded transition ${
                    language === lang ? 'bg-forest-800 text-white' : 'text-charcoal-600 hover:text-charcoal-900'
                  }`}
                >
                  {lang === 'ko' ? '한국어' : lang === 'ja' ? '日本語' : 'EN'}
                </button>
              ))}
            </div>

            {deferredInstallPrompt && (
              <button
                type="button"
                onClick={() => void handleInstallPwa()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-forest-800 hover:bg-forest-900 text-white text-[11px] font-bold transition shadow-xs"
                title={L('PWA 앱 설치', 'アプリをインストール', 'Install PWA')}
              >
                <Download className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{L('앱 설치', 'インストール', 'Install')}</span>
              </button>
            )}

            {user.role === 'ADMIN' && (
              <button
                type="button"
                onClick={() => {
                  setAdminModalTab('users');
                  setIsAdminUsersOpen(true);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-100 hover:bg-amber-200 text-amber-950 border border-amber-300 text-xs font-bold transition"
                title={L('관리자 · 회원 관리 및 NYGC 시프트 연동', '管理者 · 会員管理・NYGCシフト連携', 'Admin · Users & Shift Sync')}
              >
                <Shield className="w-3.5 h-3.5 shrink-0" />
                <span className="hidden sm:inline">{L('관리자', '管理者', 'Admin')}</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => setIsProfileOpen(true)}
              className={`p-1.5 rounded-lg transition ${
                user.pushEnabled !== false
                  ? 'text-forest-800 hover:bg-forest-50'
                  : 'text-charcoal-400 hover:text-charcoal-700 hover:bg-ivory-100'
              }`}
              title={L('푸시 알림 및 설정', '通知・設定', 'Notifications & Settings')}
            >
              <Bell className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => setIsProfileOpen(true)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-forest-50 hover:bg-forest-100 text-forest-900 border border-forest-200 text-xs font-bold max-w-[150px] transition"
              title={L('프로필 · 글자 크기 · 푸시 설정', 'プロフィール・文字サイズ・通知設定', 'Profile & Preferences')}
            >
              <SlidersHorizontal className="w-3 h-3 shrink-0" />
              <span className="truncate">{user.name}</span>
            </button>

            <button
              type="button"
              onClick={logout}
              className="p-1.5 rounded-lg text-charcoal-500 hover:text-rose-700 hover:bg-rose-50 transition"
              title={L('로그아웃', 'ログアウト', 'Sign Out')}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Space Invite Join Banner */}
      {spaceJoinBanner && (
        <div className="bg-emerald-700 text-white text-xs font-bold text-center py-2 px-4">
          {spaceJoinBanner}
        </div>
      )}

      {/* Pending Owner-Approval Banner */}
      {myPendingJoinRequests.length > 0 && activeTab !== 'mindmap' && (
        <div className="bg-sky-50 border-b border-sky-200 text-sky-950 text-xs font-bold text-center py-1.5 px-4">
          {L(
            `⏳ 방장 승인 대기 중인 초대 ${myPendingJoinRequests.length}건: ${myPendingJoinRequests.map((r) => r.space_name || r.project_title).join(', ')}`,
            `⏳ オーナー承認待ちの招待 ${myPendingJoinRequests.length}件: ${myPendingJoinRequests.map((r) => r.space_name || r.project_title).join('・')}`,
            `⏳ ${myPendingJoinRequests.length} invite(s) pending owner approval: ${myPendingJoinRequests.map((r) => r.space_name || r.project_title).join(', ')}`
          )}
        </div>
      )}

      {/* Body: PC Left Sidebar + Main Workspace */}
      <div className="flex-1 flex min-w-0">
        <DesktopSidebar
          activeTab={activeTab}
          onSelectTab={setActiveTab}
          collapsed={sidebarCollapsed}
          onToggleCollapse={toggleSidebar}
          spaces={spaces}
          activeSpaceId={activeSpace?.id ?? null}
          onSelectSpace={(sid) => setActiveSpaceId(sid)}
          onOpenCreateSpace={() => {
            setSpaceModalTarget(null);
            setSpaceModalMode('create');
          }}
          onOpenSpaceSettings={(sp) => {
            setSpaceModalTarget(sp);
            setSpaceModalMode('edit');
          }}
        />

        <main
          className={`flex-1 min-w-0 w-full px-2 sm:px-3 lg:px-5 py-3 lg:py-4 pb-20 lg:pb-6 ${
            activeTab === 'mindmap' ? 'max-w-7xl mx-auto' : ''
          }`}
        >
          {activeTab === 'mindmap' && (
            <ProjectJournal
              pendingInviteToken={pendingInviteToken}
              onConsumePendingInvite={handleConsumePendingInvite}
              initialProjectId={initialProjectId}
              onConsumeInitialProjectId={handleConsumeInitialProjectId}
              spaces={spaces}
              activeSpaceId={activeSpace?.id ?? null}
              onJumpToSpaceThought={handleJumpToSpaceThought}
              onJumpToSpaceEvent={handleJumpToSpaceEvent}
              onJumpToLinkedSpace={handleJumpToLinkedSpace}
              onSpacesNeedRefresh={() => void loadSpaces()}
              realtimeTick={realtimeTick}
            />
          )}

          {activeTab === 'calendar' && (
            <SharedCalendarPage
              spaces={spaces}
              activeSpace={activeSpace}
              onSelectSpace={(sid) => setActiveSpaceId(sid)}
              onOpenCreateSpace={() => {
                setSpaceModalTarget(null);
                setSpaceModalMode('create');
              }}
              onOpenSpaceSettings={(sp) => {
                setSpaceModalTarget(sp);
                setSpaceModalMode('edit');
              }}
              onOpenActivityFeed={() => setActivityFeedOpen(true)}
              onJumpToThought={handleJumpToThought}
              onJumpToMindmapProject={handleJumpToMindmapProject}
              onSpacesNeedRefresh={() => void loadSpaces()}
              realtimeTick={realtimeTick}
              initialFocusEventId={calendarFocusEventId}
              initialFocusDate={calendarFocusDate}
              onConsumeInitialFocus={handleConsumeCalendarFocus}
            />
          )}

          {activeTab === 'thoughts' && (
            <SharedThoughtsPage
              spaces={spaces}
              activeSpace={activeSpace}
              onSelectSpace={(sid) => setActiveSpaceId(sid)}
              onOpenCreateSpace={() => {
                setSpaceModalTarget(null);
                setSpaceModalMode('create');
              }}
              onOpenSpaceSettings={(sp) => {
                setSpaceModalTarget(sp);
                setSpaceModalMode('edit');
              }}
              onOpenActivityFeed={() => setActivityFeedOpen(true)}
              onJumpToCalendarEvent={handleJumpToCalendarEvent}
              onJumpToMindmapProject={handleJumpToMindmapProject}
              onSpacesNeedRefresh={() => void loadSpaces()}
              realtimeTick={realtimeTick}
              initialFocusThoughtId={thoughtFocusId}
              onConsumeInitialFocus={handleConsumeThoughtFocus}
            />
          )}
        </main>
      </div>

      {/* Tablet / Mobile Fixed Bottom Quick-Access Panel */}
      <MobileBottomNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        unreadCount={totalUnread}
        proposedCount={totalProposed}
      />

      {/* Global Modals */}
      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        deferredInstallPrompt={deferredInstallPrompt}
        onInstallPwa={handleInstallPwa}
        onOpenAdminUsers={() => {
          setIsProfileOpen(false);
          setAdminModalTab('users');
          setIsAdminUsersOpen(true);
        }}
        onOpenAdminShiftSync={() => {
          setIsProfileOpen(false);
          setAdminModalTab('shift-sync');
          setIsAdminUsersOpen(true);
        }}
      />

      <AdminUsersModal
        isOpen={isAdminUsersOpen}
        onClose={() => setIsAdminUsersOpen(false)}
        initialTab={adminModalTab}
        onShiftSyncChanged={() => setRealtimeTick((t) => t + 1)}
      />

      <SpaceSettingsModal
        isOpen={Boolean(spaceModalMode)}
        onClose={() => setSpaceModalMode(null)}
        mode={spaceModalMode || 'create'}
        space={liveSpaceModalTarget}
        onJumpToLinkedProject={handleJumpToMindmapProject}
        onSaved={async (sid) => {
          await loadSpaces(sid);
          setRealtimeTick((t) => t + 1);
          if (spaceModalMode === 'create' && sid && activeTab === 'mindmap') {
            setActiveTab('calendar');
          }
        }}
        onDeleted={async () => {
          setActiveSpaceId(null);
          await loadSpaces();
          setRealtimeTick((t) => t + 1);
        }}
      />

      <ActivityFeedModal
        isOpen={activityFeedOpen}
        onClose={() => setActivityFeedOpen(false)}
        space={activeSpace}
        onJumpToEvent={(eventId, startDate) => handleJumpToCalendarEvent(eventId, startDate)}
        onJumpToThought={(thoughtId) => handleJumpToThought(thoughtId)}
        onMarkedRead={() => void loadSpaces()}
      />
    </div>
  );
};

export function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppShell />
      </AuthProvider>
    </LanguageProvider>
  );
}

export default App;
