import { useEffect, useMemo, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ArrowLeft,
  Ruler,
  Hand,
  ZoomIn,
  Sun,
  Trash2,
  Loader2,
  Square,
  Circle,
  Triangle,
  ArrowUpRight,
  Edit3,
  Crosshair,
  Play,
  Pause,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  Contrast,
  RefreshCw,
  Tag,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { ImagingInterpretationPanel } from "@/components/imaging/ImagingInterpretationPanel";

// ─── Types ──────────────────────────────────────────────────────────────────
interface Annotation {
  id: number;
  type: string;
  fileIndex: number;
  geometryJson: unknown;
  label: string | null;
  measurementValue: number | null;
  measurementUnit: string | null;
  createdAt: string;
}

interface StudyDetail {
  id: number;
  patientId: number;
  modality: string | null;
  bodyPart: string | null;
  description: string | null;
  fileName: string;
  rows: number | null;
  columns: number | null;
  numberOfSlices: number | null;
  numberOfFrames: number | null;
  sliceThickness: number | null;
  pixelSpacing: string | null;
  studyDate: string | null;
  interpretation: unknown;
  interpretationModel: string | null;
  interpretationAt: string | null;
  annotations: Annotation[];
}

interface SliceFile {
  id: number;
  fileIndex: number;
  sopInstanceUid: string | null;
  instanceNumber: number | null;
  sliceLocation: number | null;
  fileName: string;
  fileSize: number | null;
}

interface DicomTag {
  tag: string;
  name: string;
  vr: string;
  value: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────
const VIEWPORT_ID = "PLEXARA_DICOM_VIEWPORT";
const RENDERING_ENGINE_ID = "PLEXARA_RENDERING_ENGINE";
const TOOL_GROUP_ID = "PLEXARA_TOOL_GROUP";

// W/L presets (window center / window width). Standard radiology values.
const WL_PRESETS: Array<{ id: string; label: string; wc: number; ww: number }> = [
  { id: "default", label: "Default", wc: 40, ww: 400 },
  { id: "soft", label: "Soft Tissue", wc: 50, ww: 400 },
  { id: "lung", label: "Lung", wc: -600, ww: 1500 },
  { id: "bone", label: "Bone", wc: 300, ww: 1500 },
  { id: "brain", label: "Brain", wc: 40, ww: 80 },
  { id: "abdomen", label: "Abdomen", wc: 50, ww: 350 },
  { id: "mediastinum", label: "Mediastinum", wc: 50, ww: 400 },
  { id: "liver", label: "Liver", wc: 60, ww: 160 },
];

type ToolName =
  | "WindowLevel"
  | "Pan"
  | "Zoom"
  | "Length"
  | "RectangleROI"
  | "EllipticalROI"
  | "Angle"
  | "ArrowAnnotate"
  | "PlanarFreehandROI"
  | "Probe";

const TOOL_BUTTONS: Array<{ tool: ToolName; label: string; Icon: typeof Hand }> = [
  { tool: "WindowLevel", label: "W/L", Icon: Sun },
  { tool: "Pan", label: "Pan", Icon: Hand },
  { tool: "Zoom", label: "Zoom", Icon: ZoomIn },
  { tool: "Length", label: "Length", Icon: Ruler },
  { tool: "RectangleROI", label: "Rect", Icon: Square },
  { tool: "EllipticalROI", label: "Ellipse", Icon: Circle },
  { tool: "Angle", label: "Angle", Icon: Triangle },
  { tool: "ArrowAnnotate", label: "Arrow", Icon: ArrowUpRight },
  { tool: "PlanarFreehandROI", label: "Freehand", Icon: Edit3 },
  { tool: "Probe", label: "Probe", Icon: Crosshair },
];

// Cornerstone tool name resolver. Cornerstone3D exports each tool as a class
// whose `.toolName` static property is the canonical string, so we look it up
// at runtime to avoid hard-coding strings that drift across versions.
type CsToolsModule = typeof import("@cornerstonejs/tools");
function getToolName(csTools: CsToolsModule, name: ToolName): string {
  const map: Record<ToolName, { toolName: string }> = {
    WindowLevel: csTools.WindowLevelTool,
    Pan: csTools.PanTool,
    Zoom: csTools.ZoomTool,
    Length: csTools.LengthTool,
    RectangleROI: csTools.RectangleROITool,
    EllipticalROI: csTools.EllipticalROITool,
    Angle: csTools.AngleTool,
    ArrowAnnotate: csTools.ArrowAnnotateTool,
    PlanarFreehandROI: csTools.PlanarFreehandROITool,
    Probe: csTools.ProbeTool,
  };
  return map[name].toolName;
}

// Annotation type → server-side type string
const ANNOTATION_TYPE_MAP: Record<string, string> = {
  Length: "length",
  RectangleROI: "rectangle",
  EllipticalROI: "ellipse",
  Angle: "angle",
  ArrowAnnotate: "arrow",
  PlanarFreehandROI: "freehand",
  Probe: "probe",
};

// ─── Component ──────────────────────────────────────────────────────────────
export default function ImagingViewer() {
  const [, params] = useRoute("/imaging/:id");
  const studyId = params?.id ? parseInt(params.id) : NaN;
  const elementRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<unknown>(null);
  const renderingEngineRef = useRef<{ destroy?: () => void } | null>(null);
  const toolGroupRef = useRef<unknown>(null);
  const sliceListenerRef = useRef<((e: Event) => void) | null>(null);
  const cineTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [activeTool, setActiveTool] = useState<ToolName>("WindowLevel");
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [currentSlice, setCurrentSlice] = useState(0);
  const [totalSlices, setTotalSlices] = useState(1);
  const [inverted, setInverted] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [cinePlaying, setCinePlaying] = useState(false);
  const [showTags, setShowTags] = useState(false);
  const [activePreset, setActivePreset] = useState<string>("default");

  const { toast } = useToast();
  const qc = useQueryClient();

  const studyQ = useQuery<StudyDetail>({
    queryKey: ["study-direct", studyId],
    queryFn: () => api(`/imaging/study/${studyId}`),
    enabled: !isNaN(studyId),
  });

  const filesQ = useQuery<SliceFile[]>({
    queryKey: ["study-files", studyId],
    queryFn: () => api(`/imaging/study/${studyId}/files`),
    enabled: !isNaN(studyId),
  });

  const tagsQ = useQuery<DicomTag[]>({
    queryKey: ["study-tags", studyId],
    queryFn: () => api(`/imaging/study/${studyId}/tags`),
    enabled: !isNaN(studyId) && showTags,
  });

  const deleteAnnotation = useMutation({
    mutationFn: ({ patientId, annotationId }: { patientId: number; annotationId: number }) =>
      api(`/patients/${patientId}/imaging/${studyId}/annotations/${annotationId}`, {
        method: "DELETE",
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["study-direct", studyId] }),
  });

  const reinterpretMu = useMutation({
    mutationFn: () => {
      if (!studyQ.data) throw new Error("No study loaded");
      return api(`/patients/${studyQ.data.patientId}/imaging/${studyId}/interpret`, {
        method: "POST",
      });
    },
    onSuccess: () => {
      toast({ title: "Interpretation refreshed" });
      qc.invalidateQueries({ queryKey: ["study-direct", studyId] });
    },
    onError: (err: Error) => toast({ title: "Re-interpretation failed", description: err.message, variant: "destructive" }),
  });

  const imageIds = useMemo(() => {
    if (!filesQ.data || filesQ.data.length === 0) return [] as string[];
    const origin = window.location.origin;
    return filesQ.data.map((f) => `wadouri:${origin}/api/imaging/dicom/${studyId}/file/${f.fileIndex}`);
  }, [filesQ.data, studyId]);

  // ── Initialise Cornerstone3D ────────────────────────────────────────────
  useEffect(() => {
    if (!studyQ.data || !filesQ.data || filesQ.data.length === 0 || !elementRef.current) return;
    let mounted = true;

    (async () => {
      try {
        const cs = await import("@cornerstonejs/core");
        const csTools = await import("@cornerstonejs/tools");
        // In @cornerstonejs/dicom-image-loader v4, the legacy
        // `external.cornerstone` / `external.dicomParser` / `configure(...)`
        // assignments were removed. The new `init()` registers the
        // wadouri/wadors loaders and wires everything internally.
        const dicomImageLoader = await import("@cornerstonejs/dicom-image-loader");

        await cs.init();
        await csTools.init();
        const dilInit = (dicomImageLoader as { init?: (o?: unknown) => void; default?: { init?: (o?: unknown) => void } }).init
          ?? (dicomImageLoader as { default?: { init?: (o?: unknown) => void } }).default?.init;
        if (typeof dilInit === "function") dilInit({ maxWebWorkers: 1 });

        if (!mounted || !elementRef.current) return;

        const renderingEngine = new cs.RenderingEngine(RENDERING_ENGINE_ID);
        renderingEngineRef.current = renderingEngine as { destroy?: () => void };

        const viewportInput = {
          viewportId: VIEWPORT_ID,
          type: cs.Enums.ViewportType.STACK,
          element: elementRef.current as HTMLDivElement,
        };
        renderingEngine.enableElement(viewportInput);

        const viewport = (renderingEngine as unknown as {
          getViewport: (id: string) => unknown;
        }).getViewport(VIEWPORT_ID);
        viewportRef.current = viewport;

        const vp = viewport as {
          setStack: (ids: string[], idx?: number) => Promise<void>;
          render: () => void;
        };
        await vp.setStack(imageIds, 0);
        vp.render();

        setTotalSlices(imageIds.length);
        setCurrentSlice(0);

        // Listen for slice changes (mouse-wheel scroll, keyboard, programmatic)
        const onNewImage = (e: Event) => {
          const detail = (e as CustomEvent<{ imageIdIndex: number; viewportId: string }>).detail;
          if (detail?.viewportId === VIEWPORT_ID && typeof detail.imageIdIndex === "number") {
            setCurrentSlice(detail.imageIdIndex);
          }
        };
        cs.eventTarget.addEventListener(cs.Enums.Events.STACK_NEW_IMAGE, onNewImage);
        sliceListenerRef.current = onNewImage;

        // ── Tools ────────────────────────────────────────────────────────
        const {
          ToolGroupManager,
          PanTool,
          ZoomTool,
          WindowLevelTool,
          LengthTool,
          RectangleROITool,
          EllipticalROITool,
          AngleTool,
          ArrowAnnotateTool,
          PlanarFreehandROITool,
          ProbeTool,
          StackScrollTool,
          addTool,
          Enums: toolEnums,
        } = csTools;

        [
          PanTool,
          ZoomTool,
          WindowLevelTool,
          LengthTool,
          RectangleROITool,
          EllipticalROITool,
          AngleTool,
          ArrowAnnotateTool,
          PlanarFreehandROITool,
          ProbeTool,
          StackScrollTool,
        ].forEach((t) => {
          try {
            addTool(t);
          } catch {
            /* already added */
          }
        });

        const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
        if (!toolGroup) throw new Error("Failed to create tool group");

        [
          PanTool.toolName,
          ZoomTool.toolName,
          WindowLevelTool.toolName,
          LengthTool.toolName,
          RectangleROITool.toolName,
          EllipticalROITool.toolName,
          AngleTool.toolName,
          ArrowAnnotateTool.toolName,
          PlanarFreehandROITool.toolName,
          ProbeTool.toolName,
          StackScrollTool.toolName,
        ].forEach((n) => toolGroup.addTool(n));

        toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID);
        toolGroup.setToolActive(WindowLevelTool.toolName, {
          bindings: [{ mouseButton: toolEnums.MouseBindings.Primary }],
        });
        // Always bind the wheel scroll tool so scrolling slices works regardless
        // of the active primary tool.
        toolGroup.setToolActive(StackScrollTool.toolName);
        toolGroupRef.current = toolGroup;

        setViewerReady(true);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        setViewerError(err instanceof Error ? err.message : String(err));
      }
    })();

    return () => {
      mounted = false;
      if (cineTimerRef.current) {
        clearInterval(cineTimerRef.current);
        cineTimerRef.current = null;
      }
      try {
        if (renderingEngineRef.current?.destroy) renderingEngineRef.current.destroy();
      } catch {
        /* swallow */
      }
      try {
        if (sliceListenerRef.current) {
          import("@cornerstonejs/core").then((cs) => {
            cs.eventTarget.removeEventListener(
              cs.Enums.Events.STACK_NEW_IMAGE,
              sliceListenerRef.current as EventListener,
            );
          }).catch(() => {});
        }
      } catch {
        /* swallow */
      }
      try {
        import("@cornerstonejs/tools")
          .then((csTools) => csTools.ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID))
          .catch(() => {});
      } catch {
        /* swallow */
      }
    };
    // Key on a stable signature of the imageId list (not just length) so the
    // viewer fully reinitializes when the user navigates between two studies
    // that happen to have the same slice count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyQ.data?.id, imageIds.join("|")]);

  // ── Keyboard navigation ─────────────────────────────────────────────────
  useEffect(() => {
    if (!viewerReady) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        gotoSlice(Math.min(currentSlice + 1, totalSlices - 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        gotoSlice(Math.max(currentSlice - 1, 0));
      } else if (e.key === " ") {
        e.preventDefault();
        toggleCine();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerReady, currentSlice, totalSlices, cinePlaying]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  function gotoSlice(idx: number) {
    const vp = viewportRef.current as { setImageIdIndex?: (i: number) => void } | null;
    if (vp?.setImageIdIndex) vp.setImageIdIndex(idx);
  }

  async function setTool(tool: ToolName) {
    setActiveTool(tool);
    if (!toolGroupRef.current) return;
    const csTools = await import("@cornerstonejs/tools");
    const tg = toolGroupRef.current as {
      setToolPassive: (n: string) => void;
      setToolActive: (n: string, opts: unknown) => void;
    };
    TOOL_BUTTONS.forEach(({ tool: t }) => tg.setToolPassive(getToolName(csTools, t)));
    tg.setToolActive(getToolName(csTools, tool), {
      bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }],
    });
  }

  function applyPreset(presetId: string) {
    setActivePreset(presetId);
    const preset = WL_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const vp = viewportRef.current as {
      setProperties?: (p: { voiRange: { lower: number; upper: number } }) => void;
      render?: () => void;
    } | null;
    if (vp?.setProperties) {
      vp.setProperties({
        voiRange: { lower: preset.wc - preset.ww / 2, upper: preset.wc + preset.ww / 2 },
      });
      vp.render?.();
    }
  }

  function toggleInvert() {
    const next = !inverted;
    setInverted(next);
    const vp = viewportRef.current as {
      setProperties?: (p: { invert: boolean }) => void;
      render?: () => void;
    } | null;
    vp?.setProperties?.({ invert: next });
    vp?.render?.();
  }

  function rotate90() {
    const next = (rotation + 90) % 360;
    setRotation(next);
    const vp = viewportRef.current as {
      setProperties?: (p: { rotation: number }) => void;
      render?: () => void;
    } | null;
    vp?.setProperties?.({ rotation: next });
    vp?.render?.();
  }

  function flipHorizontal() {
    const next = !flipH;
    setFlipH(next);
    const vp = viewportRef.current as {
      setCamera?: (p: { flipHorizontal: boolean }) => void;
      render?: () => void;
    } | null;
    vp?.setCamera?.({ flipHorizontal: next });
    vp?.render?.();
  }

  function flipVertical() {
    const next = !flipV;
    setFlipV(next);
    const vp = viewportRef.current as {
      setCamera?: (p: { flipVertical: boolean }) => void;
      render?: () => void;
    } | null;
    vp?.setCamera?.({ flipVertical: next });
    vp?.render?.();
  }

  function resetView() {
    setInverted(false);
    setRotation(0);
    setFlipH(false);
    setFlipV(false);
    setActivePreset("default");
    const vp = viewportRef.current as {
      resetCamera?: () => void;
      resetProperties?: () => void;
      render?: () => void;
    } | null;
    vp?.resetProperties?.();
    vp?.resetCamera?.();
    vp?.render?.();
  }

  function toggleCine() {
    if (cineTimerRef.current) {
      clearInterval(cineTimerRef.current);
      cineTimerRef.current = null;
      setCinePlaying(false);
      return;
    }
    if (totalSlices < 2) return;
    setCinePlaying(true);
    cineTimerRef.current = setInterval(() => {
      const vp = viewportRef.current as {
        setImageIdIndex?: (i: number) => void;
        getCurrentImageIdIndex?: () => number;
      } | null;
      if (!vp?.setImageIdIndex || !vp.getCurrentImageIdIndex) return;
      const cur = vp.getCurrentImageIdIndex();
      vp.setImageIdIndex((cur + 1) % totalSlices);
    }, 100); // 10 fps
  }

  async function persistAnnotation(tool: ToolName) {
    const study = studyQ.data;
    if (!study) return;
    const serverType = ANNOTATION_TYPE_MAP[tool];
    if (!serverType) {
      toast({ title: "This tool doesn't produce a savable annotation.", variant: "destructive" });
      return;
    }
    try {
      const csTools = await import("@cornerstonejs/tools");
      const toolName = getToolName(csTools, tool);
      const annotations = csTools.annotation.state.getAnnotations(toolName, elementRef.current!);
      if (!annotations || annotations.length === 0) {
        toast({
          title: "Nothing to save",
          description: `Draw a ${tool} on the image first.`,
          variant: "destructive",
        });
        return;
      }
      const last = annotations[annotations.length - 1] as {
        data: {
          handles: { points: number[][] };
          cachedStats?: Record<string, Record<string, number | undefined>>;
          label?: string;
        };
      };

      // Pull a single representative measurement out of cachedStats so the
      // saved annotation can show a value in the list. Cornerstone keys stats
      // by viewport/series UID so we just take the first non-empty entry.
      const stats = last.data?.cachedStats ? Object.values(last.data.cachedStats)[0] : null;
      let value: number | null = null;
      let unit: string | null = null;
      if (stats) {
        if (typeof stats.length === "number") {
          value = stats.length;
          unit = "mm";
        } else if (typeof stats.area === "number") {
          value = stats.area;
          unit = "mm²";
        } else if (typeof stats.angle === "number") {
          value = stats.angle;
          unit = "°";
        } else if (typeof stats.value === "number") {
          value = stats.value;
          unit = "HU";
        } else if (typeof stats.mean === "number") {
          value = stats.mean;
          unit = "HU";
        }
      }

      await api(`/patients/${study.patientId}/imaging/${studyId}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          type: serverType,
          fileIndex: currentSlice,
          geometry: last.data.handles.points,
          label: last.data.label ?? null,
          measurementValue: value,
          measurementUnit: unit,
        }),
      });
      toast({ title: "Annotation saved" });
      qc.invalidateQueries({ queryKey: ["study-direct", studyId] });
    } catch (err) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────
  if (studyQ.isLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading study…
      </div>
    );
  }
  if (studyQ.error) {
    return (
      <div className="text-rose-400">Could not load study: {(studyQ.error as Error).message}</div>
    );
  }
  const study = studyQ.data;
  if (!study) return null;

  const isAnnotationTool = !!ANNOTATION_TYPE_MAP[activeTool];

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
        <CardHeader className="flex flex-row items-start justify-between flex-wrap gap-3">
          <div>
            <CardTitle>{study.description || study.fileName}</CardTitle>
            <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              {study.modality && <Badge variant="outline">{study.modality}</Badge>}
              {study.bodyPart && <span>{study.bodyPart}</span>}
              {study.studyDate && <span>· {study.studyDate}</span>}
              {study.rows && study.columns && (
                <span>
                  · {study.columns}×{study.rows}
                </span>
              )}
              {totalSlices > 1 && <span>· {totalSlices} slices</span>}
              {study.sliceThickness && <span>· {study.sliceThickness} mm</span>}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            {/* Primary tool buttons */}
            <div className="flex items-center gap-1 border border-border/50 rounded-md p-1 flex-wrap">
              {TOOL_BUTTONS.map(({ tool, label, Icon }) => (
                <Button
                  key={tool}
                  size="sm"
                  variant={activeTool === tool ? "default" : "ghost"}
                  onClick={() => setTool(tool)}
                  data-testid={`tool-${tool.toLowerCase()}`}
                >
                  <Icon className="w-4 h-4 mr-1" />
                  {label}
                </Button>
              ))}
              {isAnnotationTool && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => persistAnnotation(activeTool)}
                  data-testid="save-measurement"
                >
                  Save
                </Button>
              )}
            </div>

            {/* W/L preset + image manipulation */}
            <div className="flex items-center gap-2">
              <Select value={activePreset} onValueChange={applyPreset}>
                <SelectTrigger className="h-8 w-[160px] text-xs" data-testid="wl-preset">
                  <SelectValue placeholder="W/L preset" />
                </SelectTrigger>
                <SelectContent>
                  {WL_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label} ({p.wc}/{p.ww})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1 border border-border/50 rounded-md p-1">
                <Button size="sm" variant="ghost" onClick={toggleInvert} title="Invert" data-testid="op-invert">
                  <Contrast className={`w-4 h-4 ${inverted ? "text-primary" : ""}`} />
                </Button>
                <Button size="sm" variant="ghost" onClick={flipHorizontal} title="Flip horizontal">
                  <FlipHorizontal className={`w-4 h-4 ${flipH ? "text-primary" : ""}`} />
                </Button>
                <Button size="sm" variant="ghost" onClick={flipVertical} title="Flip vertical">
                  <FlipVertical className={`w-4 h-4 ${flipV ? "text-primary" : ""}`} />
                </Button>
                <Button size="sm" variant="ghost" onClick={rotate90} title="Rotate 90°">
                  <RotateCw className={`w-4 h-4 ${rotation !== 0 ? "text-primary" : ""}`} />
                </Button>
                <Button size="sm" variant="ghost" onClick={resetView} title="Reset view">
                  <RefreshCw className="w-4 h-4" />
                </Button>
                <Button
                  size="sm"
                  variant={showTags ? "default" : "ghost"}
                  onClick={() => setShowTags((v) => !v)}
                  title="DICOM tags"
                >
                  <Tag className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          {viewerError && (
            <div className="mb-3 text-xs text-rose-400">Viewer error: {viewerError}</div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3">
            {/* Viewport + slice scrubber */}
            <div>
              <div
                ref={elementRef}
                className="relative w-full bg-black rounded-md overflow-hidden border border-border/50"
                style={{ height: "640px" }}
                onContextMenu={(e) => e.preventDefault()}
                data-testid="dicom-viewport"
              >
                {!viewerReady && !viewerError && (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Loading DICOM viewer…
                  </div>
                )}
                {/* Slice indicator overlay */}
                {viewerReady && totalSlices > 0 && (
                  <div className="absolute top-2 left-2 text-xs text-white/80 bg-black/60 px-2 py-1 rounded font-mono">
                    Slice {currentSlice + 1} / {totalSlices}
                  </div>
                )}
              </div>

              {totalSlices > 1 && (
                <div className="mt-3 flex items-center gap-3" data-testid="slice-controls">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={toggleCine}
                    data-testid="cine-toggle"
                  >
                    {cinePlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  </Button>
                  <input
                    type="range"
                    min={0}
                    max={totalSlices - 1}
                    value={currentSlice}
                    onChange={(e) => gotoSlice(parseInt(e.target.value))}
                    className="flex-1 accent-primary"
                    data-testid="slice-slider"
                  />
                  <div className="text-xs text-muted-foreground font-mono w-16 text-right">
                    {currentSlice + 1} / {totalSlices}
                  </div>
                </div>
              )}

              <div className="mt-2 text-[11px] text-muted-foreground">
                Tips: scroll wheel to change slice · arrow keys also work · spacebar toggles cine
                · right-click drags pan/zoom in some tools
              </div>
            </div>

            {/* DICOM tag inspector */}
            {showTags && (
              <div className="border border-border/50 rounded-md bg-card/50 max-h-[640px] overflow-y-auto">
                <div className="sticky top-0 bg-card border-b border-border/50 px-3 py-2 text-xs font-semibold flex items-center justify-between">
                  <span>DICOM tags</span>
                  {tagsQ.isFetching && <Loader2 className="w-3 h-3 animate-spin" />}
                </div>
                <div className="p-2 space-y-1 text-[11px] font-mono">
                  {tagsQ.error && (
                    <div className="text-rose-400">Failed to load tags.</div>
                  )}
                  {tagsQ.data?.map((t) => (
                    <div key={t.tag} className="grid grid-cols-[80px_1fr] gap-2 break-words">
                      <span className="text-muted-foreground">{t.tag}</span>
                      <span>
                        <span className="text-primary/80">{t.name}</span>{" "}
                        <span className="text-foreground/80">{t.value || "—"}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* AI interpretation */}
      <ImagingInterpretationPanel
        interpretation={study.interpretation}
        model={study.interpretationModel}
        interpretedAt={study.interpretationAt}
        onReinterpret={() => reinterpretMu.mutate()}
        reinterpreting={reinterpretMu.isPending}
      />

      {/* Saved annotations */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved measurements & annotations</CardTitle>
        </CardHeader>
        <CardContent>
          {study.annotations.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              None yet — pick a measurement tool above, draw it, and click Save.
            </div>
          ) : (
            <ul className="divide-y divide-border/40">
              {study.annotations.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <Badge variant="outline" className="mr-2">
                      {a.type}
                    </Badge>
                    {totalSlices > 1 && (
                      <span className="text-xs text-muted-foreground mr-2">
                        slice {a.fileIndex + 1}
                      </span>
                    )}
                    {a.measurementValue !== null && (
                      <span className="font-mono">
                        {a.measurementValue.toFixed(2)} {a.measurementUnit}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground ml-2">
                      {new Date(a.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      deleteAnnotation.mutate({ patientId: study.patientId, annotationId: a.id })
                    }
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
