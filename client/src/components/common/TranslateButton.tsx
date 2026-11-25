import React from 'react';
import { Languages, Loader2, RotateCcw, AlertCircle } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export interface TranslateButtonProps {
  /** When false (and not already translated/loading), renders nothing. */
  visible?: boolean;
  translated: boolean;
  loading?: boolean;
  error?: string | null;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  size?: 'xs' | 'sm';
  tone?: 'default' | 'onDark';
  iconOnly?: boolean;
  className?: string;
}

/**
 * Compact, accessible on-demand translation toggle button.
 * Toggles user-authored text between original and the viewer's active language (`ko` / `ja` / `en`).
 */
export const TranslateButton: React.FC<TranslateButtonProps> = ({
  visible = true,
  translated,
  loading = false,
  error = null,
  onClick,
  size = 'xs',
  tone = 'default',
  iconOnly = false,
  className = '',
}) => {
  const { L } = useLanguage();

  if (!visible && !translated && !loading) {
    return null;
  }

  const labelTranslate = L('번역', '翻訳', 'Translate');
  const labelTranslating = L('번역 중...', '翻訳中...', 'Translating...');
  const labelOriginal = L('원문 보기', '原文を見る', 'Original');

  const sizeClasses =
    size === 'sm'
      ? 'px-2.5 py-1 text-xs gap-1.5 rounded-lg'
      : 'px-2 py-0.5 text-[11px] gap-1 rounded-md';

  const iconSize = size === 'sm' ? 'w-3.5 h-3.5' : 'w-3 h-3';

  const toneClasses =
    tone === 'onDark'
      ? translated
        ? 'bg-white/25 text-white border border-white/40 hover:bg-white/35'
        : 'bg-white/10 text-white/90 border border-white/25 hover:bg-white/20'
      : translated
      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100'
      : 'bg-ivory-50 text-charcoal-600 border border-ivory-300 hover:bg-forest-50 hover:text-forest-700 hover:border-forest-200';

  const currentLabel = loading ? labelTranslating : translated ? labelOriginal : labelTranslate;

  return (
    <span className={`inline-flex items-center gap-1.5 flex-wrap ${className}`.trim()}>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        title={error || currentLabel}
        aria-label={currentLabel}
        className={`inline-flex items-center font-medium transition-colors select-none shrink-0 disabled:opacity-60 disabled:cursor-wait ${sizeClasses} ${toneClasses}`}
      >
        {loading ? (
          <Loader2 className={`${iconSize} animate-spin shrink-0`} />
        ) : translated ? (
          <RotateCcw className={`${iconSize} shrink-0`} />
        ) : (
          <Languages className={`${iconSize} shrink-0`} />
        )}
        {!iconOnly && <span className="leading-none">{currentLabel}</span>}
      </button>
      {error && (
        <span
          className={`inline-flex items-center gap-1 text-[11px] leading-tight ${
            tone === 'onDark' ? 'text-amber-200' : 'text-red-600'
          }`}
          role="alert"
        >
          <AlertCircle className="w-3 h-3 shrink-0" />
          <span>{error}</span>
        </span>
      )}
    </span>
  );
};
