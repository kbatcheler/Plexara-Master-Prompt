import crypto from "crypto";

export interface AnonymisedData {
  [key: string]: unknown;
}

const PII_FIELD_NAMES = new Set([
  "patientname", "name", "fullname", "firstname", "lastname",
  "dateofbirth", "dob", "birthdate", "birthday",
  "patientid", "mrn", "medicalrecordnumber",
  "ssn", "socialsecuritynumber",
  "address", "streetaddress", "homeaddress",
  "email", "emailaddress",
  "phone", "phonenumber", "mobile", "telephone",
  "physicianname", "doctorname", "referringphysician",
  "insuranceid", "policyid",
  "accountid", "userid",
]);

const PII_REPLACEMENTS: Record<string, string> = {
  patientname: "[PATIENT]", name: "[PATIENT]", fullname: "[PATIENT]",
  firstname: "[PATIENT]", lastname: "[PATIENT]",
  dateofbirth: "[DOB]", dob: "[DOB]", birthdate: "[DOB]", birthday: "[DOB]",
  patientid: "[ID]", mrn: "[MRN]", medicalrecordnumber: "[MRN]",
  ssn: "[REDACTED]", socialsecuritynumber: "[REDACTED]",
  address: "[ADDRESS]", streetaddress: "[ADDRESS]", homeaddress: "[ADDRESS]",
  email: "[REDACTED]", emailaddress: "[REDACTED]",
  phone: "[REDACTED]", phonenumber: "[REDACTED]", mobile: "[REDACTED]", telephone: "[REDACTED]",
  physicianname: "[PHYSICIAN]", doctorname: "[PHYSICIAN]", referringphysician: "[PHYSICIAN]",
  insuranceid: "[REDACTED]", policyid: "[REDACTED]",
  accountid: "[ID]", userid: "[ID]",
};

const PII_PATTERNS = [
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  { pattern: /\b\d{9}\b/g, replacement: "[POSSIBLE-ID]" },
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL]" },
  { pattern: /\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g, replacement: "[PHONE]" },
];

function scrubString(value: string): string {
  let result = value;
  for (const { pattern, replacement } of PII_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function stripRecursive(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") {
    return scrubString(value);
  }

  if (Array.isArray(value)) {
    return value.map(stripRecursive);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      const normalizedKey = key.toLowerCase().replace(/[_\-\s]/g, "");
      if (PII_FIELD_NAMES.has(normalizedKey)) {
        result[key] = PII_REPLACEMENTS[normalizedKey] || "[REDACTED]";
      } else if (typeof val === "string") {
        result[key] = scrubString(val);
      } else {
        result[key] = stripRecursive(val);
      }
    }
    return result;
  }

  return value;
}

export function stripPII(data: Record<string, unknown>): AnonymisedData {
  return stripRecursive(data) as AnonymisedData;
}

export function hashData(data: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
}
