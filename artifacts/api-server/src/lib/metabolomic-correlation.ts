/**
 * Cross-correlates organic acid test findings with blood panel biomarkers
 * to produce integrated metabolic insights.
 *
 * This is the engine that connects "your OAT shows impaired Krebs cycle"
 * with "your blood panel shows low ferritin and borderline B12" to produce
 * "your mitochondrial dysfunction is likely driven by iron and B12
 * insufficiency — here's the evidence from both tests."
 *
 * Pure function — no DB access. Caller (post-interpretation orchestrator,
 * Step 1h) loads the OAT structured JSON and the patient's blood biomarker
 * rows, hands them in, and the engine returns a list of pathway-level
 * correlations. The list rides into `runComprehensiveReport` via the
 * additive `metabolomicCorrelations` field on `ComprehensiveReportInput`.
 */

import { METABOLIC_PATHWAYS, type MetabolicPathway } from "./metabolic-pathways";

export interface MetabolomicCorrelation {
  pathway: string;
  pathwayName: string;
  oatFindings: string[];
  relatedBloodBiomarkers: Array<{
    biomarker: string;
    patientValue: string | null;
    relationship: string;
    correlationStrength: "strong" | "moderate" | "suggestive";
  }>;
  integratedInterpretation: string;
  suggestedInterventions: string[];
}

export function correlateMetabolomicWithBloodwork(
  oatData: Record<string, unknown>,
  bloodBiomarkers: Array<{ name: string; value: string; unit: string }>,
): MetabolomicCorrelation[] {
  const correlations: MetabolomicCorrelation[] = [];

  for (const pathway of METABOLIC_PATHWAYS) {
    // Check if any markers from this pathway are abnormal in the OAT data
    const abnormalMarkers = findAbnormalMarkersForPathway(pathway, oatData);
    if (abnormalMarkers.length === 0) continue;

    // Find related blood biomarkers in the patient's data
    const relatedBlood = pathway.crossCorrelationWithBloodwork.map((cc) => {
      const match = bloodBiomarkers.find((b) =>
        b.name.toLowerCase().includes(cc.bloodBiomarker.toLowerCase()),
      );
      return {
        biomarker: cc.bloodBiomarker,
        patientValue: match ? `${match.value} ${match.unit}`.trim() : null,
        relationship: cc.relationship,
        correlationStrength: match ? ("strong" as const) : ("suggestive" as const),
      };
    });

    correlations.push({
      pathway: pathway.slug,
      pathwayName: pathway.name,
      oatFindings: abnormalMarkers.map((m) => `${m.name}: ${m.meaning}`),
      relatedBloodBiomarkers: relatedBlood,
      integratedInterpretation: buildIntegratedInterpretation(pathway, abnormalMarkers, relatedBlood),
      suggestedInterventions: pathway.clinicalImplications.supportiveInterventions,
    });
  }

  return correlations;
}

interface OatMarkerRow {
  name?: unknown;
  value?: unknown;
  status?: unknown;
}

function findAbnormalMarkersForPathway(
  pathway: MetabolicPathway,
  oatData: Record<string, unknown>,
): Array<{ name: string; meaning: string }> {
  const abnormal: Array<{ name: string; meaning: string }> = [];

  // Search through all OAT data categories for markers matching this pathway
  const allOatMarkers: Array<{ name: string; value: number; status: string }> = [];
  for (const category of [
    "krebsCycleMarkers",
    "fattyAcidOxidationMarkers",
    "carbohydrateMetabolismMarkers",
    "neurotransmitterMetabolites",
    "dysbiosis_markers",
    "nutritionalMarkers",
    "detoxificationMarkers",
    "oxalateMarkers",
    "ketoneBodies",
    "aminoAcidMetabolites",
  ]) {
    const markers = oatData[category];
    if (!Array.isArray(markers)) continue;
    for (const raw of markers as OatMarkerRow[]) {
      if (!raw || typeof raw !== "object") continue;
      const name = typeof raw.name === "string" ? raw.name : null;
      const value = typeof raw.value === "number" ? raw.value : null;
      const status = typeof raw.status === "string" ? raw.status : "";
      if (name && value != null) {
        allOatMarkers.push({ name, value, status });
      }
    }
  }

  for (const pathwayMarker of pathway.markers) {
    const firstToken = pathwayMarker.name.toLowerCase().split(/\s+/)[0];
    if (!firstToken) continue;
    const match = allOatMarkers.find((m) => m.name.toLowerCase().includes(firstToken));
    if (match && (match.status === "high" || match.status === "critical")) {
      abnormal.push({ name: pathwayMarker.name, meaning: pathwayMarker.elevatedMeaning });
    }
  }

  return abnormal;
}

function buildIntegratedInterpretation(
  pathway: MetabolicPathway,
  abnormalMarkers: Array<{ name: string; meaning: string }>,
  relatedBlood: Array<{ biomarker: string; patientValue: string | null; relationship: string }>,
): string {
  const confirmedBlood = relatedBlood.filter((b) => b.patientValue !== null);
  const markerNames = abnormalMarkers.map((m) => m.name).join(", ");

  if (confirmedBlood.length > 0) {
    const bloodEvidence = confirmedBlood
      .map((b) => `${b.biomarker} at ${b.patientValue}`)
      .join(", ");
    return `${pathway.name} dysfunction detected via OAT (${markerNames}). Blood panel confirms: ${bloodEvidence}. ${pathway.clinicalImplications.whenImpaired}`;
  }

  const missingBlood = relatedBlood.map((b) => b.biomarker).join(", ");
  return `${pathway.name} dysfunction detected via OAT (${markerNames}). No corresponding blood biomarkers available for cross-confirmation — consider ordering: ${missingBlood}. ${pathway.clinicalImplications.whenImpaired}`;
}
