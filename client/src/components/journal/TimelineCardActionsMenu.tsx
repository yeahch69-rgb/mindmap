import React, { useEffect, useRef, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';

export interface TimelineCardActionItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  tone?: 'default' | 'emerald' | 'amber' | 'danger';
  active?: boolean;
  dividerBefore?: boolean;
}

interface TimelineCardActionsMenuProps {
  items: TimelineCardActionItem[];
  hasActive?: boolean;
}

export const TimelineCardActionsMenu: React.FC<TimelineCardActionsMenuProps> = ({
  items,
  hasActive = false,
}) => {
  const { L } = useLanguage();
  const [open, setOpen] = useState(false);
  const [openUpward, setOpenUpward] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [open]);

  if (items.length === 0) return null;

  const handleToggle = () => {
    setOpen((prev) => {
      const next = !prev;
      if (next && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        setOpenUpward(spaceBelow < 260 && spaceAbove > spaceBelow);
      }
      return next;
    });
  };

  const getToneClass = (item: TimelineCardActionItem) => {
    if (item.active) {
      return 'bg-emerald-50 text-emerald-900 font-bold';
    }
    switch (item.tone) {
      case 'emerald':
        return 'text-emerald-800 hover:bg-emerald-50';
      case 'amber':
        return 'text-amber-900 hover:bg-amber-50';
      case 'danger':
        return 'text-rose-700 hover:bg-rose-50';
      default:
        return 'text-charcoal-800 hover:bg-ivory-100';
    }
  };

  const moreLabel = L('더 보기', 'その他', 'More');

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={moreLabel}
        title={moreLabel}
        className={`px-1.5 sm:px-2 py-1 rounded-lg border text-[11px] font-bold inline-flex items-center gap-1 transition whitespace-nowrap ${
          open || hasActive
            ? 'bg-forest-800 text-white border-forest-900 shadow-2xs'
            : 'bg-white border-ivory-300 text-charcoal-700 hover:bg-ivory-100'
        }`}
      >
        <MoreHorizontal className="w-3.5 h-3.5 shrink-0" />
        <span className="hidden sm:inline">{moreLabel}</span>
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute right-0 ${
            openUpward ? 'bottom-full mb-1' : 'top-full mt-1'
          } w-48 sm:w-52 rounded-xl bg-white border border-ivory-300 shadow-lg py-1 z-30`}
        >
          {items.map((item) => (
            <React.Fragment key={item.key}>
              {item.dividerBefore && <div className="my-1 border-t border-ivory-200" />}
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`w-full px-3 py-2 text-left text-xs font-semibold flex items-center gap-2 transition ${getToneClass(
                  item
                )}`}
              >
                <span className="shrink-0 inline-flex items-center justify-center">{item.icon}</span>
                <span className="truncate">{item.label}</span>
              </button>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};
