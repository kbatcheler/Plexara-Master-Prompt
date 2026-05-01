import type { ReactNode, ComponentType } from "react";

/**
 * Section — top-level help section wrapper.
 *
 * Each section has a stable `id` so the sidebar TOC and external
 * deep-links (e.g. /help#stack-intelligence) can scroll to it.
 * The `id` should be kebab-case and remain stable — treat it as part
 * of the help page's URL contract.
 */
export function HelpSection({
  id,
  title,
  Icon,
  description,
  children,
}: {
  id: string;
  title: string;
  Icon?: ComponentType<{ className?: string }>;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="scroll-mt-24 space-y-4 border-t border-border/50 pt-8 first:border-t-0 first:pt-0"
      data-testid={`help-section-${id}`}
    >
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-5 w-5 text-primary" aria-hidden />}
        <h2 className="text-2xl font-heading font-semibold tracking-tight">
          {title}
        </h2>
      </div>
      {description && (
        <p className="text-sm text-muted-foreground max-w-3xl">{description}</p>
      )}
      <div className="text-sm leading-relaxed space-y-3 text-foreground/90 [&_p]:max-w-3xl">
        {children}
      </div>
    </section>
  );
}

/**
 * Subsection — second-level heading within a Section. Also gets an id
 * for deep-linking to specific subtopics within a section.
 */
export function HelpSubsection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className="scroll-mt-24 space-y-2 pt-2">
      <h3 className="text-base font-heading font-semibold text-foreground">
        {title}
      </h3>
      <div className="text-sm leading-relaxed space-y-2 text-foreground/90">
        {children}
      </div>
    </div>
  );
}
