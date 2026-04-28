import { useEffect, useId, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { api } from "../../lib/api";
import { Loader2 } from "lucide-react";

/**
 * Shared autocomplete input that pulls suggestions from a Plexara
 * `/lookup/*` proxy endpoint (currently used for NIH RxTerms drug
 * lookup and NIH DSLD supplement lookup). Three guarantees that
 * matter for this UI:
 *
 *   1. **Free-text fallback.** The input is never gated by the
 *      dropdown — anything the user types is committed via
 *      `onChange`. If the upstream NIH service returns nothing (or
 *      fails entirely), the form remains submittable with the
 *      typed value.
 *   2. **300 ms debounce.** Keystrokes coalesce so we don't spam
 *      the upstream NIH endpoint on every character. Aborts in-
 *      flight requests when the query changes.
 *   3. **No external identifiers leak.** The lookup proxy lives on
 *      our own API surface, scoped behind requireAuth, so the
 *      patient's session cookies never reach NIH directly.
 */

export interface NihAutocompleteSuggestion {
  /** Stable code from the upstream source (RXCUI for RxTerms, DSLD
   *  ingredient id for DSLD). Used as React key + passed to
   *  onSelect so the parent can store it. */
  code: string;
  /** Human-readable display string. */
  label: string;
  /** Optional small badge text (e.g. "RxTerms", "DSLD"). */
  badge?: string;
}

interface LookupResponse<T> {
  source: string;
  citation: string;
  results: T[];
}

interface Props {
  value: string;
  onChange: (val: string) => void;
  /** Fired when the user picks an item from the dropdown. */
  onSelect?: (item: NihAutocompleteSuggestion) => void;
  /** Path on our own API to call (e.g. `/lookup/rxterms`). */
  endpoint: string;
  /** Map raw upstream item shape to a NihAutocompleteSuggestion. */
  mapItem: (raw: unknown) => NihAutocompleteSuggestion | null;
  placeholder?: string;
  inputClassName?: string;
  "data-testid"?: string;
  /**
   * Optional class-name → example-list map. When the user types a query
   * that includes one of these keys but the upstream lookup returns
   * nothing, we surface the example list as clickable "did you mean…"
   * suggestions. Used by the medications input to handle drug-class
   * names like "statins" / "PPI" / "blood pressure" gracefully —
   * RxTerms searches by drug name, not class, so those queries
   * otherwise hit a confusing empty state.
   *
   * Each example entry should be of the form `"Generic (Brand)"`; the
   * portion before the first " (" is what gets pasted into the input
   * when the user clicks it.
   */
  emptyStateHints?: Record<string, string[]>;
}

const DEBOUNCE_MS = 300;
const MIN_QUERY = 2;

export function NihAutocompleteInput({
  value,
  onChange,
  onSelect,
  endpoint,
  mapItem,
  placeholder,
  inputClassName,
  "data-testid": testId,
  emptyStateHints,
}: Props) {
  const [suggestions, setSuggestions] = useState<NihAutocompleteSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  // Debounced lookup. We capture an abort controller per request so a
  // stale response that lands after a newer keystroke can't clobber
  // the dropdown.
  useEffect(() => {
    const q = value.trim();
    if (q.length < MIN_QUERY) {
      setSuggestions([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await api<LookupResponse<unknown>>(
          `${endpoint}?q=${encodeURIComponent(q)}`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        const mapped = (data.results ?? [])
          .map(mapItem)
          .filter((s): s is NihAutocompleteSuggestion => !!s);
        setSuggestions(mapped);
        setActiveIdx(0);
      } catch (err) {
        // AbortError is the normal "you typed something newer" path.
        if ((err as Error & { name?: string }).name === "AbortError") return;
        setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, endpoint, mapItem]);

  // Click-outside closes the dropdown.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  function pick(item: NihAutocompleteSuggestion) {
    onChange(item.label);
    onSelect?.(item);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      pick(suggestions[activeIdx]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  // Render the dropdown whenever it's open and the user has typed enough
  // to have queried — even with zero results — so the empty-state
  // surface (especially the drug-class hint UI) actually appears
  // instead of silently disappearing.
  const showDropdown = open && value.trim().length >= MIN_QUERY;

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKey}
        placeholder={placeholder}
        className={inputClassName}
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-autocomplete="list"
        autoComplete="off"
        data-testid={testId}
      />
      {loading && value.trim().length >= MIN_QUERY && (
        <Loader2 className="w-3 h-3 animate-spin absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
      )}
      {showDropdown && (
        <div
          id={listboxId}
          role="listbox"
          className="absolute z-50 mt-1 w-full max-h-72 overflow-auto rounded-md border border-border bg-popover shadow-lg"
        >
          {loading && suggestions.length === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
          ) : suggestions.length === 0 ? (
            (() => {
              const matchedClass = emptyStateHints
                ? Object.entries(emptyStateHints).find(
                    ([key]) => value.toLowerCase().includes(key.toLowerCase()),
                  )
                : undefined;
              if (matchedClass) {
                return (
                  <div className="px-3 py-2 text-xs text-muted-foreground space-y-1">
                    <p className="font-medium text-foreground">
                      "{value.trim()}" looks like a drug class. Try a specific medication name:
                    </p>
                    <ul className="space-y-0.5">
                      {matchedClass[1].map((drug) => {
                        const generic = drug.split(" (")[0];
                        return (
                          <li key={drug}>
                            <button
                              type="button"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                onChange(generic);
                                inputRef.current?.focus();
                              }}
                              className="cursor-pointer hover:text-foreground text-left w-full"
                              data-testid={`${testId ?? "nih-autocomplete"}-class-hint-${generic}`}
                            >
                              → {drug}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                    <p className="pt-1 text-[11px]">
                      Or press Enter to keep what you typed.
                    </p>
                  </div>
                );
              }
              return (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No matches — press Enter to keep what you typed.
                </div>
              );
            })()
          ) : (
            suggestions.map((s, i) => (
              <button
                type="button"
                key={s.code}
                role="option"
                aria-selected={i === activeIdx}
                onMouseDown={(e) => { e.preventDefault(); pick(s); }}
                onMouseEnter={() => setActiveIdx(i)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center justify-between gap-2 ${
                  i === activeIdx ? "bg-accent text-accent-foreground" : ""
                }`}
                data-testid={`${testId ?? "nih-autocomplete"}-option-${s.code}`}
              >
                <span className="truncate">{s.label}</span>
                {s.badge && (
                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground shrink-0">
                    {s.badge}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
