import dicomParser from "dicom-parser";

export interface DicomMetadata {
  modality: string | null;
  bodyPart: string | null;
  description: string | null;
  studyDate: string | null;
  sopInstanceUid: string | null;
  rows: number | null;
  columns: number | null;
}

// Extract a small set of DICOM header tags we care about.
// Tags reference: https://www.dicomlibrary.com/dicom/dicom-tags/
export function parseDicomMetadata(buffer: Buffer): DicomMetadata {
  const dataSet = dicomParser.parseDicom(new Uint8Array(buffer));
  const str = (tag: string) => {
    try {
      return dataSet.string(tag) || null;
    } catch {
      return null;
    }
  };
  const u16 = (tag: string) => {
    try {
      return dataSet.uint16(tag) ?? null;
    } catch {
      return null;
    }
  };
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
