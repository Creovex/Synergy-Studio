import fs from "node:fs";
import path from "node:path";
import { SAFE, SIZES, die, say, run, env, hf, readJSON, projDir, sheet, parseArgs } from "./common.mjs";
import { compose } from "./compose.mjs";

const PLATFORMS = [...Object.keys(SAFE), "youtube", "linkedin", "x", "website"];

export const USAGE = "stills <dir> [t1 t2 …] [--cues] [--range a:b --every s] [--platform p]";

const CUE_OFFSETS = [[-4, "before"], [0, ""], [6, "after"]];   // frames around each cue: anticipation, the hit, the reaction
const DEFAULT_EVERY = 0.25;

// ---- the extra frames of --cues and --range (pure: the tests call them)
// every cue at -4, 0 and +6 frames; `legend` maps each time to what it shows (time in milliseconds is the key)
export function cueFrames(timing, fps = timing.fps || 30) {
  const cues = Object.entries(timing.CUE || {}), frames = [], legend = new Map(), last = timing.TOTAL - 0.05;
  for (const [name, t] of cues) for (const [df, tag] of CUE_OFFSETS) {
    const want = t + df / fps, x = +Math.min(last, Math.max(0, want)).toFixed(3);
    const edge = want < 0 ? "clamped to the start of the video" : want > last ? "clamped to the end of the video" : "";
    const note = [tag, edge].filter(Boolean).join(", ");
    frames.push(x); const key = Math.round(x * 1000); legend.set(key, [...(legend.get(key) || []), note ? `${name} (${note})` : name]);
  }
  return { frames, legend };
}

// --range a:b [--every s]: one frame every `every` seconds from a to b, both ends included
export function rangeFrames(range, every, total) {
  const m = /^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/.exec(String(range)), ev = every === undefined ? DEFAULT_EVERY : Number(every);
  if (!m || !(+m[2] > +m[1]) || !(ev > 0) || every === true) throw new Error("usage: studio stills <dir> --range <from>:<to> [--every 0.25] (seconds, to after from)");
  const a = +m[1], b = +m[2];
  if (b > total) throw new Error(`stills: --range ${range} ends after the video (${total} s)`);
  const steps = Math.floor((b - a) / ev + 1e-9), out = [];                // integer steps, so rounding cannot drop a frame
  for (let k = 0; k <= steps; k++) out.push(+(a + k * ev).toFixed(3));
  if (out[out.length - 1] < b - 1e-6) out.push(+b.toFixed(3));              // the end of the range is always shown
  if (out.length > 120) throw new Error(`stills: --range gives ${out.length} frames; use a larger --every (at most 120 frames)`);
  return out;
}

// the legend file: the frame's number on the contact sheet, its time and frame number, and what it shows
export function legendText(at, legend, fps = 30) {
  return at.map((x, i) => `${String(i + 1).padStart(3)}. ${x.toFixed(3)} s  frame ${Math.round(x * fps)}  ${(legend.get(Math.round(x * 1000)) || []).join(", ")}`.trimEnd()).join("\n") + "\n";
}

// ---------------------------------------------------------------- stills
function stills(dir, times, platform, opts = {}) {
  const e = env(), d = projDir(dir);
  if (!fs.existsSync(path.join(d, "timing.json"))) die(`no timing.json yet: run studio audio ${dir} first`);
  const bad = times.filter(x => !Number.isFinite(+x)); if (bad.length) die(`stills: times must be seconds, e.g. studio stills ${dir} 1.5 4 (got ${bad.join(", ")})`);
  const timing = readJSON(path.join(d, "timing.json"));
  const outside = times.filter(x => +x < 0 || +x > timing.TOTAL); if (outside.length) die(`stills: ${outside.join(", ")} s is outside the video (0 to ${timing.TOTAL} s)`);
  if (platform !== undefined && (platform === true || !PLATFORMS.includes(String(platform).toLowerCase()))) die(`stills: unknown platform "${platform}" (use ${PLATFORMS.join(", ")})`);
  compose(dir);                                           // always rebuild comp/ from src/
  const v = hf(e, ["validate", path.join(d, "comp"), "--json"], { capture: true, soft: true });   // runtime errors + contrast
  try {
    const j = JSON.parse(v.stdout);
    for (const w of j.warnings || []) say(`  ! page warning: ${w.text || JSON.stringify(w)}`);
    for (const c of (j.contrast || []).filter(c => c.wcagAA === false)) say(`  ! low contrast at ${c.time}s: "${c.text}" (${c.selector}, ratio ${c.ratio})`);
    if ((j.errors || []).length) { j.errors.forEach(x => console.error(`  ✗ page error: ${x.text || JSON.stringify(x)}`)); die("the page has JavaScript errors (the stills would be blank): fix src/index.html"); }
  } catch (err) { if (err && err.message && err.message.startsWith("ERROR")) throw err; }
  // default frames: 0.3 s (the hook frame), then for each scene its middle and the end of its narration, then the last second
  const def = [0.3]; for (const t of Object.values(timing.T)) { def.push((t.start + t.end) / 2, Math.min(t.vo_end, t.end - 0.4)); } def.push(timing.TOTAL - 0.5);
  let extra = [], legend = new Map();
  if (opts.cues) {                                        // each cue: 4 frames before (anticipation), the hit, 6 frames after (reaction)
    if (!Object.keys(timing.CUE || {}).length) die(`stills --cues: project.json has no "cues" (add them, then run studio audio ${dir})`);
    ({ frames: extra, legend } = cueFrames(timing));
  }
  if (opts.range !== undefined) { try { extra = [...extra, ...rangeFrames(opts.range, opts.every, timing.TOTAL)]; } catch (err) { die(err.message); } }
  const asked = [...times.map(Number), ...extra];
  const at = asked.length ? [...new Set(asked)].sort((a, b) => a - b) : [...new Set(def.map(x => +Math.max(0, x).toFixed(2)))].sort((a, b) => a - b);
  // each run replaces the old stills; the look cards (made by `look`) and the source sheet (made by `import`) are kept
  const out = path.join(d, "stills"); const KEEP = /^(look-card.*|source-sheet)\.jpg$/;
  // HyperFrames' snapshot empties its output folder, so the kept files wait outside it during the capture
  const kept = fs.existsSync(out) ? fs.readdirSync(out).filter(f => KEEP.test(f)) : [];
  const aside = fs.mkdtempSync(path.join(d, ".stills-keep-"));
  for (const f of kept) fs.renameSync(path.join(out, f), path.join(aside, f));
  fs.rmSync(out, { recursive: true, force: true });
  try { hf(e, ["snapshot", path.join(d, "comp"), "--at", at.join(","), "--no-end", "-o", out, "--timeout", "30000", "--describe", "false"]); }
  finally { fs.mkdirSync(out, { recursive: true }); for (const f of kept) fs.renameSync(path.join(aside, f), path.join(out, f)); fs.rmSync(aside, { recursive: true, force: true }); }
  const proj = readJSON(path.join(d, "project.json")), plat = (platform || proj.platform || "").toLowerCase();
  const [SW, SH] = SIZES[proj.aspect || "16:9"];
  const frames = fs.readdirSync(out).filter(f => /^frame-.*\.png$/.test(f)).sort().map(f => path.join(out, f));
  sheet(e, frames, path.join(out, "sheet.jpg"), SW, SH);
  if (SAFE[plat] && (proj.aspect || "16:9") === "9:16") {                    // red overlay on the unsafe areas
    const [t, b, l, r] = SAFE[plat];
    const box = `drawbox=x=0:y=0:w=iw:h=${t}:color=red@0.35:t=fill,drawbox=x=0:y=ih-${b}:w=iw:h=${b}:color=red@0.35:t=fill,drawbox=x=0:y=0:w=${l}:h=ih:color=red@0.35:t=fill,drawbox=x=iw-${r}:y=0:w=${r}:h=ih:color=red@0.35:t=fill`;
    const pngs = fs.readdirSync(out).filter(f => /^frame-.*\.png$/.test(f)).sort().map(f => path.join(out, f));
    const guides = pngs.map(f => { const g = f.replace(/\.png$/, `-${plat}-safe.jpg`); run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", f, "-vf", box, g], { soft: true }); return g; });
    sheet(e, guides, path.join(out, `safe-${plat}.jpg`), 1080, 1920);
    say(`safe-area guide (${plat}): stills/safe-${plat}.jpg (red = covered by the app; keep text out, except captions)`);
  }
  if (legend.size) { fs.writeFileSync(path.join(out, "cues.txt"), legendText(at, legend, timing.fps || 30)); say("cue legend (the numbers on the contact sheet, stills/cues.txt):\n" + legendText(at, legend, timing.fps || 30).trimEnd()); }
  say(`stills: ${frames.length} frames at ${at.join(", ")} s → LOOK at stills/sheet.jpg (all frames, in time order)` + (SAFE[plat] ? ` and stills/safe-${plat}.jpg` : ""));
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  // a bare --cues swallows the next plain number as its value: give it back as a time
  const times = pos.slice(1); if (typeof flags.cues === "string") times.unshift(flags.cues);
  stills(pos[0], times, flags.platform, { cues: !!flags.cues, range: flags.range, every: flags.every });
  return 0;
}
