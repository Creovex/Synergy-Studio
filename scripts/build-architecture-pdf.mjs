// Builds dist/architecture.pdf from docs/ARCHITECTURE.md: the one description of how the app works, kept in the repository
// and updated with every change (AGENTS.md). The appendices of all tools and of the command line are generated from the code
// here, so they never go stale. Node built ins only; printed by the tool home's render browser (headless Chrome).
// Usage: node scripts/build-architecture-pdf.mjs [--html-only]
// Exports markdownToHtml(md) for the test (test/architecture-doc.test.mjs).
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "docs", "ARCHITECTURE.md");
const OUT_DIR = path.join(ROOT, "dist");

// ---------------------------------------------------------------- Markdown (the subset the document uses)
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// inline: `code` (short code keeps its hyphens on one line), **bold**, *italic*
export function inline(text) {
  const codes = [];
  let s = text.replace(/`([^`]+)`/g, (_, c) => {
    codes.push(`<code>${esc(c.length <= 28 ? c.replace(/-/g, "‑") : c)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = esc(s).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

const CALLOUTS = [[/^\*\*What is it\?/, "what"], [/^\*\*Why it matters/, "why"], [/^\*\*Worked example/, "example"]];

function callout(lines) {
  const text = lines.join(" ").trim();
  const kind = (CALLOUTS.find(([re]) => re.test(text)) || [null, "note"])[1];
  const m = /^\*\*([^*]+)\*\*\s*(.*)$/.exec(text);
  return m ? `<div class="box ${kind}"><div class="box-title">${inline(m[1])}</div><p>${inline(m[2])}</p></div>`
           : `<div class="box note"><p>${inline(text)}</p></div>`;
}

function table(lines) {
  const cells = (l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
  const [head, , ...rows] = lines;
  return `<table><tr>${cells(head).map((c) => `<th>${inline(c)}</th>`).join("")}</tr>${rows
    .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</table>`;
}

function list(lines) {
  const items = [];
  for (const l of lines) {
    if (/^(\d+\.|-)\s/.test(l)) items.push({ text: l.replace(/^(\d+\.|-)\s+/, ""), sub: [] });
    else if (/^\s+-\s/.test(l)) items.at(-1).sub.push(l.replace(/^\s+-\s+/, ""));
    else {                                                          // a continuation line of the last item or sub item
      const it = items.at(-1);
      if (it.sub.length) it.sub[it.sub.length - 1] += " " + l.trim(); else it.text += " " + l.trim();
    }
  }
  const tag = /^\d+\.\s/.test(lines[0]) ? "ol" : "ul";
  const sub = (i) => (i.sub.length ? `<ul>${i.sub.map((x) => `<li>${inline(x)}</li>`).join("")}</ul>` : "");
  return `<${tag}>${items.map((i) => `<li>${inline(i.text)}${sub(i)}</li>`).join("")}</${tag}>`;
}

export function markdownToHtml(md) {
  const lines = md.replace(/\r/g, "").split("\n");
  const out = [];
  let i = 0;
  const take = (test) => { const got = []; while (i < lines.length && test(lines[i])) got.push(lines[i++]); return got; };
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    if (l.startsWith("```")) {
      const lang = l.slice(3).trim(); i++;
      const body = take((x) => !x.startsWith("```")); i++;
      out.push(`<pre class="${lang === "diagram" ? "diagram" : "code"}">${esc(body.join("\n"))}</pre>`);
    } else if (/^#{1,4}\s/.test(l)) {
      const level = l.match(/^#+/)[0].length, text = l.replace(/^#+\s+/, ""); i++;
      if (level === 1) { out.push(`<section class="cover"><div class="kicker">Architecture of the whole app</div><h1>${inline(text)}</h1>`); continue; }
      if (level === 2) { out.push(`</section><section class="part"><h2>${inline(text)}</h2>`); continue; }   // every part starts a page
      out.push(`<h${level}>${inline(text)}</h${level}>`);
    } else if (l.startsWith(">")) {
      out.push(callout(take((x) => x.startsWith(">")).map((x) => x.replace(/^>\s?/, ""))));
    } else if (l.startsWith("|")) {
      out.push(table(take((x) => x.startsWith("|"))));
    } else if (/^(\d+\.|-)\s/.test(l)) {
      out.push(list(take((x) => /^(\d+\.|-)\s/.test(x) || /^\s+\S/.test(x))));
    } else {
      out.push(`<p>${inline(take((x) => x.trim() && !/^(#|>|\||```|-\s|\d+\.\s)/.test(x)).join(" "))}</p>`);
    }
  }
  return out.join("\n") + "</section>";
}

// ---------------------------------------------------------------- generated appendices
async function appendices() {
  const { TOOLS } = await import(pathToFileURL(path.join(ROOT, "mcp", "tools.mjs")).href);
  const rows = TOOLS.map((t) => {
    const req = new Set(t.required || []);
    const inputs = Object.keys(t.properties || {}).map((k) => `<code>${esc(k)}${req.has(k) ? "" : "?"}</code>`).join(", ") || "none";
    return `<tr><td><code>${t.name}</code><div class="inputs">inputs: ${inputs}</div></td><td>${esc(t.description)}</td></tr>`;
  }).join("");
  const help = spawnSync(process.execPath, [path.join(ROOT, "skills", "synergy-studio", "scripts", "studio.mjs"), "help"], { encoding: "utf8" });
  return `<section class="part appendix"><h2>Appendix A. All ${TOOLS.length} tools</h2>
<p>Each tool exactly as the server describes it to Claude, with its inputs (<code>?</code> marks an optional input), generated from the server's own definitions when this document is built.</p>
<table class="tools"><tr><th style="width:30%">Tool</th><th>Description</th></tr>${rows}</table></section>
<section class="part appendix"><h2>Appendix B. The command line</h2><p>The program's own help text (<code>node skills/synergy-studio/scripts/studio.mjs help</code>).</p>
<pre class="help">${esc((help.stdout || "") + (help.stderr || ""))}</pre></section>`;
}

const CSS = `
@page { size: Letter; margin: 0.8in 0.85in 0.85in 0.85in;
  @bottom-center { content: counter(page); font: 9pt 'Helvetica Neue', Arial, sans-serif; color: #777; }
  @top-right { content: "How Synergy Studio Makes a Video"; font: 8pt 'Helvetica Neue', Arial, sans-serif; color: #999; } }
@page :first { @bottom-center { content: none; } @top-right { content: none; } }
* { box-sizing: border-box; }
body { font-family: 'Iowan Old Style', Palatino, Georgia, serif; font-size: 10.6pt; line-height: 1.5; color: #1d1d1f; margin: 0; }
h1, h2, h3, h4, th, .kicker, .box-title { font-family: 'Helvetica Neue', Arial, sans-serif; }
h2 { font-size: 18pt; color: #0b3d63; margin: 0 0 10pt; padding-bottom: 5pt; border-bottom: 2px solid #0b3d63; }
h3 { font-size: 12.5pt; color: #0b3d63; margin: 15pt 0 5pt; break-after: avoid; }
p { margin: 0 0 7pt; } ul, ol { margin: 0 0 8pt; padding-left: 18pt; } li { margin-bottom: 3pt; }
code { font-family: Menlo, Consolas, monospace; font-size: 8.8pt; background: #f1f3f6; padding: 0 2pt; border-radius: 2pt; }
pre { font-family: Menlo, Consolas, monospace; font-size: 7.9pt; background: #f6f8fa; border: 1px solid #dde3ea; padding: 7pt 9pt; white-space: pre-wrap; line-height: 1.35; border-radius: 4pt; break-inside: avoid; }
pre.diagram { background: #f4f8fc; border-color: #b9cde0; color: #0b3d63; }
pre.help { font-size: 7.1pt; break-inside: auto; }
table { width: 100%; border-collapse: collapse; margin: 6pt 0 10pt; font-size: 9.2pt; }
th { background: #0b3d63; color: #fff; text-align: left; padding: 4pt 6pt; font-size: 9pt; }
td { border-bottom: 1px solid #dfe4ea; padding: 4pt 6pt; vertical-align: top; } tr { break-inside: avoid; }
table.tools td { font-size: 8.6pt; } table.tools .inputs { color: #666; font-size: 7.8pt; margin-top: 2pt; }
.part { break-before: page; }
.cover { min-height: 9in; display: flex; flex-direction: column; justify-content: center; }
.cover .kicker { color: #1f7a8c; letter-spacing: 2pt; text-transform: uppercase; font-size: 10pt; margin-bottom: 10pt; }
.cover h1 { font-size: 34pt; line-height: 1.1; color: #0b3d63; margin: 0 0 14pt; }
.cover p { font-size: 11.5pt; color: #333; } .cover ul { font-size: 10pt; color: #444; }
.box { border-left: 4px solid; border-radius: 3pt; padding: 7pt 10pt 4pt; margin: 9pt 0 11pt; break-inside: avoid; }
.box-title { font-weight: 700; font-size: 9.5pt; margin-bottom: 3pt; }
.box.what { background: #eef6fb; border-color: #2a7ab0; } .box.what .box-title { color: #1d5f8c; }
.box.why { background: #fff6e8; border-color: #e09a2c; } .box.why .box-title { color: #a2650b; }
.box.example { background: #eef8f1; border-color: #3c9a5f; } .box.example .box-title { color: #24713f; }
.box.note { background: #f3f3f6; border-color: #888; }
`;

function browserPath() {
  const home = process.env.SYNERGY_STUDIO_HOME || (process.platform === "darwin"
    ? path.join(process.env.HOME, "Library", "Application Support", "SynergyStudioLite")
    : process.platform === "win32" ? path.join(process.env.LOCALAPPDATA || "", "SynergyStudioLite")
    : path.join(process.env.XDG_DATA_HOME || path.join(process.env.HOME, ".local", "share"), "synergy-studio-lite"));
  try { return JSON.parse(fs.readFileSync(path.join(home, "env.json"), "utf8")).browser?.path || null; } catch { return null; }
}

async function main() {
  const md = fs.readFileSync(SOURCE, "utf8");
  const title = (/^#\s+(.+)$/m.exec(md) || [null, "Architecture"])[1];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
${markdownToHtml(md)}${await appendices()}</body></html>`;
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const htmlFile = path.join(OUT_DIR, "architecture.html");
  fs.writeFileSync(htmlFile, html);
  if (process.argv.includes("--html-only")) { console.log(`wrote ${htmlFile}`); return; }
  const chrome = browserPath();
  if (!chrome || !fs.existsSync(chrome)) { console.error("ERROR: the render browser is not installed: run studio setup (the PDF is printed with it)"); process.exit(1); }
  const pdf = path.join(OUT_DIR, "architecture.pdf");
  const r = spawnSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, pathToFileURL(htmlFile).href], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(pdf)) { console.error(`ERROR: printing failed: ${(r.stderr || "").slice(-400)}`); process.exit(1); }
  console.log(`wrote ${pdf} (${(fs.statSync(pdf).size / 1048576).toFixed(1)} MB) from docs/ARCHITECTURE.md`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
