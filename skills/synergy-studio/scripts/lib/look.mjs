import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKILL, LOOKS, die, say, run, env, hf, readJSON, copy, needFile, projDir } from "./common.mjs";

export const USAGE = "look <dir> --from <image or video …> | look <dir> --card <paper|midnight|bold|luxe>";

// every variable a look defines (LITE 9.2, plus --glow which looks.css uses for the background light)
export const LOOK_VARS = ["--bg", "--bg2", "--glow", "--ink", "--muted", "--line", "--card", "--accent", "--accent2", "--accent3", "--accent4",
  "--soft", "--soft2", "--soft3", "--ok", "--bad"];
// the bundled fonts compose copies into comp/fonts/ (compose.mjs); the card page needs the same files next to it
const FONTS = [["@fontsource/inter", "inter", [400, 500, 600, 700]], ["@fontsource/manrope", "manrope", [700, 800]],
  ["@fontsource/cormorant-garamond", "cormorant-garamond", [400, 500, 600, 700]], ["@fontsource/jost", "jost", [300, 400, 500]]];
// the file types look.py reads (its IMAGE_EXT and VIDEO_EXT; a test keeps the two lists equal)
export const IMAGE_EXT = [".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tif", ".tiff"];
export const VIDEO_EXT = [".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"];
const GRAIN_SVG = /<svg class="grain-overlay"[\s\S]*?<\/svg>/;

// `look <dir> --from a b c` or `look <dir> --card paper`; throws an Error with a plain message
export function parseLookArgs(argv) {
  let dir = null, card = null; const from = []; let mode = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") { mode = "from"; continue; }
    if (a === "--card") { mode = null; card = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true; continue; }
    if (a.startsWith("--")) throw new Error(`unknown flag ${a}. Usage: studio ${USAGE}`);
    if (mode === "from") from.push(a); else if (dir === null) dir = a; else throw new Error(`unexpected argument "${a}". Usage: studio ${USAGE}`);
  }
  if (!dir) throw new Error(`give the project folder first. Usage: studio ${USAGE}`);
  if (card === true) throw new Error(`--card needs a look name: ${LOOKS.join(", ")}`);
  if (card !== null && !LOOKS.includes(card)) throw new Error(`--card must be one of ${LOOKS.join(", ")} (got "${card}")`);
  if (card !== null && from.length) throw new Error("use --from or --card, not both (--card draws a built in look without measuring)");
  if (card === null && !from.length) throw new Error(`give --from with at least one image or video, or --card with a look name. Usage: studio ${USAGE}`);
  return { dir, from, card };
}

// the first input that is neither an image nor a video, as one plain sentence; null when all are usable
export function unsupportedInput(files) {
  const bad = files.find(f => ![...IMAGE_EXT, ...VIDEO_EXT].includes(path.extname(f).toLowerCase()));
  return bad === undefined ? null : `${path.basename(bad)} is not an image or a video that look can read (images: ${IMAGE_EXT.join(" ")}; videos: ${VIDEO_EXT.join(" ")})`;
}

// which look variables a look.css leaves undefined inside its #root rule (the file must win over looks.css whatever data-look says)
export function lookCssProblems(css) {
  const problems = [];
  const rule = css.replace(/\/\*[\s\S]*?\*\//g, "").match(/#root\s*,\s*#root\[data-look\]\s*\{([^}]*)\}/);
  if (!rule) return ["no `#root, #root[data-look] { ... }` rule: the variables would lose to looks.css on a page with another data-look"];
  for (const v of LOOK_VARS) if (!new RegExp(`${v}\\s*:`).test(rule[1])) problems.push(`${v} is not defined`);
  return problems;
}

// the card page for one look; `look` is the data-look value, `css` the text of a custom look.css or null
export function cardHtml(template, look, css) {
  let svg = "";
  if (css !== null && /\.grain-overlay\s*\{/.test(css)) {
    const m = css.match(GRAIN_SVG);
    if (!m) throw new Error("look.css styles .grain-overlay but holds no grain overlay markup");
    svg = m[0];
  }
  return template.replaceAll("{{LOOK}}", look).replaceAll("{{LOOKCSS}}", css !== null ? '<link rel="stylesheet" href="look.css">' : "").replaceAll("{{GRAIN}}", svg);
}

// one snapshot of the card with HyperFrames, saved as a JPEG at `out`
export function renderCard(e, look, cssFile, out) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "look-card-"));
  try {
    const css = cssFile ? fs.readFileSync(cssFile, "utf8") : null;
    fs.writeFileSync(path.join(tmp, "index.html"), cardHtml(fs.readFileSync(path.join(SKILL, "template", "look-card.html"), "utf8"), look, css));
    copy(path.join(SKILL, "template", "looks.css"), path.join(tmp, "looks.css"));
    if (css !== null) copy(cssFile, path.join(tmp, "look.css"));
    copy(path.join(e.node_modules, "gsap", "dist", "gsap.min.js"), path.join(tmp, "gsap.min.js"));
    for (const [pkg, fam, ws] of FONTS) for (const w of ws) copy(path.join(e.node_modules, pkg, "files", `${fam}-latin-${w}-normal.woff2`), path.join(tmp, "fonts", `${fam}-latin-${w}-normal.woff2`));
    const shots = path.join(tmp, "shots");
    hf(e, ["snapshot", tmp, "--at", "0.5", "--no-end", "-o", shots, "--timeout", "30000", "--describe", "false"], { capture: true });
    const png = fs.existsSync(shots) ? fs.readdirSync(shots).filter(f => /^frame-.*\.png$/.test(f)).sort()[0] : null;
    if (!png) die("the look card could not be drawn: HyperFrames saved no frame");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", path.join(shots, png), "-q:v", "2", out], { capture: true });
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const n = (x, d = 3) => (x === null || x === undefined ? "n/a" : Number(x).toFixed(d).replace(/\.?0+$/, ""));

// the plain language summary of look-reference.json
export function summary(ref) {
  const v = ref.video, g = ref.grain, c = ref.contrast, files = ref.sources.map(s => s.file).join(", ");
  const bars = ref.sources.filter(s => s.black_rows_removed || s.black_columns_removed);
  const lines = [`look: measured ${ref.frames} frame${ref.frames === 1 ? "" : "s"} from ${files}`];
  for (const s of bars) lines.push(`  black bars left out: ${s.file} (${s.black_rows_removed} rows, ${s.black_columns_removed} columns)`);
  lines.push(`  palette      ${ref.palette.map(p => `${p.hex} ${Math.round(p.share * 100)}%`).join("  ")}`,
    `  background   ${ref.background.hex}, ${ref.mode} (L* ${n(ref.background.lightness, 1)})`,
    `  contrast     ink ${c.ink.hex} on the background ${n(c.ink.ratio, 2)} : 1${c.ink.adjusted ? ` (adjusted from ${c.ink.measured_hex}, ${n(c.ink.measured_ratio, 2)} : 1)` : ""}; best palette pair ${n(c.best_pair.ratio, 2)} : 1`,
    `  grain        ${n(g.value)} luma levels in flat areas (${Math.round(g.flat_share * 100)}% of blocks flat), ${g.present ? `at or above ${g.threshold}: texture overlay written and drawn on the card` : `below ${g.threshold}: clean, no texture added`}`,
    `  edge density ${n(ref.edge_density, 4)} of pixels`);
  if (v) lines.push(`  video        ${n(v.fps, 2)} fps, ${n(v.cuts_per_minute, 2)} cuts per minute, motion energy ${n(v.motion_energy, 4)} (${n(v.motion_energy_without_cuts, 4)} without cuts)`);
  return lines.join("\n");
}

function fromReference(e, d, files) {
  const inputs = files.map(f => needFile(f, "reference file"));
  const bad = unsupportedInput(inputs); if (bad) die(bad);
  const prior = fs.existsSync(path.join(d, "src", "look.css"));
  run(e.python, [path.join(SKILL, "scripts", "look.py"), e.ffmpeg, e.ffprobe, d, ...inputs]);
  const cssFile = path.join(d, "src", "look.css"), ref = readJSON(path.join(d, "look-reference.json"));
  const problems = lookCssProblems(fs.readFileSync(cssFile, "utf8"));
  if (problems.length) die("the drafted look.css is incomplete: " + problems.join("; "));
  renderCard(e, "custom", cssFile, path.join(d, "stills", "look-card.jpg"));
  say(summary(ref));
  say(`  wrote look-reference.json, src/look.css${prior ? " (the earlier one is kept as src/look.previous.css)" : ""}, stills/look-card.jpg`);
  say("  LOOK at stills/look-card.jpg next to the reference (studio frames <video> makes its contact sheet), then edit src/look.css: fonts and motion are suggested in its comments.\n" +
      "  compose loads src/look.css after looks.css whenever it exists.");
}

function builtInCard(e, d, name) {
  const out = path.join(d, "stills", `look-card-${name}.jpg`);
  renderCard(e, name, null, out);
  say(`look card for the built in look "${name}" (nothing measured): stills/look-card-${name}.jpg`);
}

export async function main(argv) {
  let a;
  try { a = parseLookArgs(argv); } catch (err) { die(err.message); }
  const e = env(), d = projDir(a.dir);
  if (a.card !== null) builtInCard(e, d, a.card); else fromReference(e, d, a.from);
  return 0;
}
