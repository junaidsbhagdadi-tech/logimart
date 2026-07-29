/**
 * Logimart — company identity used on labels, invoices, PODs.
 * TODO(logimart): replace all placeholder values below with Logimart's real
 * details (legal name, address, GSTIN, AWB/LR prefix) once provided.
 */
export const COMPANY = {
  legalName: 'Logimart Logistics Pvt Ltd', // TODO(logimart): confirm exact legal name
  brand: 'Logimart',
  tagline: 'Surface & Domestic Air Cargo',
  address: {
    line1: 'TODO(logimart): address line 1',
    line2: 'TODO(logimart): address line 2',
    city: 'TODO(logimart): city',
    pincode: 'TODO',
    country: 'India',
  },
  phones: ['TODO(logimart): phone'],
  emails: ['TODO(logimart): email'],
  website: 'TODO(logimart): website',
  contact: { name: 'TODO(logimart): contact name', title: 'TODO(logimart): title' },

  // Carrier GSTIN for LR / e-way bill / e-invoice. TODO(logimart): set real GSTIN.
  gstin: process.env.COMPANY_GSTIN ?? 'TODO_LOGIMART_GSTIN',

  // AWB / LR prefix used when generating master waybill numbers.
  // TODO(logimart): confirm the real prefix + numbering format.
  awbPrefix: process.env.AWB_PREFIX ?? 'LMT',
} as const;

/** Volumetric divisor for chargeable-weight math (cm^3 -> kg). TODO(logimart): confirm. */
export const VOLUMETRIC_DIVISOR = Number(process.env.VOLUMETRIC_DIVISOR ?? 5000);
