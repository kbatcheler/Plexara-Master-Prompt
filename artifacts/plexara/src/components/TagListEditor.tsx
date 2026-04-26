import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Plus, X } from "lucide-react";

export interface TagItem {
  // Free-form key/value bag matching the server's HealthListItem schema.
  // For allergies the convention is { substance, reaction?, severity? };
  // for medications { name, dose?, frequency? }; for conditions { name,
  // status?, since? }. We don't enforce keys client-side because the AI
  // lenses tolerate variation and forcing a strict shape would slow down
  // an already-skippable onboarding flow.
  [key: string]: string | undefined;
}

interface Props {
  items: TagItem[];
  onChange: (items: TagItem[]) => void;
  placeholder?: string;
  /** Field name to use for the primary text. Defaults to "name". */
  primaryKey?: string;
  /** data-testid root. Children get suffixed (-input, -add, -item-N). */
  "data-testid"?: string;
}

/**
 * Lightweight chip-style editor for the three list-typed health profile
 * fields. Deliberately kept minimal — clinical onboarding forms over-
 * designed with separate dose/frequency/severity fields lose 30%+ of
 * users, and our AI lenses can read free-text just as well.
 */
export function TagListEditor({ items, onChange, placeholder, primaryKey = "name", ...rest }: Props) {
  const [draft, setDraft] = useState("");
  const testid = rest["data-testid"];

  const add = () => {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...items, { [primaryKey]: trimmed }]);
    setDraft("");
  };

  const remove = (idx: number) => {
    onChange(items.filter((_, i) => i !== idx));
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          data-testid={testid ? `${testid}-input` : undefined}
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={add}
          disabled={!draft.trim()}
          data-testid={testid ? `${testid}-add` : undefined}
          aria-label="Add"
        >
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-2" data-testid={testid ? `${testid}-list` : undefined}>
          {items.map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-secondary/60 border border-border/40 rounded-full text-sm"
              data-testid={testid ? `${testid}-item-${idx}` : undefined}
            >
              {String(item[primaryKey] ?? "")}
              <button
                type="button"
                onClick={() => remove(idx)}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Remove ${String(item[primaryKey] ?? "")}`}
                data-testid={testid ? `${testid}-remove-${idx}` : undefined}
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
