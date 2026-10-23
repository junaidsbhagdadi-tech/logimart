/**
 * E-way bill rules shared by booking, Edit AWB, the AWB list and compliance.
 *
 * We do NOT generate e-way bills (no GSP is wired). A consignment at/above the threshold with no
 * EWB number on file is "EWB pending" — derived, not stored, so it clears the moment CS enters the
 * real number from the GST portal via Edit AWB. Never invent a number: it prints on AWB copies /
 * manifests and goes to carriers.
 */
export const EWB_THRESHOLD = 50000; // ₹ — e-way bill mandatory at/above this invoice value

export function isEwbPending(s: { declaredValue?: unknown; ewbNo?: string | null; statusCode?: string | null }): boolean {
  if (s.statusCode === 'CAN') return false;
  if (s.ewbNo && String(s.ewbNo).trim()) return false;
  return s.declaredValue != null && Number(s.declaredValue) >= EWB_THRESHOLD;
}

/** Prisma `where` fragment matching EWB-pending shipments (AND it into a larger filter). */
export const EWB_PENDING_WHERE = {
  declaredValue: { gte: EWB_THRESHOLD },
  OR: [{ ewbNo: null }, { ewbNo: '' }],
  NOT: { statusCode: 'CAN' },
};

/** Normalise a typed/scanned EWB number ("1234 5678 9012" → "123456789012"); '' → null. */
export function normaliseEwbNo(v: unknown): string | null {
  const s = String(v ?? '').replace(/[\s-]/g, '');
  return s ? s : null;
}
