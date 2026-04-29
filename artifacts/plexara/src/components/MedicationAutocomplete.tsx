import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X, Loader2, Pill } from "lucide-react";
import { lookupMedications } from "@workspace/api-client-react";
import type { TagItem } from "@/components/TagListEditor";

interface Props {
  items: TagItem[];
  onChange: (items: TagItem[]) => void;
  placeholder?: string;
  "data-testid"?: string;
}

const MIN_QUERY_LEN = 2;
const DEBOUNCE_MS = 220;

/**
 * Drug-name autocomplete editor for the patient medications field.
 * Uses the server-side RxNorm typeahead endpoint (`/api/medications/
 * lookup`), which is the canonical clinical drug terminology — the
 * same vocabulary every U.S. EHR uses. Typing "statin" surfaces every
 * statin (atorvastatin, rosuvastatin, Lipitor, Crestor, …); typing
 * "lisinopril" surfaces the brand variants; typing a brand name like
 * "Lipitor" matches it directly.
 *
 * Free-text entries are still allowed — pressing Enter on a query
 * with no matching suggestion adds it as-is. This keeps the field
 * usable when:
 *   - the user is offline / our cached corpus hasn't loaded yet
 *   - the medication is non-US (RxNorm is US-centric)
 *   - the user wants to add a supplement / herbal that isn't in RxNorm
 */
export function MedicationAutocomplete({
  items,
  onChange,
  placeholder,
  ...rest
}: Props) {
  const testid = rest["data-testid"];
  const [draft, setDraft] = useState("");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  // -1 means "no item explicitly highlighted yet" — first ArrowDown
  // lands on index 0. We still treat -1 as "Enter picks index 0" so
  // hitting Enter without arrowing through the list selects the top
  // suggestion, which matches typical typeahead UX.
  const [highlight, setHighlight] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);

  // Debounce so we don't fire a request on every keystroke. 220ms is
  // tight enough to feel instant on a fast typist and loose enough to
  // collapse "lisin" → "lisinopril" into a single round-trip.
  useEffect(() => {
    const t = setTimeout(() => setDebounced(draft.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft]);

  const enabled = debounced.length >= MIN_QUERY_LEN && open;

  const { data, isFetching } = useQuery({
    queryKey: ["medication-lookup", debounced],
    queryFn: () => lookupMedications({ q: debounced, limit: 12 }),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const suggestions = data?.results ?? [];

  // Close the popover if the user clicks outside the editor.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Keep the highlighted suggestion in bounds whenever the list
  // resizes after a fresh fetch. Reset to -1 when the list shrinks
  // out from under the cursor so the user lands on item 0 again.
  useEffect(() => {
    if (highlight >= suggestions.length) setHighlight(-1);
  }, [suggestions.length, highlight]);

  const addRaw = (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    // Soft-dedupe against existing entries so a user picking the same
    // medication twice doesn't duplicate the chip.
    const exists = items.some(
      (i) => String(i.name ?? "").toLowerCase() === trimmed.toLowerCase(),
    );
    if (!exists) {
      onChange([...items, { name: trimmed }]);
    }
    setDraft("");
    setDebounced("");
    setOpen(false);
    setHighlight(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      if (suggestions.length > 0) {
        e.preventDefault();
        setOpen(true);
        setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (suggestions.length > 0) {
        e.preventDefault();
        // Allow wrapping back to "no selection" so the user can tab
        // out cleanly without an arbitrary item highlighted.
        setHighlight((h) => Math.max(h - 1, -1));
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Prefer the highlighted suggestion when the popover is open and
      // populated; if no item has been arrowed-to yet (highlight=-1),
      // pick the top suggestion. Otherwise fall through to a free-text
      // add so the field never traps the user.
      if (open && suggestions.length > 0) {
        const idx = highlight >= 0 ? highlight : 0;
        const pick = suggestions[idx] ?? suggestions[0];
        if (pick) {
          addRaw(pick.name);
          return;
        }
      }
      addRaw(draft);
    }
  };

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  const showPopover =
    open && debounced.length >= MIN_QUERY_LEN && (isFetching || suggestions.length > 0);

  return (
    <div className="space-y-2" ref={containerRef}>
      <div className="relative">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Input
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value);
                setOpen(true);
                // Reset highlight on each keystroke so "Enter" after
                // typing always picks the top (most relevant) result,
                // and a fresh ArrowDown lands on index 0.
                setHighlight(-1);
              }}
              onFocus={() => {
                if (draft.trim().length >= MIN_QUERY_LEN) setOpen(true);
              }}
              onKeyDown={onKeyDown}
              placeholder={placeholder ?? "Start typing — e.g. statin, lisinopril, Lipitor"}
              data-testid={testid ? `${testid}-input` : undefined}
              autoComplete="off"
            />
            {isFetching && (
              <Loader2 className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground animate-spin" />
            )}
          </div>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => addRaw(draft)}
            disabled={!draft.trim()}
            data-testid={testid ? `${testid}-add` : undefined}
            aria-label="Add"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        {showPopover && (
          <div
            className="absolute z-50 left-0 right-12 mt-1 max-h-72 overflow-auto rounded-lg border border-border/60 bg-popover shadow-lg"
            data-testid={testid ? `${testid}-suggestions` : undefined}
            role="listbox"
          >
            {suggestions.length === 0 && isFetching && (
              <div className="px-3 py-2 text-sm text-muted-foreground">
                Searching…
              </div>
            )}
            {suggestions.map((s: { name: string }, i: number) => (
              <button
                key={`${s.name}-${i}`}
                type="button"
                onClick={() => addRaw(s.name)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 ${
                  i === highlight
                    ? "bg-secondary/80 text-foreground"
                    : "hover:bg-secondary/50 text-foreground/90"
                }`}
                role="option"
                aria-selected={i === highlight}
                data-testid={
                  testid ? `${testid}-suggestion-${i}` : undefined
                }
              >
                <Pill className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="truncate">{s.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {items.length > 0 && (
        <div
          className="flex flex-wrap gap-2"
          data-testid={testid ? `${testid}-list` : undefined}
        >
          {items.map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-secondary/60 border border-border/40 rounded-full text-sm"
              data-testid={testid ? `${testid}-item-${idx}` : undefined}
            >
              {String(item.name ?? "")}
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${String(item.name ?? "")}`}
                data-testid={
                  testid ? `${testid}-remove-${idx}` : undefined
                }
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
