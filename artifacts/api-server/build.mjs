import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as esbuild } from "esbuild";
import esbuildPluginPino from "esbuild-plugin-pino";
import { rm, mkdir, cp } from "node:fs/promises";

// Plugins (e.g. 'esbuild-plugin-pino') may use `require` to resolve dependencies
globalThis.require = createRequire(import.meta.url);

const artifactDir = path.dirname(fileURLToPath(import.meta.url));

async function buildAll() {
  const distDir = path.resolve(artifactDir, "dist");
  await rm(distDir, { recursive: true, force: true });

  const sharedConfig = {
    platform: "node",
    bundle: true,
    format: "esm",
    outExtension: { ".js": ".mjs" },
    logLevel: "info",
    // Some packages may not be bundleable, so we externalize them, we can add more here as needed.
    // Some of the packages below may not be imported or installed, but we're adding them in case they are in the future.
    // Examples of unbundleable packages:
    // - uses native modules and loads them dynamically (e.g. sharp)
    // - use path traversal to read files (e.g. @google-cloud/secret-manager loads sibling .proto files)
    external: [
      "*.node",
      "sharp",
      "better-sqlite3",
      "sqlite3",
      "canvas",
      "@napi-rs/canvas",
      "@napi-rs/canvas-*",
      "bcrypt",
      "argon2",
      "fsevents",
      "re2",
      "farmhash",
      "xxhash-addon",
      "bufferutil",
      "utf-8-validate",
      "ssh2",
      "cpu-features",
      "dtrace-provider",
      "isolated-vm",
      "lightningcss",
      "pg-native",
      "oracledb",
      "mongodb-client-encryption",
      "nodemailer",
      "handlebars",
      "knex",
      "typeorm",
      "protobufjs",
      "onnxruntime-node",
      "@tensorflow/*",
      "@prisma/client",
      "@mikro-orm/*",
      "@grpc/*",
      "@swc/*",
      "@aws-sdk/*",
      "@azure/*",
      "@google-cloud/*",
      "@google/*",
      "googleapis",
      "firebase-admin",
      "@parcel/watcher",
      "@sentry/profiling-node",
      "@tree-sitter/*",
      "aws-sdk",
      "classic-level",
      "dd-trace",
      "ffi-napi",
      "grpc",
      "hiredis",
      "kerberos",
      "leveldown",
      "miniflare",
      "mysql2",
      "newrelic",
      "odbc",
      "piscina",
      "realm",
      "ref-napi",
      "rocksdb",
      "sass-embedded",
      "sequelize",
      "serialport",
      "snappy",
      "tinypool",
      "usb",
      "workerd",
      "wrangler",
      "zeromq",
      "zeromq-prebuilt",
      "playwright",
      "puppeteer",
      "puppeteer-core",
      "electron",
    ],
    sourcemap: "linked",
    // Make sure packages that are cjs only (e.g. express) but are bundled continue to work in our esm output file
    banner: {
      js: `import { createRequire as __bannerCrReq } from 'node:module';
import __bannerPath from 'node:path';
import __bannerUrl from 'node:url';

globalThis.require = __bannerCrReq(import.meta.url);
globalThis.__filename = __bannerUrl.fileURLToPath(import.meta.url);
globalThis.__dirname = __bannerPath.dirname(globalThis.__filename);
    `,
    },
  };

  // Build the API server (with the pino plugin so worker bundles land in dist/)
  await esbuild({
    ...sharedConfig,
    entryPoints: [path.resolve(artifactDir, "src/index.ts")],
    outdir: distDir,
    plugins: [esbuildPluginPino({ transports: ["pino-pretty"] })],
  });

  // Build the migration runner separately so its output lands at dist/migrate.mjs
  // regardless of the entrypoint's source path. The compose `migrate` sidecar
  // runs `node dist/migrate.mjs` against /app/drizzle.
  await esbuild({
    ...sharedConfig,
    entryPoints: { migrate: path.resolve(artifactDir, "../../lib/db/src/migrate.ts") },
    outdir: distDir,
  });

  // pdfkit reads its built-in font .afm files from `<bundle>/data/*.afm` at runtime.
  // esbuild does not bundle these binary assets, so copy pdfkit's data folder into dist/.
  try {
    const pdfkitDataSrc = path.resolve(
      artifactDir,
      "../../node_modules/.pnpm/pdfkit@0.18.0/node_modules/pdfkit/js/data",
    );
    const pdfkitDataDest = path.resolve(distDir, "data");
    await mkdir(pdfkitDataDest, { recursive: true });
    await cp(pdfkitDataSrc, pdfkitDataDest, { recursive: true });
  } catch (err) {
    console.warn("[build] could not copy pdfkit data:", err.message);
  }
}

buildAll().catch((err) => {
  console.error(err);
  process.exit(1);
});
