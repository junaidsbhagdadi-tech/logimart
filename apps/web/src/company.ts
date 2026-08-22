// Billing / carrier legal entity for printed documents (mirror of apps/api config/company.ts).
// LogiMart is the operating software/brand; the invoicing legal entity is Excelex Express Logistics LLP.
export const COMPANY = {
  legalName: 'EXCELEX EXPRESS LOGISTICS LLP',
  tagline: 'Surface & Domestic Air Cargo',
  addressLines: [
    'Office No. 27/2, Road No. 2, Block A, Near Aeroporto Hotel,',
    'Mahipalpur, New Delhi - 110037',
  ],
  phones: '011-71859599',
  email: 'accounts@excelexlog.com',
  gstin: '07AAIFE6185E1ZC',
  cin: 'AAU-3745',
  pan: 'AAIFE6185E',
  stateCode: '07', // Delhi — drives CGST/SGST (intra) vs IGST (inter) on the invoice
  sacCode: '996812', // SAC for goods transport / courier services
  jurisdiction: 'Delhi',
  // Bank details for the invoice NEFT/RTGS footer — ICICI (real, per the invoice format).
  bank: {
    beneficiary: 'EXCELEX EXPRESS LOGISTICS LLP',
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
    'Cheque / Draft should be made in favour of "EXCELEX EXPRESS LOGISTICS LLP".',
    'Excelex EX liability is as per the clause specified on the reverse of the airway bill.',
    'Any discrepancy in this invoice must be communicated in writing within 7 days of the date of invoice.',
    'This is a computer-generated invoice and does not require a signature.',
  ],
};
