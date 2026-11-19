import React, { useCallback, useEffect, useState } from 'react';
import { BookMarked, LogOut } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider, useLanguage } from './context/LanguageContext';
import { AuthScreen } from './components/auth/AuthScreen';
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

  useEffect(() => {
    if (pendingInviteToken) {
      const url = new URL(window.location.href);
      url.searchParams.delete('invite');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, [pendingInviteToken]);

  const handleConsumePendingInvite = useCallback(() => {
    setPendingInviteToken(null);
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
        <div className="max-w-7xl mx-auto px-3 sm:px-6 h-12 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-forest-800 text-white flex items-center justify-center shrink-0">
              <BookMarked className="w-4 h-4" />
            </div>
            <span className="font-bold text-sm text-charcoal-900 truncate">
              {L('프로젝트 저널', 'プロジェクト日誌', 'Project Journal')}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
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

            <span className="px-2.5 py-1 rounded-full bg-forest-50 text-forest-900 border border-forest-200 text-xs font-bold max-w-[140px] truncate">
              {user.name}
            </span>

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
        />
      </main>
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
