import { useEffect, useId, useRef } from 'react';

type ModalStackEntry = {
  id: string;
  onClose: () => void;
};

const MODAL_STATE_KEY = '__pjModalId';

let liveStack: ModalStackEntry[] = [];
let pushedIds: string[] = [];
let listenerAttached = false;
let reconcileScheduled = false;
let awaitingPopstates = 0;

function isIosStandalonePwa(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  return Boolean((navigator as unknown as { standalone?: boolean }).standalone);
}

function getActiveHistoryModalId(state: unknown = window.history.state): string | null {
  if (state && typeof state === 'object' && MODAL_STATE_KEY in state) {
    const val = (state as Record<string, unknown>)[MODAL_STATE_KEY];
    return typeof val === 'string' && val.length > 0 ? val : null;
  }
  return null;
}

function buildStateWithModalId(modalId: string): Record<string, unknown> {
  const base =
    window.history.state && typeof window.history.state === 'object'
      ? { ...(window.history.state as Record<string, unknown>) }
      : {};
  base[MODAL_STATE_KEY] = modalId;
  return base;
}

function scheduleReconcile(): void {
  if (reconcileScheduled || typeof window === 'undefined') return;
  reconcileScheduled = true;
  queueMicrotask(reconcileHistory);
}

function handleGlobalPopState(ev: PopStateEvent): void {
  if (awaitingPopstates > 0) {
    awaitingPopstates -= 1;
    if (awaitingPopstates === 0) {
      scheduleReconcile();
    }
    return;
  }

  if (pushedIds.length === 0) return;

  const activeId = getActiveHistoryModalId(ev.state);
  const keepCount = activeId ? pushedIds.indexOf(activeId) + 1 : 0;

  if (keepCount >= pushedIds.length) {
    return;
  }

  const poppedIds = pushedIds.slice(keepCount);
  pushedIds = pushedIds.slice(0, keepCount);

  const poppedSet = new Set(poppedIds);
  const toClose: ModalStackEntry[] = [];
  for (let i = liveStack.length - 1; i >= 0; i -= 1) {
    if (poppedSet.has(liveStack[i].id)) {
      toClose.push(liveStack[i]);
    }
  }
  liveStack = liveStack.filter((entry) => !poppedSet.has(entry.id));

  for (const entry of toClose) {
    try {
      entry.onClose();
    } catch {
      // Keep closing remaining popped modals even if one handler throws
    }
  }
}

function attachIosStandaloneSwipeListener(): void {
  if (typeof window === 'undefined' || !isIosStandalonePwa()) return;

  let tracking = false;
  let locked = false;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let lastDx = 0;

  const reset = () => {
    tracking = false;
    locked = false;
    lastDx = 0;
  };

  const handleTouchStart = (e: TouchEvent) => {
    if (liveStack.length === 0) return;
    if (e.touches.length !== 1) return;

    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable)
    ) {
      return;
    }

    const touch = e.touches[0];
    if (touch.clientX > 28) return;

    tracking = true;
    locked = false;
    startX = touch.clientX;
    startY = touch.clientY;
    startTime = performance.now();
    lastDx = 0;
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!tracking || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;

    if (!locked) {
      if (dx < 0) {
        reset();
        return;
      }
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dy) > dx * 0.75) {
        reset();
        return;
      }
      locked = true;
    }

    lastDx = Math.max(0, dx);
  };

  const handleTouchEnd = () => {
    if (!tracking) return;
    const elapsed = Math.max(1, performance.now() - startTime);
    const velocity = lastDx / elapsed;
    const shouldCloseTopModal = locked && (lastDx >= 64 || (lastDx >= 40 && velocity >= 0.35));
    reset();
    if (shouldCloseTopModal && liveStack.length > 0) {
      window.history.back();
    }
  };

  window.addEventListener('touchstart', handleTouchStart, { passive: true });
  window.addEventListener('touchmove', handleTouchMove, { passive: true });
  window.addEventListener('touchend', handleTouchEnd, { passive: true });
  window.addEventListener('touchcancel', reset, { passive: true });
}

function ensurePopStateListener(): void {
  if (listenerAttached || typeof window === 'undefined') return;
  window.addEventListener('popstate', handleGlobalPopState);
  attachIosStandaloneSwipeListener();
  listenerAttached = true;
}

function reconcileHistory(): void {
  reconcileScheduled = false;
  if (typeof window === 'undefined') return;
  if (awaitingPopstates > 0) return;

  const currentHistoryId = getActiveHistoryModalId();

  // If external navigation pushed another route state on top, avoid popping that route back
  if (pushedIds.length > 0 && currentHistoryId !== pushedIds[pushedIds.length - 1]) {
    pushedIds = [];
  }

  const liveIds = liveStack.map((e) => e.id);

  let commonLen = 0;
  const minLen = Math.min(pushedIds.length, liveIds.length);
  while (commonLen < minLen && pushedIds[commonLen] === liveIds[commonLen]) {
    commonLen += 1;
  }

  const toPop = pushedIds.length - commonLen;
  const toPush = liveIds.slice(commonLen);

  if (toPop === 0 && toPush.length === 0) return;

  if (toPop > 0 && toPush.length > 0) {
    if (toPop === 1) {
      window.history.replaceState(buildStateWithModalId(toPush[0]), '', window.location.href);
      for (let i = 1; i < toPush.length; i += 1) {
        window.history.pushState(buildStateWithModalId(toPush[i]), '', window.location.href);
      }
      pushedIds = liveIds;
      return;
    }
    awaitingPopstates += 1;
    pushedIds = pushedIds.slice(0, commonLen + 1);
    window.history.go(-(toPop - 1));
    window.setTimeout(() => {
      if (awaitingPopstates > 0) {
        awaitingPopstates = 0;
        scheduleReconcile();
      }
    }, 200);
    return;
  }

  if (toPop > 0) {
    awaitingPopstates += 1;
    pushedIds = pushedIds.slice(0, commonLen);
    window.history.go(-toPop);
    window.setTimeout(() => {
      if (awaitingPopstates > 0) {
        awaitingPopstates = 0;
        scheduleReconcile();
      }
    }, 200);
    return;
  }

  for (const id of toPush) {
    window.history.pushState(buildStateWithModalId(id), '', window.location.href);
  }
  pushedIds = liveIds;
}

/**
 * Returns true if any modal/sheet/overlay registered with useModalBackHandler is currently open.
 */
export function hasOpenModal(): boolean {
  return liveStack.length > 0;
}

/**
 * Returns true if the current browser history entry is owned by a modal/overlay.
 */
export function hasActiveModalHistoryEntry(): boolean {
  if (typeof window === 'undefined') return false;
  return getActiveHistoryModalId() !== null;
}

/**
 * Copies a history state object without the internal modal marker so route navigations never inherit it.
 */
export function stripModalHistoryKey(state: unknown): Record<string, unknown> {
  const next =
    state && typeof state === 'object' ? { ...(state as Record<string, unknown>) } : {};
  delete next[MODAL_STATE_KEY];
  return next;
}

/**
 * Returns the number of modal entries currently sitting on top of the active route entry
 * and clears modal history tracking so an explicit route navigation can safely replace/pop past them.
 */
export function consumePushedModalDepth(): number {
  const depth = pushedIds.length;
  pushedIds = [];
  return depth;
}

/**
 * Registers an open modal/overlay in a LIFO browser-history stack so device/browser Back
 * (Android Back button, iOS Safari swipe-back, and iOS standalone PWA left-edge swipe)
 * closes only the top modal instead of navigating to the previous page/project list.
 */
export function useModalBackHandler(isOpen: boolean, onClose: () => void): void {
  const modalId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;
    ensurePopStateListener();

    const entry: ModalStackEntry = {
      id: modalId,
      onClose: () => onCloseRef.current(),
    };
    liveStack = [...liveStack.filter((e) => e.id !== modalId), entry];
    scheduleReconcile();

    return () => {
      const idx = liveStack.findIndex((e) => e.id === modalId);
      if (idx !== -1) {
        liveStack = [...liveStack.slice(0, idx), ...liveStack.slice(idx + 1)];
        scheduleReconcile();
      }
    };
  }, [isOpen, modalId]);
}
