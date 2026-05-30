/**
 * @fileoverview Prisma CLI config: loads `.env` / `.env.local` so datasource URL resolves without shell exports.
 */

import { defineConfig } from "prisma/config";
import { config as loadEnv } from "dotenv";
import path from "path";

// Load .env so Prisma CLI picks up DATABASE_URL without needing it set in the shell
loadEnv({ path: path.resolve(process.cwd(), ".env") });
loadEnv({ path: path.resolve(process.cwd(), ".env.local"), override: true });

/** Bridges Prisma 6+ config file to `DATABASE_URL` sourced from env files above. */
export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});

