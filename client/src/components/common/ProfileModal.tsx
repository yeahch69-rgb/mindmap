import React, { useEffect, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellOff,
  CalendarDays,
  Check,
  Cloud,
  Download,
  Globe,
  Minus,
  Monitor,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Shield,
  Smartphone,
  User,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import {
  applyFontScale,
  FONT_SCALE_MOBILE_BREAKPOINT,
  parseFontScalePercent,
  useAuth,
} from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import {
  ensurePushSubscriptionSynced,
  isPushSupported,
  unsubscribeCurrentPush,
} from '../../utils/pushSync';
import { useModalBackHandler } from '../../utils/modalHistory';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  deferredInstallPrompt: BeforeInstallPromptEvent | null;
  onInstallPwa: () => Promise<boolean>;
  onOpenAdminUsers?: () => void;
  onOpenAdminShiftSync?: () => void;
}

export const ProfileModal: React.FC<ProfileModalProps> = ({
  isOpen,
  onClose,
  deferredInstallPrompt,
  onInstallPwa,
  onOpenAdminUsers,
  onOpenAdminShiftSync,
}) => {
  const { user, updatePreferences } = useAuth();
  const { L, language, setLanguage } = useLanguage();
  useModalBackHandler(isOpen && Boolean(user), onClose);

  const [name, setName] = useState(user?.name || '');
  const [desktopPercent, setDesktopPercent] = useState<number>(() =>
    parseFontScalePercent(user?.fontSize)
  );
  const [mobilePercent, setMobilePercent] = useState<number>(() =>
    parseFontScalePercent(user?.mobileFontSize || user?.fontSize)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Push states
  const [pushEnabled, setPushEnabled] = useState<boolean>(user?.pushEnabled !== false);
  const [subscribedCount, setSubscribedCount] = useState<number>(0);
  const [permissionState, setPermissionState] = useState<string>('default');
  const [isPushBusy, setIsPushBusy] = useState(false);
  const [pushFeedback, setPushFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );

  // Cloud sync states
  const [cloudSync, setCloudSync] = useState<{
    enabled: boolean;
    status: string;
    projectId: string | null;
    lastSyncedAt: string | null;
    message: string;
  } | null>(null);
  const [isSyncBusy, setIsSyncBusy] = useState(false);

  // PWA standalone check
  const [isStandalone, setIsStandalone] = useState(false);
  const [viewportWidth, setViewportWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280
  );
  const isIos =
    typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent || '');
  const isMobileViewport = viewportWidth < FONT_SCALE_MOBILE_BREAKPOINT;

  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!isOpen || !user) return;
    setName(user.name);
    setDesktopPercent(parseFontScalePercent(user.fontSize));
    setMobilePercent(parseFontScalePercent(user.mobileFontSize || user.fontSize));
    setPushEnabled(user.pushEnabled !== false);
    setSaveMessage(null);
    setPushFeedback(null);

    const standalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      Boolean((navigator as unknown as { standalone?: boolean }).standalone);
    setIsStandalone(standalone);

    if (typeof Notification !== 'undefined') {
      setPermissionState(Notification.permission);
    } else {
      setPermissionState('unsupported');
    }

    api
      .get<{ subscribedCount: number; pushEnabled: boolean }>('/push/status')
      .then((res) => {
        setSubscribedCount(res.subscribedCount || 0);
        setPushEnabled(res.pushEnabled);
      })
      .catch(() => {
        // ignore status error
      });

    if (user.role === 'ADMIN') {
      api
        .get<{ status: any }>('/system/cloud-sync')
        .then((res) => {
          if (res?.status) setCloudSync(res.status);
        })
        .catch(() => {
          // ignore cloud sync status error
        });
    } else {
      setCloudSync(null);
    }
    // Only re-initialize when modal opens (do not wipe saveMessage when user updates)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, user?.id]);

  // Live preview of font scale while editing
  const handleDesktopPercentChange = (next: number) => {
    const clamped = Math.min(150, Math.max(80, Math.round(next / 5) * 5));
    setDesktopPercent(clamped);
    applyFontScale(`${clamped}%`, 'desktop');
  };

  const handleMobilePercentChange = (next: number) => {
    const clamped = Math.min(150, Math.max(80, Math.round(next / 5) * 5));
    setMobilePercent(clamped);
    applyFontScale(`${clamped}%`, 'mobile');
  };

  const handleClose = () => {
    // Revert any unsaved font scale preview back to user's saved values
    if (user) {
      applyFontScale(user.fontSize || '100%', 'desktop');
      applyFontScale(user.mobileFontSize || user.fontSize || '100%', 'mobile');
    }
    onClose();
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsSaving(true);
    setSaveMessage(null);
    try {
      await updatePreferences({
        name: name.trim(),
        fontSize: `${desktopPercent}%`,
        mobileFontSize: `${mobilePercent}%`,
      });
      setSaveMessage({
        type: 'ok',
        text: L('설정이 저장되었습니다.', '設定を保存しました。', 'Settings saved.'),
      });
    } catch (err: any) {
      setSaveMessage({
        type: 'err',
        text:
          err?.message ||
          L('저장에 실패했습니다.', '保存に失敗しました。', 'Failed to save settings.'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleEnablePush = async () => {
    setIsPushBusy(true);
    setPushFeedback(null);
    try {
      const result = await ensurePushSubscriptionSynced(true);
      if (typeof Notification !== 'undefined') {
        setPermissionState(Notification.permission);
      }
      if (!result.ok) {
        const msg =
          result.reason === 'denied'
            ? L(
                '브라우저 알림 권한이 차단되어 있습니다. 주소창 왼쪽 자물쇠 아이콘에서 알림을 허용해주세요.',
                'ブラウザの通知権限がブロックされています。URLバー左側のアイコンから通知を許可してください。',
                'Browser notifications are blocked. Allow notifications from your browser site settings.'
              )
            : result.reason === 'unsupported'
              ? L(
                  '현재 환경에서는 웹 푸시를 지원하지 않습니다. (iOS는 "홈 화면에 추가" 후 앱에서 실행해주세요)',
                  'この環境ではWebプッシュが利用できません。(iOSは「ホーム画面に追加」後にアプリから開いてください)',
                  'Web Push is not supported in this context. On iOS, add to Home Screen first.'
                )
              : L(
                  '알림 권한이 허용되지 않았습니다.',
                  '通知が許可されませんでした。',
                  'Notification permission was not granted.'
                );
        setPushFeedback({ type: 'err', text: msg });
        return;
      }

      await updatePreferences({ pushEnabled: true });
      setPushEnabled(true);
      const status = await api
        .get<{ subscribedCount: number; pushEnabled: boolean }>('/push/status')
        .catch(() => null);
      if (status) setSubscribedCount(status.subscribedCount);

      setPushFeedback({
        type: 'ok',
        text: L(
          '이 기기에 푸시 알림이 활성화되었습니다.',
          'この端末でプッシュ通知が有効になりました。',
          'Push notifications enabled on this device.'
        ),
      });
    } finally {
      setIsPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    setIsPushBusy(true);
    setPushFeedback(null);
    try {
      await unsubscribeCurrentPush();
      await updatePreferences({ pushEnabled: false });
      setPushEnabled(false);
      const status = await api
        .get<{ subscribedCount: number; pushEnabled: boolean }>('/push/status')
        .catch(() => null);
      if (status) setSubscribedCount(status.subscribedCount);

      setPushFeedback({
        type: 'ok',
        text: L(
          '푸시 알림이 비활성화되었습니다.',
          'プッシュ通知を無効にしました。',
          'Push notifications disabled.'
        ),
      });
    } finally {
      setIsPushBusy(false);
    }
  };

  const handleSendTestPush = async () => {
    setIsPushBusy(true);
    setPushFeedback(null);
    try {
      const synced = await ensurePushSubscriptionSynced(true);
      if (typeof Notification !== 'undefined') {
        setPermissionState(Notification.permission);
      }
      if (!synced.ok) {
        setPushFeedback({
          type: 'err',
          text: L(
            '먼저 브라우저 알림 권한을 허용해야 테스트 알림을 보낼 수 있습니다.',
            '先にブラウザの通知許可が必要です。',
            'Please allow browser notifications first.'
          ),
        });
        return;
      }

      if (!pushEnabled) {
        await updatePreferences({ pushEnabled: true });
        setPushEnabled(true);
      }

      const res = await api.post<{ success: boolean; sent: number }>('/push/test');
      const status = await api
        .get<{ subscribedCount: number; pushEnabled: boolean }>('/push/status')
        .catch(() => null);
      if (status) setSubscribedCount(status.subscribedCount);

      if (res.sent > 0) {
        setPushFeedback({
          type: 'ok',
          text: L(
            `테스트 푸시 알림을 ${res.sent}개 기기로 전송했습니다.`,
            `テスト通知を ${res.sent} 台の端末に送信しました。`,
            `Sent test notification to ${res.sent} device(s).`
          ),
        });
      } else {
        setPushFeedback({
          type: 'err',
          text: L(
            '등록된 활성 푸시 기기가 없습니다. 알림을 다시 활성화해주세요.',
            '有効な登録端末がありません。再度有効にしてください。',
            'No active push subscription found. Please re-enable notifications.'
          ),
        });
      }
    } catch (err: any) {
      setPushFeedback({
        type: 'err',
        text:
          err?.message ||
          L(
            '테스트 알림 전송에 실패했습니다.',
            'テスト通知の送信に失敗しました。',
            'Failed to send test notification.'
          ),
      });
    } finally {
      setIsPushBusy(false);
    }
  };

  if (!isOpen || !user) return null;

  const pushSupported = isPushSupported();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4">
      <div className="bg-white rounded-2xl border border-ivory-300 shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-ivory-200 flex items-center justify-between bg-ivory-50/70">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-forest-800 text-white flex items-center justify-center shrink-0">
              <User className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm text-charcoal-900 truncate">
                {L('프로필 및 환경 설정', 'プロフィール・環境設定', 'Profile & Preferences')}
              </h2>
              <p className="text-[11px] text-charcoal-500 truncate">{user.email}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-charcoal-500 hover:text-charcoal-900 hover:bg-ivory-200 transition"
            aria-label={L('닫기', '閉じる', 'Close')}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Section 1: Profile & Font Scale */}
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-charcoal-700 mb-1">
                {L('표시 이름', '表示名', 'Display Name')}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 text-sm border border-ivory-300 rounded-xl bg-white focus:outline-none focus:border-forest-600"
                placeholder={L('이름 입력', '名前を入力', 'Your name')}
              />
            </div>

            {/* Language Selector (especially helpful on mobile where top switcher is compact) */}
            <div>
              <label className="flex items-center gap-1.5 text-xs font-bold text-charcoal-700 mb-1.5">
                <Globe className="w-3.5 h-3.5 text-forest-700" />
                {L('언어 설정', '言語設定', 'Language')}
              </label>
              <div className="grid grid-cols-3 gap-1.5 bg-ivory-100 p-1 rounded-xl border border-ivory-200">
                {(['ko', 'ja', 'en'] as const).map((lang) => (
                  <button
                    key={lang}
                    type="button"
                    onClick={() => setLanguage(lang)}
                    className={`py-1.5 rounded-lg text-xs font-bold transition ${
                      language === lang
                        ? 'bg-forest-800 text-white shadow-xs'
                        : 'text-charcoal-600 hover:text-charcoal-900'
                    }`}
                  >
                    {lang === 'ko' ? '한국어' : lang === 'ja' ? '日本語' : 'English'}
                  </button>
                ))}
              </div>
            </div>

            {/* Font Scale */}
            <div className="p-3.5 rounded-xl bg-ivory-50 border border-ivory-200 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-bold text-charcoal-900">
                    {L('글자 크기 조절', '文字サイズ調整', 'Font Size Scale')}
                  </div>
                  <p className="text-[11px] text-charcoal-500">
                    {L(
                      `100%가 사내 워크스페이스와 동일한 기본 크기입니다. (현재 창 너비 ${viewportWidth}px · ${
                        isMobileViewport ? '모바일(<1024px) 기준 적용' : 'PC(1024px 이상) 기준 적용'
                      })`,
                      `100%が社内ワークスペースと同じ標準サイズです。(現在幅 ${viewportWidth}px · ${
                        isMobileViewport ? 'モバイル基準適用中' : 'PC基準適用中'
                      })`,
                      `100% matches NYGC baseline. (Width ${viewportWidth}px · ${
                        isMobileViewport ? 'Mobile (<1024px)' : 'Desktop (>=1024px)'
                      } active)`
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    handleDesktopPercentChange(100);
                    handleMobilePercentChange(100);
                  }}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold bg-white border border-ivory-300 text-charcoal-700 hover:bg-ivory-100 shrink-0"
                >
                  <RotateCcw className="w-3 h-3" />
                  100%
                </button>
              </div>

              {/* PC / Desktop Font Scale */}
              <div
                className={`p-2.5 rounded-lg border ${
                  !isMobileViewport
                    ? 'bg-white border-forest-300 ring-1 ring-forest-200'
                    : 'bg-white/70 border-ivory-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-charcoal-800">
                    <Monitor className="w-3.5 h-3.5 text-forest-700" />
                    {L('PC 화면 글자 크기', 'PC画面の文字サイズ', 'Desktop Font Size')}
                    {!isMobileViewport && (
                      <span className="px-1.5 py-0.5 rounded bg-forest-100 text-forest-800 text-[10px]">
                        {L('현재 화면', '現在適用中', 'Active')}
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-bold text-forest-800 tabular-nums">
                    {desktopPercent}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleDesktopPercentChange(desktopPercent - 5)}
                    className="p-1 rounded-lg border border-ivory-300 hover:bg-ivory-100 text-charcoal-700"
                    title="-5%"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range"
                    min={80}
                    max={150}
                    step={5}
                    value={desktopPercent}
                    onChange={(e) => handleDesktopPercentChange(Number(e.target.value))}
                    className="flex-1 accent-forest-700"
                  />
                  <button
                    type="button"
                    onClick={() => handleDesktopPercentChange(desktopPercent + 5)}
                    className="p-1 rounded-lg border border-ivory-300 hover:bg-ivory-100 text-charcoal-700"
                    title="+5%"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Mobile Font Scale */}
              <div
                className={`p-2.5 rounded-lg border ${
                  isMobileViewport
                    ? 'bg-white border-forest-300 ring-1 ring-forest-200'
                    : 'bg-white/70 border-ivory-200'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-charcoal-800">
                    <Smartphone className="w-3.5 h-3.5 text-forest-700" />
                    {L('모바일 화면 글자 크기', 'モバイル画面の文字サイズ', 'Mobile Font Size')}
                    {isMobileViewport && (
                      <span className="px-1.5 py-0.5 rounded bg-forest-100 text-forest-800 text-[10px]">
                        {L('현재 화면', '現在適用中', 'Active')}
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-bold text-forest-800 tabular-nums">
                    {mobilePercent}%
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleMobilePercentChange(mobilePercent - 5)}
                    className="p-1 rounded-lg border border-ivory-300 hover:bg-ivory-100 text-charcoal-700"
                    title="-5%"
                  >
                    <Minus className="w-3.5 h-3.5" />
                  </button>
                  <input
                    type="range"
                    min={80}
                    max={150}
                    step={5}
                    value={mobilePercent}
                    onChange={(e) => handleMobilePercentChange(Number(e.target.value))}
                    className="flex-1 accent-forest-700"
                  />
                  <button
                    type="button"
                    onClick={() => handleMobilePercentChange(mobilePercent + 5)}
                    className="p-1 rounded-lg border border-ivory-300 hover:bg-ivory-100 text-charcoal-700"
                    title="+5%"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {saveMessage && (
              <div
                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 ${
                  saveMessage.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {saveMessage.type === 'ok' ? (
                  <Check className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{saveMessage.text}</span>
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={isSaving || !name.trim()}
                className="px-4 py-2 rounded-xl bg-forest-800 hover:bg-forest-900 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs"
              >
                {isSaving
                  ? L('저장 중...', '保存中...', 'Saving...')
                  : L('이름·글자크기 저장', 'プロフィール・文字サイズを保存', 'Save Profile & Font')}
              </button>
            </div>
          </form>

          <hr className="border-ivory-200" />

          {/* Section 2: PWA Install */}
          <div className="p-3.5 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Download className="w-4 h-4 text-forest-800 shrink-0" />
                <span className="text-xs font-bold text-charcoal-900">
                  {L('PWA 앱 설치', 'PWAアプリインストール', 'Install as App (PWA)')}
                </span>
              </div>
              {isStandalone && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold">
                  <Check className="w-3 h-3" />
                  {L('앱 모드로 실행 중', 'アプリモード起動中', 'Installed')}
                </span>
              )}
            </div>

            {isStandalone ? (
              <p className="text-[11px] text-charcoal-600">
                {L(
                  '홈 화면 / 데스크톱 앱으로 설치되어 실행 중입니다.',
                  'ホーム画面 / デスクトップアプリとしてインストール済みです。',
                  'Running as an installed standalone PWA.'
                )}
              </p>
            ) : deferredInstallPrompt ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] text-charcoal-600 flex-1 min-w-[200px]">
                  {L(
                    '브라우저 주소창 없이 단독 앱처럼 빠르고 편리하게 사용할 수 있습니다.',
                    'ブラウザの枠なしでアプリのように素早く起動できます。',
                    'Install on your home screen or desktop for an app-like experience.'
                  )}
                </p>
                <button
                  type="button"
                  onClick={() => void onInstallPwa()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-forest-800 hover:bg-forest-900 text-white text-xs font-bold transition shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  {L('앱으로 설치하기', 'アプリをインストール', 'Install App')}
                </button>
              </div>
            ) : isIos ? (
              <p className="text-[11px] text-charcoal-600 leading-relaxed">
                {L(
                  'iPhone / iPad에서는 Safari 하단 [공유(↑)] 버튼을 누른 뒤 [홈 화면에 추가]를 선택하면 앱으로 설치됩니다. (iOS 푸시 알림은 설치 후 앱 아이콘으로 실행해야 동작합니다)',
                  'iPhone / iPadでは Safari 下部の [共有] ボタンから「ホーム画面に追加」を選択するとアプリとして利用できます。（iOSのプッシュ通知も追加後のアプリから有効化できます）',
                  'On iPhone/iPad, tap Share in Safari and choose "Add to Home Screen".'
                )}
              </p>
            ) : (
              <p className="text-[11px] text-charcoal-600 leading-relaxed">
                {L(
                  'Chrome / Edge 우측 상단 메뉴 또는 주소창 우측 [앱 설치] 아이콘을 눌러 홈 화면/바탕화면에 설치할 수 있습니다.',
                  'Chrome / Edge のアドレスバー右側の「アプリをインストール」アイコン、またはブラウザメニューからインストールできます。',
                  'Use your browser address bar install icon or menu -> Install App.'
                )}
              </p>
            )}
          </div>

          {/* Section 3: Web Push Notifications */}
          <div className="p-3.5 rounded-xl bg-ivory-50 border border-ivory-200 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {pushEnabled && permissionState === 'granted' ? (
                  <Bell className="w-4 h-4 text-forest-800 shrink-0" />
                ) : (
                  <BellOff className="w-4 h-4 text-charcoal-500 shrink-0" />
                )}
                <div>
                  <div className="text-xs font-bold text-charcoal-900">
                    {L('푸시 알림 설정', 'プッシュ通知設定', 'Push Notifications')}
                  </div>
                  <p className="text-[11px] text-charcoal-500">
                    {L(
                      '협업 프로젝트 턴 넘김, 새 대화·아이디어, 방치 리마인드를 실시간으로 받습니다.',
                      'コラボ相手からのターン引継ぎ、新規記録・アイデア、放置リマインドを通知します。',
                      'Receive alerts for turn passes, new logs/ideas, and overdue reminders.'
                    )}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-[11px]">
              <span
                className={`px-2 py-0.5 rounded-full font-bold border ${
                  permissionState === 'granted'
                    ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                    : permissionState === 'denied'
                      ? 'bg-rose-50 text-rose-800 border-rose-200'
                      : 'bg-white text-charcoal-600 border-ivory-300'
                }`}
              >
                {L('브라우저 권한: ', '通知権限: ', 'Permission: ')}
                {permissionState === 'granted'
                  ? L('허용됨', '許可済み', 'Granted')
                  : permissionState === 'denied'
                    ? L('차단됨', 'ブロック中', 'Blocked')
                    : permissionState === 'unsupported'
                      ? L('미지원', '非対応', 'Unsupported')
                      : L('미설정', '未設定', 'Default')}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-white text-charcoal-700 border border-ivory-300 font-bold">
                {L(
                  `등록된 기기 ${subscribedCount}대`,
                  `登録端末 ${subscribedCount}台`,
                  `${subscribedCount} device(s)`
                )}
              </span>
            </div>

            {pushFeedback && (
              <div
                className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-start gap-2 ${
                  pushFeedback.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-rose-50 text-rose-800 border border-rose-200'
                }`}
              >
                {pushFeedback.type === 'ok' ? (
                  <Check className="w-4 h-4 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                )}
                <span>{pushFeedback.text}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              {pushEnabled && permissionState === 'granted' ? (
                <button
                  type="button"
                  disabled={isPushBusy}
                  onClick={() => void handleDisablePush()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-ivory-300 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 text-charcoal-700 text-xs font-bold transition disabled:opacity-50"
                >
                  <BellOff className="w-3.5 h-3.5" />
                  {L('이 기기 알림 끄기', 'この端末の通知をOFF', 'Disable Push')}
                </button>
              ) : (
                <button
                  type="button"
                  disabled={isPushBusy || !pushSupported}
                  onClick={() => void handleEnablePush()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-forest-800 hover:bg-forest-900 text-white text-xs font-bold transition disabled:opacity-50"
                >
                  <Bell className="w-3.5 h-3.5" />
                  {L('푸시 알림 켜기', 'プッシュ通知をONにする', 'Enable Push')}
                </button>
              )}

              <button
                type="button"
                disabled={isPushBusy || !pushSupported}
                onClick={() => void handleSendTestPush()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-forest-300 text-forest-900 hover:bg-forest-50 text-xs font-bold transition disabled:opacity-50"
              >
                <Send className="w-3.5 h-3.5" />
                {L('테스트 푸시 알림 보내기', 'テスト通知を送信', 'Send Test Push')}
              </button>
            </div>
          </div>

          {/* Section 4 (ADMIN ONLY): Admin Tools & Cloud DB Backup Status */}
          {user.role === 'ADMIN' && (
            <div className="space-y-3 pt-1">
              {onOpenAdminUsers && (
                <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Shield className="w-4 h-4 text-amber-800 shrink-0" />
                    <span className="text-xs font-bold text-amber-950 truncate">
                      {L('관리자 · 가입 계정 목록', '管理者 · 登録アカウント管理', 'Admin · Account Directory')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenAdminUsers}
                    className="px-3 py-1.5 rounded-lg bg-forest-800 hover:bg-forest-900 text-white text-[11px] font-bold transition shrink-0"
                  >
                    {L('계정 목록 보기', '一覧を見る', 'View Accounts')}
                  </button>
                </div>
              )}

              {onOpenAdminShiftSync && (
                <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <CalendarDays className="w-4 h-4 text-emerald-800 shrink-0" />
                    <span className="text-xs font-bold text-emerald-950 truncate">
                      {L('관리자 · NYGC 시프트 연동', '管理者 · NYGCシフト連携', 'Admin · NYGC Shift Sync')}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={onOpenAdminShiftSync}
                    className="px-3 py-1.5 rounded-lg bg-forest-800 hover:bg-forest-900 text-white text-[11px] font-bold transition shrink-0"
                  >
                    {L('연동 설정', '連携設定', 'Configure')}
                  </button>
                </div>
              )}

              {cloudSync && (
                <div className="p-3.5 rounded-xl bg-ivory-50 border border-ivory-200 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Cloud
                        className={`w-4 h-4 shrink-0 ${
                          cloudSync.status === 'ACTIVE'
                            ? 'text-emerald-700'
                            : cloudSync.status === 'ERROR'
                              ? 'text-rose-600'
                              : 'text-charcoal-500'
                        }`}
                      />
                      <span className="text-xs font-bold text-charcoal-900 truncate">
                        {L('클라우드 DB 자동 백업 (Firebase)', 'クラウド自動バックアップ', 'Cloud DB Backup (Firebase)')}
                      </span>
                    </div>
                    {cloudSync.enabled && (
                      <button
                        type="button"
                        disabled={isSyncBusy}
                        onClick={async () => {
                          setIsSyncBusy(true);
                          try {
                            const res = await api.post<{ ok: boolean; status: any }>(
                              '/system/cloud-sync/backup'
                            );
                            if (res?.status) setCloudSync(res.status);
                          } finally {
                            setIsSyncBusy(false);
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-white border border-ivory-300 hover:bg-ivory-100 text-[11px] font-bold text-charcoal-800 disabled:opacity-50 shrink-0"
                      >
                        <RefreshCw className={`w-3 h-3 ${isSyncBusy ? 'animate-spin' : ''}`} />
                        {L('지금 백업', '今すぐ保存', 'Backup Now')}
                      </button>
                    )}
                  </div>
                  <p className="text-[11px] text-charcoal-600 leading-relaxed">{cloudSync.message}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
