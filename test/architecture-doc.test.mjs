// docs/ARCHITECTURE.md stays true to the code: every tool, CLI command, CLI module, Python script and server module that
// exists is named in it (AGENTS.md: every change updates the document in the same commit). Also the Markdown converter of
// scripts/build-architecture-pdf.mjs, which turns the document into the PDF.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOC = fs.readFileSync(path.join(ROOT, "docs", "ARCHITECTURE.md"), "utf8");
const SCRIPTS = path.join(ROOT, "skills", "synergy-studio", "scripts");
const missing = (names) => names.filter((n) => !DOC.includes(n));

test("every MCP tool is named in the architecture document", async () => {
  const { TOOLS } = await import(pathToFileURL(path.join(ROOT, "mcp", "tools.mjs")).href);
  assert.deepEqual(missing(TOOLS.map((t) => t.name)), []);
  assert.match(DOC, new RegExp(`\\b${TOOLS.length} tools\\b`));               // the count the document states is the real one
});

test("every CLI command, CLI module, Python script and server module is named", () => {
  const studio = fs.readFileSync(path.join(SCRIPTS, "studio.mjs"), "utf8");
  const commands = [...studio.match(/const COMMANDS = \[([\s\S]*?)\]/)[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
  assert.match(DOC, new RegExp(`\\b${commands.length} commands\\b`));
  const modules = fs.readdirSync(path.join(SCRIPTS, "lib")).filter((f) => f.endsWith(".mjs"));
  const python = fs.readdirSync(SCRIPTS).filter((f) => f.endsWith(".py"));
  const server = fs.readdirSync(path.join(ROOT, "mcp")).filter((f) => f.endsWith(".mjs"));
  assert.deepEqual(missing(modules), [], "CLI modules missing from docs/ARCHITECTURE.md");
  assert.deepEqual(missing(python), [], "Python scripts missing from docs/ARCHITECTURE.md");
  assert.deepEqual(missing(server), [], "server modules missing from docs/ARCHITECTURE.md");
  for (const c of commands) assert.ok(DOC.includes(c), `command ${c} missing`);
});

test("the stated version is the released one", () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.ok(DOC.includes(`version ${version}`), `docs/ARCHITECTURE.md should describe version ${version}`);
});

test("the converter makes the cover, a page per part, boxes, tables, lists and diagrams", async () => {
  const { markdownToHtml } = await import(pathToFileURL(path.join(ROOT, "scripts", "build-architecture-pdf.mjs")).href);
  const html = markdownToHtml(DOC);
  assert.match(html, /<section class="cover">/);
  assert.equal((html.match(/<section class="part">/g) || []).length, (DOC.match(/^## /gm) || []).length);
  assert.match(html, /<div class="box what">/);
  assert.match(html, /<div class="box why">/);
  assert.match(html, /<div class="box example">/);
  assert.match(html, /<pre class="diagram">/);
  assert.match(html, /<table><tr><th>/);
  assert.doesNotMatch(html.replace(/<code>.*?<\/code>/g, ""), /undefined|\*\*/);   // nothing unconverted outside code
  const small = markdownToHtml("# T\n\n## P\n\n- a\n  - b\n  more\n\n| x | y |\n|---|---|\n| `a-b` | **c** |\n");
  assert.match(small, /<li>a<ul><li>b more<\/li><\/ul><\/li>/);
  assert.match(small, /<td><code>a‑b<\/code><\/td><td><strong>c<\/strong><\/td>/);
});
