import fs from "node:fs";
import path from "node:path";
import { SKILL, SIZES, die, say, env, hf, readJSON, copy, copyDir, projDir, parseArgs } from "./common.mjs";

export const USAGE = "compose <dir>";

// ---------------------------------------------------------------- compose
export const LINT = [[/Math\.random/, "Math.random (use fixed values)"], [/Date\.now/, "Date.now (clock time)"], [/new Date\(/, "new Date( (clock time)"],
  [/performance\.now/, "performance.now (clock time)"], [/setTimeout/, "setTimeout (use tl.to at a time)"], [/setInterval/, "setInterval (use tl.to at a time)"],
  [/requestAnimationFrame/, "requestAnimationFrame (use tl.to at a time)"], [/@keyframes/, "CSS @keyframes (use GSAP)"], [/animation\s*:/, "CSS animation: (use GSAP)"],
  [/transition\s*:/, "CSS transition: (use GSAP)"], [/\b(gsap|tl|timeline)\s*\.\s*from\(/, "gsap .from( (use gsap.set + tl.to)"], [/\b(gsap|tl|timeline)\s*\.\s*fromTo\(/, "gsap .fromTo( (use gsap.set + tl.to)"],
  [/\bsrc\s*=\s*["']https?:/, "network URL in src (put files in src/assets)"], [/\bhref\s*=\s*["']https?:/, "network URL in href (put files in src/assets)"],
  [/url\(\s*["']?https?:/, "network URL in url( (put files in src/assets)"], [/import\s.*["']https?:/, "network URL in an import (put files in src/assets)"]];
// every top level field project.json may have (LITE.md section 6)
export const PROJECT_FIELDS = ["name", "kind", "mode", "aspect", "platform", "length", "fps", "voice", "speed", "music", "lead", "pre", "post", "tail",
  "lexicon", "scenes", "events", "edit", "caption_fixes", "voice_track", "transition_whoosh"];
export function compose(dir) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json"));
  const tf = path.join(d, "timing.json"); if (!fs.existsSync(tf)) die("run `studio audio` first (timing.json missing)");
  const timing = readJSON(tf); const [W, Hh] = SIZES[proj.aspect || "16:9"];
  let html = fs.readFileSync(path.join(d, "src", "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");   // comments are for authors only
  const errors = [];
  for (const k of Object.keys(proj)) if (!PROJECT_FIELDS.includes(k)) errors.push(`project.json: unknown field "${k}" (known fields: ${PROJECT_FIELDS.join(", ")})`);
  const script = html.replace(/<!--[\s\S]*?-->/g, "");
  for (const [re, what] of LINT) if (re.test(script.replace(/\/\/[^\n]*/g, ""))) errors.push("not allowed: " + what);
  for (const s of proj.scenes) if (!new RegExp(`id="${s.id}"`).test(html)) errors.push(`scene ${s.id}: no element with id="${s.id}"`);
  html = html.replace(/\{\{\s*([\w-]+)\.(start|dur|end|vo)\s*\}\}/g, (m, s, k) => { const t = timing.T[s]; if (!t) { errors.push(`unknown scene in ${m}`); return m; } return String(t[k]); })
             .replace(/\{\{\s*TOTAL\s*\}\}/g, String(timing.TOTAL)).replace(/\{\{\s*W\s*\}\}/g, String(W)).replace(/\{\{\s*H\s*\}\}/g, String(Hh))
             .replace(/\{\{\s*FPS\s*\}\}/g, String(proj.fps || 30));
  const left = html.match(/\{\{[^}]*\}\}/g); if (left) errors.push("unfilled placeholders: " + [...new Set(left)].join(" "));
  const ids = [...html.matchAll(/<(\w+)[^>]*\bdata-start=[^>]*>/g)].map(m => (m[0].match(/\bid="([^"]+)"/) || [])[1]);
  if (ids.some(x => !x)) errors.push("every element with data-start needs a unique id (else video freezes and audio is silent)");
  if (errors.length) { errors.forEach(x => console.error("  ✗ " + x)); die("compose stopped: fix src/index.html"); }
  // HyperFrames looks for @font-face rules in the page itself and downloads a font from Google Fonts for a family it does not find
  // there (looks.css is a linked file it does not read), so the bundled font rules are also written into the page: no network at render time
  const faces = (fs.readFileSync(path.join(SKILL, "template", "looks.css"), "utf8").match(/@font-face\s*\{[^}]*\}/g) || []).join("\n");
  if (faces && /<\/head>/i.test(html)) html = html.replace(/<\/head>/i, `<style data-bundled-fonts>\n${faces}\n</style>\n</head>`);
  const c = path.join(d, "comp"); fs.rmSync(c, { recursive: true, force: true }); fs.mkdirSync(path.join(c, "audio"), { recursive: true });
  fs.writeFileSync(path.join(c, "index.html"), html);
  copy(path.join(SKILL, "template", "lib.js"), path.join(c, "lib.js"));
  copy(path.join(SKILL, "template", "looks.css"), path.join(c, "looks.css"));
  copy(path.join(SKILL, "template", "sketch.js"), path.join(c, "sketch.js"));
  // a custom look (look --from, or written by hand) is loaded after looks.css whenever it exists (LITE 6, 7.6.1)
  if (fs.existsSync(path.join(d, "src", "look.css"))) {
    copy(path.join(d, "src", "look.css"), path.join(c, "look.css"));
    if (!/href=["']look\.css["']/.test(html)) { html = html.replace(/(<link[^>]*href=["']looks\.css["'][^>]*>)/, '$1\n<link rel="stylesheet" href="look.css">'); fs.writeFileSync(path.join(c, "index.html"), html); }
  }
  copy(path.join(d, "timing.js"), path.join(c, "timing.js"));
  const tr = path.join(d, "transcript.json"), fixes = proj.caption_fixes || {};
  let words = fs.existsSync(tr) ? readJSON(tr) : [];
  words = words.map(w => { let t = String(w.text); for (const [a, b] of Object.entries(fixes)) t = t.replace(new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), b); return { text: t, start: w.start, end: w.end }; });
  fs.writeFileSync(path.join(c, "words.js"), "window.WORDS = " + JSON.stringify(words) + ";\n");
  copy(path.join(d, "audio", "mix.wav"), path.join(c, "audio", "mix.wav"));
  copy(path.join(e.node_modules, "gsap", "dist", "gsap.min.js"), path.join(c, "gsap.min.js"));
  for (const [pkg, fam, ws] of [["@fontsource/inter", "inter", [400, 500, 600, 700]], ["@fontsource/manrope", "manrope", [700, 800]],
                                ["@fontsource/cormorant-garamond", "cormorant-garamond", [400, 500, 600, 700]], ["@fontsource/jost", "jost", [300, 400, 500]]])
    for (const w of ws) copy(path.join(e.node_modules, pkg, "files", `${fam}-latin-${w}-normal.woff2`), path.join(c, "fonts", `${fam}-latin-${w}-normal.woff2`));
  copyDir(path.join(d, "src", "assets"), path.join(c, "assets"));
  if (/three\.module\.js|["']three["']|three\/addons\//.test(html)) {        // three.js used: copy the library + add-ons
    const T3 = path.join(e.node_modules, "three");
    if (!fs.existsSync(T3)) die("three.js is not installed: run setup again");
    for (const f of ["three.module.js", "three.core.js"]) copy(path.join(T3, "build", f), path.join(c, "three", f));
    for (const f of ["loaders/GLTFLoader.js", "utils/BufferGeometryUtils.js", "utils/SkeletonUtils.js", "environments/RoomEnvironment.js",
                     "geometries/TextGeometry.js", "loaders/FontLoader.js", "geometries/RoundedBoxGeometry.js"])
      copy(path.join(T3, "examples", "jsm", f), path.join(c, "three", "addons", f));
    if (!/type="importmap"/.test(html)) say("  ! three.js: add the import map to <head> (references/three.md)");
  }
  const r = hf(e, ["lint", c, "--json"], { capture: true, soft: true });
  let lint = null; try { lint = JSON.parse(r.stdout); } catch { /* reported below */ }
  if (!lint) say("  ! hyperframes lint output could not be read (the render will still validate the page). Raw output:\n" + String((r.stdout || "") + (r.stderr || "")).trim().split("\n").map(l => "    " + l).join("\n"));
  else {
    const found = lint.findings || lint.issues || [], sev = f => f.severity || f.level;
    for (const f of found.filter(f => sev(f) === "warning" && f.code !== "nested_structure_needs_subcomposition")) say("  ! lint: " + (f.message || JSON.stringify(f)));
    const errs = found.filter(f => sev(f) === "error");
    if (errs.length) { errs.forEach(f => console.error("  ✗ lint: " + (f.message || JSON.stringify(f)))); die("HyperFrames lint found errors"); }
    if (r.status !== 0) say(`  ! hyperframes lint exited with ${r.status}${lint.error ? ": " + lint.error : ""} (the render will still validate the page)`);
  }
  say(`composed ${c}  (${W}x${Hh}, ${timing.TOTAL} s)`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  compose(pos[0]);
  return 0;
}
