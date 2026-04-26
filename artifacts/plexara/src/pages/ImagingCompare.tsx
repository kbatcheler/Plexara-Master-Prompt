import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Loader2, GitCompare } from "lucide-react";

interface SliceFile {
  id: number;
  fileIndex: number;
  instanceNumber: number | null;
  sliceLocation: number | null;
  fileName: string;
}

interface StudyDetail {
  id: number;
  patientId: number;
  modality: string | null;
  bodyPart: string | null;
  description: string | null;
  fileName: string;
  studyDate: string | null;
  rows: number | null;
  columns: number | null;
}

const WL_PRESETS: Array<{ id: string; label: string; wc: number; ww: number }> = [
  { id: "default", label: "Default", wc: 40, ww: 400 },
  { id: "soft", label: "Soft Tissue", wc: 50, ww: 400 },
  { id: "lung", label: "Lung", wc: -600, ww: 1500 },
  { id: "bone", label: "Bone", wc: 300, ww: 1500 },
  { id: "brain", label: "Brain", wc: 40, ww: 80 },
  { id: "abdomen", label: "Abdomen", wc: 50, ww: 350 },
];

interface ViewerState {
  ready: boolean;
  error: string | null;
  total: number;
  current: number;
}

// Hook that mounts a Cornerstone3D viewer onto the given element ref. Each
// instance gets its own rendering engine + tool group ID so multiple can live
// on the same page without colliding.
function useDicomViewport(opts: {
  elementRef: React.RefObject<HTMLDivElement | null>;
  imageIds: string[];
  engineId: string;
  viewportId: string;
  toolGroupId: string;
  onSlice: (idx: number) => void;
}) {
  const viewportRef = useRef<unknown>(null);
  const engineRef = useRef<{ destroy?: () => void } | null>(null);
  const sliceListenerCleanupRef = useRef<(() => void) | null>(null);
  const [state, setState] = useState<ViewerState>({
    ready: false,
    error: null,
    total: 0,
    current: 0,
  });

  useEffect(() => {
    if (opts.imageIds.length === 0 || !opts.elementRef.current) return;
    let mounted = true;

    (async () => {
      try {
        const cs = await import("@cornerstonejs/core");
        const csTools = await import("@cornerstonejs/tools");
        // dicom-image-loader v4: legacy `external.*` removed — use `init()`.
        const dicomImageLoader = await import("@cornerstonejs/dicom-image-loader");

        await cs.init();
        await csTools.init();
        const dilInit = (dicomImageLoader as { init?: (o?: unknown) => void; default?: { init?: (o?: unknown) => void } }).init
          ?? (dicomImageLoader as { default?: { init?: (o?: unknown) => void } }).default?.init;
        if (typeof dilInit === "function") dilInit({ maxWebWorkers: 1 });

        if (!mounted || !opts.elementRef.current) return;

        const engine = new cs.RenderingEngine(opts.engineId);
        engineRef.current = engine as { destroy?: () => void };

        const viewportInput = {
          viewportId: opts.viewportId,
          type: cs.Enums.ViewportType.STACK,
          element: opts.elementRef.current as HTMLDivElement,
        };
        engine.enableElement(viewportInput);

        const vp = (engine as unknown as { getViewport: (id: string) => unknown }).getViewport(
          opts.viewportId,
        );
        viewportRef.current = vp;

        await (vp as { setStack: (ids: string[], i?: number) => Promise<void> }).setStack(
          opts.imageIds,
          0,
        );
        (vp as { render: () => void }).render();

        setState({ ready: true, error: null, total: opts.imageIds.length, current: 0 });

        const onNew = (e: Event) => {
          const detail = (e as CustomEvent<{ imageIdIndex: number; viewportId: string }>).detail;
          if (detail?.viewportId === opts.viewportId && typeof detail.imageIdIndex === "number") {
            setState((s) => ({ ...s, current: detail.imageIdIndex }));
            opts.onSlice(detail.imageIdIndex);
          }
        };
        cs.eventTarget.addEventListener(cs.Enums.Events.STACK_NEW_IMAGE, onNew);

        const {
          ToolGroupManager,
          PanTool,
          ZoomTool,
          WindowLevelTool,
          StackScrollTool,
          addTool,
          Enums: tEnums,
        } = csTools;
        [PanTool, ZoomTool, WindowLevelTool, StackScrollTool].forEach((t) => {
          try {
            addTool(t);
          } catch {
            /* already added */
          }
        });
        const tg = ToolGroupManager.createToolGroup(opts.toolGroupId);
        if (!tg) throw new Error("tool group");
        [PanTool.toolName, ZoomTool.toolName, WindowLevelTool.toolName, StackScrollTool.toolName].forEach(
          (n) => tg.addTool(n),
        );
        tg.addViewport(opts.viewportId, opts.engineId);
        tg.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: tEnums.MouseBindings.Primary }],
        });
        tg.setToolActive(StackScrollTool.toolName);
        sliceListenerCleanupRef.current = () => {
          cs.eventTarget.removeEventListener(cs.Enums.Events.STACK_NEW_IMAGE, onNew);
        };
      } catch (err) {
        setState({
          ready: false,
          error: err instanceof Error ? err.message : String(err),
          total: 0,
          current: 0,
        });
      }
    })();

    return () => {
      mounted = false;
      try {
        sliceListenerCleanupRef.current?.();
      } catch {
        /* swallow */
      }
      sliceListenerCleanupRef.current = null;
      try {
        if (engineRef.current?.destroy) engineRef.current.destroy();
      } catch {
        /* swallow */
      }
      try {
        import("@cornerstonejs/tools")
          .then((csTools) => csTools.ToolGroupManager.destroyToolGroup(opts.toolGroupId))
          .catch(() => {});
      } catch {
        /* swallow */
      }
    };
    // Key on a stable signature of the imageId list (not just length) so each
    // viewport fully reinitializes when swapping to a study with the same
    // slice count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.imageIds.join("|")]);

  return {
    state,
    setSliceIndex: (i: number) => {
      const vp = viewportRef.current as { setImageIdIndex?: (n: number) => void } | null;
      vp?.setImageIdIndex?.(i);
    },
    setVoiRange: (lower: number, upper: number) => {
      const vp = viewportRef.current as {
        setProperties?: (p: { voiRange: { lower: number; upper: number } }) => void;
        render?: () => void;
      } | null;
      vp?.setProperties?.({ voiRange: { lower, upper } });
      vp?.render?.();
    },
  };
}

function useStudyAndFiles(studyId: number | null) {
  const studyQ = useQuery<StudyDetail>({
    queryKey: ["compare-study", studyId],
    queryFn: () => api(`/imaging/study/${studyId}`),
    enabled: !!studyId,
  });
  const filesQ = useQuery<SliceFile[]>({
    queryKey: ["compare-files", studyId],
    queryFn: () => api(`/imaging/study/${studyId}/files`),
    enabled: !!studyId,
  });
  const imageIds = useMemo(() => {
    if (!filesQ.data || !studyId) return [] as string[];
    return filesQ.data.map(
      (f) => `wadouri:${window.location.origin}/api/imaging/dicom/${studyId}/file/${f.fileIndex}`,
    );
  }, [filesQ.data, studyId]);
  return { studyQ, filesQ, imageIds };
}

export default function ImagingCompare() {
  const [location] = useLocation();
  // Wouter strips the search string, so read it off window.location instead.
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  const aId = params.get("a") ? parseInt(params.get("a") as string) : null;
  const bId = params.get("b") ? parseInt(params.get("b") as string) : null;

  const elA = useRef<HTMLDivElement>(null);
  const elB = useRef<HTMLDivElement>(null);

  const a = useStudyAndFiles(aId);
  const b = useStudyAndFiles(bId);

  const [syncScroll, setSyncScroll] = useState(true);
  const [syncWl, setSyncWl] = useState(true);
  const [preset, setPreset] = useState("default");

  const vpA = useDicomViewport({
    elementRef: elA,
    imageIds: a.imageIds,
    engineId: "PLEXARA_CMP_ENGINE_A",
    viewportId: "PLEXARA_CMP_VP_A",
    toolGroupId: "PLEXARA_CMP_TG_A",
    onSlice: (idx) => {
      if (syncScroll) vpB.setSliceIndex(idx);
    },
  });
  const vpB = useDicomViewport({
    elementRef: elB,
    imageIds: b.imageIds,
    engineId: "PLEXARA_CMP_ENGINE_B",
    viewportId: "PLEXARA_CMP_VP_B",
    toolGroupId: "PLEXARA_CMP_TG_B",
    onSlice: (idx) => {
      if (syncScroll) vpA.setSliceIndex(idx);
    },
  });

  function applyPreset(id: string) {
    setPreset(id);
    const p = WL_PRESETS.find((x) => x.id === id);
    if (!p) return;
    const lower = p.wc - p.ww / 2;
    const upper = p.wc + p.ww / 2;
    vpA.setVoiRange(lower, upper);
    if (syncWl) vpB.setVoiRange(lower, upper);
  }

  useEffect(() => {
    void location;
  }, [location]);

  if (!aId || !bId) {
    return (
      <div className="space-y-3">
        <Link
          href="/imaging"
          className="text-muted-foreground hover:text-primary text-sm flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" /> All studies
        </Link>
        <div className="text-rose-400">
          Comparison needs two study IDs in the URL: <code>?a=…&b=…</code>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/imaging"
          className="text-muted-foreground hover:text-primary text-sm flex items-center gap-1"
        >
          <ArrowLeft className="w-3 h-3" /> All studies
        </Link>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <GitCompare className="w-5 h-5 text-primary" />
            <CardTitle>Compare studies</CardTitle>
          </div>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch id="sync-scroll" checked={syncScroll} onCheckedChange={setSyncScroll} />
              <Label htmlFor="sync-scroll" className="text-xs">
                Sync scroll
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="sync-wl" checked={syncWl} onCheckedChange={setSyncWl} />
              <Label htmlFor="sync-wl" className="text-xs">
                Sync W/L
              </Label>
            </div>
            <Select value={preset} onValueChange={applyPreset}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue placeholder="W/L preset" />
              </SelectTrigger>
              <SelectContent>
                {WL_PRESETS.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[
              { side: "a", q: a, vp: vpA, ref: elA },
              { side: "b", q: b, vp: vpB, ref: elB },
            ].map(({ side, q, vp, ref }) => {
              const study = q.studyQ.data;
              return (
                <div key={side} className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {q.studyQ.isLoading ? (
                      "Loading…"
                    ) : study ? (
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-foreground">
                          {study.description || study.fileName}
                        </span>
                        {study.modality && (
                          <Badge variant="outline">{study.modality}</Badge>
                        )}
                        {study.bodyPart && <span>{study.bodyPart}</span>}
                        {study.studyDate && <span>· {study.studyDate}</span>}
                      </div>
                    ) : (
                      <span className="text-rose-400">Could not load study.</span>
                    )}
                  </div>
                  <div
                    ref={ref}
                    className="relative w-full bg-black rounded-md overflow-hidden border border-border/50"
                    style={{ height: "520px" }}
                    onContextMenu={(e) => e.preventDefault()}
                    data-testid={`compare-vp-${side}`}
                  >
                    {!vp.state.ready && !vp.state.error && (
                      <div className="absolute inset-0 flex items-center justify-center text-muted-foreground gap-2">
                        <Loader2 className="w-4 h-4 animate-spin" /> Loading…
                      </div>
                    )}
                    {vp.state.error && (
                      <div className="absolute inset-0 flex items-center justify-center text-rose-400 px-3 text-center text-xs">
                        {vp.state.error}
                      </div>
                    )}
                    {vp.state.ready && vp.state.total > 0 && (
                      <div className="absolute top-2 left-2 text-xs text-white/80 bg-black/60 px-2 py-1 rounded font-mono">
                        Slice {vp.state.current + 1} / {vp.state.total}
                      </div>
                    )}
                  </div>
                  {vp.state.total > 1 && (
                    <input
                      type="range"
                      min={0}
                      max={vp.state.total - 1}
                      value={vp.state.current}
                      onChange={(e) => {
                        const idx = parseInt(e.target.value);
                        vp.setSliceIndex(idx);
                        if (syncScroll) {
                          (side === "a" ? vpB : vpA).setSliceIndex(idx);
                        }
                      }}
                      className="w-full accent-primary"
                    />
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] text-muted-foreground">
            Tip: scroll wheel changes slice. With sync on, both viewers move together.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
