/**
 * DICOM processing utilities.
 *
 * Uses dicom-parser (already in package.json) for server-side tag extraction.
 * The frontend will eventually use CornerstoneJS / OHIF for rendering — this
 * module handles the backend concerns: metadata extraction, tag reading,
 * anonymisation of DICOM headers before storage or LLM processing.
 *
 * Migration note: when moving to GCP, consider Google Cloud Healthcare API's
 * native DICOMWeb support for WADO-RS / STOW-RS / QIDO-RS endpoints.
 */

import dicomParser from "dicom-parser";
import { logger } from "./logger";

// ── Existing slim shape (kept for backward compatibility with imaging.ts) ────
export interface DicomMetadata {
  modality: string | null;
  bodyPart: string | null;
  description: string | null;
  studyDate: string | null;
  sopInstanceUid: string | null;
  rows: number | null;
  columns: number | null;
}

// ── Full extraction shapes (added per code-review remediation) ──────────────
export interface FullDicomMetadata {
  patientName: string | null;
  patientId: string | null;
  studyDate: string | null;
  modality: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  bodyPartExamined: string | null;
  institutionName: string | null;
  referringPhysician: string | null;
  sopInstanceUid: string | null;
  studyInstanceUid: string | null;
  seriesInstanceUid: string | null;
  rows: number | null;
  columns: number | null;
  numberOfFrames: number | null;
  sliceThickness: number | null;
  pixelSpacing: string | null;
  instanceNumber: number | null;
  sliceLocation: number | null;
}

// Anonymised view: identifying tags are stripped — safe to send to LLMs.
export interface AnonymisedDicomMetadata {
  studyDate: string | null;
  modality: string | null;
  studyDescription: string | null;
  seriesDescription: string | null;
  bodyPartExamined: string | null;
  rows: number | null;
  columns: number | null;
  numberOfFrames: number | null;
  sliceThickness: number | null;
  pixelSpacing: string | null;
}

// Internal: tag readers that swallow per-tag parser errors so a single bad
// tag doesn't blow up the whole extraction.
function readers(dataSet: dicomParser.DataSet) {
  return {
    str: (tag: string): string | null => {
      try {
        return dataSet.string(tag) || null;
      } catch {
        return null;
      }
    },
    u16: (tag: string): number | null => {
      try {
        return dataSet.uint16(tag) ?? null;
      } catch {
        return null;
      }
    },
    f: (tag: string): number | null => {
      try {
        const v = dataSet.floatString(tag);
        return typeof v === "number" ? v : null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Backward-compatible slim extractor used by routes/imaging.ts.
 * Extracts a small set of DICOM header tags we care about.
 * Tags reference: https://www.dicomlibrary.com/dicom/dicom-tags/
 */
export function parseDicomMetadata(buffer: Buffer): DicomMetadata {
  const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
  const { str, u16 } = readers(dataSet);
  return {
    modality: str("x00080060"),
    bodyPart: str("x00180015"),
    description: str("x00081030") || str("x0008103e"),
    studyDate: str("x00080020"),
    sopInstanceUid: str("x00080018"),
    rows: u16("x00280010"),
    columns: u16("x00280011"),
  };
}

/**
 * Extract metadata from a DICOM file buffer.
 * Returns BOTH the full metadata (for internal storage) and an anonymised
 * version (safe to forward to third-party LLMs). The `anonymised` view drops
 * patientName, patientId, institutionName, and referringPhysician.
 *
 * Throws Error("Invalid DICOM file: ...") if the buffer is not parseable.
 */
export function extractDicomMetadata(buffer: Buffer): {
  full: FullDicomMetadata;
  anonymised: AnonymisedDicomMetadata;
} {
  try {
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
    const { str, u16, f } = readers(dataSet);

    // numberOfFrames: DICOM tag (0028,0008) is an "IS" (Integer String). Be
    // strict — only accept a sequence of digits and require >0. parseInt
    // would otherwise silently accept "12abc" → 12, "0" → 0, or "-1" → -1.
    const numberOfFramesStr = str("x00280008");
    let numberOfFrames: number | null = null;
    if (numberOfFramesStr && /^\d+$/.test(numberOfFramesStr.trim())) {
      const n = parseInt(numberOfFramesStr.trim(), 10);
      if (Number.isFinite(n) && n > 0) numberOfFrames = n;
    }

    // InstanceNumber tag (0020,0013) is "IS" — strict integer parse.
    const instanceNumberStr = str("x00200013");
    let instanceNumber: number | null = null;
    if (instanceNumberStr && /^-?\d+$/.test(instanceNumberStr.trim())) {
      const n = parseInt(instanceNumberStr.trim(), 10);
      if (Number.isFinite(n)) instanceNumber = n;
    }

    const full: FullDicomMetadata = {
      patientName: str("x00100010"),
      patientId: str("x00100020"),
      studyDate: str("x00080020"),
      modality: str("x00080060"),
      studyDescription: str("x00081030"),
      seriesDescription: str("x0008103e"),
      bodyPartExamined: str("x00180015"),
      institutionName: str("x00080080"),
      referringPhysician: str("x00080090"),
      sopInstanceUid: str("x00080018"),
      studyInstanceUid: str("x0020000d"),
      seriesInstanceUid: str("x0020000e"),
      rows: u16("x00280010"),
      columns: u16("x00280011"),
      numberOfFrames,
      sliceThickness: f("x00180050"),
      pixelSpacing: str("x00280030"),
      instanceNumber,
      sliceLocation: f("x00201041"),
    };

    const anonymised: AnonymisedDicomMetadata = {
      studyDate: full.studyDate,
      modality: full.modality,
      studyDescription: full.studyDescription,
      seriesDescription: full.seriesDescription,
      bodyPartExamined: full.bodyPartExamined,
      rows: full.rows,
      columns: full.columns,
      numberOfFrames: full.numberOfFrames,
      sliceThickness: full.sliceThickness,
      pixelSpacing: full.pixelSpacing,
    };

    return { full, anonymised };
  } catch (err) {
    logger.warn({ err }, "Failed to parse DICOM metadata — file may be corrupted or non-DICOM");
    throw new Error("Invalid DICOM file: unable to extract metadata");
  }
}

/**
 * Validate that a buffer looks like a valid DICOM file.
 * Checks for the "DICM" magic bytes at offset 128 (the DICOM file preamble
 * is 128 bytes of zeros followed by the 4-byte "DICM" prefix).
 */
export function isDicomFile(buffer: Buffer): boolean {
  if (buffer.length < 132) return false;
  return buffer.slice(128, 132).toString("ascii") === "DICM";
}

// ── Full tag dump ───────────────────────────────────────────────────────────
// Curated catalogue of clinically-relevant DICOM tags. We don't dump every
// raw byte — that would leak PHI (PatientName, PatientID, etc.). Instead we
// expose a clinician-useful, anonymised slice of the header.
const TAG_CATALOGUE: Array<{ tag: string; group: string; name: string; vr: "str" | "u16" | "f" }> = [
  // Patient demographics (anonymised — only safe ones)
  { tag: "x00100040", group: "Patient", name: "Patient Sex", vr: "str" },
  { tag: "x00101010", group: "Patient", name: "Patient Age", vr: "str" },
  { tag: "x00101020", group: "Patient", name: "Patient Size (m)", vr: "str" },
  { tag: "x00101030", group: "Patient", name: "Patient Weight (kg)", vr: "str" },
  // Study
  { tag: "x00080020", group: "Study", name: "Study Date", vr: "str" },
  { tag: "x00080030", group: "Study", name: "Study Time", vr: "str" },
  { tag: "x00081030", group: "Study", name: "Study Description", vr: "str" },
  { tag: "x00080050", group: "Study", name: "Accession Number", vr: "str" },
  // Series
  { tag: "x00080060", group: "Series", name: "Modality", vr: "str" },
  { tag: "x0008103e", group: "Series", name: "Series Description", vr: "str" },
  { tag: "x00200011", group: "Series", name: "Series Number", vr: "str" },
  { tag: "x00180015", group: "Series", name: "Body Part Examined", vr: "str" },
  { tag: "x00185100", group: "Series", name: "Patient Position", vr: "str" },
  { tag: "x00185101", group: "Series", name: "View Position", vr: "str" },
  // Acquisition
  { tag: "x00181030", group: "Acquisition", name: "Protocol Name", vr: "str" },
  { tag: "x00080070", group: "Acquisition", name: "Manufacturer", vr: "str" },
  { tag: "x00081090", group: "Acquisition", name: "Manufacturer Model", vr: "str" },
  { tag: "x00181020", group: "Acquisition", name: "Software Version", vr: "str" },
  { tag: "x00181000", group: "Acquisition", name: "Device Serial Number", vr: "str" },
  // Image geometry
  { tag: "x00280010", group: "Image", name: "Rows", vr: "u16" },
  { tag: "x00280011", group: "Image", name: "Columns", vr: "u16" },
  { tag: "x00280008", group: "Image", name: "Number of Frames", vr: "str" },
  { tag: "x00180050", group: "Image", name: "Slice Thickness (mm)", vr: "f" },
  { tag: "x00280030", group: "Image", name: "Pixel Spacing (mm)", vr: "str" },
  { tag: "x00200013", group: "Image", name: "Instance Number", vr: "str" },
  { tag: "x00201041", group: "Image", name: "Slice Location", vr: "f" },
  { tag: "x00200032", group: "Image", name: "Image Position (Patient)", vr: "str" },
  { tag: "x00200037", group: "Image", name: "Image Orientation", vr: "str" },
  // Pixel data characteristics
  { tag: "x00280002", group: "Pixel Data", name: "Samples per Pixel", vr: "u16" },
  { tag: "x00280004", group: "Pixel Data", name: "Photometric Interpretation", vr: "str" },
  { tag: "x00280100", group: "Pixel Data", name: "Bits Allocated", vr: "u16" },
  { tag: "x00280101", group: "Pixel Data", name: "Bits Stored", vr: "u16" },
  { tag: "x00281050", group: "Pixel Data", name: "Window Center", vr: "str" },
  { tag: "x00281051", group: "Pixel Data", name: "Window Width", vr: "str" },
  { tag: "x00281052", group: "Pixel Data", name: "Rescale Intercept", vr: "str" },
  { tag: "x00281053", group: "Pixel Data", name: "Rescale Slope", vr: "str" },
  // CT-specific
  { tag: "x00180060", group: "Acquisition", name: "kVp", vr: "str" },
  { tag: "x00181150", group: "Acquisition", name: "Exposure Time (ms)", vr: "str" },
  { tag: "x00181151", group: "Acquisition", name: "X-Ray Tube Current (mA)", vr: "str" },
  { tag: "x00181152", group: "Acquisition", name: "Exposure (mAs)", vr: "str" },
  // MR-specific
  { tag: "x00180080", group: "Acquisition", name: "Repetition Time (ms)", vr: "str" },
  { tag: "x00180081", group: "Acquisition", name: "Echo Time (ms)", vr: "str" },
  { tag: "x00180087", group: "Acquisition", name: "Magnetic Field Strength (T)", vr: "str" },
  { tag: "x00180020", group: "Acquisition", name: "Scanning Sequence", vr: "str" },
];

export interface DicomTagEntry {
  tag: string;
  group: string;
  name: string;
  value: string | number | null;
}

/**
 * Extract a clinician-useful, anonymised dump of DICOM header tags.
 * PHI tags (PatientName, PatientID, InstitutionName, ReferringPhysician,
 * StudyInstanceUID, etc.) are deliberately excluded.
 */
export function extractAllDicomTags(buffer: Buffer): DicomTagEntry[] {
  try {
    const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
    const r = readers(dataSet);
    const out: DicomTagEntry[] = [];
    for (const t of TAG_CATALOGUE) {
      let value: string | number | null = null;
      if (t.vr === "str") value = r.str(t.tag);
      else if (t.vr === "u16") value = r.u16(t.tag);
      else if (t.vr === "f") value = r.f(t.tag);
      out.push({ tag: t.tag, group: t.group, name: t.name, value });
    }
    return out;
  } catch (err) {
    logger.warn({ err }, "Failed to extract DICOM tag dump");
    return [];
  }
}
