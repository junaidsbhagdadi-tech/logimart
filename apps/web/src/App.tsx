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
import { Customers } from './pages/Customers';
import { FtlRates } from './pages/FtlRates';
import { ZoneUploads } from './pages/ZoneUploads';
import { VendorBills } from './pages/VendorBills';
import { BillWorksheet } from './pages/BillWorksheet';
import { Pickups } from './pages/Pickups';
import { Manifests } from './pages/Manifests';
import { MyTasks } from './pages/MyTasks';
import { InvoicePrint } from './pages/InvoicePrint';
import { Users } from './pages/Users';
import { Feedback } from './pages/Feedback';
import { Vendors } from './pages/Vendors';
import { ServiceMap } from './pages/ServiceMap';
import { Sales } from './pages/Sales';
import { TaxFiling } from './pages/TaxFiling';
import { Notes } from './pages/Notes';
import { Claims } from './pages/Claims';
import { Documents } from './pages/Documents';
import { Receivables } from './pages/Receivables';
import { AuditLog } from './pages/AuditLog';
import { MasterData } from './pages/MasterData';
import { Masters } from './pages/Masters';
import { Deliver } from './pages/Deliver';
import { BulkBooking } from './pages/BulkBooking';
import { Scan } from './pages/Scan';
import { Drs } from './pages/Drs';
import { BulkPod } from './pages/BulkPod';
import { Reports } from './pages/Reports';
import { Import } from './pages/Import';

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
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/create" element={<CreateShipment />} />
        <Route path="/awb-list" element={<AwbEntryList />} />
        <Route path="/bulk" element={<BulkBooking />} />
        <Route path="/scan" element={<Scan />} />
        <Route path="/drs" element={<Drs />} />
        <Route path="/bulk-pod" element={<BulkPod />} />
        <Route path="/shipments/:awb" element={<ShipmentDetail />} />
        <Route path="/shipments/:awb/labels" element={<Labels />} />
        <Route path="/invoices" element={<Invoices />} />
        <Route path="/bill-worksheet" element={isAdminFin ? <BillWorksheet /> : <Navigate to="/" replace />} />
        <Route path="/invoices/:id" element={<InvoiceDetail />} />
        <Route path="/my-tasks" element={<MyTasks />} />
        <Route path="/pickups" element={<Pickups />} />
        <Route path="/manifests" element={<Manifests />} />
        <Route path="/customers" element={isAdminFin ? <Customers /> : <Navigate to="/" replace />} />
        <Route path="/vendors" element={isAdminFin ? <Vendors /> : <Navigate to="/" replace />} />
        <Route path="/service-mapping" element={isAdminFin ? <ServiceMap /> : <Navigate to="/" replace />} />
        <Route path="/sales" element={isAdminFin ? <Sales /> : <Navigate to="/" replace />} />
        <Route path="/ftl-rates" element={isAdminFin ? <FtlRates /> : <Navigate to="/" replace />} />
        <Route path="/vendor-bills" element={isAdminFin ? <VendorBills /> : <Navigate to="/" replace />} />
        <Route path="/zone-uploads" element={canMaster ? <ZoneUploads /> : <Navigate to="/" replace />} />
        <Route path="/tax" element={isAdminFin ? <TaxFiling /> : <Navigate to="/" replace />} />
        <Route path="/receivables" element={isAdminFin ? <Receivables /> : <Navigate to="/" replace />} />
        <Route path="/notes" element={isAdminFin ? <Notes /> : <Navigate to="/" replace />} />
        <Route path="/claims" element={isAdminFin ? <Claims /> : <Navigate to="/" replace />} />
        <Route path="/documents" element={isAdminFin ? <Documents /> : <Navigate to="/" replace />} />
        <Route path="/master-data" element={canMaster ? <MasterData /> : <Navigate to="/" replace />} />
        <Route path="/masters" element={canMaster ? <Masters /> : <Navigate to="/" replace />} />
        <Route path="/reports" element={canReports ? <Reports /> : <Navigate to="/" replace />} />
        <Route path="/import" element={canMaster ? <Import /> : <Navigate to="/" replace />} />
        <Route path="/audit" element={user?.role === 'SYS_ADMIN' ? <AuditLog /> : <Navigate to="/" replace />} />
        <Route path="/users" element={user?.role === 'SYS_ADMIN' ? <Users /> : <Navigate to="/" replace />} />
        <Route path="/feedback" element={user?.role === 'SYS_ADMIN' ? <Feedback /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
