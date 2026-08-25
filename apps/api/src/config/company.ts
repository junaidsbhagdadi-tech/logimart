/**
 * Logimart — company identity used on labels, invoices, PODs.
 * TODO(logimart): replace all placeholder values below with Logimart's real
 * details (legal name, address, GSTIN, AWB/LR prefix) once provided.
 */
export const COMPANY = {
  legalName: 'EXCELEX EXPRESS LOGISTICS LLP', // billing legal entity
  brand: 'ExcelEx Express',
  tagline: 'Surface & Domestic Air Cargo',
  address: {
    line1: 'Office No. 27/2, Road No. 2, Block A, Near Aeroporto Hotel',
    line2: 'Mahipalpur',
    city: 'New Delhi',
    pincode: '110037',
    country: 'India',
  },
  phones: ['011-71859599'],
  emails: ['accounts@excelexlog.com'],
  website: '',
  contact: { name: '', title: '' },

  // Carrier GSTIN for LR / e-way bill / e-invoice.
  gstin: process.env.COMPANY_GSTIN ?? '07AAIFE6185E1ZC',
  pan: 'AAIFE6185E',
  cin: 'AAU-3745',
  stateCode: '07', // Delhi (Excelex). Fixed to the legal entity — not env-driven, so GST intra/inter is always correct.

  // AWB / LR prefix used when generating master waybill numbers.
  // Single-letter prefix + 10-digit running number (Xpresion-style), e.g. L1000000045.
  awbPrefix: process.env.AWB_PREFIX ?? 'L',
} as const;

/** Volumetric divisor for chargeable-weight math (cm^3 -> kg). TODO(logimart): confirm. */
export const VOLUMETRIC_DIVISOR = Number(process.env.VOLUMETRIC_DIVISOR ?? 5000);
