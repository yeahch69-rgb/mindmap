import { api } from '../api/client';

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  );
}

function getDeviceInfo(): string {
  const ua = navigator.userAgent || 'unknown';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'iOS PWA / Safari';
  if (/Android/i.test(ua)) return 'Android Browser / PWA';
  if (/Windows/i.test(ua)) return 'Windows Desktop';
  if (/Mac/i.test(ua)) return 'macOS Desktop';
  return 'Web Browser';
}

export async function ensurePushSubscriptionSynced(
  requestPermissionIfDefault = false
): Promise<{ ok: boolean; reason?: 'unsupported' | 'denied' | 'default' | 'no-vapid' | 'error' }> {
  try {
    if (!isPushSupported()) {
      return { ok: false, reason: 'unsupported' };
    }

    let permission = Notification.permission;
    if (permission === 'default') {
      if (!requestPermissionIfDefault) {
        return { ok: false, reason: 'default' };
      }
      permission = await Notification.requestPermission();
    }

    if (permission !== 'granted') {
      return { ok: false, reason: permission === 'denied' ? 'denied' : 'default' };
    }

    const reg = await navigator.serviceWorker.ready;
    if (!reg || !reg.pushManager) {
      return { ok: false, reason: 'unsupported' };
    }

    const keyData = await api.get<{ publicKey: string }>('/push/vapid-public-key');
    if (!keyData?.publicKey) {
      return { ok: false, reason: 'no-vapid' };
    }

    const appServerKey = urlB64ToUint8Array(keyData.publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey.buffer as ArrayBuffer,
      });
    }

    if (sub) {
      await api.post('/push/subscribe', {
        subscription: sub.toJSON(),
        deviceInfo: getDeviceInfo(),
      });
      return { ok: true };
    }
    return { ok: false, reason: 'error' };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

export async function unsubscribeCurrentPush(): Promise<void> {
  try {
    let endpoint: string | undefined;
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg?.pushManager?.getSubscription();
      if (sub) {
        endpoint = sub.endpoint;
        await sub.unsubscribe();
      }
    }
    await api.post('/push/unsubscribe', { endpoint });
  } catch {
    // ignore cleanup failures
  }
}
