import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getStoredToken, setStoredToken } from '../api/client';
import { AuthUser } from '../types';
import { ensurePushSubscriptionSynced } from '../utils/pushSync';

export const FONT_SCALE_MOBILE_BREAKPOINT = 1024;
const FONT_PERCENT_STORAGE_KEYS = {
  desktop: 'pm_font_percent_desktop',
  mobile: 'pm_font_percent_mobile',
} as const;
const USER_CACHE_KEY = 'pj_auth_user';

function getCachedUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

function setCachedUser(nextUser: AuthUser | null) {
  try {
    if (nextUser) {
      localStorage.setItem(USER_CACHE_KEY, JSON.stringify(nextUser));
    } else {
      localStorage.removeItem(USER_CACHE_KEY);
    }
  } catch {
    // ignore storage errors
  }
}

export function parseFontScalePercent(value?: string | null): number {
  if (!value) return 100;
  const trimmed = String(value).trim();
  if (trimmed.endsWith('%')) {
    const n = Number(trimmed.slice(0, -1));
    if (Number.isFinite(n)) return Math.min(150, Math.max(80, Math.round(n)));
  }
  const legacyMap: Record<string, number> = {
    small: 90,
    normal: 100,
    large: 115,
    xlarge: 130,
  };
  if (legacyMap[trimmed]) return legacyMap[trimmed];
  const parsed = Number(trimmed);
  if (Number.isFinite(parsed)) return Math.min(150, Math.max(80, Math.round(parsed)));
  return 100;
}

export function applyFontScale(
  fontSize?: string | null,
  scope: 'desktop' | 'mobile' | 'auto' = 'auto'
) {
  const percent = parseFontScalePercent(fontSize);
  const offsetPx = (percent - 100) / 5;
  const targetScope =
    scope === 'auto'
      ? window.innerWidth < FONT_SCALE_MOBILE_BREAKPOINT
        ? 'mobile'
        : 'desktop'
      : scope;
  const isCurrentViewportTarget =
    (targetScope === 'mobile' && window.innerWidth < FONT_SCALE_MOBILE_BREAKPOINT) ||
    (targetScope === 'desktop' && window.innerWidth >= FONT_SCALE_MOBILE_BREAKPOINT);

  if (isCurrentViewportTarget) {
    document.documentElement.style.fontSize = '16px';
    document.documentElement.style.setProperty('--font-offset', `${offsetPx}px`);
  }

  try {
    localStorage.setItem(FONT_PERCENT_STORAGE_KEYS[targetScope], String(percent));
  } catch {
    // ignore storage errors
  }
}

export function getUserFontScaleForViewport(
  targetUser?: Pick<AuthUser, 'fontSize' | 'mobileFontSize'> | null
): string | undefined {
  if (typeof window !== 'undefined' && window.innerWidth < FONT_SCALE_MOBILE_BREAKPOINT) {
    return targetUser?.mobileFontSize || targetUser?.fontSize || '100%';
  }
  return targetUser?.fontSize || '100%';
}

function syncAndApplyUserFontScale(
  targetUser?: Pick<AuthUser, 'fontSize' | 'mobileFontSize'> | null
) {
  applyFontScale(targetUser?.fontSize || '100%', 'desktop');
  applyFontScale(targetUser?.mobileFontSize || targetUser?.fontSize || '100%', 'mobile');
}

export interface UpdatePreferencesPayload {
  name?: string;
  fontSize?: string;
  mobileFontSize?: string;
  pushEnabled?: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => void;
  updatePreferences: (payload: UpdatePreferencesPayload) => Promise<AuthUser>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(() =>
    getStoredToken() ? getCachedUser() : null
  );
  const [isLoading, setIsLoading] = useState<boolean>(() => !(getStoredToken() && getCachedUser()));

  const checkSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setCachedUser(null);
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const res = await api.get<{ user: AuthUser; refreshedToken?: string }>('/auth/me');
      if (res.refreshedToken) {
        setStoredToken(res.refreshedToken);
      }
      setCachedUser(res.user);
      setUser(res.user);
      syncAndApplyUserFontScale(res.user);
      if (res.user.pushEnabled !== false) {
        void ensurePushSubscriptionSynced(false);
      }
    } catch (err: any) {
      // Clear session only on explicit 401 Unauthorized; keep cached login on transient offline/5xx
      if (err?.status === 401) {
        setStoredToken(null);
        setCachedUser(null);
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  useEffect(() => {
    const onResize = () => {
      if (user) {
        applyFontScale(getUserFontScaleForViewport(user));
      } else {
        const scope = window.innerWidth < FONT_SCALE_MOBILE_BREAKPOINT ? 'mobile' : 'desktop';
        let saved: string | null = null;
        try {
          saved = localStorage.getItem(FONT_PERCENT_STORAGE_KEYS[scope]);
        } catch {
          saved = null;
        }
        applyFontScale(saved || '100%', scope);
      }
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [user]);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    setStoredToken(res.token);
    setCachedUser(res.user);
    setUser(res.user);
    syncAndApplyUserFontScale(res.user);
    if (res.user.pushEnabled !== false) {
      void ensurePushSubscriptionSynced(false);
    }
  };

  const register = async (email: string, password: string, name: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/register', { email, password, name });
    setStoredToken(res.token);
    setCachedUser(res.user);
    setUser(res.user);
    syncAndApplyUserFontScale(res.user);
    if (res.user.pushEnabled !== false) {
      void ensurePushSubscriptionSynced(false);
    }
  };

  const loginDemo = async () => {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/demo');
    setStoredToken(res.token);
    setCachedUser(res.user);
    setUser(res.user);
    syncAndApplyUserFontScale(res.user);
    if (res.user.pushEnabled !== false) {
      void ensurePushSubscriptionSynced(false);
    }
  };

  const logout = () => {
    setStoredToken(null);
    setCachedUser(null);
    setUser(null);
  };

  const updatePreferences = async (payload: UpdatePreferencesPayload): Promise<AuthUser> => {
    const res = await api.patch<{ user: AuthUser }>('/auth/preferences', payload);
    setCachedUser(res.user);
    setUser(res.user);
    syncAndApplyUserFontScale(res.user);
    return res.user;
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, loginDemo, logout, updatePreferences }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
