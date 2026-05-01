import { useState, type ReactNode } from "react";
import { ChevronRight, Stethoscope } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * ClinicalDetail — collapsible expander used throughout the help guide
 * to surface a more technical/clinical layer of an explanation without
 * cluttering the plain-language baseline.
 *
 * Default state is closed so non-clinical readers see only the calm
 * top-level prose; clinicians (or curious patients) can opt in.
 */
export function ClinicalDetail({
  label = "Clinical detail",
  children,
}: {
  label?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3 rounded-lg border border-border/60 bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
        data-testid="help-clinical-detail-toggle"
      >
        <Stethoscope className="h-3.5 w-3.5 text-primary/70" aria-hidden />
        <span className="uppercase tracking-wider">{label}</span>
        <ChevronRight
          className={cn(
            "ml-auto h-3.5 w-3.5 transition-transform",
            open && "rotate-90",
          )}
          aria-hidden
        />
      </button>
      {open && (
        <div className="border-t border-border/60 px-3 py-3 text-sm leading-relaxed text-foreground/90 [&_p]:mt-2 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
          {children}
        </div>
      )}
    </div>
  );
}
