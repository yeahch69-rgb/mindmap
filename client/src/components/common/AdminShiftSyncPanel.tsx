import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CalendarDays,
  Check,
  Clock,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { api } from '../../api/client';
import { useLanguage } from '../../context/LanguageContext';

interface ShiftSyncAdminConfig {
  enabled: boolean;
  feedUrl: string;
  hasToken: boolean;
  tokenPreview: string | null;
  enabledSpaceIds: number[];
  syncIntervalMinutes: number;
  initialSyncCompleted: boolean;
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastSyncStatus: 'IDLE' | 'OK' | 'ERROR';
  lastSyncError: string | null;
  lastShiftCount: number;
  cachedShiftCount: number;
  lastChangeSummary: string | null;
  updatedAt: string | null;
}

interface ShiftSyncSpaceOption {
  id: number;
  name: string;
  color: string;
  isPersonal: boolean;
  memberCount: number;
  memberNames: string[];
}

interface ShiftSyncAdminView {
  config: ShiftSyncAdminConfig;
  spaces: ShiftSyncSpaceOption[];
}

interface AdminShiftSyncPanelProps {
  isOpen: boolean;
  onUpdated?: () => void;
}

export const AdminShiftSyncPanel: React.FC<AdminShiftSyncPanelProps> = ({ isOpen, onUpdated }) => {
  const { L } = useLanguage();

  const [view, setView] = useState<ShiftSyncAdminView | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [feedUrl, setFeedUrl] = useState('');
  const [feedTokenInput, setFeedTokenInput] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [enabledSpaceIds, setEnabledSpaceIds] = useState<number[]>([]);
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState<number>(20);
  const [confirmClearToken, setConfirmClearToken] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const applyView = useCallback((res: ShiftSyncAdminView) => {
    setView(res);
    setEnabled(Boolean(res.config.enabled));
    setFeedUrl(res.config.feedUrl || '');
    setEnabledSpaceIds(res.config.enabledSpaceIds || []);
    setSyncIntervalMinutes(res.config.syncIntervalMinutes || 20);
  }, []);

  const loadView = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await api.get<ShiftSyncAdminView>('/admin/nygc-shift-sync');
      applyView(res);
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text:
          err?.message ||
          L(
            '시프트 연동 설정을 불러오지 못했습니다.',
            'シフト連携設定を読み込めませんでした。',
            'Failed to load shift sync settings.'
          ),
      });
    } finally {
      setIsLoading(false);
    }
  }, [applyView, L]);

  useEffect(() => {
    if (isOpen) {
      setFeedTokenInput('');
      setShowTokenInput(false);
      setConfirmClearToken(false);
      setFeedback(null);
      void loadView();
    }
  }, [isOpen, loadView]);

  const toggleSpaceId = (spaceId: number) => {
    setEnabledSpaceIds((prev) =>
      prev.includes(spaceId) ? prev.filter((id) => id !== spaceId) : [...prev, spaceId]
    );
  };

  const hasUnsavedChanges = (() => {
    if (!view) return false;
    const cfg = view.config;
    const curSpaces = [...enabledSpaceIds].sort((a, b) => a - b).join(',');
    const savedSpaces = [...(cfg.enabledSpaceIds || [])].sort((a, b) => a - b).join(',');
    return (
      enabled !== cfg.enabled ||
      feedUrl.trim() !== (cfg.feedUrl || '').trim() ||
      feedTokenInput.trim().length > 0 ||
      syncIntervalMinutes !== cfg.syncIntervalMinutes ||
      curSpaces !== savedSpaces
    );
  })();

  const persistSettings = async (clearToken = false): Promise<ShiftSyncAdminView | null> => {
    const res = await api.put<ShiftSyncAdminView & { success: boolean }>('/admin/nygc-shift-sync', {
      enabled,
      feedUrl: feedUrl.trim(),
      feedToken: feedTokenInput.trim() || undefined,
      clearToken,
      enabledSpaceIds,
      syncIntervalMinutes,
    });
    applyView(res);
    setFeedTokenInput('');
    setConfirmClearToken(false);
    onUpdated?.();
    return res;
  };

  const handleSave = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setIsSaving(true);
    setFeedback(null);
    try {
      await persistSettings(false);
      setFeedback({
        type: 'ok',
        text: L(
          'NYGC 시프트 연동 설정이 저장되었습니다.',
          'NYGCシフト連携設定を保存しました。',
          'NYGC shift sync settings saved.'
        ),
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text:
          err?.message ||
          L('설정 저장에 실패했습니다.', '設定の保存に失敗しました。', 'Failed to save settings.'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleClearToken = async () => {
    setIsSaving(true);
    setFeedback(null);
    try {
      await persistSettings(true);
      setFeedback({
        type: 'ok',
        text: L(
          '저장된 토큰을 삭제했습니다.',
          '保存済みトークンを削除しました。',
          'Stored token cleared.'
        ),
      });
    } catch (err: any) {
      setFeedback({
        type: 'err',
        text:
          err?.message ||
          L('토큰 삭제에 실패했습니다.', 'トークン削除に失敗しました。', 'Failed to clear token.'),
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setFeedback(null);
    try {
      if (hasUnsavedChanges) {
        await persistSettings(false);
      }
      const res = await api.post<
        ShiftSyncAdminView & {
          success: boolean;
          result: {
            initialLoad: boolean;
            shiftCount: number;
            diffCount: number;
            pushSent: number;
            summary: string | null;
          };
        }
      >('/admin/nygc-shift-sync/sync-now', {});
      applyView(res);
      onUpdated?.();

      const r = res.result;
      if (r.initialLoad) {
        setFeedback({
          type: 'ok',
          text: L(
            `초기 적재 완료: 시프트 ${r.shiftCount}일치를 로컬 DB에 캐시했습니다. (초기 적재 시 푸시 생략)`,
            `初期取り込み完了：シフト${r.shiftCount}日分をローカルDBにキャッシュしました。（初回はプッシュ通知を省略）`,
            `Initial load complete: cached ${r.shiftCount} shift day(s). (Initial push skipped)`
          ),
        });
      } else if (r.diffCount > 0) {
        setFeedback({
          type: 'ok',
          text: L(
            `동기화 완료: ${r.diffCount}건 변경 감지 (전체 ${r.shiftCount}일 캐시 · 푸시 ${r.pushSent}대 발송)`,
            `同期完了：${r.diffCount}件の変更を検出（計${r.shiftCount}日分キャッシュ・通知${r.pushSent}台送信）`,
            `Synced: ${r.diffCount} change(s) detected (${r.shiftCount} days cached · ${r.pushSent} push sent)`
          ),
        });
      } else {
        setFeedback({
          type: 'ok',
          text: L(
            `동기화 완료: 변경 사항 없음 (전체 ${r.shiftCount}일 캐시 최신 상태)`,
            `同期完了：変更なし（計${r.shiftCount}日分キャッシュ最新）`,
            `Synced: no changes (${r.shiftCount} shift days up to date)`
          ),
        });
      }
    } catch (err: any) {
      await loadView();
      setFeedback({
        type: 'err',
        text:
          err?.message ||
          L('수동 동기화에 실패했습니다.', '手動同期に失敗しました。', 'Manual sync failed.'),
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const cfg = view?.config;

  return (
    <div className="space-y-4">
      {/* Intro & Security Note */}
      <div className="p-3 rounded-xl bg-emerald-50/70 border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-950">
        <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
        <div className="space-y-0.5 leading-relaxed">
          <div className="font-bold">
            {L(
              'NYGC → Mindmap 관리자 전용 시프트 단방향 동기화',
              'NYGC → Mindmap 管理者専用シフト片方向同期',
              'NYGC → Mindmap Admin-Only Shift Sync'
            )}
          </div>
          <p className="text-[11px] text-emerald-900/90">
            {L(
              'NYGC Admin 프로필 설정에서 발급한 피드 URL과 비공개 토큰을 등록하면 서버가 주기적으로 날짜·근무유형만 가져와 로컬 DB에 캐시하고, 아래 선택한 공유 스페이스 달력에 컴팩트 배지로 표시합니다.',
              'NYGC管理者プロフィール設定で発行したフィードURLと非公開トークンを登録すると、サーバーが定期的に日付と勤務区分のみを取得してキャッシュし、選択した共有スペースのカレンダーにバッジ表示します。',
              'Connect using the private feed URL & token from NYGC Admin Profile. The server periodically caches shift types locally and renders compact badges on selected shared calendars.'
            )}
          </p>
        </div>
      </div>

      {/* Status Summary Card */}
      <div className="p-3.5 rounded-xl bg-white border border-ivory-300 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-forest-800" />
            <span className="text-xs font-bold text-charcoal-900">
              {L('동기화 상태 (JST 기준)', '同期ステータス (JST)', 'Sync Status (JST)')}
            </span>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                cfg?.lastSyncStatus === 'OK'
                  ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                  : cfg?.lastSyncStatus === 'ERROR'
                    ? 'bg-rose-100 text-rose-900 border-rose-300'
                    : 'bg-stone-100 text-stone-700 border-stone-200'
              }`}
            >
              {cfg?.lastSyncStatus === 'OK'
                ? L('정상 (OK)', '正常 (OK)', 'OK')
                : cfg?.lastSyncStatus === 'ERROR'
                  ? L('오류 (ERROR)', 'エラー (ERROR)', 'ERROR')
                  : L('대기 (IDLE)', '待機 (IDLE)', 'IDLE')}
            </span>
          </div>

          <button
            type="button"
            disabled={isSyncing || isSaving || isLoading}
            onClick={() => void handleSyncNow()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-forest-800 hover:bg-forest-900 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
            <span>
              {isSyncing
                ? L('동기화 중...', '同期中...', 'Syncing...')
                : L('지금 즉시 동기화', '今すぐ同期', 'Sync Now')}
            </span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[11px]">
          <div className="p-2 rounded-lg bg-ivory-50 border border-ivory-200">
            <div className="text-charcoal-500">{L('마지막 동기화 성공', '最終同期成功', 'Last Success')}</div>
            <div className="font-mono font-bold text-charcoal-900 mt-0.5">
              {cfg?.lastSuccessAt || '-'}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-ivory-50 border border-ivory-200">
            <div className="text-charcoal-500">{L('마지막 시도 시각', '最終試行時刻', 'Last Attempt')}</div>
            <div className="font-mono font-bold text-charcoal-900 mt-0.5">
              {cfg?.lastSyncAt || '-'}
            </div>
          </div>
          <div className="p-2 rounded-lg bg-ivory-50 border border-ivory-200 col-span-2 sm:col-span-1">
            <div className="text-charcoal-500">{L('캐시된 시프트', 'キャッシュ件数', 'Cached Shifts')}</div>
            <div className="font-mono font-bold text-forest-800 mt-0.5">
              {L(
                `${cfg?.cachedShiftCount ?? 0}일`,
                `${cfg?.cachedShiftCount ?? 0}日分`,
                `${cfg?.cachedShiftCount ?? 0} day(s)`
              )}
              {cfg?.initialSyncCompleted && (
                <span className="ml-1.5 text-[10px] font-sans font-semibold text-emerald-700">
                  ({L('초기적재 완료', '初期完了', 'Initialized')})
                </span>
              )}
            </div>
          </div>
        </div>

        {cfg?.lastChangeSummary && (
          <div className="text-[11px] text-charcoal-600 bg-ivory-50 px-2.5 py-1.5 rounded-lg border border-ivory-200">
            <span className="font-bold text-charcoal-700">
              {L('최근 변경:', '直近の変更:', 'Latest change:')}
            </span>{' '}
            {cfg.lastChangeSummary}
          </div>
        )}

        {cfg?.lastSyncError && (
          <div className="text-[11px] text-rose-800 bg-rose-50 px-2.5 py-1.5 rounded-lg border border-rose-200 flex items-start gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            <span className="break-all">
              {L('최근 오류:', '直近エラー:', 'Last error:')} {cfg.lastSyncError}
            </span>
          </div>
        )}
      </div>

      {/* Settings Form */}
      <form onSubmit={handleSave} className="p-3.5 rounded-xl bg-white border border-ivory-300 space-y-4">
        {/* Enable Toggle & Sync Interval */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-ivory-200">
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              role="switch"
              aria-checked={enabled}
              onClick={() => setEnabled((v) => !v)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                enabled ? 'bg-forest-800' : 'bg-charcoal-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <div>
              <div className="text-xs font-bold text-charcoal-900">
                {enabled
                  ? L('시프트 연동 활성화됨 (ON)', 'シフト連携 有効 (ON)', 'Shift Sync Enabled (ON)')
                  : L('시프트 연동 비활성화됨 (OFF)', 'シフト連携 無効 (OFF)', 'Shift Sync Disabled (OFF)')}
              </div>
              <div className="text-[11px] text-charcoal-500">
                {L(
                  '끄면 자동 동기화·달력 배지 표시·변경 푸시 알림이 모두 중단됩니다.',
                  'OFFにすると自動同期・バッジ表示・変更通知がすべて停止します。',
                  'Disabling pauses auto-sync, calendar badges, and change push alerts.'
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-xs">
            <Clock className="w-3.5 h-3.5 text-forest-700" />
            <span className="font-bold text-charcoal-700">
              {L('자동 주기', '自動間隔', 'Interval')}
            </span>
            <select
              value={syncIntervalMinutes}
              onChange={(e) => setSyncIntervalMinutes(Number(e.target.value))}
              className="px-2 py-1 rounded-lg border border-ivory-300 bg-ivory-50 text-xs font-bold text-charcoal-800 focus:outline-none focus:border-forest-600"
            >
              <option value={15}>{L('15분마다', '15分ごと', 'Every 15m')}</option>
              <option value={20}>{L('20분마다', '20分ごと', 'Every 20m')}</option>
              <option value={30}>{L('30분마다', '30分ごと', 'Every 30m')}</option>
            </select>
          </div>
        </div>

        {/* Feed URL */}
        <div className="space-y-1">
          <label className="flex items-center gap-1.5 text-xs font-bold text-charcoal-800">
            <Link2 className="w-3.5 h-3.5 text-forest-700" />
            <span>{L('NYGC 시프트 피드 URL', 'NYGC シフトフィードURL', 'NYGC Shift Feed URL')}</span>
          </label>
          <input
            type="url"
            value={feedUrl}
            onChange={(e) => setFeedUrl(e.target.value)}
            placeholder="https://your-nygc-server.onrender.com/api/shifts/external-feed"
            className="w-full px-3 py-2 rounded-xl border border-ivory-300 bg-ivory-50 focus:bg-white text-xs font-mono text-charcoal-900 focus:outline-none focus:border-forest-600"
          />
        </div>

        {/* Private Token */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-charcoal-800">
              <KeyRound className="w-3.5 h-3.5 text-forest-700" />
              <span>{L('NYGC 비공개 연동 토큰', 'NYGC 非公開連携トークン', 'NYGC Private Sync Token')}</span>
            </label>
            {cfg?.hasToken && (
              <div className="flex items-center gap-1.5">
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 text-[10px] font-mono font-bold">
                  {cfg.tokenPreview}
                </span>
                {confirmClearToken ? (
                  <>
                    <button
                      type="button"
                      disabled={isSaving}
                      onClick={() => void handleClearToken()}
                      className="px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold"
                    >
                      {L('삭제 확인', '削除確定', 'Confirm')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmClearToken(false)}
                      className="px-2 py-0.5 rounded-lg bg-ivory-100 text-charcoal-700 text-[10px] font-bold"
                    >
                      {L('취소', 'キャンセル', 'Cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClearToken(true)}
                    className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-lg text-rose-700 hover:bg-rose-50 text-[10px] font-bold transition"
                    title={L('저장된 토큰 삭제', '保存済みトークンを削除', 'Clear stored token')}
                  >
                    <Trash2 className="w-3 h-3" />
                    <span>{L('삭제', '削除', 'Clear')}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="relative">
            <input
              type={showTokenInput ? 'text' : 'password'}
              value={feedTokenInput}
              onChange={(e) => setFeedTokenInput(e.target.value)}
              placeholder={
                cfg?.hasToken
                  ? L(
                      '저장된 토큰 유지 중 (교체할 때만 새 토큰을 붙여넣으세요)',
                      '保存済みトークンを維持中（変更する場合のみ新トークンを入力）',
                      'Stored token kept (paste a new token only to replace)'
                    )
                  : L(
                      'NYGC에서 복사한 비공개 토큰을 붙여넣으세요',
                      'NYGCでコピーした非公開トークンを貼り付けてください',
                      'Paste private token copied from NYGC'
                    )
              }
              className="w-full pl-3 pr-9 py-2 rounded-xl border border-ivory-300 bg-ivory-50 focus:bg-white text-xs font-mono text-charcoal-900 focus:outline-none focus:border-forest-600"
            />
            <button
              type="button"
              onClick={() => setShowTokenInput((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-charcoal-400 hover:text-charcoal-700"
              aria-label={showTokenInput ? L('숨기기', '隠す', 'Hide') : L('보기', '表示', 'Show')}
            >
              {showTokenInput ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Target Shared Spaces Multi-Select */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-1.5 text-xs font-bold text-charcoal-800">
              <Users className="w-3.5 h-3.5 text-forest-700" />
              <span>
                {L(
                  '시프트를 표시·알림 발송할 공유 스페이스 (복수 선택 가능)',
                  'シフトを表示・通知する共有スペース（複数選択可）',
                  'Shared Spaces to Display Shifts & Send Alerts (multi-select)'
                )}
              </span>
            </label>
            <span className="text-[11px] font-bold text-forest-800">
              {L(
                `${enabledSpaceIds.length}개 선택됨`,
                `${enabledSpaceIds.length}件選択`,
                `${enabledSpaceIds.length} selected`
              )}
            </span>
          </div>

          <div className="space-y-1.5 max-h-48 overflow-y-auto pr-0.5">
            {(view?.spaces || []).length === 0 ? (
              <div className="py-4 text-center text-xs text-charcoal-400">
                {L('생성된 공유 스페이스가 없습니다.', '共有スペースがありません。', 'No shared spaces found.')}
              </div>
            ) : (
              (view?.spaces || []).map((sp) => {
                const checked = enabledSpaceIds.includes(sp.id);
                return (
                  <label
                    key={sp.id}
                    className={`flex items-center justify-between gap-2.5 p-2.5 rounded-xl border cursor-pointer transition ${
                      checked
                        ? 'bg-forest-50/70 border-forest-300'
                        : 'bg-ivory-50/60 border-ivory-200 hover:border-ivory-300'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSpaceId(sp.id)}
                        className="w-4 h-4 rounded accent-forest-800 shrink-0"
                      />
                      <span
                        className="w-3 h-3 rounded-full shrink-0"
                        style={{ backgroundColor: sp.color }}
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-charcoal-900 truncate flex items-center gap-1.5">
                          <span className="truncate">{sp.name}</span>
                          {sp.isPersonal && (
                            <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 text-[10px] font-semibold shrink-0">
                              {L('기본', '基本', 'Default')}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-charcoal-500 truncate">
                          {L(
                            `멤버 ${sp.memberCount}명`,
                            `メンバー ${sp.memberCount}名`,
                            `${sp.memberCount} member(s)`
                          )}
                          {sp.memberNames.length > 0 ? ` · ${sp.memberNames.join(', ')}` : ''}
                        </div>
                      </div>
                    </div>
                  </label>
                );
              })
            )}
          </div>
        </div>

        {feedback && (
          <div
            className={`px-3 py-2 rounded-xl text-xs font-semibold flex items-start gap-2 ${
              feedback.type === 'ok'
                ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                : 'bg-rose-50 text-rose-800 border border-rose-200'
            }`}
          >
            {feedback.type === 'ok' ? (
              <Check className="w-4 h-4 shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{feedback.text}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="submit"
            disabled={isSaving || isSyncing}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-forest-800 hover:bg-forest-900 disabled:opacity-50 text-white text-xs font-bold transition shadow-xs"
          >
            <Save className="w-3.5 h-3.5" />
            <span>
              {isSaving
                ? L('저장 중...', '保存中...', 'Saving...')
                : L('연동 설정 저장', '連携設定を保存', 'Save Sync Settings')}
            </span>
          </button>
        </div>
      </form>
    </div>
  );
};
