// The plugin, the Claude Desktop bundle, the server and package.json carry one version. Claude Code only updates an
// installed plugin when this number changes, so every release raises it in all four places.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

test("one version everywhere", async () => {
  const { SERVER_VERSION } = await import(path.join(ROOT, "mcp", "context.mjs"));
  const versions = { plugin: json(".claude-plugin/plugin.json").version, bundle: json("bundle/manifest.json").version, server: SERVER_VERSION, package: json("package.json").version };
  assert.equal(new Set(Object.values(versions)).size, 1, JSON.stringify(versions));
});
