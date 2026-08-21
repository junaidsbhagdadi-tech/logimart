// The pincode-mapping file stores 3-letter city/service-centre codes (DEL, BLR, MUM…).
// Expand the common ones to full city names for display; unknown codes fall through as-is.
const CITY: Record<string, string> = {
  DEL: 'NEW DELHI', NDL: 'NEW DELHI', BLR: 'BENGALURU', BOM: 'MUMBAI', MUM: 'MUMBAI', HYD: 'HYDERABAD',
  MAA: 'CHENNAI', CHE: 'CHENNAI', CHN: 'CHENNAI', CCU: 'KOLKATA', KOL: 'KOLKATA', PNQ: 'PUNE', PUN: 'PUNE',
  AMD: 'AHMEDABAD', ABD: 'AHMEDABAD', JAI: 'JAIPUR', LKO: 'LUCKNOW', GOI: 'GOA', COK: 'KOCHI', CJB: 'COIMBATORE',
  NAG: 'NAGPUR', IDR: 'INDORE', BBI: 'BHUBANESWAR', PAT: 'PATNA', GAU: 'GUWAHATI', VTZ: 'VISAKHAPATNAM',
  VNS: 'VARANASI', CHD: 'CHANDIGARH', IXC: 'CHANDIGARH', SXR: 'SRINAGAR', IXJ: 'JAMMU', TRV: 'THIRUVANANTHAPURAM',
  SURAT: 'SURAT', SRT: 'SURAT', RAJ: 'RAJKOT', VAD: 'VADODARA', BRD: 'VADODARA', KNU: 'KANPUR', AGR: 'AGRA',
  LDH: 'LUDHIANA', ATQ: 'AMRITSAR', RPR: 'RAIPUR', RNC: 'RANCHI', DED: 'DEHRADUN', SLG: 'SILIGURI', MYS: 'MYSURU',
  MNG: 'MANGALURU', HBX: 'HUBLI', VJA: 'VIJAYAWADA', TIR: 'TIRUPATI', MDU: 'MADURAI', TCR: 'THRISSUR', CBE: 'COIMBATORE',
};

/** Full city name for a code (e.g. BLR → BENGALURU); returns the input unchanged if unknown. */
export function expandCity(code?: string | null): string {
  const c = String(code ?? '').trim();
  return CITY[c.toUpperCase()] || c;
}
