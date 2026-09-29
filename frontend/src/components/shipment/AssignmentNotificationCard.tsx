import { useState } from "react";
import { Mail, Copy, ExternalLink } from "lucide-react";
import { Card, CardHeader, CardBody, Button } from "@/components/common";

interface AssignmentNotificationCardProps {
  assignmentToken: string;
}

/**
 * Simulated "Shipment Assigned" email notification link, generated the
 * moment the shipment is created. Same copy/open pattern as the quotation
 * link and the POD QR — this link stands in for the email a transporter
 * would actually receive; opening it shows them the full assignment
 * notification with a CTA to view the shipment details.
 */
export function AssignmentNotificationCard({ assignmentToken }: AssignmentNotificationCardProps) {
  const [copied, setCopied] = useState(false);
  const notifyUrl = `${window.location.origin}/assignment/${assignmentToken}`;

  const copyLink = () => {
    navigator.clipboard?.writeText(notifyUrl).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card>
      <CardHeader>
        <h2 className="font-bold text-slate-800 flex items-center gap-2">
          <Mail className="w-5 h-5 text-indigo-500" /> Transporter Assignment Notification
        </h2>
      </CardHeader>
      <CardBody className="p-6">
        <p className="text-sm font-medium text-slate-600">
          A simulated "Shipment Assigned" email was sent to the transporter with the full shipment details and a link to view them.
        </p>
        <div className="flex items-center gap-2 mt-3">
          <code className="text-[11px] bg-slate-50 border border-slate-200 rounded px-2 py-1 text-slate-500 truncate flex-1 min-w-0">
            {notifyUrl}
          </code>
          <Button variant="secondary" size="sm" onClick={copyLink}>
            <Copy className="w-3.5 h-3.5" /> {copied ? "Copied" : "Copy link"}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => window.open(`/assignment/${assignmentToken}`, "_blank")}>
            <ExternalLink className="w-3.5 h-3.5" /> Open
          </Button>
        </div>
        <p className="text-[10px] text-slate-400 mt-2">
          No email integration in this POC — this link stands in for the one that would be emailed to the transporter.
        </p>
      </CardBody>
    </Card>
  );
}
