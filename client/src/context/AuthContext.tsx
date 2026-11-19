import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getStoredToken, setStoredToken } from '../api/client';
import { AuthUser } from '../types';

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkSession = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }
    try {
      const res = await api.get<{ user: AuthUser }>('/auth/me');
      setUser(res.user);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkSession();
  }, [checkSession]);

  const login = async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    setStoredToken(res.token);
    setUser(res.user);
  };

  const register = async (email: string, password: string, name: string) => {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/register', { email, password, name });
    setStoredToken(res.token);
    setUser(res.user);
  };

  const loginDemo = async () => {
    const res = await api.post<{ token: string; user: AuthUser }>('/auth/demo');
    setStoredToken(res.token);
    setUser(res.user);
  };

  const logout = () => {
    setStoredToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, loginDemo, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
