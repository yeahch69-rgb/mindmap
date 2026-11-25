import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bell,
  FolderKanban,
  Languages,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { api } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { formatJstTime, getJstDateKey } from '../../utils/dateTime';
import { useModalBackHandler } from '../../utils/modalHistory';

interface AdminUserRow {
  id: number;
  email: string;
  name: string;
  role: 'USER' | 'ADMIN';
  fontSize: string;
  mobileFontSize: string;
  pushEnabled: boolean;
  projectCount: number;
  pushDeviceCount: number;
  isDemo: boolean;
  createdAt: string;
}

interface TranslationUsageSummary {
  apiCallCount: number;
  cacheHitCount: number;
  totalRequestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  inputCostUsd: number;
  outputCostUsd: number;
  totalCostUsd: number;
  inputCostJpy: number;
  outputCostJpy: number;
  totalCostJpy: number;
  activeProvider: string;
  activeModel: string;
  lastModel: string | null;
  lastUsedAt: string | null;
  resetAt: string | null;
}

interface AdminUsersModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AdminUsersModal: React.FC<AdminUsersModalProps> = ({ isOpen, onClose }) => {
  const { user } = useAuth();
  const { L } = useLanguage();
  useModalBackHandler(isOpen && user?.role === 'ADMIN', onClose);

  const [users, setUsers] = useState<AdminUserRow[]>([]);
  const [usage, setUsage] = useState<TranslationUsageSummary | null>(null);
  const [isResettingUsage, setIsResettingUsage] = useState(false);
  const [confirmResetUsage, setConfirmResetUsage] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'ALL' | 'REGULAR' | 'DEMO'>('ALL');
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  const loadUsers = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [usersRes, usageRes] = await Promise.all([
        api.get<{ users: AdminUserRow[] }>('/admin/users'),
        api.get<TranslationUsageSummary>('/translate/usage').catch(() => null),
      ]);
      setUsers(usersRes.users || []);
      if (usageRes) setUsage(usageRes);
    } catch (err: any) {
      setError(
        err?.message ||
          L('회원 목록을 불러오지 못했습니다.', 'ユーザー一覧を取得できませんでした。', 'Failed to load users.')
      );
    } finally {
      setIsLoading(false);
    }
  }, [L]);

  const handleResetUsage = async () => {
    setIsResettingUsage(true);
    try {
      const res = await api.post<TranslationUsageSummary>('/translate/usage/reset', {});
      setUsage(res);
      setConfirmResetUsage(false);
    } catch (err: any) {
      setError(
        err?.message ||
          L('사용량 초기화에 실패했습니다.', '使用量のリセットに失敗しました。', 'Failed to reset translation usage.')
      );
    } finally {
      setIsResettingUsage(false);
    }
  };

  useEffect(() => {
    if (isOpen && user?.role === 'ADMIN') {
      void loadUsers();
    }
  }, [isOpen, user?.role, loadUsers]);

  const handleToggleRole = async (target: AdminUserRow) => {
    if (target.id === user?.id) return;
    const nextRole = target.role === 'ADMIN' ? 'USER' : 'ADMIN';
    setBusyUserId(target.id);
    try {
      await api.patch(`/admin/users/${target.id}/role`, { role: nextRole });
      setUsers((prev) => prev.map((u) => (u.id === target.id ? { ...u, role: nextRole } : u)));
    } catch (err: any) {
      setError(err?.message || L('권한 변경에 실패했습니다.', '権限変更に失敗しました。', 'Failed to update role.'));
    } finally {
      setBusyUserId(null);
    }
  };

  const stats = useMemo(() => {
    const total = users.length;
    const demoCount = users.filter((u) => u.isDemo).length;
    const adminCount = users.filter((u) => u.role === 'ADMIN').length;
    const regularCount = total - demoCount;
    return { total, demoCount, adminCount, regularCount };
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filterType === 'REGULAR' && u.isDemo) return false;
      if (filterType === 'DEMO' && !u.isDemo) return false;
      if (q) {
        return (
          u.name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [users, search, filterType]);

  if (!isOpen || user?.role !== 'ADMIN') return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-3 sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-white rounded-2xl border border-ivory-300 shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-ivory-200 flex items-center justify-between bg-ivory-50/70">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 rounded-xl bg-forest-800 text-white flex items-center justify-center shrink-0">
              <Shield className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="font-bold text-sm text-charcoal-900 truncate">
                {L('관리자 · 전체 가입 계정 목록', '管理者 · 登録アカウント一覧', 'Admin · Registered Accounts')}
              </h2>
              <p className="text-[11px] text-charcoal-500 truncate">
                {L(
                  `총 ${stats.total}개 계정 (정식 가입 ${stats.regularCount} · 게스트 ${stats.demoCount} · 관리자 ${stats.adminCount})`,
                  `合計 ${stats.total}件 (通常 ${stats.regularCount} · ゲスト ${stats.demoCount} · 管理者 ${stats.adminCount})`,
                  `${stats.total} total (${stats.regularCount} regular · ${stats.demoCount} guest · ${stats.adminCount} admin)`
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void loadUsers()}
              disabled={isLoading}
              className="p-1.5 rounded-lg text-charcoal-600 hover:text-forest-800 hover:bg-ivory-200 transition disabled:opacity-50"
              title={L('새로고침', '更新', 'Refresh')}
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-charcoal-500 hover:text-charcoal-900 hover:bg-ivory-200 transition"
              aria-label={L('닫기', '閉じる', 'Close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Gemini Translation API Usage Monitor */}
        {usage && (
          <div className="px-5 py-3 border-b border-ivory-200 bg-emerald-50/50 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-xs font-bold text-forest-900">
                <Languages className="w-3.5 h-3.5 text-forest-700" />
                <span>{L('Gemini 번역 API 사용량', 'Gemini 翻訳API使用量', 'Gemini Translation Usage')}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                    usage.activeProvider === 'gemini'
                      ? 'bg-emerald-100 text-emerald-900 border-emerald-300'
                      : 'bg-amber-100 text-amber-900 border-amber-300'
                  }`}
                >
                  {usage.activeProvider === 'gemini'
                    ? `Gemini · ${usage.activeModel}`
                    : `${usage.activeProvider} (fallback)`}
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                {confirmResetUsage ? (
                  <>
                    <button
                      type="button"
                      disabled={isResettingUsage}
                      onClick={() => void handleResetUsage()}
                      className="px-2 py-0.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold disabled:opacity-50"
                    >
                      {L('초기화 확인', 'リセット確定', 'Confirm Reset')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmResetUsage(false)}
                      className="px-2 py-0.5 rounded-lg bg-white border border-ivory-300 text-charcoal-700 text-[11px] font-bold hover:bg-ivory-100"
                    >
                      {L('취소', 'キャンセル', 'Cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmResetUsage(true)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-white border border-ivory-300 text-charcoal-700 hover:bg-ivory-100 text-[11px] font-bold transition"
                    title={L('누적 통계 초기화', '累積統計をリセット', 'Reset counters')}
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>{L('카운터 초기화', 'リセット', 'Reset')}</span>
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2 rounded-xl bg-white border border-ivory-200">
                <div className="text-charcoal-500">{L('API 호출 / 캐시', 'API呼出 / キャッシュ', 'API / Cache')}</div>
                <div className="font-mono font-bold text-charcoal-900 mt-0.5">
                  {usage.apiCallCount.toLocaleString()} / {usage.cacheHitCount.toLocaleString()}
                </div>
                <div className="text-[10px] text-emerald-700 font-semibold">
                  {L('캐시 적중률', 'キャッシュ率', 'Cache hit')}{' '}
                  {usage.totalRequestCount > 0
                    ? `${Math.round((usage.cacheHitCount / usage.totalRequestCount) * 100)}%`
                    : '0%'}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-white border border-ivory-200">
                <div className="text-charcoal-500">{L('입력 토큰', '入力トークン', 'Input Tokens')}</div>
                <div className="font-mono font-bold text-charcoal-900 mt-0.5">
                  {usage.inputTokens.toLocaleString()}
                </div>
                <div className="text-[10px] text-charcoal-400 font-mono">
                  ${usage.inputCostUsd.toFixed(4)}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-white border border-ivory-200">
                <div className="text-charcoal-500">{L('출력 토큰', '出力トークン', 'Output Tokens')}</div>
                <div className="font-mono font-bold text-charcoal-900 mt-0.5">
                  {usage.outputTokens.toLocaleString()}
                </div>
                <div className="text-[10px] text-charcoal-400 font-mono">
                  ${usage.outputCostUsd.toFixed(4)}
                </div>
              </div>
              <div className="p-2 rounded-xl bg-white border border-emerald-200">
                <div className="text-charcoal-500">{L('예상 누적 비용', '推定累積コスト', 'Est. Cost')}</div>
                <div className="font-mono font-bold text-emerald-900 mt-0.5">
                  ${usage.totalCostUsd.toFixed(4)}
                </div>
                <div className="text-[10px] text-charcoal-500 font-mono">
                  ≈ ¥{usage.totalCostJpy.toFixed(2)}
                </div>
              </div>
            </div>
            {usage.lastUsedAt && (
              <div className="text-[10px] text-charcoal-500 font-mono">
                {L('최근 호출:', '最終呼出:', 'Last call:')} {usage.lastUsedAt}
                {usage.lastModel ? ` (${usage.lastModel})` : ''}
              </div>
            )}
          </div>
        )}

        {/* Search & Filter */}
        <div className="px-5 py-3 border-b border-ivory-200 flex flex-wrap items-center gap-2 bg-white">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="w-3.5 h-3.5 text-charcoal-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={L('이름 또는 이메일 검색...', '名前またはメール検索...', 'Search name or email...')}
              className="w-full pl-8 pr-3 py-1.5 text-xs border border-ivory-300 rounded-xl bg-ivory-50 focus:outline-none focus:border-forest-600"
            />
          </div>
          <div className="flex items-center bg-ivory-100 border border-ivory-200 rounded-xl p-0.5 text-[11px] font-bold">
            {(
              [
                { id: 'ALL', label: L('전체', 'すべて', 'All') },
                { id: 'REGULAR', label: L('정식 가입', '通常', 'Regular') },
                { id: 'DEMO', label: L('게스트', 'ゲスト', 'Guest') },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setFilterType(tab.id)}
                className={`px-2.5 py-1 rounded-lg transition ${
                  filterType === tab.id
                    ? 'bg-forest-800 text-white'
                    : 'text-charcoal-600 hover:text-charcoal-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* Users List */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-2.5 bg-ivory-50/50">
          {error && (
            <div className="px-3 py-2 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold">
              {error}
            </div>
          )}

          {isLoading && users.length === 0 ? (
            <div className="py-12 text-center text-xs text-charcoal-500 font-semibold">
              {L('계정 목록을 불러오는 중...', '読み込み中...', 'Loading accounts...')}
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-xs text-charcoal-500 flex flex-col items-center gap-2">
              <Users className="w-6 h-6 text-charcoal-400" />
              <span>{L('조건에 맞는 계정이 없습니다.', '該当するアカウントがありません。', 'No matching accounts.')}</span>
            </div>
          ) : (
            filtered.map((item) => {
              const dateStr = getJstDateKey(item.createdAt);
              const timeStr = formatJstTime(item.createdAt);
              const isSelf = item.id === user?.id;
              return (
                <div
                  key={item.id}
                  className="p-3.5 rounded-xl bg-white border border-ivory-300 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-sm text-charcoal-900 truncate">
                        {item.name}
                      </span>
                      {item.role === 'ADMIN' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 border border-amber-300 text-[10px] font-bold">
                          <ShieldCheck className="w-3 h-3" />
                          ADMIN
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 border border-stone-200 text-[10px] font-bold">
                          USER
                        </span>
                      )}
                      {item.isDemo && (
                        <span className="px-2 py-0.5 rounded-full bg-sky-50 text-sky-800 border border-sky-200 text-[10px] font-bold">
                          {L('게스트', 'ゲスト', 'Guest')}
                        </span>
                      )}
                      {isSelf && (
                        <span className="px-2 py-0.5 rounded-full bg-forest-100 text-forest-900 border border-forest-200 text-[10px] font-bold">
                          {L('현재 로그인', 'ログイン中', 'You')}
                        </span>
                      )}
                    </div>

                    <div className="text-xs text-charcoal-600 font-mono truncate">{item.email}</div>

                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-charcoal-500">
                      <span className="inline-flex items-center gap-1">
                        <FolderKanban className="w-3 h-3 text-forest-700" />
                        {L(`프로젝트 ${item.projectCount}개`, `案件 ${item.projectCount}件`, `${item.projectCount} projects`)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Bell className="w-3 h-3 text-forest-700" />
                        {L(
                          `푸시 기기 ${item.pushDeviceCount}대`,
                          `通知端末 ${item.pushDeviceCount}台`,
                          `${item.pushDeviceCount} push device(s)`
                        )}
                      </span>
                      {dateStr && (
                        <span>
                          {L('가입:', '登録:', 'Joined:')} {dateStr} {timeStr}
                        </span>
                      )}
                    </div>
                  </div>

                  {!isSelf && !item.isDemo && (
                    <div className="shrink-0">
                      <button
                        type="button"
                        disabled={busyUserId === item.id}
                        onClick={() => void handleToggleRole(item)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition disabled:opacity-50 ${
                          item.role === 'ADMIN'
                            ? 'bg-white border-rose-200 text-rose-700 hover:bg-rose-50'
                            : 'bg-ivory-50 border-ivory-300 text-charcoal-700 hover:bg-forest-50 hover:border-forest-300 hover:text-forest-900'
                        }`}
                      >
                        {item.role === 'ADMIN'
                          ? L('관리자 해제', '管理者解除', 'Revoke Admin')
                          : L('관리자 지정', '管理者に指定', 'Make Admin')}
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
