import fs from "node:fs";
import path from "node:path";
import { SKILL, die, say, run, env, toolEnv, projDir } from "./common.mjs";

export const USAGE = 'brand <dir> --brand "#hex" [--brand "#hex"] [images …]';
export const VERDICTS = ["ACCENT", "HEAVY", "FLOODED"];

// "#2A67B7", "2a67b7" and "#2ab" all mean a colour; the script wants six digits with no surprises
export function normaliseHex(text) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(text).trim());
  if (!m) throw new Error(`"${text}" is not a hex colour (write it like #2A67B7)`);
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toUpperCase()}`;
}

// brand <dir> --brand "#hex" [--brand "#hex" …] [images …]; every problem is a plain Error
export function parseBrandArgs(argv) {
  const out = { dir: null, brands: [], images: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--brand" || a.startsWith("--brand=")) {
      const v = a === "--brand" ? argv[++i] : a.slice("--brand=".length);
      if (v === undefined || v === "" || v.startsWith("--")) throw new Error('--brand needs a hex colour, for example --brand "#2A67B7"');
      out.brands.push(normaliseHex(v));
    } else if (a.startsWith("--")) {
      throw new Error(`unknown flag ${a} (usage: ${USAGE})`);
    } else if (out.dir === null) {
      out.dir = a;
    } else {
      out.images.push(a);
    }
  }
  if (out.dir === null) throw new Error("give the project folder first (usage: " + USAGE + ")");
  if (!out.brands.length) throw new Error('give at least one --brand "#hex", the signature colour of the brand (usage: ' + USAGE + ")");
  out.brands = [...new Set(out.brands)];
  return out;
}

// the project's stills, the frames the last `stills` run made, in time order
export function defaultImages(projectDir) {
  const dir = path.join(projectDir, "stills");
  const frames = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^frame-.*\.png$/.test(f)).sort() : [];
  if (!frames.length) throw new Error(`no stills in ${dir} yet: run studio stills first, or name the pictures to measure`);
  return frames.map((f) => path.join(dir, f));
}

// a picture the user names: relative to the current folder when it exists there, else relative to the project folder
export function resolveImage(projectDir, file) {
  const here = path.resolve(file), inProject = path.resolve(projectDir, file);
  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
  if (isFile(here)) return here;
  if (isFile(inProject)) return inProject;
  throw new Error(`picture not found: ${file} (looked in ${here === inProject ? here : `${here} and ${inProject}`})`);
}

// the verdict word in the script's output, or null
export function verdictOf(stdout) {
  const m = /^VERDICT: (ACCENT|HEAVY|FLOODED)\b/m.exec(stdout || "");
  return m ? m[1] : null;
}

// one line for the end: how many pictures of each verdict
export function summary(verdicts) {
  const n = (v) => verdicts.filter((x) => x === v).length;
  const parts = VERDICTS.filter((v) => n(v)).map((v) => `${n(v)} ${v}`);
  const flooded = n("FLOODED");
  return `brand: ${verdicts.length} ${verdicts.length === 1 ? "picture" : "pictures"}: ${parts.join(", ")}` +
    (flooded ? `. ${flooded} FLOODED: the brand colour is the wallpaper, rebuild the palette (references/brand-colours.md)` : "");
}

// one plain line for a picture that could not be measured: the script's own line when it is the "not a picture" one,
// else the last line of what went wrong; never the script's name or raw ffmpeg output
export function measureFailure(image, r) {
  const lines = ((r.stderr || "") + (r.error?.message || "")).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1] || `exit ${r.status}`;
  return /is not a picture ffmpeg can read$/.test(last) ? last : `could not measure ${image}: ${last}`;
}

// runs scripts/brand_coverage.py on each picture; returns 2 when any picture is FLOODED, else 0
export function brand(brands, images) {
  const e = env();
  const script = path.join(SKILL, "scripts", "brand_coverage.py");
  const verdicts = [];
  for (const image of images) {
    const args = [script, image, ...brands.flatMap((b) => ["--brand", b]), "--ffmpeg", e.ffmpeg];
    const r = run(e.python, args, { capture: true, soft: true, env: toolEnv(e) });
    if (r.error || (r.status !== 0 && r.status !== 2)) die(measureFailure(image, r));
    const verdict = verdictOf(r.stdout);
    if (!verdict) die(`could not measure ${image}: no result came back`);
    verdicts.push(verdict);
    say(r.stdout.trimEnd());
  }
  say(summary(verdicts));
  return verdicts.includes("FLOODED") ? 2 : 0;
}

export async function main(argv) {
  let args;
  try { args = parseBrandArgs(argv); } catch (err) { die(err.message); }
  const d = projDir(args.dir);
  let images;
  try { images = args.images.length ? args.images.map((f) => resolveImage(d, f)) : defaultImages(d); } catch (err) { die(err.message); }
  return brand(args.brands, images);
}
