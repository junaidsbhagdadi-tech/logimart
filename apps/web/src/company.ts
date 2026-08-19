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
  sacCode: '996812', // SAC for goods transport / courier services (matches billing app)
  // Bank details for the invoice NEFT/RTGS footer (like the billing app).
  bank: {
    beneficiary: 'Logimart Logistics Pvt Ltd', // TODO(logimart): confirm beneficiary
    name: 'TODO(logimart): bank name',
    accountNo: 'TODO(logimart): account number',
    ifsc: 'TODO(logimart): IFSC code',
    branch: 'TODO(logimart): branch',
  },
  // Numbered Terms & Conditions (matches the billing app invoice).
  terms: [
    'Any errors in the invoice must be reported in writing within 3 days from the date of receipt of the invoice.',
    'Interest @24% per annum will be charged on bills after the due date.',
    'Bank details for payment through NEFT or RTGS are as mentioned below:',
  ],
};
