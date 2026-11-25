import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useModalBackHandler } from '../../utils/modalHistory';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | '5xl';
}

export const Modal: React.FC<ModalProps> = ({ isOpen, onClose, title, children, size, maxWidth }) => {
  const effectiveMaxWidth = maxWidth || size || 'lg';
  useModalBackHandler(isOpen, onClose);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.body.style.overflow = 'unset';
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const lgMaxWidthClass = {
    sm: 'lg:max-w-sm',
    md: 'lg:max-w-md',
    lg: 'lg:max-w-lg',
    xl: 'lg:max-w-xl',
    '2xl': 'lg:max-w-2xl',
    '3xl': 'lg:max-w-3xl',
    '4xl': 'lg:max-w-4xl',
    '5xl': 'lg:max-w-5xl',
  }[effectiveMaxWidth];

  return createPortal(
    <div className="fixed inset-0 z-50 m-0 overflow-hidden lg:overflow-y-auto bg-charcoal-900/60 backdrop-blur-sm flex items-stretch lg:items-center justify-center p-0 lg:p-4">
      <div className="hidden lg:block fixed inset-0" onClick={onClose} aria-hidden="true" />
      <div
        className={`relative w-full h-full lg:h-auto lg:max-h-[90vh] ${lgMaxWidthClass} bg-white rounded-none lg:rounded-xl shadow-none lg:shadow-2xl border-0 lg:border lg:border-ivory-300 flex flex-col overflow-hidden transform transition-all m-0 lg:my-8 z-10`}
      >
        <div className="flex items-center justify-between gap-2 px-3.5 py-3 lg:px-6 lg:py-4 border-b border-ivory-200 bg-ivory-50 shrink-0">
          <h3 className="text-sm lg:text-base font-bold text-charcoal-900 leading-snug break-words min-w-0">
            {title}
          </h3>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-charcoal-500 hover:text-charcoal-900 hover:bg-ivory-200 transition-colors shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          data-modal-body="true"
          className="flex-1 min-h-0 px-3.5 py-3.5 lg:p-6 lg:max-h-[calc(85vh-5rem)] overflow-y-auto overflow-x-hidden"
        >
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};
