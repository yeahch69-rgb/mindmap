import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useModalBackHandler } from '../../utils/modalHistory';

export type DraggableFabTone =
  | 'default'
  | 'primary'
  | 'emerald'
  | 'amber'
  | 'rose'
  | 'indigo'
  | 'sky';

export interface DraggableFabAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: DraggableFabTone;
  badge?: string | number;
  disabled?: boolean;
}

export interface DraggableFabProps {
  /** Accessible label for the primary FAB button */
  label: string;
  /** Optional custom icon for the FAB (defaults to Plus) */
  icon?: React.ReactNode;
  /** Single-action handler (used when `actions` is not provided) */
  onClick?: () => void;
  /** Speed-dial menu items (when provided, tapping the FAB toggles the speed dial) */
  actions?: DraggableFabAction[];
  /** Optional visible pill label next to the icon (e.g. floating Save button) */
  pillLabel?: string;
  /** Color tone of the main FAB button */
  tone?: 'primary' | 'emerald' | 'amber' | 'rose' | 'indigo';
  /** Disabled state for single-action FAB */
  disabled?: boolean;
  /** Optional small counter/status badge on the FAB corner */
  badge?: string | number;
}

interface SafeBounds {
  minLeft: number;
  maxLeft: number;
  minTop: number;
  maxTop: number;
  maxBottom: number;
}

const DRAG_THRESHOLD_PX = 7;
const HORIZONTAL_MARGIN = 10;
const HEADER_GAP = 8;
const NAV_GAP = 10;
const MENU_GAP = 10;

const FAB_TONE_CLASSES: Record<NonNullable<DraggableFabProps['tone']>, string> = {
  primary:
    'bg-forest-800 hover:bg-forest-900 active:bg-forest-950 text-white shadow-lg shadow-forest-950/30 ring-1 ring-white/15',
  emerald:
    'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-lg shadow-emerald-950/30 ring-1 ring-white/15',
  amber:
    'bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white shadow-lg shadow-amber-950/30 ring-1 ring-white/15',
  rose:
    'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-lg shadow-rose-950/30 ring-1 ring-white/15',
  indigo:
    'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-lg shadow-indigo-950/30 ring-1 ring-white/15',
};

const ACTION_ICON_TONE_CLASSES: Record<DraggableFabTone, string> = {
  default: 'bg-ivory-100 text-charcoal-700 border border-ivory-300',
  primary: 'bg-forest-800 text-white',
  emerald: 'bg-emerald-600 text-white',
  amber: 'bg-amber-500 text-white',
  rose: 'bg-rose-600 text-white',
  indigo: 'bg-indigo-600 text-white',
  sky: 'bg-sky-600 text-white',
};

function computeSafeBounds(fabWidth: number, fabHeight: number): SafeBounds {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  const headerEl = document.querySelector('header');
  const headerRect = headerEl?.getBoundingClientRect();
  const headerBottom = headerRect && headerRect.height > 0 ? headerRect.bottom : 48;

  const navEl = document.querySelector('[data-mobile-nav="true"]');
  const navRect = navEl?.getBoundingClientRect();
  const navVisible = Boolean(navRect && navRect.height > 0 && navRect.top < vh);
  const maxBottom = navVisible && navRect ? navRect.top - NAV_GAP : vh - 14;

  const minLeft = HORIZONTAL_MARGIN;
  const maxLeft = Math.max(minLeft, vw - fabWidth - HORIZONTAL_MARGIN);
  const minTop = Math.max(HORIZONTAL_MARGIN, headerBottom + HEADER_GAP);
  const maxTop = Math.max(minTop, maxBottom - fabHeight);

  return { minLeft, maxLeft, minTop, maxTop, maxBottom };
}

function clampPosition(
  left: number,
  top: number,
  bounds: SafeBounds
): { left: number; top: number } {
  return {
    left: Math.min(bounds.maxLeft, Math.max(bounds.minLeft, left)),
    top: Math.min(bounds.maxTop, Math.max(bounds.minTop, top)),
  };
}

export const DraggableFab: React.FC<DraggableFabProps> = ({
  label,
  icon,
  onClick,
  actions,
  pillLabel,
  tone = 'primary',
  disabled = false,
  badge,
}) => {
  const { L } = useLanguage();
  const isSpeedDial = Array.isArray(actions) && actions.length > 0;

  // Ephemeral drag coordinates (always resets to default bottom-right on reload / tab switch)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  useModalBackHandler(isOpen, () => setIsOpen(false));
  const [menuLayout, setMenuLayout] = useState<{
    vertical: 'up' | 'down';
    horizontal: 'left' | 'right';
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
    maxHeight?: number;
    maxWidth?: number;
  }>({ vertical: 'up', horizontal: 'right', bottom: 132, right: 16 });

  const fabRef = useRef<HTMLButtonElement | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startClientX: number;
    startClientY: number;
    originLeft: number;
    originTop: number;
    fabWidth: number;
    fabHeight: number;
    didDrag: boolean;
  } | null>(null);
  const suppressNextClickRef = useRef(false);

  const updateMenuLayout = useCallback(() => {
    const btn = fabRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const bounds = computeSafeBounds(rect.width, rect.height);
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const itemCount = actions?.length ?? 0;
    const estimatedMenuHeight = itemCount * 50 + 16;
    const spaceAbove = rect.top - bounds.minTop;
    const spaceBelow = bounds.maxBottom - rect.bottom;
    const vertical: 'up' | 'down' =
      spaceAbove >= estimatedMenuHeight || spaceAbove >= spaceBelow ? 'up' : 'down';

    const fabCenterX = rect.left + rect.width / 2;
    const horizontal: 'left' | 'right' = fabCenterX < vw / 2 ? 'left' : 'right';

    const maxHeight = Math.max(
      120,
      Math.floor((vertical === 'up' ? spaceAbove : spaceBelow) - MENU_GAP)
    );

    const anchorLeft =
      horizontal === 'left'
        ? Math.max(HORIZONTAL_MARGIN, Math.min(rect.left, vw - Math.min(260, vw - HORIZONTAL_MARGIN * 2) - HORIZONTAL_MARGIN))
        : undefined;
    const anchorRight =
      horizontal === 'right'
        ? Math.max(HORIZONTAL_MARGIN, Math.min(vw - rect.right, vw - Math.min(260, vw - HORIZONTAL_MARGIN * 2) - HORIZONTAL_MARGIN))
        : undefined;
    const maxWidth =
      horizontal === 'left' && anchorLeft !== undefined
        ? Math.max(160, vw - anchorLeft - HORIZONTAL_MARGIN)
        : horizontal === 'right' && anchorRight !== undefined
        ? Math.max(160, vw - anchorRight - HORIZONTAL_MARGIN)
        : vw - HORIZONTAL_MARGIN * 2;

    if (vertical === 'up') {
      const bottom = Math.max(HORIZONTAL_MARGIN, vh - rect.top + MENU_GAP);
      setMenuLayout({
        vertical,
        horizontal,
        bottom,
        left: anchorLeft,
        right: anchorRight,
        maxHeight,
        maxWidth,
      });
    } else {
      const top = Math.min(vh - HORIZONTAL_MARGIN, rect.bottom + MENU_GAP);
      setMenuLayout({
        vertical,
        horizontal,
        top,
        left: anchorLeft,
        right: anchorRight,
        maxHeight,
        maxWidth,
      });
    }
  }, [actions?.length]);

  useLayoutEffect(() => {
    if (isOpen) {
      updateMenuLayout();
    }
  }, [isOpen, pos, updateMenuLayout]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 640 && isOpen) {
        setIsOpen(false);
      }
      const btn = fabRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      setPos((prev) => {
        if (!prev) return prev;
        const bounds = computeSafeBounds(rect.width || 52, rect.height || 52);
        return clampPosition(prev.left, prev.top, bounds);
      });
      if (isOpen) {
        updateMenuLayout();
      }
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
  }, [isOpen, updateMenuLayout]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const btn = fabRef.current;
    if (!btn) return;

    const rect = btn.getBoundingClientRect();
    dragRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      fabWidth: rect.width || 52,
      fabHeight: rect.height || 52,
      didDrag: false,
    };

    try {
      btn.setPointerCapture(e.pointerId);
    } catch {
      // Ignore if pointer capture is unavailable
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startClientX;
    const dy = e.clientY - drag.startClientY;

    if (!drag.didDrag) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.didDrag = true;
      setIsDragging(true);
      setIsOpen(false);
    }

    const bounds = computeSafeBounds(drag.fabWidth, drag.fabHeight);
    const next = clampPosition(drag.originLeft + dx, drag.originTop + dy, bounds);
    setPos(next);
  };

  const finishDrag = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const wasDragged = drag.didDrag;
    dragRef.current = null;
    setIsDragging(false);

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }

    if (wasDragged) {
      suppressNextClickRef.current = true;
      window.setTimeout(() => {
        suppressNextClickRef.current = false;
      }, 80);
    }
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (isSpeedDial) {
      setIsOpen((prev) => !prev);
      return;
    }

    if (!disabled && onClick) {
      onClick();
    }
  };

  if (typeof document === 'undefined') return null;

  const fabStyle: React.CSSProperties = pos
    ? { left: `${pos.left}px`, top: `${pos.top}px` }
    : {
        right: '14px',
        bottom: 'calc(68px + env(safe-area-inset-bottom, 0px))',
      };

  const menuContainerStyle: React.CSSProperties = {
    ...(menuLayout.top !== undefined ? { top: `${menuLayout.top}px` } : {}),
    ...(menuLayout.bottom !== undefined ? { bottom: `${menuLayout.bottom}px` } : {}),
    ...(menuLayout.left !== undefined ? { left: `${menuLayout.left}px` } : {}),
    ...(menuLayout.right !== undefined ? { right: `${menuLayout.right}px` } : {}),
    ...(menuLayout.maxHeight !== undefined ? { maxHeight: `${menuLayout.maxHeight}px` } : {}),
    ...(menuLayout.maxWidth !== undefined ? { maxWidth: `${menuLayout.maxWidth}px` } : {}),
  };

  return createPortal(
    <>
      {isSpeedDial && isOpen && (
        /* modal-backdrop-ignore: Mobile-only FAB speed-dial dismiss overlay */
        <div
          className="sm:hidden fixed inset-0 z-30 bg-charcoal-900/25 backdrop-blur-[1px]"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {isSpeedDial && isOpen && actions && (
        <div
          role="menu"
          aria-label={label}
          style={menuContainerStyle}
          className={`sm:hidden fixed z-30 flex flex-col gap-2 overflow-y-auto py-0.5 ${
            menuLayout.horizontal === 'left' ? 'items-start' : 'items-end'
          }`}
        >
          {actions.map((action) => {
            const iconToneClass = ACTION_ICON_TONE_CLASSES[action.tone ?? 'default'];
            const isLeftAligned = menuLayout.horizontal === 'left';
            return (
              <button
                key={action.id}
                type="button"
                role="menuitem"
                disabled={action.disabled}
                onClick={() => {
                  setIsOpen(false);
                  action.onClick();
                }}
                className={`flex items-center gap-2.5 max-w-full rounded-full bg-white border border-ivory-300 shadow-lg shadow-charcoal-950/15 px-3 py-2 text-[13px] font-bold text-charcoal-900 active:scale-[0.98] transition-transform disabled:opacity-50 ${
                  isLeftAligned ? 'flex-row' : 'flex-row-reverse'
                }`}
              >
                <span
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${iconToneClass}`}
                >
                  {action.icon}
                </span>
                <span className="truncate whitespace-nowrap px-0.5">{action.label}</span>
                {action.badge !== undefined && action.badge !== '' && (
                  <span className="shrink-0 px-1.5 py-0.5 rounded-full text-[13px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300 leading-none">
                    {action.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      <button
        ref={fabRef}
        type="button"
        aria-label={isSpeedDial && isOpen ? L('메뉴 닫기', 'メニューを閉じる', 'Close menu') : label}
        aria-expanded={isSpeedDial ? isOpen : undefined}
        aria-haspopup={isSpeedDial ? 'menu' : undefined}
        aria-disabled={!isSpeedDial && disabled ? true : undefined}
        title={label}
        style={fabStyle}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        onClick={handleClick}
        onContextMenu={(e) => e.preventDefault()}
        className={`sm:hidden fixed z-30 touch-none select-none flex items-center justify-center gap-1.5 transition-transform ${
          pillLabel ? 'h-12 px-4 rounded-full text-[13.5px] font-bold' : 'w-[52px] h-[52px] rounded-full'
        } ${FAB_TONE_CLASSES[tone]} ${
          isDragging ? 'scale-105 cursor-grabbing opacity-95' : 'active:scale-95 cursor-grab'
        } ${!isSpeedDial && disabled ? 'opacity-60' : ''}`}
      >
        {isSpeedDial && isOpen ? (
          <X className="w-6 h-6 shrink-0" strokeWidth={2.5} />
        ) : (
          <>
            <span className="shrink-0 flex items-center justify-center">
              {icon ?? <Plus className="w-6 h-6" strokeWidth={2.5} />}
            </span>
            {pillLabel && <span className="whitespace-nowrap">{pillLabel}</span>}
          </>
        )}
        {badge !== undefined && badge !== '' && !(isSpeedDial && isOpen) && (
          <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1.5 rounded-full bg-amber-400 text-forest-950 text-[13px] font-extrabold flex items-center justify-center leading-none shadow-sm border border-white">
            {badge}
          </span>
        )}
      </button>
    </>,
    document.body
  );
};
