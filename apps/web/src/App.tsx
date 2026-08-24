import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { CreateShipment } from './pages/CreateShipment';
import { AwbEntryList } from './pages/AwbEntryList';
import { ShipmentDetail } from './pages/ShipmentDetail';
import { Labels } from './pages/Labels';
import { Invoices } from './pages/Invoices';
import { InvoiceDetail } from './pages/InvoiceDetail';
import { Track } from './pages/Track';
import { TrackDetail } from './pages/TrackDetail';
import { PincodeSearch } from './pages/PincodeSearch';
import { GreenTax } from './pages/GreenTax';
import { Archive } from './pages/Archive';
import { Customers } from './pages/Customers';
import { FtlRates } from './pages/FtlRates';
import { VendorBills } from './pages/VendorBills';
import { WalkIn } from './pages/WalkIn';
import { AwbPrint } from './pages/AwbPrint';
import { BillWorksheet } from './pages/BillWorksheet';
import { Pickups } from './pages/Pickups';
import { Manifests } from './pages/Manifests';
import { InvoicePrint } from './pages/InvoicePrint';
import { Users } from './pages/Users';
import { Riders } from './pages/Riders';
import { Feedback } from './pages/Feedback';
import { Vendors } from './pages/Vendors';
import { Vehicles } from './pages/Vehicles';
import { ServiceMap } from './pages/ServiceMap';
import { Sales } from './pages/Sales';
import { TaxFiling } from './pages/TaxFiling';
import { Notes } from './pages/Notes';
import { Claims } from './pages/Claims';
import { Documents } from './pages/Documents';
import { Receivables } from './pages/Receivables';
import { AuditLog } from './pages/AuditLog';
import { Pincodes } from './pages/Pincodes';
import { Masters } from './pages/Masters';
import { Customer360 } from './pages/Customer360';
import { ClientPortal } from './pages/ClientPortal';
import { BulkRateUpload } from './pages/BulkRateUpload';
import { Deliver } from './pages/Deliver';
import { BulkBooking } from './pages/BulkBooking';
import { Reports } from './pages/Reports';
import { MileScan, MileDashboard, Bagging, DeliveryUpdate, ManualScan } from './pages/Mile';

export function App() {
  const { user } = useAuth();
  const isAdminFin = user?.role === 'FINANCE_EXEC' || user?.role === 'SYS_ADMIN';
  const canMaster = user?.role === 'HUB_MANAGER' || user?.role === 'SYS_ADMIN';
  const canReports = ['HUB_MANAGER', 'FINANCE_EXEC', 'SYS_ADMIN'].includes(user?.role || '');
  if (!user) {
    return (
      <Routes>
        {/* public, no login */}
        <Route path="/track" element={<Track />} />
        <Route path="/track/:awb" element={<Track />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }
  return (
    <Routes>
      <Route path="/track" element={<Track />} />
      <Route path="/track/:awb" element={<Track />} />
      <Route path="/deliver" element={<Deliver />} />
      <Route path="/invoices/:id/print" element={<InvoicePrint />} />
      <Route path="/shipments/:awb/awb-print" element={<AwbPrint />} />
      <Route element={<Layout />}>
        <Route path="/" element={user?.role === 'CLIENT_ADMIN' ? <ClientPortal /> : <Dashboard />} />
        <Route path="/tracker" element={<TrackDetail />} />
        <Route path="/pincode-search" element={<PincodeSearch />} />
        <Route path="/tracker/:awb" element={<TrackDetail />} />
        <Route path="/create" element={<CreateShipment />} />
        <Route path="/awb-list" element={<AwbEntryList />} />
        <Route path="/bulk" element={<BulkBooking />} />
        <Route path="/walk-in" element={isAdminFin || canMaster ? <WalkIn /> : <Navigate to="/" replace />} />
        <Route path="/shipments/:awb" element={<ShipmentDetail />} />
        <Route path="/shipments/:awb/labels" element={<Labels />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/bill-worksheet" element={isAdminFin ? <BillWorksheet /> : <Navigate to="/" replace />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/pickups" element={<Pickups />} />
        <Route path="/manifests" element={<Manifests />} />
        {/* First Mile */}
        <Route path="/fm" element={<MileDashboard mile="first" />} />
        <Route path="/fm/pickup-outscan" element={<MileScan title="Pickup Outscan" code="PKD" pickupPod hint="Scan each AWB the pickup staff collected → Picked (PKD). Attach a pickup POD if available." />} />
        <Route path="/fm/bulk-pickup-outscan" element={<MileScan title="Bulk Pickup Outscan" code="PKD" bulk hint="Paste all picked AWBs → Picked (PKD)." />} />
        <Route path="/fm/update-pickup" element={<MileScan title="Update Pickup" code="PKD" pickupPod hint="Re-confirm / update a pickup → Picked (PKD)." />} />
        {/* Mid Mile */}
        <Route path="/mm" element={<MileDashboard mile="mid" />} />
        <Route path="/mm/inscan-shipment" element={<MileScan title="Inscan Shipment" code="ORD" hub hint="Inscan at the origin hub → Origin hub received (ORD). Pick the hub." />} />
        <Route path="/mm/bagging" element={<Bagging />} />
        <Route path="/mm/trips" element={<Manifests />} />
        <Route path="/mm/unloaded-bags" element={<Navigate to="/mm" replace />} />
        <Route path="/mm/inscan-trip" element={<MileScan title="Inscan Trip (depart)" code="DPD" bulk hint="Scan AWBs loaded on the departing trip → Departed (DPD)." />} />
        {/* Last Mile */}
        <Route path="/lm" element={<MileDashboard mile="last" />} />
        <Route path="/lm/inscan-shipment" element={<MileScan title="Inscan Shipment" code="DRD" hub hint="Inscan at destination hub → Destination received (DRD). Pick the hub." />} />
        <Route path="/lm/inscan-trip" element={<MileScan title="Inscan Trip (arrival)" code="DRD" bulk hub hint="Scan AWBs arrived on the trip → Destination received (DRD). Pick the hub." />} />
        <Route path="/lm/delivery-outscan" element={<MileScan title="Delivery Outscan" code="OFD" hint="Handing to delivery staff → Out for delivery (OFD)." />} />
        <Route path="/lm/update-delivery" element={<DeliveryUpdate />} />
        <Route path="/lm/bulk-delivery-update" element={<DeliveryUpdate bulk />} />
        <Route path="/lm/manual-scan" element={<ManualScan />} />
        <Route path="/customers" element={isAdminFin ? <Customers /> : <Navigate to="/" replace />} />
        <Route path="/customers/:id/overview" element={isAdminFin ? <Customer360 /> : <Navigate to="/" replace />} />
        <Route path="/vendors" element={isAdminFin ? <Vendors /> : <Navigate to="/" replace />} />
        <Route path="/vehicles" element={isAdminFin || canMaster ? <Vehicles /> : <Navigate to="/" replace />} />
        <Route path="/service-mapping" element={isAdminFin || canMaster ? <ServiceMap /> : <Navigate to="/" replace />} />
        <Route path="/sales" element={isAdminFin ? <Sales /> : <Navigate to="/" replace />} />
        <Route path="/ftl-rates" element={isAdminFin ? <FtlRates /> : <Navigate to="/" replace />} />
        <Route path="/vendor-bills" element={isAdminFin ? <VendorBills /> : <Navigate to="/" replace />} />
        <Route path="/pincodes" element={canMaster ? <Pincodes /> : <Navigate to="/" replace />} />
        {/* old split routes → merged Pincodes screen (keep stale bookmarks working) */}
        <Route path="/master-data" element={<Navigate to="/pincodes" replace />} />
        <Route path="/zone-uploads" element={<Navigate to="/pincodes" replace />} />
        <Route path="/tax" element={isAdminFin ? <TaxFiling /> : <Navigate to="/" replace />} />
        <Route path="/receivables" element={isAdminFin ? <Receivables /> : <Navigate to="/" replace />} />
        <Route path="/notes" element={isAdminFin ? <Notes /> : <Navigate to="/" replace />} />
        <Route path="/claims" element={isAdminFin ? <Claims /> : <Navigate to="/" replace />} />
        <Route path="/documents" element={isAdminFin ? <Documents /> : <Navigate to="/" replace />} />
        <Route path="/masters" element={canMaster ? <Masters /> : <Navigate to="/" replace />} />
        {/* Standard Charges merged into Masters → Charges (default rate/min per charge). Keep old bookmarks working. */}
        <Route path="/standard-charges" element={<Navigate to="/masters" replace />} />
        <Route path="/bulk-rate-upload" element={canMaster ? <BulkRateUpload /> : <Navigate to="/" replace />} />
        <Route path="/green-tax" element={canMaster ? <GreenTax /> : <Navigate to="/" replace />} />
        <Route path="/reports" element={canReports ? <Reports /> : <Navigate to="/" replace />} />
        <Route path="/audit" element={user?.role === 'SYS_ADMIN' ? <AuditLog /> : <Navigate to="/" replace />} />
        <Route path="/users" element={user?.role === 'SYS_ADMIN' ? <Users /> : <Navigate to="/" replace />} />
        <Route path="/riders" element={(user?.role === 'SYS_ADMIN' || user?.role === 'HUB_MANAGER') ? <Riders /> : <Navigate to="/" replace />} />
        <Route path="/feedback" element={user?.role === 'SYS_ADMIN' ? <Feedback /> : <Navigate to="/" replace />} />
        <Route path="/archive" element={user?.role === 'SYS_ADMIN' ? <Archive /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
