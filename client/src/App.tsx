import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BookMarked, Download, LogOut, SlidersHorizontal } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthScreen } from './components/auth/AuthScreen';
import {
  BeforeInstallPromptEvent,
  ProfileModal,
} from './components/common/ProfileModal';
import { ProjectJournal } from './pages/ProjectJournal';

const AppShell: React.FC = () => {
  const { user, isLoading, logout } = useAuth();
  const { L, language, setLanguage } = useLanguage();

  const [pendingInviteToken, setPendingInviteToken] = useState<string | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('invite');
    } catch {
      return null;
    }
  });

  const [initialProjectId, setInitialProjectId] = useState<number | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const raw = params.get('project');
      const parsed = raw ? Number(raw) : NaN;
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    } catch {
      return null;
    }
  });

  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [deferredInstallPrompt, setDeferredInstallPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (pendingInviteToken || initialProjectId) {
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      url.searchParams.delete('project');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [pendingInviteToken, initialProjectId]);

  useEffect(() => {
    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredInstallPrompt(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setDeferredInstallPrompt(null);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
    };
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onSwMessage = (event: MessageEvent) => {
      if (event.data?.type === 'MINDMAP_OPEN_PROJECT' && event.data?.url) {
        try {
          const parsedUrl = new URL(event.data.url, window.location.origin);
          const pid = Number(parsedUrl.searchParams.get('project'));
          if (Number.isFinite(pid) && pid > 0) {
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
  }, []);

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

  const handleConsumePendingInvite = useCallback(() => {
    setPendingInviteToken(null);
  }, []);

  const handleConsumeInitialProjectId = useCallback(() => {
    setInitialProjectId(null);
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-ivory-100 flex items-center justify-center text-xs font-bold text-charcoal-500">
        {L('워크스페이스 불러오는 중...', '読み込み中...', 'Loading workspace...')}
      </div>
    );
  }

  if (!user) {
    return <AuthScreen pendingInviteToken={pendingInviteToken} />;
  }

  return (
    <div className="min-h-screen bg-ivory-100 flex flex-col">
      {/* Top Navbar */}
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-ivory-300">
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-12 flex items-center justify-between gap-2 sm:gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-forest-800 text-white flex items-center justify-center shrink-0">
              <BookMarked className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm text-charcoal-900 truncate">
              {L('프로젝트 마인드맵', 'プロジェクトマインドマップ', 'Project Mindmap')}
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

      {/* Main Content */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 py-4">
        <ProjectJournal
          pendingInviteToken={pendingInviteToken}
          onConsumePendingInvite={handleConsumePendingInvite}
          initialProjectId={initialProjectId}
          onConsumeInitialProjectId={handleConsumeInitialProjectId}
        />
      </main>

      <ProfileModal
        isOpen={isProfileOpen}
        onClose={() => setIsProfileOpen(false)}
        deferredInstallPrompt={deferredInstallPrompt}
        onInstallPwa={handleInstallPwa}
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
