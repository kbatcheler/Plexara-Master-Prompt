import { useState } from "react";
import {
  useListEvidence,
  getListEvidenceQueryKey,
  type EvidenceMapEntry,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity,
  Bone,
  ChevronDown,
  ChevronRight,
  Dna,
  FlaskConical,
  Microscope,
  ScanLine,
  ShieldCheck,
  Watch,
} from "lucide-react";

interface EvidenceMapProps {
  patientId: number;
}

function iconForDocumentType(documentType: string) {
  switch (documentType) {
    case "blood_panel":
      return FlaskConical;
    case "dexa_scan":
      return Bone;
    case "cancer_screening":
      return ShieldCheck;
    case "imaging":
    case "scan_report":
      return ScanLine;
    case "pharmacogenomics":
    case "genetics":
      return Dna;
    case "wearable":
      return Watch;
    case "specialized_panel":
      return Microscope;
    case "organic_acid_test":
    case "fatty_acid_profile":
      return FlaskConical;
    default:
      return Activity;
  }
}

function significanceClasses(significance: string | null | undefined) {
  switch (significance) {
    case "urgent":
      return "border-red-500/40 bg-red-500/5";
    case "watch":
      return "border-amber-500/40 bg-amber-500/5";
    case "positive":
      return "border-emerald-500/40 bg-emerald-500/5";
    default:
      return "border-border bg-card";
  }
}

function formatDate(value: string | null) {
  if (!value) return "Unknown date";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function prettyDocumentType(documentType: string) {
  return documentType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function EvidenceMapItem({ entry }: { entry: EvidenceMapEntry }) {
  const [expanded, setExpanded] = useState(false);
  const Icon = iconForDocumentType(entry.documentType);
  const date = formatDate(entry.testDate ?? entry.uploadDate);
  const hasDetail = (entry.keyFindings?.length ?? 0) > 0 || (entry.metrics?.length ?? 0) > 0;
  const integratedLabel = entry.integratedIntoReport
    ? "In latest report"
    : "Pending in next report";

  return (
    <li className="relative pl-10">
      <span className="absolute left-3 top-3 -translate-x-1/2 flex h-7 w-7 items-center justify-center rounded-full border-2 border-border bg-background">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
      </span>
      <div
        className={`rounded-lg border ${significanceClasses(entry.significance)} transition-shadow`}
      >
        <button
          type="button"
          onClick={() => hasDetail && setExpanded((e) => !e)}
          className={`w-full flex items-start justify-between gap-3 px-4 py-3 text-left ${
            hasDetail ? "cursor-pointer" : "cursor-default"
          }`}
          aria-expanded={expanded}
          data-testid={`evidence-row-${entry.id}`}
        >
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {prettyDocumentType(entry.documentType)}
              </span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{date}</span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  entry.integratedIntoReport
                    ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                    : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                }`}
              >
                {integratedLabel}
              </span>
            </div>
            <p className="mt-1 text-sm text-foreground">{entry.summary || "Record on file"}</p>
          </div>
          {hasDetail ? (
            expanded ? (
              <ChevronDown className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
            ) : (
              <ChevronRight className="h-4 w-4 mt-1 text-muted-foreground shrink-0" />
            )
          ) : null}
        </button>
        {expanded && hasDetail ? (
          <div className="border-t border-border/60 px-4 py-3 space-y-3 text-sm">
            {entry.keyFindings && entry.keyFindings.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Key findings
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-foreground/90">
                  {entry.keyFindings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {entry.metrics && entry.metrics.length > 0 ? (
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1">
                  Metrics
                </p>
                <ul className="space-y-0.5 text-foreground/90">
                  {entry.metrics.map((m, i) => (
                    <li key={i} className="text-xs">
                      <span className="font-medium">{m.name}:</span> {String(m.value)}
                      {m.unit ? ` ${m.unit}` : ""}
                      {m.interpretation ? (
                        <span className="text-muted-foreground"> — {m.interpretation}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export function EvidenceMap({ patientId }: EvidenceMapProps) {
  const { data, isLoading, error } = useListEvidence(patientId, {
    query: {
      enabled: !!patientId,
      queryKey: getListEvidenceQueryKey(patientId),
    },
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-6 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-16 w-full rounded-lg" />
          <Skeleton className="h-16 w-full rounded-lg" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          Couldn't load the evidence map right now.
        </CardContent>
      </Card>
    );
  }

  const entries = data?.evidence ?? [];
  if (entries.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No evidence on file yet. Upload a record to populate your evidence map.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-6">
        <ol className="relative space-y-3 before:absolute before:left-3 before:top-2 before:bottom-2 before:w-px before:bg-border">
          {entries.map((entry) => (
            <EvidenceMapItem key={entry.id} entry={entry} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
