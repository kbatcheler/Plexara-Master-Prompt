import { useState } from "react";
import { AlertCircle, AlertTriangle, Info, CheckCircle2, X, ChevronDown } from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type AlertSeverity = "urgent" | "watch" | "info" | "resolved";

interface AlertBannerProps {
  severity: AlertSeverity;
  title: string;
  description?: string;
  /** Click target for "View details" — usually the record or trend page */
  viewHref?: string;
  /** If provided, renders a "Dismiss with reason" dropdown */
  onDismiss?: (reason: string) => void;
  className?: string;
  testId?: string;
}

/* ── Severity styling table ─────────────────────────────────────────────────
   The brief is explicit: severity-tinted bg + 4px left border + icon.
   Use the status palette tokens — never raw colour names — so dark mode and
   future re-themes work without touching this component. */
type IconProps = React.SVGProps<SVGSVGElement> & { className?: string };
const severityMap: Record<AlertSeverity, {
  Icon: React.ComponentType<IconProps>;
  /** CSS variable for tint colour (used in border + icon + soft bg). */
  varName: string;
  label: string;
}> = {
  urgent:   { Icon: AlertCircle,   varName: "--status-urgent",  label: "Urgent" },
  watch:    { Icon: AlertTriangle, varName: "--status-watch",   label: "Watch" },
  info:     { Icon: Info,          varName: "--status-normal",  label: "Info" },
  resolved: { Icon: CheckCircle2,  varName: "--status-optimal", label: "Resolved" },
};

const DISMISS_REASONS = [
  "Acknowledged — will monitor",
  "Discussed with clinician",
  "Already being addressed",
  "Not relevant to me",
  "False positive",
];

export function AlertBanner({
  severity, title, description, viewHref, onDismiss, className, testId,
}: AlertBannerProps) {
  const { Icon, varName, label } = severityMap[severity];
  const [busy, setBusy] = useState(false);

  return (
    <div
      role="status"
      aria-live={severity === "urgent" ? "assertive" : "polite"}
      data-testid={testId}
      className={cn(
        "relative flex items-start gap-3 pl-4 pr-3 py-3 rounded-lg border border-border bg-card",
        // 4px left accent — pure CSS for sharp edge in any zoom
        "before:absolute before:inset-y-0 before:left-0 before:w-1 before:rounded-l-lg",
        className,
      )}
      style={{
        // Soft tinted background (5% of severity colour)
        backgroundColor: `color-mix(in srgb, hsl(var(${varName})) 6%, hsl(var(--card)))`,
        ["--bar-color" as string]: `hsl(var(${varName}))`,
        // Set the ::before bar colour via custom property
        backgroundImage: `linear-gradient(to right, hsl(var(${varName})), hsl(var(${varName}))) `,
        backgroundSize: "4px 100%",
        backgroundRepeat: "no-repeat",
        backgroundPosition: "left",
      }}
    >
      <Icon
        className="w-5 h-5 shrink-0 mt-0.5"
        style={{ color: `hsl(var(${varName}))` }}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: `hsl(var(${varName}))` }}
          >
            {label}
          </span>
          <h4 className="text-sm font-semibold text-foreground truncate">{title}</h4>
        </div>
        {description && (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{description}</p>
        )}
      </div>
      <div className="flex items-center gap-1 shrink-0">
        {viewHref && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() => { window.location.href = viewHref; }}
          >
            View details
          </Button>
        )}
        {onDismiss ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs gap-1"
                disabled={busy}
                aria-label="Dismiss alert"
                data-testid={`${testId}-dismiss`}
              >
                Dismiss <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Reason
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              {DISMISS_REASONS.map((r) => (
                <DropdownMenuItem
                  key={r}
                  onClick={async () => { setBusy(true); try { await onDismiss(r); } finally { setBusy(false); } }}
                >
                  {r}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
    </div>
  );
}
