/**
 * Comprehensive report → PDF rendering.
 *
 * Streams a clean, multi-section PDF using PDFKit. The PDF mirrors what the
 * `/report` page shows: header + executive summary + urgent flags + patient
 * narrative + clinical narrative + by-system sections + cross-panel patterns
 * + recommendations + footer with optional QR share-link.
 *
 * Visual goals (kept in sync with `Report.tsx`):
 *  - Stacked hero score block ("Unified health score" label, large purple
 *    number, "out of 100" caption) with the executive summary as a sibling
 *    column on the right — same `flex items-end gap-6` rhythm as on screen.
 *  - Soft rounded "card" containers behind urgent flags, top concerns, top
 *    positives, recommended next steps, follow-up testing and each
 *    by-system section, with light fills and matching borders.
 *  - Status chips on each by-system card (top-right pill).
 *  - Hanging-indent bullets so wrapped lines align under the text, not
 *    under the bullet glyph.
 *  - Left-aligned body copy (no `justify`) so the page no longer has the
 *    river-of-whitespace look that justified PDF text gets.
 *  - Page numbers + brand line in the footer of every page.
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

// ── Layout tokens ────────────────────────────────────────────────────────
const PAGE_W = 595.28; // A4 width in pt
const PAGE_H = 841.89; // A4 height in pt
const M = 50; // page margin
const CONTENT_W = PAGE_W - 2 * M; // 495.28
const PAGE_BOTTOM = PAGE_H - M; // y past which we should page-break
const FOOTER_RESERVE = 30; // pt reserved at bottom for the page footer

// ── Color tokens (kept loosely aligned with Tailwind palette) ────────────
const C = {
  ink: "#1a1a2e",
  body: "#2d2d3a",
  muted: "#6b7280",
  faint: "#9ca3af",
  rule: "#e5e7eb",
  primary: "#7c3aed",
  primarySoft: "#f5f3ff",
  red: "#dc2626",
  redSoft: "#fef2f2",
  redBorder: "#fecaca",
  green: "#059669",
  greenSoft: "#f0fdf4",
  greenBorder: "#bbf7d0",
  amber: "#b45309",
  amberSoft: "#fffbeb",
  amberBorder: "#fde68a",
  cardBg: "#fafafa",
  cardBorder: "#e5e7eb",
} as const;

type StatusKey = "optimal" | "normal" | "borderline" | "elevated" | "low";
const STATUS_PALETTE: Record<StatusKey, { fg: string; bg: string; label: string }> = {
  optimal: { fg: C.green, bg: C.greenSoft, label: "OPTIMAL" },
  normal: { fg: C.muted, bg: "#f3f4f6", label: "NORMAL" },
  borderline: { fg: C.amber, bg: C.amberSoft, label: "BORDERLINE" },
  elevated: { fg: C.red, bg: C.redSoft, label: "ELEVATED" },
  low: { fg: C.red, bg: C.redSoft, label: "LOW" },
};

export function renderReportPdf(args: RenderReportPdfArgs): NodeJS.ReadableStream {
  const doc = new PDFDocument({
    size: "A4",
    margin: M,
    // bufferPages lets us write footers (page numbers) onto every page
    // after the body content has been fully laid out.
    bufferPages: true,
    info: {
      Title: `Plexara Health Report — ${args.patient.displayName}`,
      Author: "Plexara",
      Subject: "Comprehensive cross-panel health report",
      CreationDate: args.meta.generatedAt,
    },
  });

  // ── Header ─────────────────────────────────────────────────────────────
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(22).text("Plexara Health Report", M, M, { width: CONTENT_W });
  doc.moveDown(0.3);
  doc.font("Helvetica").fontSize(10).fillColor(C.muted)
    .text(
      `Patient: ${args.patient.displayName}${args.patient.sex ? ` · ${args.patient.sex}` : ""}`,
      { width: CONTENT_W },
    )
    .text(`Synthesised from ${args.meta.panelCount} panel${args.meta.panelCount === 1 ? "" : "s"}`, { width: CONTENT_W })
    .text(`Generated ${args.meta.generatedAt.toLocaleString()}`, { width: CONTENT_W });
  doc.moveDown(0.6);
  hr(doc);
  doc.moveDown(0.8);

  // ── Hero: unified health score + executive summary ────────────────────
  // Two-column layout: score block on the left, exec summary on the right,
  // bottom-aligned (matches `flex items-end gap-6` on screen).
  if (args.meta.unifiedHealthScore !== null || args.report.executiveSummary) {
    const scoreColW = 160;
    const gap = 24;
    const summaryColW = CONTENT_W - scoreColW - gap;
    const top = doc.y;

    let scoreBlockBottom = top;
    if (args.meta.unifiedHealthScore !== null) {
      const score = Math.round(args.meta.unifiedHealthScore);
      doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(8)
        .text("UNIFIED HEALTH SCORE", M, top, { width: scoreColW, characterSpacing: 0.5 });
      const numTop = doc.y + 2;
      doc.fillColor(C.primary).font("Helvetica-Bold").fontSize(56)
        .text(`${score}`, M, numTop, { width: scoreColW, lineGap: 0 });
      const numBottom = doc.y;
      doc.fillColor(C.muted).font("Helvetica").fontSize(9)
        .text("out of 100", M, numBottom + 2, { width: scoreColW });
      scoreBlockBottom = doc.y;
    }

    let summaryBottom = top;
    if (args.report.executiveSummary) {
      // Render summary in the right column, vertically anchored so its last
      // line aligns with the bottom of the score number (mirrors items-end).
      doc.fillColor(C.body).font("Helvetica").fontSize(10.5);
      const summaryH = doc.heightOfString(args.report.executiveSummary, { width: summaryColW, lineGap: 2 });
      const summaryTop = Math.max(top, scoreBlockBottom - summaryH);
      doc.text(args.report.executiveSummary, M + scoreColW + gap, summaryTop, {
        width: summaryColW,
        align: "left",
        lineGap: 2,
      });
      summaryBottom = doc.y;
    }

    doc.x = M;
    doc.y = Math.max(scoreBlockBottom, summaryBottom) + 18;
  }

  // ── Integrated summary (deepened section #7) ──────────────────────────
  // Big-picture cross-data synthesis. Per spec, sits AFTER the executive
  // summary so the reader gets the convergent insights before urgent flags
  // and per-narrative blocks.
  if (args.report.integratedSummary?.included) {
    deepenedSection(doc, {
      title: args.report.integratedSummary.title,
      narrative: args.report.integratedSummary.narrative,
    });
    if (args.report.integratedSummary.keyConnections?.length) {
      bulletCard(doc, {
        title: "Key connections",
        titleColor: C.ink,
        bg: C.cardBg,
        border: C.cardBorder,
        items: args.report.integratedSummary.keyConnections.map((kc) =>
          kc.dataTypes?.length ? `${kc.dataTypes.join(" · ")} — ${kc.finding}` : kc.finding,
        ),
      });
    }
    if (args.report.integratedSummary.prioritisedActionPlan?.length) {
      bulletCard(doc, {
        title: "Prioritised action plan",
        titleColor: C.primary,
        bg: C.primarySoft,
        border: C.cardBorder,
        bulletColor: C.primary,
        items: [...args.report.integratedSummary.prioritisedActionPlan]
          .sort((a, b) => a.priority - b.priority)
          .map((a) => {
            const tf = a.timeframe ? ` (${a.timeframe})` : "";
            return `${a.priority}. ${a.action}${tf} — ${a.rationale}`;
          }),
      });
    }
  }

  // ── Urgent flags (red card) ───────────────────────────────────────────
  if (args.report.urgentFlags && args.report.urgentFlags.length > 0) {
    bulletCard(doc, {
      title: "Urgent flags",
      titleColor: C.red,
      bg: C.redSoft,
      border: C.redBorder,
      bulletColor: C.red,
      items: args.report.urgentFlags,
    });
  }

  // ── Patient narrative ─────────────────────────────────────────────────
  if (args.report.patientNarrative) {
    sectionLabel(doc, "FOR YOU");
    paragraph(doc, args.report.patientNarrative, { fontSize: 11, color: C.ink, lineGap: 2.5 });
    doc.moveDown(0.6);
  }

  // ── Clinical narrative ────────────────────────────────────────────────
  if (args.report.clinicalNarrative) {
    sectionLabel(doc, "CLINICAL NARRATIVE");
    paragraph(doc, args.report.clinicalNarrative, { fontSize: 10, color: C.body, lineGap: 2 });
    doc.moveDown(0.6);
  }

  // ── By body system (one card per system) ──────────────────────────────
  if (args.report.sections && args.report.sections.length > 0) {
    sectionLabel(doc, "BY BODY SYSTEM");
    for (const s of args.report.sections) {
      systemCard(doc, s);
    }
    doc.moveDown(0.2);
  }

  // ── Deepened conditional sections (1-6) ───────────────────────────────
  // Per spec these sit AFTER the body-system breakdown and BEFORE the
  // cross-panel patterns. Each is gated on `included === true`; absent
  // data types simply skip rendering.
  if (args.report.bodyComposition?.included) {
    deepenedSection(doc, {
      title: args.report.bodyComposition.title,
      narrative: args.report.bodyComposition.narrative,
      recommendations: args.report.bodyComposition.recommendations,
    });
  }
  if (args.report.imagingSummary?.included) {
    deepenedSection(doc, {
      title: args.report.imagingSummary.title,
      narrative: args.report.imagingSummary.narrative,
      recommendations: args.report.imagingSummary.recommendations,
    });
  }
  if (args.report.cancerSurveillance?.included) {
    deepenedSection(doc, {
      title: args.report.cancerSurveillance.title,
      narrative: args.report.cancerSurveillance.narrative,
      recommendations: args.report.cancerSurveillance.recommendations,
    });
    if (args.report.cancerSurveillance.overallAssessment) {
      paragraph(doc, `Overall assessment: ${args.report.cancerSurveillance.overallAssessment}`, {
        fontSize: 10, color: C.body, lineGap: 1.5,
      });
      doc.moveDown(0.4);
    }
  }
  if (args.report.pharmacogenomicProfile?.included) {
    deepenedSection(doc, {
      title: args.report.pharmacogenomicProfile.title,
      narrative: args.report.pharmacogenomicProfile.narrative,
      recommendations: args.report.pharmacogenomicProfile.recommendations,
    });
    if (args.report.pharmacogenomicProfile.drugAlerts?.length) {
      bulletCard(doc, {
        title: "Drug alerts",
        titleColor: C.amber,
        bg: C.amberSoft,
        border: C.amberBorder,
        bulletColor: C.amber,
        items: args.report.pharmacogenomicProfile.drugAlerts.map(
          (d) => `${d.drug} (${d.gene}) — ${d.severity.toUpperCase()}: ${d.recommendation}`,
        ),
      });
    }
    if (args.report.pharmacogenomicProfile.currentMedicationAssessment) {
      paragraph(
        doc,
        `Current medications: ${args.report.pharmacogenomicProfile.currentMedicationAssessment}`,
        { fontSize: 10, color: C.body, lineGap: 1.5 },
      );
      doc.moveDown(0.4);
    }
  }
  if (args.report.wearablePhysiology?.included) {
    deepenedSection(doc, {
      title: args.report.wearablePhysiology.title,
      narrative: args.report.wearablePhysiology.narrative,
      recommendations: args.report.wearablePhysiology.recommendations,
    });
  }
  if (args.report.metabolomicAssessment?.included) {
    deepenedSection(doc, {
      title: args.report.metabolomicAssessment.title,
      narrative: args.report.metabolomicAssessment.narrative,
      recommendations: args.report.metabolomicAssessment.recommendations,
    });
    if (args.report.metabolomicAssessment.gutBrainAxis) {
      paragraph(doc, `Gut–brain axis: ${args.report.metabolomicAssessment.gutBrainAxis}`, {
        fontSize: 10, color: C.body, lineGap: 1.5,
      });
      doc.moveDown(0.4);
    }
  }

  // ── Cross-panel patterns ──────────────────────────────────────────────
  if (args.report.crossPanelPatterns && args.report.crossPanelPatterns.length > 0) {
    sectionLabel(doc, "CROSS-PANEL PATTERNS");
    for (const p of args.report.crossPanelPatterns) {
      patternCard(doc, p);
    }
    doc.moveDown(0.2);
  }

  // ── Two-up cards: top concerns / top positives ────────────────────────
  twoUp(
    doc,
    args.report.topConcerns?.length
      ? { title: "Top concerns", titleColor: C.ink, bg: C.cardBg, border: C.cardBorder, items: args.report.topConcerns }
      : null,
    args.report.topPositives?.length
      ? {
          title: "What's going well",
          titleColor: C.green,
          bg: C.greenSoft,
          border: C.greenBorder,
          bulletColor: C.green,
          items: args.report.topPositives,
        }
      : null,
  );

  // ── Two-up cards: recommended next steps / follow-up testing ──────────
  twoUp(
    doc,
    args.report.recommendedNextSteps?.length
      ? {
          title: "Recommended next steps",
          titleColor: C.ink,
          bg: C.cardBg,
          border: C.cardBorder,
          items: args.report.recommendedNextSteps,
        }
      : null,
    args.report.followUpTesting?.length
      ? {
          title: "Follow-up testing",
          titleColor: C.ink,
          bg: C.cardBg,
          border: C.cardBorder,
          items: args.report.followUpTesting,
        }
      : null,
  );

  // ── QR share link ─────────────────────────────────────────────────────
  if (args.qrDataUrl) {
    ensureSpace(doc, 140);
    sectionLabel(doc, "SHARE WITH YOUR CLINICIAN");
    const qrTop = doc.y;
    const base64 = args.qrDataUrl.replace(/^data:image\/png;base64,/, "");
    const buf = Buffer.from(base64, "base64");
    doc.image(buf, M, qrTop, { width: 100, height: 100 });

    const textX = M + 115;
    const textW = CONTENT_W - 115;
    doc.fillColor(C.body).font("Helvetica").fontSize(10)
      .text("Scan this QR code to share this report with your clinician.", textX, qrTop + 6, { width: textW });
    doc.moveDown(0.4)
      .fillColor(C.muted).fontSize(9)
      .text("Read-only access. Link expires in 30 days. Revocable from your Plexara dashboard.", textX, doc.y, { width: textW });
    if (args.shareUrl) {
      doc.moveDown(0.4)
        .fillColor(C.primary).fontSize(8.5)
        .text(args.shareUrl, textX, doc.y, { width: textW, link: args.shareUrl, underline: true });
    }
    doc.x = M;
    doc.y = Math.max(doc.y, qrTop + 110);
    doc.moveDown(0.6);
  }

  // ── Disclaimer (above per-page footer) ────────────────────────────────
  ensureSpace(doc, 40);
  hr(doc);
  doc.moveDown(0.4);
  doc.fillColor(C.faint).font("Helvetica-Oblique").fontSize(8)
    .text(
      "This report is generated by Plexara, a personal health intelligence platform. It is not a medical diagnosis. Discuss findings with a qualified clinician before changing medication or treatment.",
      M,
      doc.y,
      { align: "center", width: CONTENT_W },
    );

  // ── Per-page footer (drawn after body completes) ──────────────────────
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const footY = PAGE_H - M + 14;
    doc.fillColor(C.faint).font("Helvetica").fontSize(8)
      .text("Plexara Health Report", M, footY, { width: CONTENT_W / 2, align: "left", lineBreak: false });
    doc.text(
      `Page ${i + 1} of ${range.count}`,
      M + CONTENT_W / 2,
      footY,
      { width: CONTENT_W / 2, align: "right", lineBreak: false },
    );
  }

  doc.end();
  return doc;
}

// ─────────────────────────────────────────────────────────────────────────
// Layout helpers
// ─────────────────────────────────────────────────────────────────────────

function hr(doc: PDFKit.PDFDocument): void {
  doc.moveTo(M, doc.y).lineTo(M + CONTENT_W, doc.y).strokeColor(C.rule).lineWidth(0.5).stroke();
}

function sectionLabel(doc: PDFKit.PDFDocument, label: string): void {
  ensureSpace(doc, 24);
  doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(9)
    .text(label, M, doc.y, { width: CONTENT_W, characterSpacing: 0.6 });
  doc.moveDown(0.35);
}

function paragraph(
  doc: PDFKit.PDFDocument,
  text: string,
  opts: { fontSize: number; color: string; lineGap?: number },
): void {
  doc.fillColor(opts.color).font("Helvetica").fontSize(opts.fontSize)
    .text(text, M, doc.y, { width: CONTENT_W, align: "left", lineGap: opts.lineGap ?? 1.5 });
}

/**
 * Render a deepened conditional section: title (as section label) +
 * narrative paragraph + optional recommendations bullet card. The title
 * comes from the AI's section title (uppercased to match house style)
 * so we don't hardcode any of the seven section names here.
 */
function deepenedSection(
  doc: PDFKit.PDFDocument,
  args: { title: string; narrative: string; recommendations?: string[] },
): void {
  if (!args.title && !args.narrative) return;
  if (args.title) {
    sectionLabel(doc, args.title.toUpperCase());
  }
  if (args.narrative) {
    paragraph(doc, args.narrative, { fontSize: 10, color: C.body, lineGap: 2 });
    doc.moveDown(0.5);
  }
  if (args.recommendations && args.recommendations.length > 0) {
    bulletCard(doc, {
      title: "Recommendations",
      titleColor: C.ink,
      bg: C.cardBg,
      border: C.cardBorder,
      items: args.recommendations,
    });
  } else {
    doc.moveDown(0.2);
  }
}

function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  if (doc.y + needed > PAGE_BOTTOM - FOOTER_RESERVE) doc.addPage();
}

interface BulletCardArgs {
  title: string;
  titleColor: string;
  bg: string;
  border: string;
  bulletColor?: string;
  items: string[];
}

/**
 * Renders a rounded card containing a small title and a vertical list of
 * hanging-indent bullets. Card height is computed up front so we can draw
 * the rectangle first and overlay the text on top.
 */
function bulletCard(doc: PDFKit.PDFDocument, args: BulletCardArgs): void {
  const padX = 14;
  const padY = 12;
  const innerW = CONTENT_W - 2 * padX;
  const titleSize = 10.5;
  const titleGap = 6;
  const bulletColX = M + padX;
  const textColX = bulletColX + 12;
  const textW = innerW - 12;

  // Measure heights
  doc.font("Helvetica-Bold").fontSize(titleSize);
  const titleH = doc.heightOfString(args.title, { width: innerW });

  doc.font("Helvetica").fontSize(10);
  const itemHeights = args.items.map((it) => doc.heightOfString(it, { width: textW, lineGap: 1.5 }));
  const itemsH = itemHeights.reduce((a, b) => a + b, 0) + (args.items.length - 1) * 5;

  const totalH = padY + titleH + titleGap + itemsH + padY;

  // Page-break if it won't fit.
  if (doc.y + totalH > PAGE_BOTTOM - FOOTER_RESERVE) {
    doc.addPage();
  }

  const cardY = doc.y;

  // Fill + stroke.
  doc.save();
  doc.roundedRect(M, cardY, CONTENT_W, totalH, 8).fillColor(args.bg).fill();
  doc.roundedRect(M, cardY, CONTENT_W, totalH, 8).strokeColor(args.border).lineWidth(0.8).stroke();
  doc.restore();

  // Title
  doc.fillColor(args.titleColor).font("Helvetica-Bold").fontSize(titleSize)
    .text(args.title, M + padX, cardY + padY, { width: innerW });

  // Bulleted items with hanging indent.
  let yCursor = cardY + padY + titleH + titleGap;
  const dotColor = args.bulletColor ?? args.titleColor;
  args.items.forEach((it, i) => {
    doc.fillColor(dotColor).font("Helvetica-Bold").fontSize(10)
      .text("•", bulletColX, yCursor, { width: 10, lineBreak: false });
    doc.fillColor(C.body).font("Helvetica").fontSize(10)
      .text(it, textColX, yCursor, { width: textW, lineGap: 1.5 });
    yCursor += itemHeights[i] + (i < args.items.length - 1 ? 5 : 0);
  });

  doc.x = M;
  doc.y = cardY + totalH + 12;
}

/**
 * Render two cards side-by-side. Either side may be null (then the other
 * card spans full width). When both are present, each occupies half the
 * content width with a small gap.
 */
function twoUp(doc: PDFKit.PDFDocument, left: BulletCardArgs | null, right: BulletCardArgs | null): void {
  if (!left && !right) return;
  if (!left || !right) {
    bulletCard(doc, (left ?? right)!);
    return;
  }

  // Render side-by-side: measure both heights, draw each in its column,
  // advance doc.y to the taller one.
  const gap = 12;
  const colW = (CONTENT_W - gap) / 2;
  const padX = 12;
  const padY = 11;
  const innerW = colW - 2 * padX;
  const textW = innerW - 12;

  const measure = (a: BulletCardArgs): { h: number; itemHeights: number[]; titleH: number } => {
    doc.font("Helvetica-Bold").fontSize(10);
    const titleH = doc.heightOfString(a.title, { width: innerW });
    doc.font("Helvetica").fontSize(9.5);
    const itemHeights = a.items.map((it) => doc.heightOfString(it, { width: textW, lineGap: 1.4 }));
    const itemsH = itemHeights.reduce((s, x) => s + x, 0) + (a.items.length - 1) * 4;
    return { h: padY + titleH + 5 + itemsH + padY, itemHeights, titleH };
  };

  const ml = measure(left);
  const mr = measure(right);
  const totalH = Math.max(ml.h, mr.h);

  if (doc.y + totalH > PAGE_BOTTOM - FOOTER_RESERVE) doc.addPage();
  const cardY = doc.y;

  const drawCol = (a: BulletCardArgs, m: typeof ml, x: number) => {
    doc.save();
    doc.roundedRect(x, cardY, colW, totalH, 7).fillColor(a.bg).fill();
    doc.roundedRect(x, cardY, colW, totalH, 7).strokeColor(a.border).lineWidth(0.8).stroke();
    doc.restore();

    doc.fillColor(a.titleColor).font("Helvetica-Bold").fontSize(10)
      .text(a.title, x + padX, cardY + padY, { width: innerW });

    let yc = cardY + padY + m.titleH + 5;
    const dot = a.bulletColor ?? a.titleColor;
    a.items.forEach((it, i) => {
      doc.fillColor(dot).font("Helvetica-Bold").fontSize(9.5)
        .text("•", x + padX, yc, { width: 10, lineBreak: false });
      doc.fillColor(C.body).font("Helvetica").fontSize(9.5)
        .text(it, x + padX + 12, yc, { width: textW, lineGap: 1.4 });
      yc += m.itemHeights[i] + (i < a.items.length - 1 ? 4 : 0);
    });
  };

  drawCol(left, ml, M);
  drawCol(right, mr, M + colW + gap);

  doc.x = M;
  doc.y = cardY + totalH + 12;
}

function patternCard(
  doc: PDFKit.PDFDocument,
  p: { title: string; description: string; significance: string; biomarkersInvolved?: string[] },
): void {
  const padX = 14;
  const padY = 11;
  const innerW = CONTENT_W - 2 * padX;
  const sig = (p.significance || "").toLowerCase();
  const palette =
    sig === "concerning" || sig === "high"
      ? { bg: C.redSoft, border: C.redBorder, fg: C.red }
      : sig === "noteworthy" || sig === "moderate"
      ? { bg: C.amberSoft, border: C.amberBorder, fg: C.amber }
      : { bg: C.cardBg, border: C.cardBorder, fg: C.muted };

  doc.font("Helvetica-Bold").fontSize(10.5);
  const titleH = doc.heightOfString(p.title, { width: innerW - 80 });
  doc.font("Helvetica").fontSize(10);
  const descH = doc.heightOfString(p.description, { width: innerW, lineGap: 1.5 });
  let markersH = 0;
  if (p.biomarkersInvolved && p.biomarkersInvolved.length > 0) {
    doc.font("Helvetica-Oblique").fontSize(9);
    markersH = doc.heightOfString(`Markers: ${p.biomarkersInvolved.join(", ")}`, { width: innerW }) + 4;
  }
  const totalH = padY + titleH + 4 + descH + markersH + padY;

  if (doc.y + totalH > PAGE_BOTTOM - FOOTER_RESERVE) doc.addPage();
  const cardY = doc.y;

  doc.save();
  doc.roundedRect(M, cardY, CONTENT_W, totalH, 7).fillColor(palette.bg).fill();
  doc.roundedRect(M, cardY, CONTENT_W, totalH, 7).strokeColor(palette.border).lineWidth(0.8).stroke();
  doc.restore();

  // Title left + significance chip right
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(10.5)
    .text(p.title, M + padX, cardY + padY, { width: innerW - 80 });

  const chipLabel = (p.significance || "").toUpperCase();
  if (chipLabel) {
    doc.font("Helvetica-Bold").fontSize(8);
    const chipW = Math.max(50, doc.widthOfString(chipLabel) + 14);
    const chipH = 14;
    const chipX = M + CONTENT_W - padX - chipW;
    const chipY = cardY + padY;
    doc.save();
    doc.roundedRect(chipX, chipY, chipW, chipH, 7).fillColor("#ffffff").fill();
    doc.roundedRect(chipX, chipY, chipW, chipH, 7).strokeColor(palette.border).lineWidth(0.6).stroke();
    doc.restore();
    doc.fillColor(palette.fg).font("Helvetica-Bold").fontSize(7.5)
      .text(chipLabel, chipX, chipY + 3.5, { width: chipW, align: "center", lineBreak: false, characterSpacing: 0.4 });
  }

  let yc = cardY + padY + titleH + 4;
  doc.fillColor(C.body).font("Helvetica").fontSize(10)
    .text(p.description, M + padX, yc, { width: innerW, align: "left", lineGap: 1.5 });
  yc = doc.y;

  if (p.biomarkersInvolved && p.biomarkersInvolved.length > 0) {
    doc.fillColor(C.muted).font("Helvetica-Oblique").fontSize(9)
      .text(`Markers: ${p.biomarkersInvolved.join(", ")}`, M + padX, yc + 4, { width: innerW });
  }

  doc.x = M;
  doc.y = cardY + totalH + 10;
}

function systemCard(
  doc: PDFKit.PDFDocument,
  s: NonNullable<ComprehensiveReportOutput["sections"]>[number],
): void {
  const padX = 14;
  const padY = 12;
  const innerW = CONTENT_W - 2 * padX;
  const statusKey = (s.status as StatusKey) in STATUS_PALETTE ? (s.status as StatusKey) : "normal";
  const palette = STATUS_PALETTE[statusKey];

  // Measure ahead so we know whether to page-break.
  doc.font("Helvetica-Bold").fontSize(12.5);
  const titleH = doc.heightOfString(s.system, { width: innerW - 90 });

  let headlineH = 0;
  if (s.headline) {
    doc.font("Helvetica-Oblique").fontSize(10.5);
    headlineH = doc.heightOfString(s.headline, { width: innerW, lineGap: 1.5 }) + 4;
  }

  let interpH = 0;
  if (s.interpretation) {
    doc.font("Helvetica").fontSize(10);
    interpH = doc.heightOfString(s.interpretation, { width: innerW, lineGap: 1.5 }) + 6;
  }

  // Biomarker table height
  let tableH = 0;
  const hasBiomarkers = s.keyBiomarkers && s.keyBiomarkers.length > 0;
  if (hasBiomarkers) {
    tableH = 16 + s.keyBiomarkers.length * 14 + 6;
  }

  // Recommendations height
  let recsH = 0;
  if (s.recommendations && s.recommendations.length > 0) {
    doc.font("Helvetica-Bold").fontSize(8.5);
    recsH += doc.heightOfString("RECOMMENDATIONS", { width: innerW }) + 3;
    doc.font("Helvetica").fontSize(9.5);
    for (const r of s.recommendations) {
      recsH += doc.heightOfString(r, { width: innerW - 12, lineGap: 1.4 }) + 3;
    }
  }

  const totalH = padY + titleH + headlineH + interpH + tableH + recsH + padY;

  if (doc.y + totalH > PAGE_BOTTOM - FOOTER_RESERVE) doc.addPage();
  const cardY = doc.y;

  // Card background — very light tinted by status (so it's clear at a
  // glance which systems need attention) but with a soft neutral feel.
  doc.save();
  doc.roundedRect(M, cardY, CONTENT_W, totalH, 8).fillColor(palette.bg).fill();
  doc.roundedRect(M, cardY, CONTENT_W, totalH, 8).strokeColor(C.cardBorder).lineWidth(0.8).stroke();
  doc.restore();

  // Title + status chip
  doc.fillColor(C.ink).font("Helvetica-Bold").fontSize(12.5)
    .text(s.system, M + padX, cardY + padY, { width: innerW - 90 });

  doc.font("Helvetica-Bold").fontSize(7.5);
  const chipLabel = palette.label;
  const chipW = Math.max(60, doc.widthOfString(chipLabel) + 14);
  const chipH = 15;
  const chipX = M + CONTENT_W - padX - chipW;
  const chipY = cardY + padY + 1;
  doc.save();
  doc.roundedRect(chipX, chipY, chipW, chipH, 7.5).fillColor("#ffffff").fill();
  doc.roundedRect(chipX, chipY, chipW, chipH, 7.5).strokeColor(palette.fg).lineWidth(0.6).stroke();
  doc.restore();
  doc.fillColor(palette.fg).font("Helvetica-Bold").fontSize(7.5)
    .text(chipLabel, chipX, chipY + 4, { width: chipW, align: "center", lineBreak: false, characterSpacing: 0.5 });

  let yc = cardY + padY + titleH;

  if (s.headline) {
    doc.fillColor(C.body).font("Helvetica-Oblique").fontSize(10.5)
      .text(s.headline, M + padX, yc, { width: innerW, lineGap: 1.5 });
    yc = doc.y + 4;
  }

  if (s.interpretation) {
    doc.fillColor(C.body).font("Helvetica").fontSize(10)
      .text(s.interpretation, M + padX, yc, { width: innerW, align: "left", lineGap: 1.5 });
    yc = doc.y + 6;
  }

  // Biomarker mini-table (column layout)
  if (hasBiomarkers) {
    const cols = [
      { label: "Biomarker", w: 0.35 },
      { label: "Latest", w: 0.20 },
      { label: "Optimal", w: 0.20 },
      { label: "Flag", w: 0.25 },
    ];
    const colXs: number[] = [];
    let acc = M + padX;
    for (const c of cols) {
      colXs.push(acc);
      acc += c.w * innerW;
    }

    // Header row
    doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(8);
    cols.forEach((c, i) => {
      doc.text(c.label.toUpperCase(), colXs[i], yc, { width: c.w * innerW - 4, lineBreak: false, characterSpacing: 0.4 });
    });
    yc += 11;
    doc.moveTo(M + padX, yc).lineTo(M + padX + innerW, yc).strokeColor(C.cardBorder).lineWidth(0.4).stroke();
    yc += 4;

    doc.font("Helvetica").fontSize(9);
    for (const b of s.keyBiomarkers) {
      const valueText = `${b.latestValue}${b.unit ? ` ${b.unit}` : ""}`;
      const flagColor =
        b.flag === "urgent" ? C.red
        : b.flag === "watch" ? C.amber
        : b.flag === "optimal" ? C.green
        : C.muted;

      doc.fillColor(C.ink).text(b.name, colXs[0], yc, { width: cols[0].w * innerW - 6, lineBreak: false });
      doc.fillColor(C.body).text(valueText, colXs[1], yc, { width: cols[1].w * innerW - 6, lineBreak: false });
      doc.fillColor(C.muted).text(b.optimalRange ?? "—", colXs[2], yc, { width: cols[2].w * innerW - 6, lineBreak: false });
      doc.fillColor(flagColor).text(b.flag ?? "—", colXs[3], yc, { width: cols[3].w * innerW - 6, lineBreak: false });
      yc += 14;
    }
    yc += 2;
  }

  // Recommendations
  if (s.recommendations && s.recommendations.length > 0) {
    doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(8.5)
      .text("RECOMMENDATIONS", M + padX, yc, { width: innerW, characterSpacing: 0.5 });
    yc = doc.y + 3;
    for (const r of s.recommendations) {
      doc.fillColor(C.muted).font("Helvetica-Bold").fontSize(9.5)
        .text("•", M + padX, yc, { width: 10, lineBreak: false });
      doc.fillColor(C.body).font("Helvetica").fontSize(9.5)
        .text(r, M + padX + 12, yc, { width: innerW - 12, lineGap: 1.4 });
      yc = doc.y + 3;
    }
  }

  doc.x = M;
  doc.y = cardY + totalH + 10;
}
