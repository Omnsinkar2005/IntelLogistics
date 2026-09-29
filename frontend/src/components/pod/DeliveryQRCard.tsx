import { QRCodeSVG } from "qrcode.react";
import { QrCode, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardBody, Button } from "@/components/common";

interface DeliveryQRCardProps {
  qrToken: string;
}

/**
 * Shipment-specific delivery QR. Scanning it opens the receiver
 * confirmation page (/deliver/:token) — the same page the "Open Receiver
 * Confirmation" link below opens directly. That link is a POC-only
 * convenience for when a physical phone can't reach a localhost URL; it is
 * not a second POD workflow, just another way to reach the same page.
 */
export function DeliveryQRCard({ qrToken }: DeliveryQRCardProps) {
  const confirmUrl = `${window.location.origin}/deliver/${qrToken}`;

  return (
    <Card>
      <CardHeader>
        <h2 className="font-bold text-slate-800 flex items-center gap-2">
          <QrCode className="w-5 h-5 text-indigo-500" /> Delivery QR
        </h2>
      </CardHeader>
      <CardBody className="p-6">
        <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
          <div className="p-3 bg-white border-2 border-slate-100 rounded-xl flex-shrink-0">
            <QRCodeSVG value={confirmUrl} size={140} />
          </div>
          <div className="flex-1 min-w-0 text-center sm:text-left">
            <p className="text-sm font-medium text-slate-600">
              The receiver scans this at the destination and confirms delivery — the POD is then automatically registered for manager approval.
            </p>
            <p className="text-[11px] text-slate-400 mt-2 break-all font-mono">{confirmUrl}</p>
            <Button
              variant="secondary" size="sm" className="mt-3"
              onClick={() => window.open(`/deliver/${qrToken}`, "_blank")}
            >
              <ExternalLink className="w-3.5 h-3.5" /> Open Receiver Confirmation (Demo)
            </Button>
            <p className="text-[10px] text-slate-400 mt-1.5">
              POC convenience only — opens the same confirmation page a real QR scan would, useful when a phone can't reach this localhost URL.
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
