import { describe, it, expect, beforeEach, afterEach } from "vitest";
import type * as SentryTypes from "@sentry/node";
import { scrubSentryEvent } from "../src/lib/sentry";

function makeEvent(overrides: Partial<SentryTypes.Event> = {}): SentryTypes.Event {
  return { event_id: "abc123", ...overrides };
}

describe("scrubSentryEvent", () => {
  describe("extra — PHI field names are redacted", () => {
    it("redacts firstName in extra", () => {
      const event = makeEvent({ extra: { firstName: "Alice" } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["firstName"]).toBe("[REDACTED]");
    });

    it("redacts diagnosis in extra", () => {
      const event = makeEvent({ extra: { diagnosis: "hypertension" } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["diagnosis"]).toBe("[REDACTED]");
    });

    it("redacts databaseUrl in extra (SENTRY_EXTRA_FIELDS)", () => {
      const event = makeEvent({ extra: { databaseUrl: "postgres://user:pass@host/db" } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["databaseUrl"]).toBe("[REDACTED]");
    });

    it("redacts narrative in extra", () => {
      const event = makeEvent({ extra: { narrative: "Patient had severe chest pain" } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["narrative"]).toBe("[REDACTED]");
    });
  });

  describe("extra — pattern scrubbing on string values", () => {
    it("redacts postgres connection string in a non-PHI field", () => {
      const event = makeEvent({ extra: { info: "postgres://user:secret@localhost/mydb" } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["info"]).toBe("[REDACTED]");
    });

    it("redacts mysql connection string", () => {
      const event = makeEvent({ extra: { info: "mysql://root:pw@host/db" } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["info"]).toBe("[REDACTED]");
    });

    it("redacts mongodb connection string", () => {
      const event = makeEvent({ extra: { info: "mongodb+srv://user:pw@cluster.mongodb.net/db" } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["info"]).toBe("[REDACTED]");
    });

    it("redacts raw base64 string of 40+ chars", () => {
      const b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmn"; // 40 chars
      const event = makeEvent({ extra: { token: b64 } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["token"]).toBe("[REDACTED]");
    });

    it("does NOT redact a short base64-like string (< 40 chars)", () => {
      const short = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcde"; // 31 chars
      const event = makeEvent({ extra: { ref: short } });
      const result = scrubSentryEvent(event)!;
      expect(result.extra!["ref"]).toBe(short);
    });
  });

  describe("event.message, exception, request, tags, user are preserved", () => {
    it("preserves event.message", () => {
      const event = makeEvent({ message: "Unhandled error in route handler" });
      const result = scrubSentryEvent(event)!;
      expect(result.message).toBe("Unhandled error in route handler");
    });

    it("preserves exception stack frames", () => {
      const frame = { filename: "src/routes/records.ts", lineno: 42, function: "uploadRecord" };
      const event = makeEvent({
        exception: { values: [{ type: "Error", value: "boom", stacktrace: { frames: [frame] } }] },
      });
      const result = scrubSentryEvent(event)!;
      expect(result.exception!.values![0].stacktrace!.frames![0]).toEqual(frame);
    });

    it("preserves request.method and request.url", () => {
      const event = makeEvent({ request: { method: "POST", url: "https://api.example.com/records" } });
      const result = scrubSentryEvent(event)!;
      expect(result.request!.method).toBe("POST");
      expect(result.request!.url).toBe("https://api.example.com/records");
    });

    it("preserves tags", () => {
      const event = makeEvent({ tags: { statusCode: "500", route: "/records" } });
      const result = scrubSentryEvent(event)!;
      expect(result.tags!["statusCode"]).toBe("500");
      expect(result.tags!["route"]).toBe("/records");
    });

    it("preserves user.id", () => {
      const event = makeEvent({ user: { id: "user_abc123" } });
      const result = scrubSentryEvent(event)!;
      expect(result.user!.id).toBe("user_abc123");
    });
  });

  describe("contexts — PHI scrubbed, non-PHI preserved", () => {
    it("redacts PHI key inside a context", () => {
      const event = makeEvent({
        contexts: { custom: { diagnosis: "diabetes", statusCode: 200 } },
      });
      const result = scrubSentryEvent(event)!;
      expect(result.contexts!["custom"]!["diagnosis"]).toBe("[REDACTED]");
      expect(result.contexts!["custom"]!["statusCode"]).toBe(200);
    });
  });

  describe("breadcrumbs", () => {
    it("redacts PHI in breadcrumb.data but preserves breadcrumb.message", () => {
      const event = makeEvent({
        breadcrumbs: {
          values: [
            {
              category: "pino",
              message: "Processing upload",
              level: "info",
              data: { patientId: 99, email: "alice@example.com", step: "extraction" },
            },
          ],
        },
      });
      const result = scrubSentryEvent(event)!;
      const crumb = (result.breadcrumbs as { values: SentryTypes.Breadcrumb[] }).values[0];
      expect(crumb.message).toBe("Processing upload");
      expect(crumb.data!["email"]).toBe("[REDACTED]");
      expect(crumb.data!["step"]).toBe("extraction");
    });

    it("handles breadcrumbs as a plain array", () => {
      const event = makeEvent({
        breadcrumbs: [
          { category: "http", message: "GET /health", data: { token: "secret" } },
        ] as unknown as SentryTypes.Event["breadcrumbs"],
      });
      const result = scrubSentryEvent(event)!;
      const crumb = (result.breadcrumbs as SentryTypes.Breadcrumb[])[0];
      expect(crumb.data!["token"]).toBe("[REDACTED]");
      expect(crumb.message).toBe("GET /health");
    });
  });

  describe("edge cases", () => {
    it("returns the event unchanged when extra/contexts/breadcrumbs are absent", () => {
      const event = makeEvent({ message: "clean event" });
      const result = scrubSentryEvent(event)!;
      expect(result).toBe(event);
      expect(result.message).toBe("clean event");
    });

    it("handles nested objects in extra", () => {
      const event = makeEvent({
        extra: { meta: { userId: "u1", email: "a@b.com", step: "upload" } },
      });
      const result = scrubSentryEvent(event)!;
      const meta = result.extra!["meta"] as Record<string, unknown>;
      expect(meta["email"]).toBe("[REDACTED]");
      expect(meta["step"]).toBe("upload");
    });

    it("handles arrays in extra", () => {
      const event = makeEvent({
        extra: { items: [{ email: "x@y.com" }, { step: "ok" }] },
      });
      const result = scrubSentryEvent(event)!;
      const items = result.extra!["items"] as Record<string, unknown>[];
      expect(items[0]["email"]).toBe("[REDACTED]");
      expect(items[1]["step"]).toBe("ok");
    });
  });
});
