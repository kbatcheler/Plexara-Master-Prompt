import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface AINarrativeProps {
  /** The raw narrative text from the LLM. May contain markdown. */
  text: string | null | undefined;
  /** Visual treatment.
   * - `serif`  : long-form patient-facing prose (Newsreader serif, dropcap)
   * - `clinical`: clinician-mode body copy (slightly tighter, sans)
   * - `compact`: small inline narrative (for sidebars / cards)
   */
  variant?: "serif" | "clinical" | "compact";
  /** Optional dropcap on the first paragraph (serif variant only). */
  dropcap?: boolean;
  className?: string;
  "data-testid"?: string;
}

/**
 * Single canonical renderer for AI-produced narrative prose.
 *
 * Eliminates the raw `**bold**` / `### header` artifacts that surfaced
 * when LLM output was dropped into <p> tags directly. All AI lens
 * narratives, comprehensive-report sections, biological-age commentary,
 * chat replies and shared-view content render through this component
 * so they share one consistent typographic treatment.
 *
 * GFM (GitHub-flavoured markdown) is enabled so the model can return
 * tables, task lists, and strikethrough when clinically useful.
 */
export function AINarrative({
  text,
  variant = "serif",
  dropcap = false,
  className,
  "data-testid": testId,
}: AINarrativeProps) {
  if (!text || typeof text !== "string" || !text.trim()) {
    return (
      <p className="text-xs text-muted-foreground italic" data-testid={testId}>
        Narrative not available.
      </p>
    );
  }

  // Strip stray AI artifacts that aren't real markdown signal.
  const cleaned = text
    .replace(/^\s*[-*_]{3,}\s*$/gm, "")    // horizontal rules from chatty models
    .replace(/\u2003+/g, " ")               // em-spaces
    .trim();

  const baseProse =
    "max-w-none prose prose-stone " +
    "prose-headings:font-medium prose-headings:tracking-tight " +
    "prose-h1:text-lg prose-h2:text-base prose-h3:text-sm prose-h4:text-sm " +
    "prose-h1:mt-0 prose-h2:mt-4 prose-h3:mt-3 " +
    "prose-p:leading-relaxed prose-p:my-2 " +
    "prose-strong:font-semibold prose-strong:text-foreground " +
    "prose-em:italic " +
    "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 " +
    "prose-blockquote:border-l-2 prose-blockquote:border-primary/40 " +
    "prose-blockquote:pl-3 prose-blockquote:text-foreground/80 prose-blockquote:not-italic " +
    "prose-table:text-xs prose-th:font-semibold prose-th:text-foreground " +
    "prose-td:border prose-td:border-border prose-td:px-2 prose-td:py-1 " +
    "prose-th:border prose-th:border-border prose-th:px-2 prose-th:py-1 " +
    "prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:before:hidden prose-code:after:hidden";

  const variantClass =
    variant === "serif"
      ? "font-serif text-[15px] leading-[1.7] text-foreground " +
        (dropcap
          ? "first-letter:font-serif first-letter:text-4xl first-letter:font-medium " +
            "first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:leading-none first-letter:text-primary "
          : "")
      : variant === "clinical"
        ? "font-sans text-sm leading-relaxed text-foreground"
        : "text-xs leading-relaxed text-foreground";

  return (
    <div className={cn(baseProse, variantClass, className)} data-testid={testId}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleaned}</ReactMarkdown>
    </div>
  );
}

export default AINarrative;
