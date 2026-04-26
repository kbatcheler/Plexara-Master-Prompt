import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  SUPPLEMENT_CATALOG,
  searchCatalog,
  findExactMatch,
  categoryLabel,
  type CatalogSupplement,
} from "../../lib/supplement-catalog";

interface Props {
  value: string;
  onChange: (name: string) => void;
  onSelect?: (item: CatalogSupplement) => void;
  recentNames?: string[];
  placeholder?: string;
  "data-testid"?: string;
}

export function SupplementNameInput({
  value,
  onChange,
  onSelect,
  recentNames = [],
  placeholder = "Name (e.g. Vitamin D3)",
  "data-testid": testId,
}: Props) {
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const recentAll = useMemo(() => {
    const seen = new Set<string>();
    const out: CatalogSupplement[] = [];
    for (const n of recentNames) {
      // First try the raw name. If no match, try peeling off everything after
      // " — ", " - ", " (", or "," — common patterns for verbose/AI-rec names like
      // "Vitamin D3 (Cholecalciferol) — conditional on confirming current level".
      let match = findExactMatch(n);
      if (!match) {
        const cleaned = n
          .split(/\s—\s|\s-\s|,/)[0]
          .replace(/\s*\(.*$/, "")
          .trim();
        if (cleaned && cleaned !== n) match = findExactMatch(cleaned);
      }
      let item: CatalogSupplement | null = match;
      if (!item) {
        const looksClean = n.length <= 30 && !/[—,()]/.test(n);
        if (looksClean) item = { name: n, category: "other" };
      }
      if (!item) continue;
      const key = item.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out.slice(0, 5);
  }, [recentNames]);

  const results = useMemo(() => {
    const q = value.trim();
    return searchCatalog(q, q.length === 0 ? 30 : 12);
  }, [value]);

  // Filter recents by the same query so they don't linger when the user types
  // something that doesn't match them.
  const recent = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return recentAll;
    const tokens = q.split(/\s+/).filter(Boolean);
    return recentAll.filter((r) => {
      const hay = r.name.toLowerCase();
      return tokens.every((t) => hay.includes(t));
    });
  }, [recentAll, value]);

  const grouped = useMemo(() => {
    const groups: Record<string, CatalogSupplement[]> = {};
    for (const r of results) {
      const k = categoryLabel(r.category);
      (groups[k] ??= []).push(r);
    }
    return groups;
  }, [results]);

  const flatList = useMemo(() => {
    const items: Array<{ kind: "recent" | "catalog"; item: CatalogSupplement }> = [];
    for (const r of recent) items.push({ kind: "recent", item: r });
    for (const r of results) items.push({ kind: "catalog", item: r });
    return items;
  }, [recent, results]);

  useEffect(() => {
    setActiveIdx(0);
  }, [value, open]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const choose = (item: CatalogSupplement) => {
    onChange(item.name);
    onSelect?.(item);
    setOpen(false);
    inputRef.current?.focus();
  };

  const exact = findExactMatch(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              if (!open) setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onClick={() => setOpen(true)}
            onKeyDown={(e) => {
              if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                setOpen(true);
                return;
              }
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveIdx((i) => Math.min(i + 1, flatList.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveIdx((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && open && flatList[activeIdx]) {
                e.preventDefault();
                choose(flatList[activeIdx].item);
              } else if (e.key === "Escape") {
                setOpen(false);
              } else if (e.key === "Tab") {
                setOpen(false);
              }
            }}
            placeholder={placeholder}
            data-testid={testId}
            className="pr-9"
            autoComplete="off"
          />
          <ChevronsUpDown className="absolute right-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        </div>
      </PopoverAnchor>
      <PopoverContent
        className="p-0 w-[var(--radix-popover-trigger-width)] max-h-[340px] overflow-hidden"
        align="start"
        sideOffset={4}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (e.target instanceof Element && e.target === inputRef.current) {
            e.preventDefault();
          }
        }}
      >
        <div ref={listRef} className="max-h-[340px] overflow-y-auto" data-testid="supplement-suggestions">
          {flatList.length === 0 ? (
            <div className="p-4 text-xs text-muted-foreground">
              <div className="flex items-center gap-2 mb-2">
                <Search className="w-3.5 h-3.5" />
                <span>No matches in catalog</span>
              </div>
              <p className="text-[11px]">Press Enter to add "{value}" as a custom entry.</p>
            </div>
          ) : (
            <>
              {recent.length > 0 && (
                <div className="px-2 pt-2 pb-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 pb-1">Your recent</div>
                  {recent.map((r, i) => (
                    <Row
                      key={`recent-${r.name}`}
                      idx={i}
                      activeIdx={activeIdx}
                      item={r}
                      onChoose={choose}
                      onHover={() => setActiveIdx(i)}
                      isSelected={exact?.name === r.name}
                      showCategory={false}
                    />
                  ))}
                </div>
              )}
              {Object.entries(grouped).map(([cat, items]) => (
                <div key={cat} className="px-2 pt-2 pb-1">
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground px-2 pb-1">{cat}</div>
                  {items.map((r) => {
                    const idx = recent.length + results.indexOf(r);
                    return (
                      <Row
                        key={r.name}
                        idx={idx}
                        activeIdx={activeIdx}
                        item={r}
                        onChoose={choose}
                        onHover={() => setActiveIdx(idx)}
                        isSelected={exact?.name === r.name}
                        showCategory={false}
                      />
                    );
                  })}
                </div>
              ))}
              <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground bg-muted/20">
                {SUPPLEMENT_CATALOG.length} known supplements · ↑↓ navigate · Enter to select · Esc to close
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface RowProps {
  idx: number;
  activeIdx: number;
  item: CatalogSupplement;
  onChoose: (i: CatalogSupplement) => void;
  onHover: () => void;
  isSelected: boolean;
  showCategory: boolean;
}

function Row({ idx, activeIdx, item, onChoose, onHover, isSelected, showCategory }: RowProps) {
  const active = idx === activeIdx;
  return (
    <button
      type="button"
      data-idx={idx}
      data-testid={`suggestion-${item.name}`}
      onClick={() => onChoose(item)}
      onMouseEnter={onHover}
      className={cn(
        "w-full text-left px-2 py-1.5 rounded-md text-sm flex items-center justify-between gap-2",
        active ? "bg-accent text-accent-foreground" : "hover:bg-accent/50",
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <Check className={cn("w-3.5 h-3.5 shrink-0", isSelected ? "opacity-100 text-primary" : "opacity-0")} />
        <span className="truncate">{item.name}</span>
      </span>
      <span className="flex items-center gap-1.5 shrink-0">
        {showCategory && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">{categoryLabel(item.category)}</Badge>
        )}
        {item.defaultDosage && (
          <span className="text-[11px] font-mono text-muted-foreground">{item.defaultDosage}</span>
        )}
      </span>
    </button>
  );
}
