import React, { createContext, useCallback, useContext, useState } from 'react';
import { Language } from '../types';

const LANG_KEY = 'pj_language';

const COMMON_TEXT: Record<string, Record<Language, string>> = {
  'common.loading': { ko: '불러오는 중...', ja: '読み込み中...', en: 'Loading...' },
  'common.save': { ko: '저장', ja: '保存', en: 'Save' },
  'common.cancel': { ko: '취소', ja: 'キャンセル', en: 'Cancel' },
  'common.delete': { ko: '삭제', ja: '削除', en: 'Delete' },
  'common.edit': { ko: '수정', ja: '編集', en: 'Edit' },
  'common.error': { ko: '요청을 처리할 수 없습니다.', ja: 'エラーが発生しました。', en: 'Request failed.' },
};

interface LanguageContextValue {
  language: Language;
  setLanguage: (lang: Language) => void;
  L: (ko: string, ja: string, en: string) => string;
  t: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLangState] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'ko' || saved === 'ja' || saved === 'en') return saved;
    } catch {
      // ignore
    }
    return 'ko';
  });

  const setLanguage = useCallback((lang: Language) => {
    setLangState(lang);
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      // ignore
    }
  }, []);

  const L = useCallback(
    (ko: string, ja: string, en: string) => {
      if (language === 'ja') return ja;
      if (language === 'en') return en;
      return ko;
    },
    [language]
  );

  const t = useCallback(
    (key: string) => {
      return COMMON_TEXT[key]?.[language] || key;
    },
    [language]
  );

  return (
    <LanguageContext.Provider value={{ language, setLanguage, L, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider');
  return ctx;
}
