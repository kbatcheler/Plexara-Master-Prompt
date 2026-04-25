import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Tests touch process.env (PHI key configuration). Forking each test file
    // into its own process keeps env mutations from leaking across suites.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    // Reasonable defaults — keep test runs fast and predictable.
    testTimeout: 10_000,
    hookTimeout: 10_000,
    reporters: process.env.CI ? ["default", "junit"] : ["default"],
    outputFile: process.env.CI ? { junit: "test-results.xml" } : undefined,
  },
});
