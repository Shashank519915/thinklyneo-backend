/**
 * @fileoverview Trigger.dev project wiring: Node runtime, FFmpeg extension for crop task,
 * Prisma extension for DB access in orchestrator task, externalized `fluent-ffmpeg` bundle.
 */

import { defineConfig } from "@trigger.dev/sdk/v3";
import { ffmpeg } from "@trigger.dev/build/extensions/core";
import { prismaExtension } from "@trigger.dev/build/extensions/prisma";

/** Registers `proj_*` id, 10m max duration budget, and `./trigger` discovery for deployable tasks. */
export default defineConfig({
  project: "proj_gmfmlgyvztqvrdinkuzi",
  runtime: "node-22",
  logLevel: "log",
  maxDuration: 600, // 10 minutes max (orchestrator runs entire workflow DAG)
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 1,
    },
  },
  dirs: ["./trigger"],
  build: {
    // FFmpeg for crop task + Prisma for orchestrator DB access
    extensions: [
      ffmpeg(),
      prismaExtension({
        mode: "legacy",
        schema: "prisma/schema.prisma",
      }),
    ],
    external: ["fluent-ffmpeg"],
    // Resolve local workspace package to its TS source so esbuild bundles it inline.
    // Without this, Trigger.dev's cloud Docker build can't follow the pnpm file: symlink.
    alias: {
      "@galaxy/shared": "./shared/src/index.ts",
    },
  },
});
