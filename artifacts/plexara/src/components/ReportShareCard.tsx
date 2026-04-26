import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { useCurrentPatient } from "../hooks/use-current-patient";
import { api } from "../lib/api";
import { Button } from "@/components/ui/button";
import { Loader2, Copy, Check, RefreshCw, ShieldCheck, Link2 } from "lucide-react";

interface ShareLink {
  id: number;
  token: string;
  label: string | null;
  recipientName: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

const DEFAULT_LABEL = "Comprehensive Report";
const DEFAULT_DAYS = 14;

/**
 * Generates a single time-limited share link for the comprehensive report and
 * renders a scannable QR code. Designed to live in the report header so the
 * patient can hand a clinician the report without printing — they scan and
 * see the same view at /share/:token. Print-friendly: the QR survives the
 * "Print / save PDF" path because we render it as inline SVG.
 */
export function ReportShareCard() {
  const { patientId } = useCurrentPatient();
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function generate() {
    if (!patientId || busy) return;
    setBusy(true);
    setErr(null);
    try {
      const created = await api<ShareLink>(`/patients/${patientId}/share-links`, {
        method: "POST",
        body: JSON.stringify({
          label: DEFAULT_LABEL,
          expiresInDays: DEFAULT_DAYS,
        }),
      });
      setLink(created);
    } catch {
      setErr("Could not generate share link. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeAndRegenerate() {
    if (!patientId || !link || busy) return;
    setBusy(true);
    try {
      await api(`/patients/${patientId}/share-links/${link.id}`, { method: "DELETE" });
      setLink(null);
      await generate();
    } catch {
      setErr("Could not regenerate share link.");
    } finally {
      setBusy(false);
    }
  }

  async function copyUrl() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(shareUrl(link.token));
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setErr("Could not copy link to clipboard.");
    }
  }

  if (!patientId) return null;

  if (!link) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-4 print:hidden">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <Link2 className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-foreground">Share this report securely</h4>
            <p className="text-xs text-muted-foreground mt-1 max-w-md leading-relaxed">
              Generate a single-use, time-limited link with a scannable QR code. Anyone you share the link or QR with sees a read-only copy of this report. Expires after {DEFAULT_DAYS} days.
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Button onClick={generate} disabled={busy} size="sm" data-testid="btn-generate-share">
                {busy ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5 mr-2" />}
                Generate share link &amp; QR
              </Button>
              {err && <span className="text-xs text-destructive">{err}</span>}
            </div>
          </div>
        </div>
      </div>
    );
  }

  const url = shareUrl(link.token);
  const expires = link.expiresAt ? new Date(link.expiresAt).toLocaleDateString() : null;

  return (
    <div
      className="rounded-xl border border-border bg-card p-4 print:border-foreground/30 print:break-inside-avoid"
      data-testid="report-share-card"
    >
      <div className="flex flex-col sm:flex-row gap-4 items-start">
        <div className="bg-white p-2 rounded-lg border border-border shrink-0">
          <QRCodeSVG
            value={url}
            size={128}
            level="M"
            includeMargin={false}
            data-testid="report-share-qr"
          />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div>
            <h4 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4 text-primary" />
              Share with your clinician
            </h4>
            <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              Scan the QR or open the link below. Read-only{expires ? `, expires ${expires}` : ""}.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <code
              className="flex-1 min-w-0 truncate text-[11px] bg-secondary/60 rounded-md px-2 py-1.5 font-mono"
              data-testid="report-share-url"
            >
              {url}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={copyUrl}
              className="h-8 shrink-0 print:hidden"
              data-testid="btn-copy-share"
            >
              {copied ? <Check className="w-3.5 h-3.5 mr-1.5" /> : <Copy className="w-3.5 h-3.5 mr-1.5" />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>

          <div className="flex items-center gap-3 print:hidden">
            <Button
              size="sm"
              variant="ghost"
              onClick={revokeAndRegenerate}
              disabled={busy}
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
              data-testid="btn-regenerate-share"
            >
              {busy ? <Loader2 className="w-3 h-3 mr-1.5 animate-spin" /> : <RefreshCw className="w-3 h-3 mr-1.5" />}
              Revoke &amp; regenerate
            </Button>
            {err && <span className="text-xs text-destructive">{err}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function shareUrl(token: string): string {
  if (typeof window === "undefined") return `/share/${token}`;
  return `${window.location.origin}/share/${token}`;
}
