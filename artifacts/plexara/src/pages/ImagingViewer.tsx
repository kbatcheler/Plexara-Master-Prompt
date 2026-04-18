import { useEffect, useRef, useState } from "react";
import { useRoute, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Ruler, Hand, ZoomIn, Sun, Trash2, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface Annotation {
  id: number;
  type: string;
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
  annotations: Annotation[];
}

const VIEWPORT_ID = "PLEXARA_DICOM_VIEWPORT";
const RENDERING_ENGINE_ID = "PLEXARA_RENDERING_ENGINE";
const TOOL_GROUP_ID = "PLEXARA_TOOL_GROUP";

export default function ImagingViewer() {
  const [, params] = useRoute("/imaging/:id");
  const studyId = params?.id ? parseInt(params.id) : NaN;
  const elementRef = useRef<HTMLDivElement>(null);
  const [activeTool, setActiveTool] = useState<"Pan" | "Zoom" | "WindowLevel" | "Length">("WindowLevel");
  const [viewerReady, setViewerReady] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const toolGroupRef = useRef<unknown>(null);
  const { toast } = useToast();
  const qc = useQueryClient();

  const studyQ = useQuery<StudyDetail>({
    queryKey: ["imaging-study", studyId],
    queryFn: () => api(`/patients/0/imaging/${studyId}`).catch(async () => {
      // Need patient id — fetch via /imaging/dicom auth header is patient-scoped. Use direct study lookup via a list.
      // Fallback: query each patient. Simpler: server's GET requires patient ownership — we need the patientId.
      // We retrieve the study by trying patients owned by user; the list page supplied patientId via context but we lost it.
      // Easiest: use the dicom stream which we know is auth-checked on the server.
      throw new Error("Use list-driven navigation");
    }),
    retry: false,
    enabled: false,
  });

  // Direct study fetch — server route /patients/:pid/imaging/:studyId requires patient id we don't have here.
  // Use a generic direct lookup added below.
  const studyDirectQ = useQuery<StudyDetail>({
    queryKey: ["study-direct", studyId],
    queryFn: () => api(`/imaging/study/${studyId}`),
    enabled: !isNaN(studyId),
  });

  const deleteAnnotation = useMutation({
    mutationFn: ({ patientId, annotationId }: { patientId: number; annotationId: number }) =>
      api(`/patients/${patientId}/imaging/${studyId}/annotations/${annotationId}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["study-direct", studyId] }),
  });

  // Initialise Cornerstone3D
  useEffect(() => {
    if (!studyDirectQ.data || !elementRef.current) return;
    let mounted = true;
    let renderingEngine: { destroy?: () => void } | null = null;

    (async () => {
      try {
        const cs = await import("@cornerstonejs/core");
        const csTools = await import("@cornerstonejs/tools");
        const dicomImageLoader = (await import("@cornerstonejs/dicom-image-loader")).default;
        const dicomParser = (await import("dicom-parser")).default;

        await cs.init();
        await csTools.init();
        // @ts-expect-error external module typings differ across versions
        dicomImageLoader.external.cornerstone = cs;
        // @ts-expect-error external module typings differ across versions
        dicomImageLoader.external.dicomParser = dicomParser;
        // @ts-expect-error setup config not in types for some versions
        dicomImageLoader.configure?.({ useWebWorkers: false });

        if (!mounted || !elementRef.current) return;

        renderingEngine = new cs.RenderingEngine(RENDERING_ENGINE_ID);
        const viewportInput = {
          viewportId: VIEWPORT_ID,
          type: cs.Enums.ViewportType.STACK,
          element: elementRef.current as HTMLDivElement,
        };
        // @ts-expect-error rendering engine generic typing
        renderingEngine.enableElement(viewportInput);

        // Load image via dicom-image-loader, source = our auth-checked stream URL.
        const dicomUrl = `${window.location.origin}/api/imaging/dicom/${studyId}`;
        const imageId = `wadouri:${dicomUrl}`;
        const viewport = (renderingEngine as unknown as { getViewport: (id: string) => { setStack: (ids: string[]) => Promise<void>; render: () => void } }).getViewport(VIEWPORT_ID);
        await viewport.setStack([imageId]);
        viewport.render();

        // Set up tools
        const { ToolGroupManager, PanTool, ZoomTool, WindowLevelTool, LengthTool, addTool, Enums: toolEnums } = csTools;
        addTool(PanTool);
        addTool(ZoomTool);
        addTool(WindowLevelTool);
        addTool(LengthTool);

        const toolGroup = ToolGroupManager.createToolGroup(TOOL_GROUP_ID);
        if (!toolGroup) throw new Error("Failed to create tool group");
        toolGroup.addTool(PanTool.toolName);
        toolGroup.addTool(ZoomTool.toolName);
        toolGroup.addTool(WindowLevelTool.toolName);
        toolGroup.addTool(LengthTool.toolName);
        toolGroup.addViewport(VIEWPORT_ID, RENDERING_ENGINE_ID);
        toolGroup.setToolActive(WindowLevelTool.toolName, { bindings: [{ mouseButton: toolEnums.MouseBindings.Primary }] });
        toolGroupRef.current = toolGroup;

        setViewerReady(true);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(err);
        setViewerError(err instanceof Error ? err.message : String(err));
      }
    })();

    cleanupRef.current = () => {
      mounted = false;
      try {
        if (renderingEngine?.destroy) renderingEngine.destroy();
      } catch { /* swallow */ }
      try {
        // @ts-expect-error tool group cleanup
        if (toolGroupRef.current) {
          import("@cornerstonejs/tools").then((csTools) => csTools.ToolGroupManager.destroyToolGroup(TOOL_GROUP_ID)).catch(() => {});
        }
      } catch { /* swallow */ }
    };
    return () => { cleanupRef.current?.(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [studyDirectQ.data?.id, studyId]);

  async function setTool(tool: typeof activeTool) {
    setActiveTool(tool);
    if (!toolGroupRef.current) return;
    const csTools = await import("@cornerstonejs/tools");
    const tg = toolGroupRef.current as { setToolPassive: (n: string) => void; setToolActive: (n: string, opts: unknown) => void };
    [csTools.PanTool.toolName, csTools.ZoomTool.toolName, csTools.WindowLevelTool.toolName, csTools.LengthTool.toolName].forEach((n) => tg.setToolPassive(n));
    const map = {
      Pan: csTools.PanTool.toolName,
      Zoom: csTools.ZoomTool.toolName,
      WindowLevel: csTools.WindowLevelTool.toolName,
      Length: csTools.LengthTool.toolName,
    } as const;
    tg.setToolActive(map[tool], { bindings: [{ mouseButton: csTools.Enums.MouseBindings.Primary }] });
  }

  async function persistLengthMeasurement() {
    if (!studyDirectQ.data) return;
    try {
      const csTools = await import("@cornerstonejs/tools");
      const annotations = csTools.annotation.state.getAnnotations(csTools.LengthTool.toolName, elementRef.current!);
      if (!annotations || annotations.length === 0) {
        toast({ title: "No measurement to save", description: "Draw a length first using the ruler tool.", variant: "destructive" });
        return;
      }
      const last = annotations[annotations.length - 1] as { data: { handles: { points: number[][] }; cachedStats?: Record<string, { length?: number }> } };
      const length = last.data?.cachedStats ? Object.values(last.data.cachedStats)[0]?.length ?? null : null;
      await api(`/patients/${studyDirectQ.data.patientId}/imaging/${studyId}/annotations`, {
        method: "POST",
        body: JSON.stringify({
          type: "length",
          geometry: last.data.handles.points,
          measurementValue: length,
          measurementUnit: length ? "mm" : null,
        }),
      });
      toast({ title: "Measurement saved" });
      qc.invalidateQueries({ queryKey: ["study-direct", studyId] });
    } catch (err) {
      toast({ title: "Failed to save", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    }
  }

  if (studyDirectQ.isLoading) {
    return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Loading study…</div>;
  }
  if (studyDirectQ.error) {
    return <div className="text-rose-400">Could not load study: {(studyDirectQ.error as Error).message}</div>;
  }
  const study = studyDirectQ.data;
  if (!study) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/imaging" className="text-muted-foreground hover:text-primary text-sm flex items-center gap-1">
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
              {study.rows && study.columns && <span>· {study.columns}×{study.rows}</span>}
            </div>
          </div>
          <div className="flex items-center gap-1 border border-border/50 rounded-md p-1">
            <Button size="sm" variant={activeTool === "WindowLevel" ? "default" : "ghost"} onClick={() => setTool("WindowLevel")}><Sun className="w-4 h-4 mr-1" />W/L</Button>
            <Button size="sm" variant={activeTool === "Pan" ? "default" : "ghost"} onClick={() => setTool("Pan")}><Hand className="w-4 h-4 mr-1" />Pan</Button>
            <Button size="sm" variant={activeTool === "Zoom" ? "default" : "ghost"} onClick={() => setTool("Zoom")}><ZoomIn className="w-4 h-4 mr-1" />Zoom</Button>
            <Button size="sm" variant={activeTool === "Length" ? "default" : "ghost"} onClick={() => setTool("Length")} data-testid="tool-length"><Ruler className="w-4 h-4 mr-1" />Length</Button>
            {activeTool === "Length" && (
              <Button size="sm" variant="outline" onClick={persistLengthMeasurement} data-testid="save-measurement">Save</Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {viewerError && <div className="mb-3 text-xs text-rose-400">Viewer error: {viewerError}</div>}
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
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Saved measurements & annotations</CardTitle>
        </CardHeader>
        <CardContent>
          {study.annotations.length === 0 ? (
            <div className="text-sm text-muted-foreground">None yet — switch to the Length tool, draw a line, and click Save.</div>
          ) : (
            <ul className="divide-y divide-border/40">
              {study.annotations.map((a) => (
                <li key={a.id} className="flex items-center justify-between py-2 text-sm">
                  <div>
                    <Badge variant="outline" className="mr-2">{a.type}</Badge>
                    {a.measurementValue !== null && (
                      <span className="font-mono">{a.measurementValue.toFixed(2)} {a.measurementUnit}</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-2">{new Date(a.createdAt).toLocaleString()}</span>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => deleteAnnotation.mutate({ patientId: study.patientId, annotationId: a.id })}>
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
