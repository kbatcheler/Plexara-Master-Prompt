/**
 * Report export → PDF.
 *
 * POST /api/patients/:patientId/report-export/export-pdf
 *
 * Streams a PDF of the patient's most recent comprehensive report. When the
 * physician portal is enabled and the caller passes `?withQr=1` (default),
 * we mint a fresh 30-day share link and embed its QR code in the PDF so a
 * recipient with the printed page can scan straight to a live read-only
 * view. With the portal disabled, or `?withQr=0`, the PDF renders without
 * the share block.
 *
 * The route is mounted unconditionally — the PDF itself is useful even
 * without the share-link feature — but QR generation is gated on the same
 * `ENABLE_PHYSICIAN_PORTAL` flag the share router uses.
 */
import { Router } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { db } from "@workspace/db";
import {
  patientsTable,
  comprehensiveReportsTable,
  shareLinksTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { decryptText, decryptJson } from "../lib/phi-crypto";
import { renderReportPdf } from "../lib/report-pdf";
import type { ComprehensiveReportOutput } from "../lib/reports-ai";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

function flagEnabled(envName: string): boolean {
  return process.env[envName] !== "false";
}
const ENABLE_PHYSICIAN_PORTAL = flagEnabled("ENABLE_PHYSICIAN_PORTAL");

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

router.post("/export-pdf", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);
  const withQr = req.query.withQr !== "0" && ENABLE_PHYSICIAN_PORTAL;

  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "Invalid patient id" });
    return;
  }

  try {
    const [patient] = await db.select().from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    // Fetch latest comprehensive report row. Narratives + sections are PHI-
    // encrypted at rest using the same envelope wrapper as interpretations.
    const [row] = await db.select().from(comprehensiveReportsTable)
      .where(eq(comprehensiveReportsTable.patientId, patientId))
      .orderBy(desc(comprehensiveReportsTable.generatedAt))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "No comprehensive report yet — generate one first." });
      return;
    }

    const sections = decryptJson<{
      sections: ComprehensiveReportOutput["sections"];
      crossPanelPatterns: ComprehensiveReportOutput["crossPanelPatterns"];
      topConcerns: string[];
      topPositives: string[];
      urgentFlags: string[];
      recommendedNextSteps: string[];
      followUpTesting: string[];
    }>(row.sectionsJson);

    const reportPayload: ComprehensiveReportOutput = {
      executiveSummary: decryptText(row.executiveSummary) ?? "",
      patientNarrative: decryptText(row.patientNarrative) ?? "",
      clinicalNarrative: decryptText(row.clinicalNarrative) ?? "",
      unifiedHealthScore: row.unifiedHealthScore !== null ? Number(row.unifiedHealthScore) : 0,
      sections: sections?.sections ?? [],
      crossPanelPatterns: sections?.crossPanelPatterns ?? [],
      topConcerns: sections?.topConcerns ?? [],
      topPositives: sections?.topPositives ?? [],
      urgentFlags: sections?.urgentFlags ?? [],
      recommendedNextSteps: sections?.recommendedNextSteps ?? [],
      followUpTesting: sections?.followUpTesting ?? [],
    };

    // Mint a fresh 30-day share link if the portal is enabled and the
    // caller wants a QR. The raw token is embedded in the QR (and in a
    // visible link below the QR) and never persisted in plaintext — only
    // its SHA-256 hash lands in `share_links.token_hash`.
    let qrDataUrl: string | undefined;
    let shareUrl: string | undefined;
    if (withQr) {
      const rawToken = crypto.randomBytes(24).toString("base64url");
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await db.insert(shareLinksTable).values({
        patientId,
        createdBy: userId,
        tokenHash,
        label: "PDF report share",
        recipientName: null,
        permissions: "read",
        expiresAt,
      });
      // Build the share URL from a trusted, server-configured base — never
      // from request Origin/Host headers, which an attacker can spoof to
      // poison the QR code embedded in the exported PDF.
      const trustedBase =
        process.env.APP_BASE_URL ??
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null);
      if (!trustedBase) {
        logger.warn(
          { patientId },
          "report-export: APP_BASE_URL/REPLIT_DEV_DOMAIN not set — skipping QR generation",
        );
        qrDataUrl = undefined;
        shareUrl = undefined;
      } else {
        shareUrl = `${trustedBase.replace(/\/+$/, "")}/share/${rawToken}`;
        qrDataUrl = await QRCode.toDataURL(shareUrl, { errorCorrectionLevel: "M", margin: 1, width: 256 });
      }
    }

    const filename = `plexara-report-${patient.displayName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${new Date().toISOString().split("T")[0]}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");

    const stream = renderReportPdf({
      patient: { displayName: patient.displayName, sex: patient.sex, dateOfBirth: patient.dateOfBirth },
      meta: {
        generatedAt: row.generatedAt,
        panelCount: row.panelCount ?? 0,
        unifiedHealthScore: row.unifiedHealthScore !== null ? Number(row.unifiedHealthScore) : null,
      },
      report: reportPayload,
      qrDataUrl,
      shareUrl,
    });
    stream.pipe(res);
  } catch (err) {
    req.log.error({ err }, "Failed to export report PDF");
    if (!res.headersSent) res.status(500).json({ error: "Failed to export report PDF" });
  }
});

export default router;
