import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useModalBackHandler } from '../../utils/modalHistory';

interface MobileNodeBottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export const MobileNodeBottomSheet: React.FC<MobileNodeBottomSheetProps> = ({
  isOpen,
  onClose,
  title,
  children,
}) => {
  const { L } = useLanguage();
  useModalBackHandler(isOpen, onClose);

  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [dragDeltaY, setDragDeltaY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const startYRef = useRef<number | null>(null);

  useEffect(() => {
    if (isOpen) {
      setMounted(true);
      setExpanded(false);
      setDragDeltaY(0);
      const raf = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setVisible(true));
      });
      return () => window.cancelAnimationFrame(raf);
    } else {
      setVisible(false);
      const timer = window.setTimeout(() => setMounted(false), 260);
      return () => window.clearTimeout(timer);
    }
  }, [isOpen]);

  const handleDragStart = (clientY: number) => {
    startYRef.current = clientY;
    setIsDragging(true);
    setDragDeltaY(0);
  };

  const handleDragMove = (clientY: number) => {
    if (startYRef.current === null) return;
    const delta = clientY - startYRef.current;
    setDragDeltaY(Math.max(-140, delta));
  };

  const handleDragEnd = () => {
    if (startYRef.current === null) return;
    const delta = dragDeltaY;
    startYRef.current = null;
    setIsDragging(false);
    setDragDeltaY(0);

    if (delta < -45) {
      setExpanded(true);
    } else if (delta > 150) {
      onClose();
    } else if (delta > 55) {
      if (expanded) {
        setExpanded(false);
      } else {
        onClose();
      }
    }
  };

  if (!mounted) return null;

  const targetHeight = expanded ? '88vh' : '56vh';
  const translateStyle = !visible
    ? 'translateY(100%)'
    : isDragging && dragDeltaY > 0
      ? `translateY(${dragDeltaY}px)`
      : 'translateY(0)';

  return createPortal(
    <div
      className={`xl:hidden fixed inset-0 z-40 flex flex-col justify-end ${
        !visible ? 'pointer-events-none' : ''
      }`}
    >
      {/* modal-backdrop-ignore: Mobile/tablet-only (xl:hidden) mindmap node detail slide-up bottom sheet */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-charcoal-950/45 backdrop-blur-[1px] transition-opacity duration-250 ${
          visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      />

      {/* Slide-Up Sheet */}
      <div
        style={{
          height: targetHeight,
          transform: translateStyle,
          transition: isDragging
            ? 'none'
            : 'transform 260ms cubic-bezier(0.22, 1, 0.36, 1), height 240ms cubic-bezier(0.22, 1, 0.36, 1)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
        className="relative z-10 w-full max-w-2xl mx-auto bg-ivory-50 rounded-t-3xl shadow-[0_-12px_40px_rgba(0,0,0,0.2)] border-t border-ivory-300 flex flex-col overflow-hidden"
      >
        {/* Draggable Top Handle Bar */}
        <div
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            handleDragStart(e.clientY);
          }}
          onPointerMove={(e) => {
            if (isDragging) handleDragMove(e.clientY);
          }}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
          className="pt-2.5 pb-1.5 flex flex-col items-center cursor-grab active:cursor-grabbing touch-none select-none shrink-0 bg-ivory-50"
        >
          <div className="w-11 h-1.5 rounded-full bg-charcoal-300" />
        </div>

        {/* Sheet Header */}
        <div className="px-4 py-2 bg-ivory-50 border-b border-ivory-200 flex items-center justify-between gap-2 shrink-0">
          <div className="text-xs font-bold text-forest-900 truncate">
            {title || L('노드 상세', 'ノード詳細', 'Node Detail')}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="p-1.5 rounded-lg text-charcoal-500 hover:text-charcoal-800 hover:bg-ivory-200 transition"
              title={expanded ? L('크기 축소', '縮小', 'Collapse') : L('크기 확장', '拡大', 'Expand')}
            >
              {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-charcoal-500 hover:text-charcoal-800 hover:bg-ivory-200 transition"
              title={L('닫기', '閉じる', 'Close')}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
};
