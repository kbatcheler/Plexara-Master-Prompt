import crypto from "crypto";

export interface AnonymisedData {
  [key: string]: unknown;
}

export function stripPII(data: Record<string, unknown>): AnonymisedData {
  const stripped = { ...data };
  if ("patientName" in stripped) stripped.patientName = "[PATIENT]";
  if ("name" in stripped) stripped.name = "[PATIENT]";
  if ("dateOfBirth" in stripped) stripped.dateOfBirth = "[DOB]";
  if ("dob" in stripped) stripped.dob = "[DOB]";
  if ("patientId" in stripped) stripped.patientId = "[ID]";
  if ("labName" in stripped) stripped.labName = "[LAB]";
  if ("physicianName" in stripped) stripped.physicianName = "[PHYSICIAN]";
  if ("address" in stripped) stripped.address = "[ADDRESS]";
  if ("mrn" in stripped) stripped.mrn = "[MRN]";
  if ("ssn" in stripped) stripped.ssn = "[REDACTED]";
  return stripped;
}

export function hashData(data: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
