// Assignable feature catalog (route path = feature key). Super admin grants a subset per user;
// the sidebar then shows only granted features. Keep roughly in sync with the Layout nav.
export type Feature = { to: string; label: string };
export type FeatureSection = { section: string; features: Feature[] };

export const FEATURE_CATALOG: FeatureSection[] = [
  { section: 'Overview', features: [
    { to: '/', label: 'Dashboard' },
    { to: '/team-dashboards', label: 'Team Dashboards' },
    { to: '/tracker', label: 'Track Shipment' },
    { to: '/pincode-search', label: 'Pincode Search' },
  ] },
  { section: 'Operations', features: [
    { to: '/create', label: 'New Shipment' },
    { to: '/awb-list', label: 'Shipment List' },
    { to: '/bulk', label: 'Bulk Booking' },
    { to: '/walk-in', label: 'Walk-in Counter' },
    { to: '/deliver', label: 'Delivery App' },
    { to: '/pickups', label: 'Pickups' },
  ] },
  { section: 'First Mile', features: [
    { to: '/fm', label: 'First Mile Dashboard' },
    { to: '/fm/pickup-outscan', label: 'Pickup Outscan' },
    { to: '/fm/bulk-pickup-outscan', label: 'Bulk Pickup Outscan' },
    { to: '/fm/update-pickup', label: 'Update Pickup' },
  ] },
  { section: 'Mid Mile', features: [
    { to: '/mm', label: 'Mid Mile Dashboard' },
    { to: '/mm/inscan-shipment', label: 'Inscan Shipment (ORD)' },
    { to: '/mm/bagging', label: 'Bagging' },
    { to: '/mm/trips', label: 'Trips' },
    { to: '/mm/inscan-trip', label: 'Inscan Trip (DPD)' },
  ] },
  { section: 'Last Mile', features: [
    { to: '/lm', label: 'Last Mile Dashboard' },
    { to: '/lm/inscan-shipment', label: 'Inscan Shipment (DRD)' },
    { to: '/lm/inscan-trip', label: 'Inscan Trip (arrival)' },
    { to: '/lm/delivery-outscan', label: 'Delivery Outscan' },
    { to: '/lm/update-delivery', label: 'Update Delivery' },
    { to: '/lm/bulk-delivery-update', label: 'Bulk Delivery Update' },
    { to: '/lm/manual-scan', label: 'Update Scans (manual)' },
  ] },
  { section: 'Billing & CRM', features: [
    { to: '/invoices', label: 'Invoices' },
    { to: '/bill-worksheet', label: 'Bill Worksheet' },
    { to: '/sales-mis', label: 'Sales MIS' },
    { to: '/receivables', label: 'Receivables' },
    { to: '/notes', label: 'Debit / Credit Notes' },
    { to: '/claims', label: 'Claims' },
    { to: '/customers', label: 'Customers' },
    { to: '/vendors', label: 'Vendors' },
    { to: '/vehicles', label: 'Vehicles' },
    { to: '/vendor-bills', label: 'Vendor Bills & P&L' },
    { to: '/documents', label: 'Documents' },
    { to: '/expenses', label: 'Expense Tracker' },
    { to: '/sales', label: 'Sales' },
  ] },
  { section: 'Masters & Setup', features: [
    { to: '/ftl-rates', label: 'FTL Rates' },
    { to: '/per-box-rates', label: 'Per-Box Rates' },
    { to: '/service-mapping', label: 'Service Mapping' },
    { to: '/pincodes', label: 'Pincodes and TAT' },
    { to: '/masters', label: 'Masters' },
    { to: '/bulk-rate-upload', label: 'Bulk Rate Upload' },
    { to: '/tax', label: 'Tax Filing' },
  ] },
  { section: 'Insights & Admin', features: [
    { to: '/reports', label: 'Reports' },
    { to: '/riders', label: 'Riders & Drivers' },
    { to: '/audit', label: 'Audit Log' },
    { to: '/feedback', label: 'Feedback' },
  ] },
];

export const ALL_FEATURES = FEATURE_CATALOG.flatMap((s) => s.features.map((f) => f.to));

// ============================ DEPARTMENTS ============================
// A user's department drives their DEFAULT feature access (which pages + at what level). Role
// remains the hard server-side boundary; an explicit per-user grant still overrides the default.
export type DeptLevel = 'VIEW' | 'EDIT' | 'DELETE';
export type Department = 'OPERATIONS' | 'CUSTOMER_SERVICE' | 'FINANCE' | 'SALES' | 'MANAGEMENT';

export const DEPARTMENTS: { value: Department; label: string; desc: string }[] = [
  { value: 'OPERATIONS', label: 'Operations / Warehouse', desc: 'Booking + first/mid/last-mile scanning, pickups, delivery.' },
  { value: 'CUSTOMER_SERVICE', label: 'Customer Service', desc: 'Booking on behalf, tracking, claims, customer coordination.' },
  { value: 'FINANCE', label: 'Finance & Billing', desc: 'Invoices, receivables, notes, vendor bills, tax.' },
  { value: 'SALES', label: 'Sales & CRM', desc: 'Customers, quoting, rates, sales targets & MIS.' },
  { value: 'MANAGEMENT', label: 'Management', desc: 'Full cross-department visibility.' },
];
export const departmentLabel = (d?: string | null) =>
  DEPARTMENTS.find((x) => x.value === d)?.label ?? '—';

// Compact level maps per department. Anything not listed is hidden for that department.
const OPERATIONS: Record<string, DeptLevel> = {
  '/': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
  '/create': 'EDIT', '/awb-list': 'EDIT', '/bulk': 'EDIT', '/deliver': 'EDIT', '/pickups': 'EDIT', '/walk-in': 'EDIT',
  '/fm': 'VIEW', '/fm/pickup-outscan': 'EDIT', '/fm/bulk-pickup-outscan': 'EDIT', '/fm/update-pickup': 'EDIT',
  '/mm': 'VIEW', '/mm/inscan-shipment': 'EDIT', '/mm/bagging': 'EDIT', '/mm/trips': 'EDIT', '/mm/inscan-trip': 'EDIT',
  '/lm': 'VIEW', '/lm/inscan-shipment': 'EDIT', '/lm/inscan-trip': 'EDIT', '/lm/delivery-outscan': 'EDIT',
  '/lm/update-delivery': 'EDIT', '/lm/bulk-delivery-update': 'EDIT', '/lm/manual-scan': 'EDIT',
  '/reports': 'VIEW',
};
const CUSTOMER_SERVICE: Record<string, DeptLevel> = {
  '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
  '/create': 'EDIT', '/awb-list': 'EDIT', '/bulk': 'EDIT', '/pickups': 'EDIT',
  '/customers': 'EDIT', '/claims': 'EDIT', '/documents': 'EDIT', '/notes': 'VIEW', '/invoices': 'VIEW',
  '/reports': 'VIEW',
};
const FINANCE: Record<string, DeptLevel> = {
  '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW',
  '/invoices': 'DELETE', '/bill-worksheet': 'EDIT', '/sales-mis': 'VIEW', '/receivables': 'EDIT',
  '/notes': 'DELETE', '/claims': 'EDIT', '/customers': 'EDIT', '/vendors': 'EDIT', '/vehicles': 'EDIT',
  '/vendor-bills': 'EDIT', '/documents': 'EDIT', '/expenses': 'EDIT', '/sales': 'VIEW',
  '/ftl-rates': 'VIEW', '/per-box-rates': 'VIEW', '/tax': 'EDIT', '/reports': 'VIEW',
};
const SALES: Record<string, DeptLevel> = {
  '/': 'VIEW', '/team-dashboards': 'VIEW', '/tracker': 'VIEW', '/pincode-search': 'VIEW',
  '/create': 'EDIT', '/awb-list': 'VIEW', '/invoices': 'VIEW',
  '/customers': 'EDIT', '/sales': 'EDIT', '/sales-mis': 'VIEW',
  '/ftl-rates': 'VIEW', '/per-box-rates': 'VIEW', '/service-mapping': 'VIEW', '/pincodes': 'VIEW',
  '/reports': 'VIEW',
};
// Management sees everything at full level.
const MANAGEMENT: Record<string, DeptLevel> = Object.fromEntries(ALL_FEATURES.map((to) => [to, 'DELETE']));

export const DEPARTMENT_DEFAULTS: Record<Department, Record<string, DeptLevel>> = {
  OPERATIONS, CUSTOMER_SERVICE, FINANCE, SALES, MANAGEMENT,
};

/** Default feature grants for a department (or null if unassigned/unknown). */
export function departmentGrants(dep?: string | null): Record<string, DeptLevel> | null {
  return dep && dep in DEPARTMENT_DEFAULTS ? DEPARTMENT_DEFAULTS[dep as Department] : null;
}
