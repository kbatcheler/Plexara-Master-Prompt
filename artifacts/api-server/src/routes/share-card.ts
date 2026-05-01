/**
 * Enhancement E12 — Share-as-image card.
 *
 * GET /api/patients/:patientId/share-card.png
 *
 * Renders a 1080×1080 PNG suitable for pasting into WhatsApp / iMessage /
 * Instagram. Draws Plexara branding, the unified health score (large), six
 * mini-gauge dots labelled by domain, the patient's top three concerns, and
 * a footer disclaimer. When the physician portal is enabled, mints a fresh
 * 30-day share link and embeds its QR in the bottom-right corner so a
 * recipient can tap straight through to the live read-only view.
 *
 * Strictly additive: no existing routes, schemas, or response shapes are
 * touched. The image is not cached on the server side.
 */
import { Router } from "express";
import crypto from "crypto";
import QRCode from "qrcode";
import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { db } from "@workspace/db";
import {
  patientsTable,
  comprehensiveReportsTable,
  gaugesTable,
  shareLinksTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, type AuthenticatedRequest } from "../lib/auth";
import { decryptJson } from "../lib/phi-crypto";
import type { ComprehensiveReportOutput } from "../lib/reports-ai";
import { logger } from "../lib/logger";

const router = Router({ mergeParams: true });

function flagEnabled(envName: string): boolean {
  const v = process.env[envName];
  if (typeof v !== "string") return false;
  const normalised = v.trim().toLowerCase();
  return normalised === "true" || normalised === "1" || normalised === "yes" || normalised === "on";
}
const ENABLE_PHYSICIAN_PORTAL = flagEnabled("ENABLE_PHYSICIAN_PORTAL");

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Map a 0–100 score to the same colour buckets the dashboard gauges use. */
function scoreColour(score: number | null): string {
  if (score === null) return "#9CA3AF"; // muted
  if (score >= 76) return "#16A34A";    // optimal
  if (score >= 51) return "#84CC16";    // good
  if (score >= 26) return "#F59E0B";    // fair
  if (score >= 11) return "#F97316";    // poor
  return "#DC2626";                      // critical
}

function scoreBand(score: number | null): string {
  if (score === null) return "Pending";
  if (score >= 76) return "Optimal";
  if (score >= 51) return "Good";
  if (score >= 26) return "Fair";
  if (score >= 11) return "Poor";
  return "Critical";
}

/** Wrap a single line of text to fit within `maxWidth`, returning lines. */
function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  // Truncate the last line with an ellipsis if we ran out of space.
  if (lines.length === maxLines && words.join(" ").length > lines.join(" ").length) {
    let last = lines[lines.length - 1];
    while (last.length > 0 && ctx.measureText(`${last}…`).width > maxWidth) {
      last = last.slice(0, -1);
    }
    lines[lines.length - 1] = `${last}…`;
  }
  return lines;
}

router.get("/share-card.png", requireAuth, async (req, res): Promise<void> => {
  const { userId } = req as AuthenticatedRequest;
  const patientId = parseInt(req.params.patientId as string);

  if (!Number.isFinite(patientId)) {
    res.status(400).json({ error: "Invalid patient id" });
    return;
  }

  try {
    const [patient] = await db
      .select()
      .from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.accountId, userId)));
    if (!patient) {
      res.status(404).json({ error: "Patient not found" });
      return;
    }

    const [row] = await db
      .select()
      .from(comprehensiveReportsTable)
      .where(eq(comprehensiveReportsTable.patientId, patientId))
      .orderBy(desc(comprehensiveReportsTable.generatedAt))
      .limit(1);
    if (!row) {
      res.status(404).json({ error: "No comprehensive report yet — generate one first." });
      return;
    }

    const sections = decryptJson<{
      topConcerns?: string[];
    } & Partial<ComprehensiveReportOutput>>(row.sectionsJson);
    const topConcerns = (sections?.topConcerns ?? []).slice(0, 3);
    const unifiedScore = row.unifiedHealthScore !== null ? Math.round(Number(row.unifiedHealthScore)) : null;

    const gauges = await db
      .select({ domain: gaugesTable.domain, currentValue: gaugesTable.currentValue })
      .from(gaugesTable)
      .where(eq(gaugesTable.patientId, patientId));

    // Optional QR — only when the physician portal is on.
    let qrPngBuffer: Buffer | null = null;
    if (ENABLE_PHYSICIAN_PORTAL) {
      const trustedBase =
        process.env.APP_BASE_URL ??
        (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null);
      if (trustedBase) {
        const rawToken = crypto.randomBytes(24).toString("base64url");
        const tokenHash = hashToken(rawToken);
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
        await db.insert(shareLinksTable).values({
          patientId,
          createdBy: userId,
          tokenHash,
          label: "Share image",
          recipientName: null,
          permissions: "read",
          expiresAt,
        });
        const shareUrl = `${trustedBase.replace(/\/+$/, "")}/share/${rawToken}`;
        qrPngBuffer = await QRCode.toBuffer(shareUrl, {
          errorCorrectionLevel: "M",
          margin: 1,
          width: 220,
          color: { dark: "#0F172A", light: "#FFFFFFFF" },
        });
      } else {
        logger.warn(
          { patientId },
          "share-card: APP_BASE_URL/REPLIT_DEV_DOMAIN not set — skipping QR",
        );
      }
    }

    // ── Render ────────────────────────────────────────────────────────────
    const W = 1080;
    const H = 1080;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext("2d");

    // Background — soft gradient from light surface to muted blue.
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#F8FAFC");
    bg.addColorStop(1, "#E2E8F0");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Top brand bar.
    ctx.fillStyle = "#0F172A";
    ctx.font = "600 44px sans-serif";
    ctx.textBaseline = "top";
    ctx.fillText("Plexara", 60, 56);
    ctx.fillStyle = "#475569";
    ctx.font = "400 22px sans-serif";
    ctx.fillText("Your AI-powered health snapshot", 60, 110);

    // Score circle, centre-left.
    const scoreCx = 320;
    const scoreCy = 360;
    const scoreR = 170;
    const scoreColor = scoreColour(unifiedScore);

    // Track ring.
    ctx.beginPath();
    ctx.arc(scoreCx, scoreCy, scoreR, 0, Math.PI * 2);
    ctx.lineWidth = 24;
    ctx.strokeStyle = "#E5E7EB";
    ctx.stroke();

    // Filled arc (270° max sweep, starts at 135°).
    if (unifiedScore !== null) {
      const startAngle = (135 * Math.PI) / 180;
      const sweep = (270 * Math.PI) / 180 * (unifiedScore / 100);
      ctx.beginPath();
      ctx.arc(scoreCx, scoreCy, scoreR, startAngle, startAngle + sweep);
      ctx.lineWidth = 24;
      ctx.lineCap = "round";
      ctx.strokeStyle = scoreColor;
      ctx.stroke();
    }

    // Score text.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = scoreColor;
    ctx.font = "700 110px sans-serif";
    ctx.fillText(unifiedScore !== null ? String(unifiedScore) : "--", scoreCx, scoreCy - 8);
    ctx.fillStyle = "#475569";
    ctx.font = "500 24px sans-serif";
    ctx.fillText(scoreBand(unifiedScore).toUpperCase(), scoreCx, scoreCy + 70);
    ctx.fillStyle = "#64748B";
    ctx.font = "400 18px sans-serif";
    ctx.fillText("HEALTH SCORE / 100", scoreCx, scoreCy + 105);
    ctx.textAlign = "left";
    ctx.textBaseline = "top";

    // Mini-gauge dots — up to 6 along the right column.
    const dotsX = 600;
    const dotsY = 220;
    const dotRowH = 60;
    ctx.font = "500 22px sans-serif";
    const visibleGauges = gauges.slice(0, 6);
    visibleGauges.forEach((g, i) => {
      const v = g.currentValue !== null ? Math.round(Number(g.currentValue)) : null;
      const cx = dotsX + 22;
      const cy = dotsY + i * dotRowH + 22;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fillStyle = scoreColour(v);
      ctx.fill();
      ctx.fillStyle = "#0F172A";
      ctx.font = "500 22px sans-serif";
      ctx.fillText(g.domain, cx + 36, cy - 14);
      ctx.fillStyle = "#64748B";
      ctx.font = "400 18px sans-serif";
      ctx.fillText(v !== null ? `${v} / 100` : "Pending", cx + 36, cy + 8);
    });

    // Top concerns block.
    const concernsY = 600;
    ctx.fillStyle = "#0F172A";
    ctx.font = "600 28px sans-serif";
    ctx.fillText("Top concerns", 60, concernsY);
    ctx.font = "400 22px sans-serif";
    ctx.fillStyle = "#1F2937";
    if (topConcerns.length === 0) {
      ctx.fillStyle = "#64748B";
      ctx.fillText("No urgent concerns flagged.", 60, concernsY + 50);
    } else {
      let y = concernsY + 50;
      topConcerns.forEach((c) => {
        const lines = wrapText(ctx, `• ${c}`, W - 120, 2);
        lines.forEach((line) => {
          ctx.fillText(line, 60, y);
          y += 32;
        });
        y += 10;
      });
    }

    // QR + footer.
    if (qrPngBuffer) {
      const { Image } = await import("@napi-rs/canvas");
      const img = new Image();
      img.src = qrPngBuffer;
      const qrSize = 220;
      const qrX = W - qrSize - 60;
      const qrY = H - qrSize - 120;
      // White card behind the QR for scanability.
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(qrX - 12, qrY - 12, qrSize + 24, qrSize + 24);
      ctx.drawImage(img, qrX, qrY, qrSize, qrSize);
      ctx.fillStyle = "#475569";
      ctx.font = "400 16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Scan for live view", qrX + qrSize / 2, qrY + qrSize + 14);
      ctx.textAlign = "left";
    }

    ctx.fillStyle = "#64748B";
    ctx.font = "400 16px sans-serif";
    ctx.fillText(
      `Generated ${row.generatedAt instanceof Date ? row.generatedAt.toISOString().split("T")[0] : ""}  ·  Educational only — not a medical diagnosis`,
      60,
      H - 60,
    );

    const png = await canvas.encode("png");
    const filenameSafe = patient.displayName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const filename = `plexara-share-${filenameSafe}-${new Date().toISOString().split("T")[0]}.png`;

    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  } catch (err) {
    req.log.error({ err }, "Failed to render share card");
    if (!res.headersSent) res.status(500).json({ error: "Failed to render share card" });
  }
});

export default router;
