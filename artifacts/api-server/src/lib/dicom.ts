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
  rows: number | null;
  columns: number | null;
  numberOfFrames: number | null;
  sliceThickness: number | null;
  pixelSpacing: string | null;
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
      rows: u16("x00280010"),
      columns: u16("x00280011"),
      numberOfFrames,
      sliceThickness: f("x00180050"),
      pixelSpacing: str("x00280030"),
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
