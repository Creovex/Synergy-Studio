#!/usr/bin/env node
// Synergy Studio CLI: make narrated motion-graphics videos with HyperFrames + GSAP + Kokoro.
// Node >= 20, built-ins only. Run `node studio.mjs help`.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";
const PINS = {
  node: { "hyperframes": "0.8.92", "gsap": "3.14.2", "@ffprobe-installer/ffprobe": "2.1.2",
          "@fontsource/inter": "5.3.0", "@fontsource/manrope": "5.3.0", "@fontsource/cormorant-garamond": "5.3.0", "@fontsource/jost": "5.3.0", "three": "0.186.1" },
  python: ["kokoro-onnx==0.6.1", "soundfile==0.14.0", "imageio-ffmpeg==0.6.0"],
  models: {
    "kokoro-v1.0.int8.onnx": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx",
    "voices-v1.0.bin": "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin",
  },
};
// unsafe margins in px at 1080x1920 (top, bottom, left, right). meta = published by Meta (14% / 35% / 6%);
// tiktok and shorts are working defaults (measured app overlays), not official specs.
const SAFE = { tiktok: [200, 400, 60, 180], reels: [269, 672, 65, 65], meta: [269, 672, 65, 65], shorts: [288, 672, 60, 201] };
const SIZES = { "16:9": [1920, 1080], "9:16": [1080, 1920], "1:1": [1080, 1080], "4:5": [1080, 1350] };

function home() {
  if (process.env.SYNERGY_STUDIO_HOME) return path.resolve(process.env.SYNERGY_STUDIO_HOME);
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "SynergyStudioLite");
  if (WIN) return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "SynergyStudioLite");
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share"), "synergy-studio-lite");
}
const H = home();
const ENVF = path.join(H, "env.json");
const die = (msg, code = 1) => { console.error("ERROR: " + msg); process.exit(code); };
const say = msg => console.log(msg);
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: opts.capture ? "pipe" : "inherit", encoding: "utf8", shell: opts.shell || false,
    env: { ...process.env, ...(opts.env || {}) }, cwd: opts.cwd });
  if (r.error) { if (opts.soft) return r; die(`${cmd} failed to start: ${r.error.message}`); }
  if (r.status !== 0 && !opts.soft) die(opts.capture ? `${path.basename(cmd)} ${args.slice(0, 3).join(" ")} … exited with ${r.status}\n${(r.stderr || "").slice(-2000)}`
                                                     : `${path.basename(/\.(py|mjs)$/.test(args[0] || "") ? args[0] : cmd)} stopped (exit ${r.status}): see the message above`);
  return r;
}
const which = cmd => { const r = spawnSync(WIN ? "where" : "which", [cmd], { encoding: "utf8" }); return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null; };
const env = () => { if (!fs.existsSync(ENVF)) die(`not set up yet: run  node "${path.join(SKILL, "scripts", "studio.mjs")}" setup`); return JSON.parse(fs.readFileSync(ENVF, "utf8")); };
const toolEnv = e => ({ PATH: e.bin + path.delimiter + process.env.PATH, HYPERFRAMES_SKIP_SKILLS: "1", HYPERFRAMES_NO_TELEMETRY: "1" });
const hf = (e, args, opts = {}) => run(process.execPath, [e.hyperframes, ...args], { ...opts, env: { ...toolEnv(e), ...(opts.env || {}) } });
const readJSON = f => JSON.parse(fs.readFileSync(f, "utf8"));
const copy = (a, b) => { fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(a, b); };
function copyDir(a, b) { if (!fs.existsSync(a)) return; fs.mkdirSync(b, { recursive: true });
  for (const n of fs.readdirSync(a)) { const s = path.join(a, n), d = path.join(b, n); fs.statSync(s).isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d); } }
const modeOf = d => readJSON(path.join(d, "project.json")).mode || "narrated";
const needNarrated = (d, cmd) => { const m = modeOf(d); if (m !== "narrated") die(`${cmd} is for narrated projects; this project is "mode": "${m}" (scenes are timed in seconds; see references/commands.md)`); };
const needFile = (f, what) => { if (!f || !fs.existsSync(path.resolve(f)) || !fs.statSync(path.resolve(f)).isFile()) die(`${what} not found: ${f}`); return path.resolve(f); };
const LOOKS = ["paper", "midnight", "bold", "luxe"];
const projDir = p => { if (!p) die("give the project folder"); const d = path.resolve(p); if (!fs.existsSync(path.join(d, "project.json"))) die(`${d} has no project.json (make one with: studio new ${p})`); return d; };

// ---------------------------------------------------------------- setup
function setup() {
  const [maj] = process.versions.node.split(".").map(Number);
  if (maj < 20) die(`Node ${process.versions.node} is too old; install Node 22 LTS from https://nodejs.org`);
  fs.mkdirSync(H, { recursive: true });
  say(`Synergy Studio home: ${H}`);
  // 1. Node packages (HyperFrames renderer, GSAP, fonts, ffprobe)
  const nd = path.join(H, "node");
  fs.mkdirSync(nd, { recursive: true });
  fs.writeFileSync(path.join(nd, "package.json"), JSON.stringify({ name: "synergy-studio-lite-tools", private: true, dependencies: PINS.node }, null, 2));
  say("1/5 Installing the renderer (HyperFrames), GSAP and fonts…");
  run(WIN ? "npm.cmd" : "npm", ["install", "--no-audit", "--no-fund", "--loglevel=error"], { cwd: nd, shell: WIN });
  // 2. Python venv with Kokoro
  say("2/5 Creating the Python environment for the voice…");
  const venv = path.join(H, "venv");
  const py = path.join(venv, WIN ? "Scripts" : "bin", WIN ? "python.exe" : "python");
  const uv = which("uv");
  if (!fs.existsSync(py)) {
    if (uv) run(uv, ["venv", "--python", "3.11", venv]);
    else {
      const sys = which(WIN ? "python" : "python3") || which("python");
      if (!sys) die("Python 3.10–3.12 is needed (https://www.python.org/downloads/) or install uv (https://docs.astral.sh/uv/)");
      run(sys, ["-m", "venv", venv]);
    }
  }
  if (uv) run(uv, ["pip", "install", "--python", py, ...PINS.python]);
  else { run(py, ["-m", "pip", "install", "-q", "--upgrade", "pip"]); run(py, ["-m", "pip", "install", "-q", ...PINS.python]); }
  // 3. voice model (Python download: honours HTTPS_PROXY like the rest of the machine)
  say("3/5 Downloading the Kokoro voice model (about 120 MB)…");
  const md = path.join(H, "models"); fs.mkdirSync(md, { recursive: true });
  for (const [name, url] of Object.entries(PINS.models)) {
    const dst = path.join(md, name);
    if (fs.existsSync(dst) && fs.statSync(dst).size > 1e6) continue;
    run(py, ["-c", "import sys,urllib.request,shutil\nwith urllib.request.urlopen(sys.argv[1]) as r, open(sys.argv[2]+'.part','wb') as f: shutil.copyfileobj(r,f)\nimport os; os.replace(sys.argv[2]+'.part', sys.argv[2])", url, dst]);
  }
  // 4. ffmpeg + ffprobe into home/bin
  say("4/5 Installing ffmpeg and ffprobe…");
  const bin = path.join(H, "bin"); fs.mkdirSync(bin, { recursive: true });
  const ffSrc = run(py, ["-c", "import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())"], { capture: true }).stdout.trim();
  const ff = path.join(bin, WIN ? "ffmpeg.exe" : "ffmpeg"); fs.copyFileSync(ffSrc, ff);
  const ffpSrc = createRequire(path.join(nd, "package.json"))("@ffprobe-installer/ffprobe").path;
  const ffp = path.join(bin, WIN ? "ffprobe.exe" : "ffprobe"); fs.copyFileSync(ffpSrc, ffp);
  if (!WIN) { fs.chmodSync(ff, 0o755); fs.chmodSync(ffp, 0o755); }
  if (process.platform === "darwin") for (const b of [ff, ffp]) {
    if (run("codesign", ["--verify", b], { soft: true, capture: true }).status !== 0) run("codesign", ["--force", "--sign", "-", b], { soft: true });
  }
  // 5. HyperFrames' Chrome
  const e = { home: H, node_modules: path.join(nd, "node_modules"), hyperframes: path.join(nd, "node_modules", "hyperframes", "bin", "hyperframes.mjs"),
              python: py, bin, ffmpeg: ff, ffprobe: ffp, kokoro_model: path.join(md, "kokoro-v1.0.int8.onnx"), kokoro_voices: path.join(md, "voices-v1.0.bin"),
              installed_at: new Date().toISOString(), platform: `${process.platform}-${process.arch}` };
  say("5/5 Getting the render browser…");
  hf(e, ["telemetry", "disable"], { soft: true });
  hf(e, ["browser", "ensure"]);
  fs.writeFileSync(ENVF, JSON.stringify(e, null, 2));
  doctor();
}

// ---------------------------------------------------------------- doctor
function doctor() {
  const e = env(); let bad = 0;
  const line = (ok, name, info) => { if (!ok) bad++; say(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  " + info : ""}`); };
  line(fs.existsSync(e.hyperframes), "HyperFrames 0.8.92", e.hyperframes);
  const v = run(e.ffmpeg, ["-version"], { capture: true, soft: true }); line(v.status === 0, "ffmpeg", (v.stdout || "").split("\n")[0]);
  const p = run(e.ffprobe, ["-version"], { capture: true, soft: true }); line(p.status === 0, "ffprobe", (p.stdout || "").split("\n")[0]);
  const k = run(e.python, ["-c", "import kokoro_onnx, soundfile, numpy; print('ok')"], { capture: true, soft: true }); line(k.status === 0, "Python + Kokoro", e.python);
  line(fs.existsSync(e.kokoro_model) && fs.existsSync(e.kokoro_voices), "voice model", e.kokoro_model);
  const b = hf(e, ["browser", "path"], { capture: true, soft: true }); line(b.status === 0, "render browser", (b.stdout || "").trim().split("\n").pop());
  say(bad ? `${bad} problem(s): run setup again` : "All good.");
  if (bad) process.exit(1);
}

// ---------------------------------------------------------------- new
function newProject(dir, opts) {
  if (!dir) die("usage: studio new <folder> [--mode narrated|footage|film] [--aspect 16:9|9:16|1:1|4:5] [--platform tiktok|reels|shorts|meta|youtube|linkedin|x|website] [--length 30] [--look paper|midnight|bold|luxe]");
  const mode = opts.mode || "narrated"; if (!["narrated", "footage", "film"].includes(mode)) die("--mode must be narrated, footage or film");
  if (opts.look && !LOOKS.includes(opts.look)) die("--look must be one of " + LOOKS.join(", ") + " (for a canvas film use the sketch kit: references/illustration.md)");
  if (opts.length !== undefined && (opts.length === true || !(+opts.length > 0))) die("--length needs a number of seconds, e.g. --length 30");
  const d = path.resolve(dir);
  if (fs.existsSync(path.join(d, "project.json"))) die(`${d} already has a project`);
  const aspect = opts.aspect || "16:9"; if (!SIZES[aspect]) die("aspect must be one of " + Object.keys(SIZES).join(", "));
  fs.mkdirSync(path.join(d, "src", "assets"), { recursive: true });
  const plat = opts.platform || (aspect === "9:16" ? "tiktok" : "");
  if (plat && !SAFE[plat] && !["youtube", "linkedin", "x", "website"].includes(plat)) die("platform must be tiktok, reels, shorts, youtube, linkedin, x or website");
  const proj = { name: path.basename(d), aspect, platform: plat, length: +(opts.length || (aspect === "9:16" ? 30 : 60)), fps: 30, voice: "af_heart", speed: 0.95, music: "warm", ...(aspect === "9:16" ? { lead: 0.4, pre: 0.3, post: 0.7, tail: 2.0 } : { lead: 0.9, pre: 0.6, post: 1.2, tail: 2.5 }),
    lexicon: {}, scenes: [
      { id: "s1", say: "Replace this with the hook: one sentence that makes people care." },
      { id: "s2", say: "Replace this with the main point, shown on screen while it is said." },
      { id: "s3", say: "Replace this with the call to action." } ],
    events: { s2: { card: { t: 0.2, sfx: "pop" } } } };
  if (mode !== "narrated") {                                   // footage / film: scenes in seconds, no narration fields
    for (const k of ["voice", "speed", "lead", "pre", "post", "tail", "lexicon"]) delete proj[k];
    const L = proj.length, third = +(L / 3).toFixed(2);
    proj.mode = mode; proj.scenes = [{ id: "s1", start: 0, end: third }, { id: "s2", start: third, end: +(2 * third).toFixed(2) }, { id: "s3", start: +(2 * third).toFixed(2), end: L }];
    proj.events = { s2: { card: { t: 0.2, sfx: "pop" } } };
    if (mode === "footage") { proj.edit = { clips: [{ src: "src/footage/clip1.mp4", in: 0, out: third }], grade: "warm", clean_voice: true }; fs.mkdirSync(path.join(d, "src", "footage"), { recursive: true }); }
    else { proj.music = { file: "src/assets/score.wav", start: 0, gain_db: 0 }; proj.transition_whoosh = false; }
  }
  fs.writeFileSync(path.join(d, "project.json"), JSON.stringify(proj, null, 2));
  let html = fs.readFileSync(path.join(SKILL, "template", "index.html"), "utf8");
  if (opts.look) html = html.replace('data-look="paper"', `data-look="${opts.look}"`);
  fs.writeFileSync(path.join(d, "src", "index.html"), html);
  for (const f of ["brief.md", "shots.md", "feedback.md"])
    fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(SKILL, "template", f), "utf8").replace(/\{\{NAME\}\}/g, proj.name));
  const steps = { narrated: `  1. studio budget ${dir}, then write the narration in project.json (scenes[].say)\n  2. studio voice ${dir}   3. studio audio ${dir}   (then studio words ${dir}, add events, studio audio again)`,
    footage: `  1. put clips in src/footage/ and list them in project.json "edit.clips" (src, in, out)\n  2. studio cut ${dir}   3. studio transcribe ${dir}   4. set scenes (start/end s of the edit)   5. studio audio ${dir}`,
    film: `  1. put the music at src/assets/score.wav (the user's track or your own score script)\n  2. set scenes (start/end in seconds, e.g. one per bar)   3. studio audio ${dir}` }[mode];
  say(`New ${mode} project: ${d}  (${aspect}${plat ? ", " + plat : ""}, ${proj.length} s)\n  0. fill brief.md and shots.md (the plan) and get the user's OK\n${steps}\n  then: write src/index.html → studio stills ${dir} (look!) → studio render ${dir} → studio check ${dir}`);
}

// ---------------------------------------------------------------- voice / audio
function voice(dir, only) {
  const e = env(), d = projDir(dir); needNarrated(d, "voice");
  if (only) { const ids = readJSON(path.join(d, "project.json")).scenes.map(s => s.id), bad = String(only).split(",").filter(x => !ids.includes(x));
    if (bad.length) die(`--only: no scene ${bad.join(", ")} (scenes: ${ids.join(", ")})`); }
  run(e.python, [path.join(SKILL, "scripts", "voice.py"), ENVF, d, only || ""]);
}
function audio(dir) {
  const e = env(), d = projDir(dir);
  run(e.python, [path.join(SKILL, "scripts", "audio.py"), d, e.ffmpeg]);
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", path.join(d, "audio", "mix_raw.wav"), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", path.join(d, "audio", "mix.wav")]);
  say("wrote timing.js and audio/mix.wav (-14 LUFS)");
}

// ---------------------------------------------------------------- compose
const LINT = [[/Math\.random/, "Math.random (use fixed values)"], [/Date\.now|new Date\(|performance\.now/, "clock time"],
  [/setTimeout|setInterval|requestAnimationFrame/, "timers (use tl.to at a time)"], [/@keyframes|animation\s*:|transition\s*:/, "CSS animation/transition (use GSAP)"],
  [/\b(gsap|tl|timeline)\s*\.\s*(from|fromTo)\(/, "gsap .from/.fromTo (use gsap.set + tl.to)"], [/(src|href)\s*=\s*["']https?:|url\(\s*["']?https?:|import\s.*["']https?:/, "network URL (put files in src/assets)"]];
function compose(dir) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json"));
  const tf = path.join(d, "timing.json"); if (!fs.existsSync(tf)) die("run `studio audio` first (timing.json missing)");
  const timing = readJSON(tf); const [W, Hh] = SIZES[proj.aspect || "16:9"];
  let html = fs.readFileSync(path.join(d, "src", "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, "");   // comments are for authors only
  const errors = [];
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
  const c = path.join(d, "comp"); fs.rmSync(c, { recursive: true, force: true }); fs.mkdirSync(path.join(c, "audio"), { recursive: true });
  fs.writeFileSync(path.join(c, "index.html"), html);
  copy(path.join(SKILL, "template", "lib.js"), path.join(c, "lib.js"));
  copy(path.join(SKILL, "template", "looks.css"), path.join(c, "looks.css"));
  copy(path.join(SKILL, "template", "sketch.js"), path.join(c, "sketch.js"));
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
  try { const j = JSON.parse(r.stdout); const errs = (j.findings || j.issues || []).filter(f => (f.severity || f.level) === "error");
        if (errs.length) { errs.forEach(f => console.error("  ✗ lint: " + (f.message || JSON.stringify(f)))); die("HyperFrames lint found errors"); } }
  catch { /* lint output format differs: ignore, render will still validate */ }
  say(`composed ${c}  (${W}x${Hh}, ${timing.TOTAL} s)`);
}

// ---------------------------------------------------------------- stills
function stills(dir, times) {
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
  const proj = readJSON(path.join(d, "project.json")), plat = (flagsGlobal.platform || proj.platform || "").toLowerCase();
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
function sheet(e, files, outFile, W = 1920, H = 1080) {
  files = files.filter(f => fs.existsSync(f)); if (!files.length) return;
  const tw = 480, th = Math.round(tw * H / W / 2) * 2, cols = Math.min(4, files.length), rows = Math.ceil(files.length / cols);
  const inputs = files.flatMap(f => ["-i", f]);
  let fc = files.map((_, i) => `[${i}]scale=${tw}:${th},setsar=1,format=yuv420p[v${i}];`).join("");
  const blank = rows * cols - files.length;
  for (let i = 0; i < blank; i++) fc += `color=c=0x222222:s=${tw}x${th},format=yuv420p[b${i}];`;
  const all = [...files.map((_, i) => `[v${i}]`), ...Array.from({ length: blank }, (_, i) => `[b${i}]`)];
  const rowsOut = [];
  for (let r = 0; r < rows; r++) { const seg = all.slice(r * cols, r * cols + cols); fc += cols > 1 ? `${seg.join("")}hstack=${cols}[r${r}];` : `${seg[0]}null[r${r}];`; rowsOut.push(`[r${r}]`); }
  fc += rows > 1 ? `${rowsOut.join("")}vstack=${rows}` : `${rowsOut[0]}null`;
  run(e.ffmpeg, ["-loglevel", "error", "-y", ...inputs, "-filter_complex", fc, "-frames:v", "1", outFile], { soft: true });
}

// ---------------------------------------------------------------- render
function render(dir, draft) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json"));
  compose(dir);
  const out = path.join(d, "out"); fs.mkdirSync(out, { recursive: true });
  const prev = fs.readdirSync(out).filter(f => f.endsWith(".mp4") || f.startsWith("source-") || f === "check.json");
  if (prev.some(f => f.endsWith(".mp4"))) {                                // keep the previous version with the sources that made it
    const h = path.join(d, "history", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)); fs.mkdirSync(h, { recursive: true });
    for (const f of prev) fs.renameSync(path.join(out, f), path.join(h, f));
    say(`previous version kept in ${path.relative(d, h)}/`);
  }
  const raw = path.join(out, "render-raw.mp4"), fin = path.join(out, `${proj.name}-${(proj.aspect || "16:9").replace(":", "x")}.mp4`);
  const args = ["render", path.join(d, "comp"), "-o", raw, "--player-ready-timeout", "60000"];
  if (draft) args.push("--quality", "draft");
  let r = hf(e, args, { soft: true });
  if (r.status !== 0) { say("render failed once; retrying (the first browser start can time out)"); hf(e, args); }
  // AAC encoding lowers loudness slightly: normalise the final file again, video untouched
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", raw, "-c:v", "copy", "-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", fin]);
  fs.rmSync(raw, { force: true });
  copy(path.join(d, "project.json"), path.join(out, "source-project.json")); copy(path.join(d, "src", "index.html"), path.join(out, "source-index.html"));
  say(`rendered ${fin}`);
  const mb = fs.statSync(fin).size / 1048576;
  if (mb > 25) {                            // chat apps and Claude's file sharing cap uploads (about 25–30 MB)
    const dur = parseFloat(run(e.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", fin], { capture: true }).stdout);
    const kbps = Math.max(150, Math.floor(23 * 8192 / dur - 128 - 30)), share = fin.replace(/\.mp4$/, "-share.mp4");   // 23 MB budget: video + 128k audio + container
    const scale = kbps < 900 ? ["-vf", "scale=-2:720"] : [];                                                               // long videos: 720p keeps it watchable
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", fin, ...scale, "-c:v", "libx264", "-preset", "slow", "-b:v", `${kbps}k`, "-maxrate", `${Math.floor(kbps * 1.2)}k`, "-bufsize", `${kbps * 2}k`,
                   "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", share]);
    say(`${mb.toFixed(0)} MB is too big to send in chat: share copy ${share} (${(fs.statSync(share).size / 1048576).toFixed(0)} MB)`);
  }
  return fin;
}

// ---------------------------------------------------------------- reference
// a reference video from the user → reference/sheet.jpg (one frame every N s) + reference/cuts.json (shot changes)
function reference(dir, video, every) {
  const e = env(), d = projDir(dir), N = parseFloat(every || 2);
  if (!video) die("usage: studio reference <dir> <video> [--every 2]"); needFile(video, "video");
  const out = path.join(d, "reference"); fs.mkdirSync(out, { recursive: true });
  const dur = parseFloat(run(e.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], { capture: true }).stdout);
  const n = Math.ceil(dur / N), cols = 4, rows = Math.ceil(n / cols);
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", video, "-vf", `fps=1/${N},scale=480:-2,tile=${cols}x${rows}`, "-frames:v", "1", path.join(out, "sheet.jpg")]);
  const log = run(e.ffmpeg, ["-hide_banner", "-i", video, "-vf", "select='gt(scene,0.3)',showinfo", "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const cuts = [...log.matchAll(/pts_time:([\d.]+)/g)].map(m => +(+m[1]).toFixed(2));
  fs.writeFileSync(path.join(out, "cuts.json"), JSON.stringify({ duration: +dur.toFixed(2), cuts }, null, 1));
  say(`reference: ${dur.toFixed(1)} s, ${cuts.length} cuts (average shot ${(dur / (cuts.length + 1)).toFixed(1)} s)\n  LOOK at ${path.relative(process.cwd(), path.join(out, "sheet.jpg"))} and write the style card in brief.md (references/cinema.md §1)`);
}

// ---------------------------------------------------------------- check
function check(dir) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json")), timing = readJSON(path.join(d, "timing.json"));
  const out = path.join(d, "out"); const mp4 = fs.existsSync(out) && fs.readdirSync(out).filter(f => f.endsWith(".mp4") && !/-share\.mp4$|^render-raw/.test(f)).map(f => path.join(out, f))[0];
  if (!mp4) die("no video yet: run `studio render` first");
  const res = { file: mp4, checks: [] }; const add = (name, ok, info) => res.checks.push({ name, ok, info });
  const pr = JSON.parse(run(e.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate:format=duration", "-of", "json", mp4], { capture: true }).stdout);
  const v = pr.streams.find(s => s.codec_type === "video"), a = pr.streams.find(s => s.codec_type === "audio"), dur = +pr.format.duration;
  const [W, Hh] = SIZES[proj.aspect || "16:9"];
  add("video stream", !!v && v.codec_name === "h264" && v.width === W && v.height === Hh, v ? `${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate}` : "missing");
  add("audio stream", !!a && a.codec_name === "aac", a ? a.codec_name : "missing (every data-start element needs an id)");
  add("duration", Math.abs(dur - timing.TOTAL) <= 0.15, `${dur.toFixed(2)} s (timeline ${timing.TOTAL} s ± 0.15 s)`);
  if (proj.length) add("target length", dur <= proj.length * 1.05, `${dur.toFixed(1)} s (target ${proj.length} s)` + (dur < proj.length * 0.8 ? ` — note: ${Math.round(100 - 100 * dur / proj.length)}% shorter than the target; fine if on purpose` : ""));
  const lo = run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const I = +(lo.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)[0], TP = +(lo.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)[0];
  add("loudness", Math.abs(I + 14) <= 1, `${I} LUFS (target -14 ±1)`); add("true peak", TP <= -1.0, `${TP} dBTP (max -1.0)`);
  const bl = run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-vf", "blackdetect=d=0.5:pic_th=0.98", "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const blacks = (bl.match(/black_start/g) || []).length; add("no black frames", blacks === 0, `${blacks} black stretch(es) ≥ 0.5 s`);
  const fr = run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-vf", "freezedetect=n=0.001:d=4", "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const frozen = [...fr.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map(m => `${(+m[1]).toFixed(1)} s for ${(+m[2]).toFixed(1)} s`);
  add("nothing frozen ≥ 4 s", frozen.length === 0, frozen.length ? "still at " + frozen.join(", ") + " (add motion there)" : "ok");
  const sd = path.join(d, "stills"); fs.mkdirSync(sd, { recursive: true });
  const frames = Object.entries(timing.T).map(([s, t]) => { const f = path.join(sd, `final-${s}.jpg`);
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(Math.min(t.vo_end, t.end - 0.5)), "-i", mp4, "-frames:v", "1", "-q:v", "3", f], { soft: true }); return f; });
  sheet(e, frames, path.join(sd, "final-sheet.jpg"), W, Hh);
  res.sheet = path.join(sd, "final-sheet.jpg"); res.pass = res.checks.every(c => c.ok);
  fs.writeFileSync(path.join(out, "check.json"), JSON.stringify(res, null, 2));
  for (const c of res.checks) say(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.info}`);
  say(`contact sheet: ${res.sheet}\n${res.pass ? "All automatic checks passed. Now LOOK at the contact sheet and watch the video before delivering." : "Fix the FAIL lines (references/checks-and-fixes.md), then render and check again."}`);
  if (!res.pass) process.exit(2);
}


// ---------------------------------------------------------------- cut (footage)
// project.json "edit": {"clips": [{"src": "src/footage/c4.mp4", "in": 0.4, "out": 8.7}, ...], "grade": "warm|neutral|none", "clean_voice": true}
function cut(dir) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json")), ed = proj.edit;
  if (!ed || !ed.clips || !ed.clips.length) die('add "edit": {"clips": [{"src", "in", "out"}]} to project.json');
  const [W, Hh] = SIZES[proj.aspect || "9:16"], fps = proj.fps || 30;
  const grade = { warm: "colortemperature=temperature=5400,eq=saturation=1.2:contrast=1.05,unsharp=5:5:0.4", neutral: "eq=saturation=1.05:contrast=1.03", none: "null" }[ed.grade || "warm"];
  const clean = ed.clean_voice === false ? "anull" : "highpass=f=80,afftdn=nf=-25,equalizer=f=3000:t=q:w=1.2:g=3,acompressor=threshold=-20dB:ratio=3:attack=5:release=80";
  const work = path.join(d, "work"); fs.rmSync(work, { recursive: true, force: true }); fs.mkdirSync(work, { recursive: true });
  const list = [], auds = [];
  ed.clips.forEach((c, i) => {
    const src = path.resolve(d, c.src), len = c.out - c.in; if (!fs.existsSync(src)) die(`clip not found: ${src}`);
    const v = path.join(work, `v${i}.mp4`), a = path.join(work, `a${i}.wav`);
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(c.in), "-t", String(len), "-i", src, "-an",
      "-vf", `scale=${W}:${Hh}:force_original_aspect_ratio=increase,crop=${W}:${Hh},fps=${fps},${grade},format=yuv420p`, "-c:v", "libx264", "-crf", "16", "-preset", "fast", v]);
    const hasAudio = run(e.ffprobe, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", src], { capture: true }).stdout.trim();
    if (hasAudio) run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(c.in), "-t", String(len), "-i", src, "-vn", "-ac", "1", "-ar", "24000",
      "-af", `${clean},afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, len - 0.012)}:d=0.012`, a]);
    else run(e.ffmpeg, ["-loglevel", "error", "-y", "-f", "lavfi", "-t", String(len), "-i", "anullsrc=r=24000:cl=mono", a]);
    list.push(`file '${v.replace(/'/g, "'\\''")}'`); auds.push(a);
  });
  fs.writeFileSync(path.join(work, "list.txt"), list.join("\n"));
  fs.mkdirSync(path.join(d, "src", "assets"), { recursive: true }); fs.mkdirSync(path.join(d, "audio"), { recursive: true });
  run(e.ffmpeg, ["-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", path.join(work, "list.txt"), "-c", "copy", path.join(d, "src", "assets", "base.mp4")]);
  run(e.ffmpeg, ["-loglevel", "error", "-y", ...auds.flatMap(a => ["-i", a]), "-filter_complex", `${auds.map((_, i) => `[${i}]`).join("")}concat=n=${auds.length}:v=0:a=1`, path.join(d, "audio", "voice.wav")]);
  const total = +run(e.ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(d, "src", "assets", "base.mp4")], { capture: true }).stdout.trim();
  let t = 0; const cuts = ed.clips.map(c => { const s = t; t += c.out - c.in; return +s.toFixed(3); });
  fs.writeFileSync(path.join(d, "cuts.json"), JSON.stringify({ total, cuts }, null, 1));
  fs.rmSync(work, { recursive: true, force: true });
  say(`cut: src/assets/base.mp4 (${W}x${Hh}, ${total.toFixed(2)} s, cuts at ${cuts.join(", ")} s) and audio/voice.wav\nnext: studio transcribe ${dir}  (word timings for captions and overlays)`);
}

// ---------------------------------------------------------------- transcribe / words
function transcribe(dir, media) {
  const e = env(), d = projDir(dir);
  const src = path.resolve(media || path.join(d, "audio", "voice.wav"));
  const r = hf(e, ["transcribe", src, "-d", d, "--json", "-m", "small.en"], { capture: true, soft: true });
  const out = (r.stdout || "").trim().split("\n").pop();
  if (r.status !== 0 || !fs.existsSync(path.join(d, "transcript.json"))) die(`transcribe failed: ${out || r.stderr}\n(The first run downloads the Whisper model from huggingface.co; it needs internet. Or import captions: studio transcribe ${dir} my.srt)`);
  say(`transcript.json written (${readJSON(path.join(d, "transcript.json")).length} words). Fix misheard brand words with "caption_fixes" in project.json.`);
}
// narrated videos: word timings estimated from the script (character-proportional inside each line)
function words(dir) {
  const d = projDir(dir), proj = readJSON(path.join(d, "project.json"));
  if ((proj.mode || "narrated") !== "narrated") die(`words estimates timings from the narration; this is a ${proj.mode} project (use studio transcribe for footage). transcript.json was not touched.`);
  if (!fs.existsSync(path.join(d, "timing.json"))) die(`no timing.json yet: run studio audio ${dir} first (it times the scenes)`);
  const timing = readJSON(path.join(d, "timing.json"));
  const out = [];
  for (const s of proj.scenes) { const t = timing.T[s.id]; const ws = String(s.say || "").split(/\s+/).filter(Boolean); if (!ws.length) continue;
    const tot = ws.reduce((a, w) => a + w.length + 1, 0); let c = t.vo;
    ws.forEach(w => { const dur = (t.vo_end - t.vo) * (w.length + 1) / tot; out.push({ text: w, start: +c.toFixed(3), end: +(c + dur).toFixed(3) }); c += dur; }); }
  fs.writeFileSync(path.join(d, "transcript.json"), JSON.stringify(out, null, 1));
  say(`transcript.json: ${out.length} words (estimated timing, ±0.25 s)`);
}
function beats(dir, song, start) {
  const e = env(), d = projDir(dir); if (!song) die("usage: studio beats <dir> <song file> [--start seconds]"); needFile(song, "song");
  run(e.python, [path.join(SKILL, "scripts", "beats.py"), e.ffmpeg, d, path.resolve(song), start || ""]);
}

// ---------------------------------------------------------------- budget / say
function budget(dir) {
  const d = projDir(dir); needNarrated(d, "budget"); const p = readJSON(path.join(d, "project.json")), n = p.scenes.length, L = +(p.length || 30);
  const DEF = { lead: 0.9, pre: 0.6, post: 1.5, tail: 2.5 }, g = k => (p[k] ?? DEF[k]),   // the same defaults as audio.py
        pauses = g("lead") + g("tail") + p.scenes.reduce((a, s, i) => a + (i ? (s.pre ?? g("pre")) : 0) + (s.post ?? g("post")) + (s.hold || 0), 0);
  const narr = L - pauses, wps = 2.8 * (p.speed || 0.95) / 0.95;
  say(`target ${L} s = pauses ${pauses.toFixed(1)} s (lead ${g("lead")}, pre ${g("pre")} and post ${g("post")} per scene, tail ${g("tail")}) + narration ${narr.toFixed(1)} s`);
  say(`→ about ${Math.round(narr * wps)} words in total at speed ${p.speed || 0.95}, about ${Math.round(narr * wps / n)} per scene for ${n} scenes`);
  if (narr < n * 2) say("  too little narration time: use fewer scenes, shorter pauses, or a longer video");
}
function sayLine(dir, text, v) {
  const e = env(), d = projDir(dir); if (!text) die('usage: studio say <dir> "HAURA Scent" [--voice af_heart]');
  const p = readJSON(path.join(d, "project.json")); const tmpP = path.join(d, "audio", "say-project");
  fs.mkdirSync(tmpP, { recursive: true });
  fs.writeFileSync(path.join(tmpP, "project.json"), JSON.stringify({ voice: v || p.voice || "af_heart", speed: p.speed || 0.95, lexicon: p.lexicon || {}, scenes: [{ id: "say", say: text }] }));
  const r = run(e.python, [path.join(SKILL, "scripts", "voice.py"), ENVF, tmpP, ""], { capture: true, soft: true });
  if (r.status !== 0) { fs.rmSync(tmpP, { recursive: true, force: true }); die(`say failed (unknown voice?): ${(r.stderr || "").trim().split("\n").pop()}`); }
  copy(path.join(tmpP, "audio", "vo", "say.wav"), path.join(d, "audio", "say.wav")); fs.rmSync(tmpP, { recursive: true, force: true });
  say(`wrote ${path.join(d, "audio", "say.wav")}: send it to the user to confirm the pronunciation (fix spelling in "lexicon")`);
}

// ---------------------------------------------------------------- silences / scenes (find cut points in footage)
function silences(dir, clip, flags) {
  const e = env(), d = projDir(dir); if (!clip) die("usage: studio silences <dir> <clip> [--db -32] [--min 0.4]");
  needFile(clip, "clip"); const db = flags.db || -32, min = flags.min || 0.4;
  const r = run(e.ffmpeg, ["-hide_banner", "-i", path.resolve(clip), "-af", `silencedetect=noise=${db}dB:d=${min}`, "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const st = [...r.matchAll(/silence_start: ([\d.]+)/g)].map(m => +m[1]), en = [...r.matchAll(/silence_end: ([\d.]+)/g)].map(m => +m[1]);
  const dur = +(r.match(/Duration: (\d+):(\d+):([\d.]+)/) || [0, 0, 0, 0]).slice(1).reduce((a, x, i) => a + x * [3600, 60, 1][i], 0);
  const gaps = st.map((s, i) => ({ start: +s.toFixed(2), end: +(en[i] ?? dur).toFixed(2) }));
  // speech = the complement of the silences; each piece is a candidate "clip" for project.json edit.clips (0.12 s padding)
  const speech = []; let t = 0;
  for (const g of gaps) { if (g.start - t > 0.2) speech.push({ in: +Math.max(0, t - 0.12).toFixed(2), out: +Math.min(dur, g.start + 0.12).toFixed(2) }); t = g.end; }
  if (dur - t > 0.2) speech.push({ in: +Math.max(0, t - 0.12).toFixed(2), out: +dur.toFixed(2) });
  const out = { clip, duration: +dur.toFixed(2), silences: gaps, speech };
  fs.writeFileSync(path.join(d, `silences-${path.basename(clip).replace(/\.\w+$/, "")}.json`), JSON.stringify(out, null, 1));
  say(`${gaps.length} pauses ≥ ${min} s; ${speech.length} speech pieces (saved as silences-*.json; paste the pieces you keep into edit.clips)`);
  speech.forEach(p => say(`  speech ${p.in}–${p.out} s`));
}
function scenes(dir, clip, flags) {
  const e = env(), d = projDir(dir); if (!clip) die("usage: studio scenes <dir> <clip> [--threshold 0.3]"); needFile(clip, "clip");
  const th = flags.threshold || 0.3;
  const r = run(e.ffmpeg, ["-hide_banner", "-i", path.resolve(clip), "-vf", `select='gt(scene,${th})',showinfo`, "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const cuts = [...r.matchAll(/pts_time:([\d.]+)/g)].map(m => +(+m[1]).toFixed(2));
  fs.writeFileSync(path.join(d, `scenes-${path.basename(clip).replace(/\.\w+$/, "")}.json`), JSON.stringify({ clip, threshold: th, cuts }, null, 1));
  say(`${cuts.length} shot changes: ${cuts.join(", ")}`);
}

// ---------------------------------------------------------------- main
const [cmd, ...rest] = process.argv.slice(2);
const flags = {}; const pos = []; var flagsGlobal = flags;
for (let i = 0; i < rest.length; i++) { if (rest[i].startsWith("--")) { const k = rest[i].slice(2); flags[k] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true; } else pos.push(rest[i]); }
const HELP = `Synergy Studio (lite): videos written as HTML + GSAP (+ SVG, canvas, three.js), rendered by HyperFrames.
Usage: node <skill>/scripts/studio.mjs <command> [args]. Full reference: references/commands.md. Tool home: ${H}
Modes (project.json "mode"): narrated (voice sets the timing) · footage (your clips, studio cut) · film (wordless, your music, scenes in seconds)
 once
  setup                     one-time install (HyperFrames + Chrome, Kokoro voice, ffmpeg; about 1.1 GB)
  doctor                    check the install
 every video
  new <dir> [--mode narrated|footage|film] [--aspect 16:9|9:16|1:1|4:5] [--platform tiktok|reels|shorts|meta|youtube|linkedin|x|website]
            [--length 30] [--look paper|midnight|bold|luxe]      project skeleton (default 16:9; 9:16 defaults to tiktok)
  budget <dir>              narrated: words that fit per scene for the target length (run before writing the narration)
  say <dir> "text" [--voice v]  narrated: one line of speech → audio/say.wav (let the user check a pronunciation)
  voice <dir> [--only s2,s4]  narrated: Kokoro narration → audio/vo/*.wav + durations.json
  audio <dir>               all modes: scene timing (timing.json/js) + music + effects + mix (-14 LUFS)
  words <dir>               narrated: estimated word times → transcript.json (captions, event cues)
  compose <dir>             fill timings into src/index.html → comp/ (+ lint); stills and render run it for you
  stills <dir> [t1 t2 …] [--platform p]  frames → stills/sheet.jpg (+ safe-<platform>.jpg for 9:16): LOOK at them
  render <dir> [--draft]    MP4 → out/<name>-<aspect>.mp4 (+ -share.mp4 if over 25 MB); the old one moves to history/
  check <dir>               8 automatic checks → out/check.json + stills/final-sheet.jpg
 footage, music, reference
  cut <dir>                 project.json "edit.clips" → src/assets/base.mp4 + audio/voice.wav (+ cuts.json)
  transcribe <dir> [file]   words from audio/voice.wav with Whisper (needs internet once), or import a .srt/.vtt/.json → transcript.json
  silences <dir> <clip> [--db -32 --min 0.4]  pauses and speech pieces → silences-<clip>.json
  scenes <dir> <clip> [--threshold 0.3]       shot changes → scenes-<clip>.json
  beats <dir> <song> [--start s]  beat grid (times from --start) → beats.json
  reference <dir> <video> [--every 2]         reference study: contact sheet + cut rhythm → reference/`;
switch (cmd) {
  case "setup": setup(); break;
  case "doctor": doctor(); break;
  case "new": newProject(pos[0], flags); break;
  case "voice": voice(pos[0], flags.only); break;
  case "audio": audio(pos[0]); break;
  case "compose": compose(pos[0]); break;
  case "stills": stills(pos[0], pos.slice(1)); break;
  case "render": render(pos[0], !!flags.draft); break;
  case "check": check(pos[0]); break;
  case "cut": cut(pos[0]); break;
  case "transcribe": transcribe(pos[0], pos[1]); break;
  case "words": words(pos[0]); break;
  case "beats": beats(pos[0], pos[1], flags.start); break;
  case "silences": silences(pos[0], pos[1], flags); break;
  case "budget": budget(pos[0]); break;
  case "say": sayLine(pos[0], pos[1], flags.voice); break;
  case "scenes": scenes(pos[0], pos[1], flags); break;
  case "reference": reference(pos[0], pos[1], flags.every); break;
  case undefined: case "help": case "--help": case "-h": say(HELP); break;
  default: say(HELP); die(`unknown command: ${cmd}`);
}
