// One date format across the app: DD-MM-YYYY (and DD-MM-YYYY HH:mm for date-times, 24h).
// Replaces the mix of en-GB (DD/MM/YYYY), en-IN (D/M/YYYY, h:mm:ss am) and browser-default formats.

type DateLike = Date | string | number | null | undefined;

const p2 = (n: number) => String(n).padStart(2, '0');
const toDate = (v: DateLike): Date | null => {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

/** DD-MM-YYYY, or '' for an empty / invalid value. */
export function fmtDate(v: DateLike): string {
  const d = toDate(v);
  return d ? `${p2(d.getDate())}-${p2(d.getMonth() + 1)}-${d.getFullYear()}` : '';
}

/** DD-MM-YYYY HH:mm (24h), or '' for an empty / invalid value. */
export function fmtDateTime(v: DateLike): string {
  const d = toDate(v);
  return d ? `${fmtDate(d)} ${p2(d.getHours())}:${p2(d.getMinutes())}` : '';
}
