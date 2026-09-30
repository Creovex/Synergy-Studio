import fs from "node:fs";
import path from "node:path";
import { SAFE, SIZES, die, say, run, env, hf, readJSON, projDir, sheet, parseArgs } from "./common.mjs";
import { compose } from "./compose.mjs";

export const USAGE = "stills <dir> [t1 t2 …] [--platform p]";

// ---------------------------------------------------------------- stills
function stills(dir, times, platform) {
  const e = env(), d = projDir(dir);
  if (!fs.existsSync(path.join(d, "timing.json"))) die(`no timing.json yet: run studio audio ${dir} first`);
  const bad = times.filter(x => !Number.isFinite(+x)); if (bad.length) die(`stills: times must be seconds, e.g. studio stills ${dir} 1.5 4 (got ${bad.join(", ")})`);
  const timing = readJSON(path.join(d, "timing.json"));
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
  const at = times.length ? times.map(Number) : [...new Set(def.map(x => +Math.max(0, x).toFixed(2)))].sort((a, b) => a - b);
  const out = path.join(d, "stills"); fs.rmSync(out, { recursive: true, force: true });
  hf(e, ["snapshot", path.join(d, "comp"), "--at", at.join(","), "--no-end", "-o", out, "--timeout", "30000", "--describe", "false"]);
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
  say(`stills: ${frames.length} frames at ${at.join(", ")} s → LOOK at stills/sheet.jpg (all frames, in time order)` + (SAFE[plat] ? ` and stills/safe-${plat}.jpg` : ""));
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  stills(pos[0], pos.slice(1), flags.platform);
  return 0;
}
