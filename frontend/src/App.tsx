import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { Dashboard } from "@/pages/Dashboard";
import { Requirements } from "@/pages/Requirements";
import { CreateRequirement } from "@/pages/CreateRequirement";
import { TransporterMatching } from "@/pages/TransporterMatching";
import { Shipments } from "@/pages/Shipments";
import { ShipmentDetail } from "@/pages/ShipmentDetail";
import { PODList, PODDetail } from "@/pages/POD";
import { Transporters, TransporterDetail } from "@/pages/Transporters";
import { DemoMode } from "@/pages/DemoMode";
import { ReceiverConfirmation } from "@/pages/ReceiverConfirmation";
import { TransporterQuoteSubmission } from "@/pages/TransporterQuoteSubmission";
import { TransporterAssignmentNotice } from "@/pages/TransporterAssignmentNotice";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Receiver-facing, reached via QR — standalone, no AppShell nav */}
        <Route path="/deliver/:token" element={<ReceiverConfirmation />} />
        {/* Transporter-facing, reached via the one-time quotation link — standalone, no AppShell nav */}
        <Route path="/quote/:token" element={<TransporterQuoteSubmission />} />
        {/* Transporter-facing, reached via the simulated assignment-notification link — standalone, no AppShell nav */}
        <Route path="/assignment/:token" element={<TransporterAssignmentNotice />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/requirements" element={<Requirements />} />
          <Route path="/requirements/new" element={<CreateRequirement />} />
          <Route path="/requirements/:id/edit" element={<CreateRequirement />} />
          <Route path="/requirements/:id/match" element={<TransporterMatching />} />
          <Route path="/shipments" element={<Shipments />} />
          <Route path="/shipments/:id" element={<ShipmentDetail />} />
          <Route path="/transporters" element={<Transporters />} />
          <Route path="/transporters/:id" element={<TransporterDetail />} />
          <Route path="/pod" element={<PODList />} />
          <Route path="/pod/:shipmentId" element={<PODDetail />} />
          <Route path="/demo" element={<DemoMode />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
