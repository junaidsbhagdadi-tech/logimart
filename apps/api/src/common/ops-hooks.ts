/**
 * Tiny hooks into the owner console (OpsService) that any code can call without wiring a dependency:
 * record an event (error / security / deploy …) or wrap a background job so its runs are tracked.
 * Until OpsService registers itself (or if it fails), the hooks are no-ops — monitoring must never
 * break the work it watches.
 */
export type OpsEventInput = {
  kind: 'error' | 'security' | 'boot' | 'alert' | 'info';
  level?: 'info' | 'warn' | 'error';
  source?: string; // module / carrier / route
  message: string;
  detail?: Record<string, any>;
  fingerprint?: string; // groups repeats of the same problem
  userId?: bigint | string | null;
};

type Sink = {
  record(e: OpsEventInput): void;
  jobStart(name: string): Promise<bigint | null>;
  jobEnd(id: bigint | null, name: string, ok: boolean, summary?: string, error?: string): void;
  http(method: string, path: string, status: number, ms: number): void;
  alert(key: string, subject: string, body: string): void;
};

let sink: Sink | null = null;
export function registerOpsSink(s: Sink) { sink = s; }

export function opsRecord(e: OpsEventInput) {
  try { sink?.record(e); } catch { /* never throw from monitoring */ }
}

export function opsHttp(method: string, path: string, status: number, ms: number) {
  try { sink?.http(method, path, status, ms); } catch { /* ignore */ }
}

/** Email the owner now (de-duplicated per key) — for things that can't wait for the console. */
export function opsAlert(key: string, subject: string, body: string) {
  try { sink?.alert(key, subject, body); } catch { /* ignore */ }
}

/** Is this email on the server's owner list (OPS_OWNER_EMAILS)? */
export function isOpsOwnerEmail(email?: string | null) {
  const list = String(process.env.OPS_OWNER_EMAILS || '').split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  return !!email && list.includes(String(email).toLowerCase());
}

/** Run a background job and record its run (start, duration, ok / error, a short result summary). */
export async function opsJob<T>(name: string, fn: () => Promise<T>, summarize?: (r: T) => string): Promise<T> {
  const id = sink ? await sink.jobStart(name).catch(() => null) : null;
  try {
    const r = await fn();
    let summary: string | undefined;
    try { summary = summarize ? summarize(r) : r && typeof r === 'object' ? JSON.stringify(r).slice(0, 300) : r != null ? String(r).slice(0, 300) : undefined; } catch { summary = undefined; }
    sink?.jobEnd(id, name, true, summary);
    return r;
  } catch (e: any) {
    sink?.jobEnd(id, name, false, undefined, String(e?.message || e).slice(0, 1000));
    throw e;
  }
}
