/**
 * @fileoverview Prisma CLI config: loads `.env` / `.env.local` so datasource URL resolves without shell exports.
 */

import { defineConfig } from "prisma/config";
import { config as loadEnv } from "dotenv";

// Load .env so Prisma CLI picks up DATABASE_URL without needing it set in the shell
loadEnv({ path: ".env" });
loadEnv({ path: ".env.local", override: true });

/** Bridges Prisma 6+ config file to `DATABASE_URL` sourced from env files above. */
export default defineConfig({
  schema: "./prisma/schema.prisma",
  datasource: {
    url: process.env.DATABASE_URL!,
  },
});
