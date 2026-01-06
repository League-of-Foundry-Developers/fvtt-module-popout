#!/usr/bin/env node
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");

const API_URL = "https://foundryvtt.com/_api/packages/release_version/";

function loadModuleJson() {
  const path = join(rootDir, "module.json");
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function release({ version, dryRun }) {
  const module = loadModuleJson();
  const token = process.env.FOUNDRY_VTT_API_KEY;

  if (!token) {
    console.error("Error: FOUNDRY_VTT_API_KEY environment variable not set");
    process.exit(1);
  }

  // Use the manifest URL from module.json (always points to master)
  const manifest = module.manifest;

  const payload = {
    id: module.id,
    ...(dryRun && { "dry-run": true }),
    release: {
      version,
      manifest,
      notes: `https://github.com/League-of-Foundry-Developers/fvtt-module-popout/releases/tag/v${version}`,
      compatibility: module.compatibility,
    },
  };

  console.log(`${dryRun ? "[DRY-RUN] " : ""}Submitting release to Foundry...`);
  console.log(`  Package: ${module.id}`);
  console.log(`  Version: ${version}`);
  console.log(`  Manifest: ${manifest}`);
  console.log(`  Compatibility: ${JSON.stringify(module.compatibility)}`);

  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
    },
    body: JSON.stringify(payload),
  });

  const result = await response.json();

  if (result.status === "error") {
    console.error("Error from Foundry API:", JSON.stringify(result, null, 2));
    process.exit(1);
  }

  console.log("Success:", result.message || result.page);
  return result;
}

// CLI
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const versionIdx = args.indexOf("--version");

if (versionIdx === -1) {
  console.error("Usage: foundry-release.js --version <ver> [--dry-run]");
  process.exit(1);
}

const version = args[versionIdx + 1];

release({ version, dryRun });
