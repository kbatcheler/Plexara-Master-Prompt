import { useEffect, useState, type ReactNode } from "react";

/**
 * Side TOC entry. `id` matches the corresponding HelpSection id.
 * `children` lets us nest a few subsections under each top entry
 * (used for the 8 health domains and the feature guide).
 */
export type HelpTocEntry = {
  id: string;
  label: string;
  children?: HelpTocEntry[];
};

/**
 * HelpLayout — two-column page shell:
 *   - Sticky sidebar with a hyperlinked table of contents
 *   - Content column with the actual sections
 *
 * Includes a lightweight scroll-spy: as the user scrolls, the closest
 * section above the fold is highlighted in the sidebar. We use
 * IntersectionObserver against [id] elements rendered by HelpSection /
 * HelpSubsection.
 *
 * Mobile: the sidebar collapses into a small inline jump-to selector.
 */
export function HelpLayout({
  toc,
  children,
}: {
  toc: HelpTocEntry[];
  children: ReactNode;
}) {
  const [activeId, setActiveId] = useState<string | null>(toc[0]?.id ?? null);

  useEffect(() => {
    const allIds = toc.flatMap((e) => [e.id, ...(e.children?.map((c) => c.id) ?? [])]);
    const elements = allIds
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);

    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry whose top edge is closest to (but above) 96px from top.
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) {
          setActiveId(visible[0].target.id);
        }
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: 0 },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [toc]);

  return (
    <div className="grid lg:grid-cols-[260px_1fr] gap-8 max-w-6xl">
      {/* Sidebar TOC */}
      <aside className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
        {/* Mobile: jump-to dropdown */}
        <div className="lg:hidden mb-4">
          <label htmlFor="help-jump" className="sr-only">
            Jump to section
          </label>
          <select
            id="help-jump"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            value={activeId ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              const el = document.getElementById(id);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
              setActiveId(id);
            }}
            data-testid="help-jump-select"
          >
            {toc.flatMap((entry) => [
              <option key={entry.id} value={entry.id}>
                {entry.label}
              </option>,
              ...(entry.children ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  &nbsp;&nbsp;— {c.label}
                </option>
              )),
            ])}
          </select>
        </div>

        {/* Desktop: nested list */}
        <nav
          className="hidden lg:block text-sm"
          aria-label="Help guide table of contents"
          data-testid="help-toc"
        >
          <p className="mb-3 text-[11px] uppercase tracking-wider font-medium text-muted-foreground">
            On this page
          </p>
          <ul className="space-y-0.5">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  aria-current={activeId === entry.id ? "location" : undefined}
                  className={`block rounded-md px-2 py-1 transition-colors ${
                    activeId === entry.id
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
                  }`}
                  data-testid={`help-toc-${entry.id}`}
                >
                  {entry.label}
                </a>
                {entry.children && entry.children.length > 0 && (
                  <ul className="ml-3 mt-0.5 space-y-0.5 border-l border-border/60 pl-2">
                    {entry.children.map((child) => (
                      <li key={child.id}>
                        <a
                          href={`#${child.id}`}
                          aria-current={activeId === child.id ? "location" : undefined}
                          className={`block rounded-md px-2 py-0.5 text-xs transition-colors ${
                            activeId === child.id
                              ? "text-primary font-medium"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                          data-testid={`help-toc-${child.id}`}
                        >
                          {child.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </nav>
      </aside>

      {/* Content */}
      <div className="space-y-12 min-w-0">{children}</div>
    </div>
  );
}
