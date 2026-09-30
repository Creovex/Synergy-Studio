#!/usr/bin/env node
// Builds dist/synergy-studio.mcpb for Claude Desktop from bundle/manifest.json, mcp/ and skills/.
// Steps: copy those into a staging folder (never node_modules, tmp, reference, ledger or test), add the tool list
// to the staged manifest, validate it, pack it and validate the packed file, all with the repo's pinned mcpb
// (run through node, never npx), then list the bundle and refuse it when a forbidden folder slipped in.
// Usage: node scripts/pack-bundle.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MCPB = path.join(ROOT, "node_modules", "@anthropic-ai", "mcpb", "dist", "cli", "cli.js");
const OUT = path.join(ROOT, "dist", "synergy-studio.mcpb");
const SKIP_NAMES = new Set([".DS_Store", "__pycache__", ".pytest_cache", "node_modules", ".git"]);
const FORBIDDEN = ["node_modules", "tmp", "reference", "ledger", "test", "tests"];

function fail(message) {
  console.error(`pack-bundle: ${message}`);
  process.exit(1);
}

function run(label, command, args) {
  console.log(`$ ${label}`);
  const result = spawnSync(command, args, { encoding: "utf8", shell: false });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) fail(`${label} failed with exit code ${result.status}`);
  return result.stdout;
}

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name) || entry.name.endsWith(".pyc")) continue;
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) copyTree(source, target);
    else if (entry.isFile()) fs.copyFileSync(source, target);
  }
}

// Unpacks the finished bundle and asks its server to initialize and list the tools, as a client would.
function smokeTest(bundle) {
  const unpacked = fs.mkdtempSync(path.join(os.tmpdir(), "synergy-unpacked-"));
  try {
    run("mcpb unpack (smoke test)", process.execPath, [MCPB, "unpack", bundle, unpacked]);
    const input = [
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "pack-bundle", version: "0" } } },
      { jsonrpc: "2.0", id: 2, method: "tools/list" },
    ].map((m) => JSON.stringify(m)).join("\n");
    const result = spawnSync(process.execPath, [path.join(unpacked, "mcp", "server.mjs")], {
      input: `${input}\n`,
      encoding: "utf8",
      shell: false,
      env: { ...process.env, SYNERGY_STUDIO_HOME: path.join(unpacked, "home") },
    });
    const replies = result.stdout.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const count = replies.find((r) => r.id === 2)?.result?.tools?.length;
    if (!replies.find((r) => r.id === 1)?.result?.instructions || !count) fail("the unpacked server did not answer initialize and tools/list");
    console.log(`smoke test: the unpacked server answered initialize and lists ${count} tools`);
  } finally {
    fs.rmSync(unpacked, { recursive: true, force: true });
  }
}

if (!fs.existsSync(MCPB)) fail("node_modules/@anthropic-ai/mcpb is missing: run npm install once in the repo (dev dependencies only)");

const staging = fs.mkdtempSync(path.join(os.tmpdir(), "synergy-bundle-"));
try {
  copyTree(path.join(ROOT, "mcp"), path.join(staging, "mcp"));
  copyTree(path.join(ROOT, "skills"), path.join(staging, "skills"));
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "bundle", "manifest.json"), "utf8"));
  const { TOOLS } = await import(path.join(ROOT, "mcp", "tools.mjs"));
  manifest.tools = TOOLS.map((t) => ({ name: t.name, description: t.description }));
  fs.writeFileSync(path.join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`staged ${staging}: manifest.json, mcp/, skills/ (${manifest.tools.length} tools listed)`);

  run("mcpb validate manifest.json", process.execPath, [MCPB, "validate", path.join(staging, "manifest.json")]);
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.rmSync(OUT, { force: true });
  run("mcpb pack", process.execPath, [MCPB, "pack", staging, OUT]);
  run("mcpb info", process.execPath, [MCPB, "info", OUT]);

  const listing = run("unzip -Z1 (file list)", "/usr/bin/unzip", ["-Z1", OUT]).split("\n").filter(Boolean);
  const bad = listing.filter((f) => f.split("/").some((part) => FORBIDDEN.includes(part)));
  if (bad.length) fail(`the bundle holds forbidden paths: ${bad.slice(0, 5).join(", ")}`);
  for (const need of ["manifest.json", "mcp/server.mjs", "skills/synergy-studio/SKILL.md", "skills/synergy-studio/scripts/studio.mjs"]) {
    if (!listing.includes(need)) fail(`the bundle lacks ${need}`);
  }
  smokeTest(OUT);
  console.log(`bundle: ${OUT}\nsize: ${fs.statSync(OUT).size} bytes, ${listing.length} files`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
