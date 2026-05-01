import { Link } from "wouter";
import { ArrowUpRight } from "lucide-react";

/**
 * OpenFeature — small inline "Open this feature" deep link button
 * placed at the bottom of every feature explainer. Wraps wouter Link.
 */
export function OpenFeature({
  to,
  label,
}: {
  to: string;
  label?: string;
}) {
  return (
    <Link
      href={to}
      className="inline-flex items-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/10 transition-colors no-underline"
      data-testid={`help-open-${to.replace(/[^a-z0-9]+/gi, "-")}`}
    >
      <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
      <span>{label ?? `Open ${to}`}</span>
    </Link>
  );
}
