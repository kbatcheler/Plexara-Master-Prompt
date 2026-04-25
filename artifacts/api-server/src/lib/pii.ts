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
  // UK / international medical record fields (added per code review):
  "nhsnumber", "nhsno", "nino", "nationalinsurancenumber",
  "gpname", "gppractice", "surgery",
  "postcode", "zipcode",
  "hospitalnumber", "hospitalid",
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
  // UK / international additions:
  nhsnumber: "[NHS]", nhsno: "[NHS]", nino: "[REDACTED]",
  nationalinsurancenumber: "[REDACTED]",
  gpname: "[PHYSICIAN]", gppractice: "[FACILITY]", surgery: "[FACILITY]",
  postcode: "[POSTCODE]", zipcode: "[POSTCODE]",
  hospitalnumber: "[ID]", hospitalid: "[ID]",
};

// Patterns are applied sequentially. Order matters: more specific / more
// distinctive patterns must come first so that a value like "+44 7700 900123"
// is caught by the international-phone pattern before any of the UK/US
// patterns get a chance to partially match it.
const PII_PATTERNS = [
  // SSN (US) — 3-2-4 digits with dashes; distinctive, no overlap with phones.
  { pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: "[SSN]" },
  // NHS Number (UK) — 10 digits in 3-3-4 grouping (spaces optional).
  { pattern: /\b\d{3}\s?\d{3}\s?\d{4}\b/g, replacement: "[NHS-NUMBER]" },
  // Generic 9-digit ID (kept from previous version for backward compat).
  { pattern: /\b\d{9}\b/g, replacement: "[POSSIBLE-ID]" },
  // Email — distinct symbol set, can't overlap phones.
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: "[EMAIL]" },
  // International phone with leading "+" (e.g. +44 7700 900123, +1-555-123-4567,
  // +353 1 234 5678). MUST come before the UK/US patterns below — otherwise
  // a leading "+44" would be ignored and the trailing digits partially eaten.
  { pattern: /\+\d{1,4}[\s\-.]?\(?\d{1,5}\)?[\s\-.]?\d{1,5}[\s\-.]?\d{1,5}[\s\-.]?\d{0,5}/g, replacement: "[PHONE]" },
  // UK mobile: 07xxx xxxxxx (with optional spaces / dashes / dots).
  { pattern: /\b07\d{3}[\s\-.]?\d{3}[\s\-.]?\d{3}\b/g, replacement: "[PHONE]" },
  // UK landline: 01x / 02x / 03x followed by 7-8 digits with optional grouping.
  { pattern: /\b0[1-3]\d{1,4}[\s\-.]?\d{3,4}[\s\-.]?\d{3,4}\b/g, replacement: "[PHONE]" },
  // US phone (existing pattern, kept for backward compatibility).
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
