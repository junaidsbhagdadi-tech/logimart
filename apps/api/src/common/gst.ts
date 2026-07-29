// Shared GST helpers: place-of-supply split (CGST+SGST intra-state vs IGST inter-state).
// Carrier state defaults to Karnataka (29); override via COMPANY_STATE_CODE.

export const GST_RATE = 0.18; // GTA / transport service, SAC 9968

export const STATE_NAMES: Record<string, string> = {
  '29': 'Karnataka', '27': 'Maharashtra', '36': 'Telangana', '33': 'Tamil Nadu',
  '07': 'Delhi', '24': 'Gujarat', '06': 'Haryana', '09': 'Uttar Pradesh',
  '19': 'West Bengal', '32': 'Kerala', '08': 'Rajasthan', '37': 'Andhra Pradesh',
  '23': 'Madhya Pradesh', '03': 'Punjab', '10': 'Bihar', '21': 'Odisha',
};

export const stateName = (code: string | null): string | null =>
  code ? STATE_NAMES[code] ?? null : null;

export interface GstSplit {
  subtotal: number;
  tax: number;
  cgst: number;
  sgst: number;
  igst: number;
  total: number;
  placeOfSupply: string;
}

/**
 * Split GST on a pre-tax subtotal for a given client GSTIN.
 * applyGst=false yields a zero-tax split (e.g. non-taxable claim compensation).
 */
export function gstSplit(
  subtotal: number,
  clientGstin: string | null,
  clientCity: string | null,
  applyGst = true,
): GstSplit {
  const r2 = (n: number) => +n.toFixed(2);
  const carrierState = process.env.COMPANY_STATE_CODE ?? '29';
  const clientState = clientGstin && clientGstin.length >= 2 ? clientGstin.slice(0, 2) : null;
  const intraState = clientState ? clientState === carrierState : true;

  const tax = applyGst ? r2(subtotal * GST_RATE) : 0;
  const cgst = intraState ? r2(tax / 2) : 0;
  const sgst = intraState ? r2(tax / 2) : 0;
  const igst = intraState ? 0 : tax;
  const placeOfSupply = stateName(clientState) ?? clientCity ?? stateName(carrierState) ?? 'Karnataka';
  return { subtotal: r2(subtotal), tax, cgst, sgst, igst, total: r2(subtotal + tax), placeOfSupply };
}
