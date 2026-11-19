import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  className = '',
  disabled,
  ...props
}) => {
  const { L } = useLanguage();
  const base =
    'inline-flex items-center justify-center font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed select-none';

  const sizes = {
    sm: 'text-xs px-2.5 py-1.5 rounded-md gap-1.5',
    md: 'text-sm px-4 py-2 rounded-lg gap-2',
    lg: 'text-base px-5 py-2.5 rounded-lg gap-2.5',
  };

  const variants = {
    primary: 'bg-forest-700 hover:bg-forest-800 active:bg-forest-900 text-white shadow-sm focus:ring-forest-600',
    secondary:
      'bg-ivory-200 hover:bg-ivory-300 active:bg-ivory-400 text-charcoal-900 focus:ring-stone-400 border border-ivory-300',
    outline: 'border border-forest-700 text-forest-700 hover:bg-forest-50 active:bg-forest-100 focus:ring-forest-600',
    danger: 'bg-red-600 hover:bg-red-700 active:bg-red-800 text-white shadow-sm focus:ring-red-500',
    ghost: 'hover:bg-ivory-200 text-charcoal-700 active:bg-ivory-300 focus:ring-stone-400',
  };

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? (
        <>
          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            ></path>
          </svg>
          {L('처리 중...', '処理中...', 'Processing...')}
        </>
      ) : (
        children
      )}
    </button>
  );
};
