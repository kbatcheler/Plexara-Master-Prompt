import { Link } from "wouter";
import { HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/**
 * HelpHint — a small "?" icon that surfaces a one-paragraph plain-language
 * explainer in a tooltip and (optionally) deep-links to the relevant
 * section of the full Help guide.
 *
 * Usage:
 *   <HelpHint topic="Three-lens AI" anchor="how-it-works">
 *     Plexara reviews each finding through three independent vantage…
 *   </HelpHint>
 *
 * The icon is intentionally muted so it never competes with primary
 * controls. Anchor links scroll to the matching <Section id="…"/> on
 * the /help page.
 */
export function HelpHint({
  topic,
  anchor,
  children,
}: {
  topic: string;
  anchor?: string;
  children: React.ReactNode;
}) {
  const helpHref = anchor ? `/help#${anchor}` : "/help";
  return (
    <Tooltip delayDuration={150}>
      <TooltipTrigger asChild>
        <Link
          href={helpHref}
          aria-label={`Help: ${topic}`}
          className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground/60 hover:text-primary hover:bg-primary/10 transition-colors no-underline align-middle"
          data-testid={`help-hint-${anchor ?? topic.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        >
          <HelpCircle className="h-3.5 w-3.5" aria-hidden />
        </Link>
      </TooltipTrigger>
      <TooltipContent
        side="top"
        align="center"
        className="max-w-xs whitespace-normal text-left text-xs leading-relaxed bg-popover text-popover-foreground border border-border shadow-md"
      >
        <div className="space-y-1">
          <div className="font-semibold text-[11px] uppercase tracking-wider text-primary">
            {topic}
          </div>
          <div>{children}</div>
          <div className="pt-1 text-[10px] text-muted-foreground">
            Click for the full guide →
          </div>
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
