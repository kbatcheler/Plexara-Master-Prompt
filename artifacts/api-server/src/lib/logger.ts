import pino from "pino";
import { Writable } from "stream";
import type { SeverityLevel } from "@sentry/node";
import { addLogBreadcrumb } from "./sentry";

const isProduction = process.env.NODE_ENV === "production";

const PINO_TO_SENTRY: Record<number, SeverityLevel> = {
  10: "debug",
  20: "debug",
  30: "info",
  40: "warning",
  50: "error",
  60: "fatal",
};

// JSON.parse on every log line is acceptable at current throughput but is a
// hot-path candidate to optimise if logging becomes a bottleneck.
const sentryStream = new Writable({
  write(chunk: Buffer, _encoding, cb) {
    try {
      const log = JSON.parse(chunk.toString()) as { level: number; msg?: string };
      if (log.level < 40) { cb(); return; }
      addLogBreadcrumb(PINO_TO_SENTRY[log.level] ?? "log", log.msg ?? "");
    } catch {
      // never block the log pipeline on a parse failure
    }
    cb();
  },
});

const mainStream = isProduction
  ? pino.destination(1)
  : pino.transport({ target: "pino-pretty", options: { colorize: true } });

export const logger = pino(
  {
    level: process.env.LOG_LEVEL ?? "info",
    redact: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
    ],
  },
  pino.multistream([
    { stream: mainStream },
    { stream: sentryStream },
  ]),
);
