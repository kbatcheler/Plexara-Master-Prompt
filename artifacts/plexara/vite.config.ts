import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// Resolve PORT lazily — it's only needed when running the dev or preview
// server. During a production build (`vite build`) the deploy pipeline
// doesn't pass PORT through, and erroring here would crash the build.
function resolvePort(): number {
  const rawPort = process.env.PORT;
  if (!rawPort) {
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }
  const n = Number(rawPort);
  if (Number.isNaN(n) || n <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  return n;
}

// BASE_PATH is baked into asset URLs at build time, so it IS needed for
// both dev and build. We fall back to "/" (the standard root mount used by
// the production deploy) when the deploy runner doesn't propagate it.
const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig(async ({ command }) => {
  const isServe = command === "serve";
  // Only resolve PORT for `vite dev` / `vite preview`. `vite build` doesn't
  // need it and the production build environment doesn't supply it.
  const port = isServe ? resolvePort() : 0;

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            await import("@replit/vite-plugin-cartographer").then((m) =>
              m.cartographer({
                root: path.resolve(import.meta.dirname, ".."),
              }),
            ),
            await import("@replit/vite-plugin-dev-banner").then((m) =>
              m.devBanner(),
            ),
          ]
        : []),
    ],
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(
          import.meta.dirname,
          "..",
          "..",
          "attached_assets",
        ),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    // The Cornerstone DICOM image-loader spawns code-split web workers
    // (lazy codec chunks for JPEG/JPEG2000/JPEG-LS/HTJ2K). Vite defaults
    // workers to the legacy IIFE output format, which Rollup refuses to use
    // with code-splitting. Switching workers to ES modules is the fix —
    // every browser we target supports module workers.
    worker: {
      format: "es",
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
