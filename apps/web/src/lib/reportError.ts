import { getToken } from '../api';

/**
 * Browser-side bugs → Tech Console. A crash in a screen (React render error, uncaught exception, rejected
 * promise) used to stay in the user's browser console where nobody saw it. Each distinct error is sent once per
 * session (max 20), only for signed-in users; noise (ResizeObserver, browser extensions) is skipped.
 */
const sent = new Set<string>();
const NOISE = /ResizeObserver loop|Script error\.?$|chrome-extension:|moz-extension:|Non-Error promise rejection|AbortError|The user aborted/i;

export function reportClientError(err: unknown, where = 'window') {
  try {
    const e = err as any;
    const message = String(e?.message ?? e ?? '').slice(0, 400);
    const stack = String(e?.stack ?? '').slice(0, 3000);
    if (!message || NOISE.test(message) || NOISE.test(stack)) return;
    const key = `${location.pathname}|${message}`;
    if (sent.has(key) || sent.size >= 20) return;
    sent.add(key);
    const token = getToken();
    if (!token) return;
    const base = (import.meta.env.VITE_API_URL as string) || '';
    void fetch(`${base}/api/v1/ops/client-error`, {
      method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ message, stack, path: location.pathname, where, ua: navigator.userAgent.slice(0, 160) }),
    }).catch(() => undefined);
  } catch { /* never let reporting break the page */ }
}

export function installErrorReporting() {
  window.addEventListener('error', (ev) => reportClientError(ev.error ?? ev.message, 'window.error'));
  window.addEventListener('unhandledrejection', (ev) => reportClientError(ev.reason, 'promise'));
}
