// Carrier identity for printed documents (mirror of apps/api config/company.ts).
// TODO(logimart): replace placeholders with Logimart's real details.
export const COMPANY = {
  legalName: 'Logimart Logistics Pvt Ltd', // TODO(logimart): confirm exact legal name
  tagline: 'Surface & Domestic Air Cargo',
  addressLines: [
    'TODO(logimart): address line 1',
    'TODO(logimart): address line 2, City - PIN',
  ],
  phones: 'TODO(logimart): phone',
  email: 'TODO(logimart): email',
  gstin: 'TODO_LOGIMART_GSTIN',
  cin: '', // TODO(logimart): CIN if applicable
  pan: 'TODO_LOGIMART_PAN', // TODO(logimart): PAN
  sacCode: '996812', // SAC for goods transport / courier services
  jurisdiction: 'Delhi', // legal jurisdiction printed in T&C — TODO(logimart): confirm
  // Bank details for the invoice NEFT/RTGS footer — ICICI (from the invoice-format attachment).
  bank: {
    beneficiary: 'Logimart Logistics Pvt Ltd', // TODO(logimart): confirm beneficiary name on the account
    name: 'ICICI BANK',
    accountNo: '347405000806',
    ifsc: 'ICIC0003474',
    branch: 'Mahipalpur, New Delhi',
    address: '84 B-1, Main Vasant Kunj Road, Mahipalpur, New Delhi-110037',
  },
  // Numbered Terms & Conditions (matches the supplied invoice format).
  terms: [
    'Payment should be made within 7 days from the date of Invoice; delayed payment will attract interest @ 24% P.A.',
    'All disputes are subject to Delhi jurisdiction only.',
    'Cheque / Draft should be made in favour of "Logimart Logistics Pvt Ltd".',
    'Any discrepancy in this invoice must be communicated in writing within 7 days of the date of invoice.',
    'This is a computer-generated invoice and does not require a signature.',
  ],
};
