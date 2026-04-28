/**
 * Comprehensive report → PDF rendering.
 *
 * Streams a clean, multi-section PDF using PDFKit. The PDF mirrors what the
 * `/report` page shows: header + executive summary + urgent flags + patient
 * narrative + clinical narrative + by-system sections + cross-panel patterns
 * + recommendations + footer with optional QR share-link.
 *
 * The `qrDataUrl` parameter is an optional already-generated QR PNG data
 * URL (`data:image/png;base64,...`) that the route hands in. When omitted,
 * the share-link block is skipped entirely. Keeping QR generation outside
 * this function lets the route layer decide whether the physician portal
 * is enabled before we ever try to mint a share link.
 */
import PDFDocument from "pdfkit";
import type { ComprehensiveReportOutput } from "./reports-ai";

export interface ReportPdfPatient {
  displayName: string;
  sex: string | null;
  dateOfBirth?: string | null;
}

export interface ReportPdfMeta {
  generatedAt: Date;
  panelCount: number;
  unifiedHealthScore: number | null;
}

export interface RenderReportPdfArgs {
  patient: ReportPdfPatient;
  meta: ReportPdfMeta;
  report: ComprehensiveReportOutput;
  /** PNG data URL produced by `qrcode.toDataURL`. Omit to skip the QR block. */
  qrDataUrl?: string;
  /** Human-readable share URL printed alongside the QR for accessibility. */
  shareUrl?: string;
}

const PAGE_MARGIN = 50;

export function renderReportPdf(args: RenderReportPdfArgs): NodeJS.ReadableStream {
  const doc = new PDFDocument({
    size: "A4",
    margin: PAGE_MARGIN,
    info: {
      Title: `Plexara Health Report — ${args.patient.displayName}`,
      Author: "Plexara",
      Subject: "Comprehensive cross-panel health report",
      CreationDate: args.meta.generatedAt,
    },
  });

  // ── Header ─────────────────────────────────────────────────────────────
  doc.fillColor("#1a1a2e").font("Helvetica-Bold").fontSize(22).text("Plexara Health Report", { align: "left" });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor("#555")
    .text(`Patient: ${args.patient.displayName}${args.patient.sex ? ` · ${args.patient.sex}` : ""}`)
    .text(`Synthesised from ${args.meta.panelCount} panel${args.meta.panelCount === 1 ? "" : "s"}`)
    .text(`Generated ${args.meta.generatedAt.toLocaleString()}`);
  doc.moveDown(0.5);
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(545, doc.y).strokeColor("#e0e0e0").stroke();
  doc.moveDown(0.8);

  // ── Unified health score + executive summary ──────────────────────────
  if (args.meta.unifiedHealthScore !== null) {
    const score = Math.round(args.meta.unifiedHealthScore);
    doc.fillColor("#7c3aed").font("Helvetica-Bold").fontSize(36)
      .text(`${score}`, { continued: true })
      .font("Helvetica").fontSize(11).fillColor("#666")
      .text(" / 100  Unified Health Score");
    doc.moveDown(0.5);
  }

  if (args.report.executiveSummary) {
    doc.fillColor("#1a1a2e").font("Helvetica").fontSize(11).text(args.report.executiveSummary, { align: "justify" });
    doc.moveDown(1);
  }

  // ── Urgent flags ──────────────────────────────────────────────────────
  if (args.report.urgentFlags && args.report.urgentFlags.length > 0) {
    sectionHeader(doc, "Urgent Flags", "#dc2626");
    args.report.urgentFlags.forEach((u) => bulletLine(doc, u, "#dc2626"));
    doc.moveDown(0.5);
  }

  // ── Patient narrative ─────────────────────────────────────────────────
  if (args.report.patientNarrative) {
    sectionHeader(doc, "For You");
    doc.fillColor("#1a1a2e").font("Helvetica").fontSize(11).text(args.report.patientNarrative, { align: "justify" });
    doc.moveDown(0.8);
  }

  // ── Clinical narrative ────────────────────────────────────────────────
  if (args.report.clinicalNarrative) {
    sectionHeader(doc, "Clinical Narrative");
    doc.fillColor("#333").font("Helvetica").fontSize(10).text(args.report.clinicalNarrative, { align: "justify" });
    doc.moveDown(0.8);
  }

  // ── By body system ────────────────────────────────────────────────────
  if (args.report.sections && args.report.sections.length > 0) {
    sectionHeader(doc, "By Body System");
    for (const s of args.report.sections) {
      // Force a page break if there isn't enough room for at least the
      // section title + first line, otherwise the system header gets
      // orphaned at the bottom of the page.
      if (doc.y > 720) doc.addPage();

      doc.fillColor("#1a1a2e").font("Helvetica-Bold").fontSize(13).text(`${s.system} — ${s.status.toUpperCase()}`);
      if (s.headline) {
        doc.fillColor("#333").font("Helvetica-Oblique").fontSize(11).text(s.headline);
      }
      doc.moveDown(0.3);
      if (s.interpretation) {
        doc.fillColor("#333").font("Helvetica").fontSize(10).text(s.interpretation, { align: "justify" });
        doc.moveDown(0.3);
      }

      if (s.keyBiomarkers && s.keyBiomarkers.length > 0) {
        doc.fillColor("#666").font("Helvetica-Bold").fontSize(9).text("Key biomarkers:");
        for (const b of s.keyBiomarkers) {
          const flag = b.flag ? ` [${b.flag}]` : "";
          const optimal = b.optimalRange ? ` (optimal ${b.optimalRange})` : "";
          doc.fillColor("#333").font("Helvetica").fontSize(9)
            .text(`  • ${b.name}: ${b.latestValue}${b.unit ? ` ${b.unit}` : ""}${optimal}${flag}`);
        }
        doc.moveDown(0.3);
      }

      if (s.recommendations && s.recommendations.length > 0) {
        doc.fillColor("#666").font("Helvetica-Bold").fontSize(9).text("Recommendations:");
        s.recommendations.forEach((r) => doc.fillColor("#333").font("Helvetica").fontSize(9).text(`  • ${r}`));
      }
      doc.moveDown(0.6);
    }
  }

  // ── Cross-panel patterns ──────────────────────────────────────────────
  if (args.report.crossPanelPatterns && args.report.crossPanelPatterns.length > 0) {
    if (doc.y > 700) doc.addPage();
    sectionHeader(doc, "Cross-Panel Patterns");
    for (const p of args.report.crossPanelPatterns) {
      doc.fillColor("#1a1a2e").font("Helvetica-Bold").fontSize(11).text(`${p.title} (${p.significance})`);
      doc.fillColor("#333").font("Helvetica").fontSize(10).text(p.description, { align: "justify" });
      if (p.biomarkersInvolved && p.biomarkersInvolved.length > 0) {
        doc.fillColor("#666").font("Helvetica-Oblique").fontSize(9).text(`Markers: ${p.biomarkersInvolved.join(", ")}`);
      }
      doc.moveDown(0.4);
    }
  }

  // ── Top concerns / positives ──────────────────────────────────────────
  if (args.report.topConcerns && args.report.topConcerns.length > 0) {
    if (doc.y > 700) doc.addPage();
    sectionHeader(doc, "Top Concerns");
    args.report.topConcerns.forEach((c) => bulletLine(doc, c));
    doc.moveDown(0.5);
  }
  if (args.report.topPositives && args.report.topPositives.length > 0) {
    sectionHeader(doc, "Top Positives", "#059669");
    args.report.topPositives.forEach((c) => bulletLine(doc, c, "#059669"));
    doc.moveDown(0.5);
  }
  if (args.report.recommendedNextSteps && args.report.recommendedNextSteps.length > 0) {
    sectionHeader(doc, "Recommended Next Steps");
    args.report.recommendedNextSteps.forEach((c) => bulletLine(doc, c));
    doc.moveDown(0.5);
  }
  if (args.report.followUpTesting && args.report.followUpTesting.length > 0) {
    sectionHeader(doc, "Follow-Up Testing");
    args.report.followUpTesting.forEach((c) => bulletLine(doc, c));
    doc.moveDown(0.5);
  }

  // ── QR share link ─────────────────────────────────────────────────────
  if (args.qrDataUrl) {
    if (doc.y > 600) doc.addPage();
    doc.moveDown(1);
    sectionHeader(doc, "Share with your clinician");
    const qrTop = doc.y;

    // pdfkit accepts a base64 buffer for embedded PNGs.
    const base64 = args.qrDataUrl.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    doc.image(buf, PAGE_MARGIN, qrTop, { width: 100, height: 100 });

    doc.fillColor("#333").font("Helvetica").fontSize(9)
      .text("Scan this QR code to share this report with your clinician.", PAGE_MARGIN + 115, qrTop + 5, { width: 380 })
      .moveDown(0.4)
      .text("Read-only access. Link expires in 30 days. Revocable from your Plexara dashboard.", { width: 380 });
    if (args.shareUrl) {
      doc.moveDown(0.4).fillColor("#7c3aed").fontSize(8).text(args.shareUrl, { width: 380, link: args.shareUrl, underline: true });
    }
    // Move past the QR block before footer.
    doc.y = Math.max(doc.y, qrTop + 110);
    doc.moveDown(0.5);
  }

  // ── Footer ────────────────────────────────────────────────────────────
  doc.moveDown(1);
  doc.moveTo(PAGE_MARGIN, doc.y).lineTo(545, doc.y).strokeColor("#e0e0e0").stroke();
  doc.moveDown(0.4);
  doc.fillColor("#999").font("Helvetica-Oblique").fontSize(8)
    .text(
      "This report is generated by Plexara, a personal health intelligence platform. It is not a medical diagnosis. Discuss findings with a qualified clinician before changing medication or treatment.",
      { align: "center", width: 495 },
    );

  doc.end();
  return doc;
}

function sectionHeader(doc: PDFKit.PDFDocument, label: string, color = "#7c3aed"): void {
  doc.fillColor(color).font("Helvetica-Bold").fontSize(13).text(label);
  doc.moveDown(0.3);
}

function bulletLine(doc: PDFKit.PDFDocument, text: string, color = "#1a1a2e"): void {
  doc.fillColor(color).font("Helvetica").fontSize(10).text(`• ${text}`, { indent: 10 });
}
