// Assignable feature catalog (route path = feature key). Super admin grants a subset per user;
// the sidebar then shows only granted features. Keep roughly in sync with the Layout nav.
export type Feature = { to: string; label: string };
export type FeatureSection = { section: string; features: Feature[] };

export const FEATURE_CATALOG: FeatureSection[] = [
  { section: 'Overview', features: [
    { to: '/', label: 'Dashboard' },
    { to: '/tracker', label: 'Track Shipment' },
  ] },
  { section: 'Operations', features: [
    { to: '/create', label: 'New Shipment' },
    { to: '/awb-list', label: 'Shipment List' },
    { to: '/bulk', label: 'Bulk Booking' },
    { to: '/walk-in', label: 'Walk-in Counter' },
    { to: '/deliver', label: 'Delivery App' },
    { to: '/pickups', label: 'Pickups' },
    { to: '/manifests', label: 'Manifests' },
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
    { to: '/mm/unloaded-bags', label: 'Unloaded Bags' },
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
    { to: '/receivables', label: 'Receivables' },
    { to: '/notes', label: 'Debit / Credit Notes' },
    { to: '/claims', label: 'Claims' },
    { to: '/customers', label: 'Customers' },
    { to: '/vendors', label: 'Vendors' },
    { to: '/vehicles', label: 'Vehicles' },
    { to: '/vendor-bills', label: 'Vendor Bills & P&L' },
    { to: '/documents', label: 'Documents' },
    { to: '/sales', label: 'Sales' },
  ] },
  { section: 'Masters & Setup', features: [
    { to: '/ftl-rates', label: 'FTL Rates' },
    { to: '/service-mapping', label: 'Service Mapping' },
    { to: '/pincodes', label: 'Pincodes and TAT' },
    { to: '/masters', label: 'Masters' },
    { to: '/bulk-rate-upload', label: 'Bulk Rate Upload' },
    { to: '/tax', label: 'Tax Filing' },
  ] },
  { section: 'Insights & Admin', features: [
    { to: '/reports', label: 'Reports' },
    { to: '/audit', label: 'Audit Log' },
  ] },
];

export const ALL_FEATURES = FEATURE_CATALOG.flatMap((s) => s.features.map((f) => f.to));
