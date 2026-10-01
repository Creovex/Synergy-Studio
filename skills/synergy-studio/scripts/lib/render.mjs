import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { H, die, say, run, env, hf, readJSON, copy, projDir, parseArgs } from "./common.mjs";
import { compose } from "./compose.mjs";
import { withHeavyLock } from "./lock.mjs";
import { LUFS_TARGET, LUFS_TOLERANCE, masterGain, masterChain, measureFile } from "./master.mjs";

export const USAGE = "render <dir> [--draft]";

// ---------------------------------------------------------------- render
const TP_LIMIT = -1.5;                     // the final MP4 must land at -14 ± 0.3 LUFS with a true peak of at most -1.5 dBTP
const RENDER_LIMIT = 0.70;                 // linear, about -3.1 dBFS: AAC overshoot then stays under -1 dBTP

// The final sound comes from the lossless mix when there is one (not the AAC track the renderer muxed, so there is no second
// lossy pass; the owner's fix of 2026-09-30), trimmed to the timeline. The gain is searched with the 4x oversampled limiter in
// the measured chain (master.mjs), so a peaky score lands on -14 LUFS instead of under it. The finished file is measured again
// (AAC shifts the level a little); if it is outside the target the gain is corrected by the miss, or the limit is lowered when the
// peak is too high, and the encode is repeated (at most three encodes). Video is copied untouched.
export function normaliseLoudness(e, raw, fin, mix = null, total = null) {
  const src = mix && fs.existsSync(mix) ? mix : raw, audioIn = src === raw ? [] : ["-i", src], map = src === raw ? [] : ["-map", "0:v:0", "-map", "1:a:0"];
  // trimmed first in the filter chain: loudnorm shifts timestamps, so a trim after it (or an output -t) ends the sound about 0.07 s early
  const trim = Number.isFinite(total) && total > 0 ? `apad,atrim=end=${total},` : "";
  let limit = RENDER_LIMIT, m = masterGain(e, src, limit, { trim, log: say });
  if (m.silent) {                                            // a silent mix is kept silent: no gain, still an audio track
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", raw, ...audioIn, ...map, "-c:v", "copy", "-af", masterChain(0, limit, trim), "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", fin]);
    return { I: null, TP: null, silent: true };
  }
  if (!m.reachable) die(`the final mix is too peaky to master (it only reaches ${m.I} LUFS after the limiter): run studio audio again, with a less peaky track, softer hits or a lower "gain_db"`);
  let gain = m.gain, last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", raw, ...audioIn, ...map, "-c:v", "copy", "-af", masterChain(gain, limit, trim), "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", fin]);
    last = measureFile(e, fin);
    if (last.I === null || last.TP === null) die("could not measure the loudness of the finished file");
    const over = last.TP - TP_LIMIT, miss = last.I - LUFS_TARGET;
    if (Math.abs(miss) <= LUFS_TOLERANCE && over <= 0) break;
    if (over > 0) { limit = +(limit * 10 ** (-(over + 0.1) / 20)).toFixed(4); m = masterGain(e, src, limit, { trim }); gain = m.gain; }   // lower the ceiling, search the gain again
    else gain -= miss;
  }
  return last;
}

// the caption record the page keeps in window.__SS.captions, read from the composed page in the render browser
// (the same Chrome HyperFrames renders with). Returns an array, or null when the page never calls captions().
export async function readCaptions(e, compDir, timeoutMs = 30000) {
  const puppeteer = createRequire(path.join(e.node_modules, "noop.js"))("puppeteer-core");
  if (!e.browser?.path || !fs.existsSync(e.browser.path)) throw new Error("the render browser is not installed: run setup again");
  const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".wav": "audio/wav", ".mp4": "video/mp4", ".woff2": "font/woff2", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
  const server = http.createServer((req, res) => {                          // module scripts (three.js) do not load from file://
    const file = path.join(compDir, decodeURIComponent(new URL(req.url, "http://127.0.0.1").pathname).replace(/\/$/, "/index.html"));
    if (path.relative(compDir, file).startsWith("..") || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
    res.writeHead(200, { "Content-Type": types[path.extname(file).toLowerCase()] || "application/octet-stream" }); fs.createReadStream(file).pipe(res);
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "ss-browser-")); let browser;
  try {
    browser = await puppeteer.launch({ executablePath: e.browser.path, headless: "shell", userDataDir: profile, args: ["--mute-audio"] });
    const page = await browser.newPage(); const errors = []; page.on("pageerror", x => errors.push(x.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, { waitUntil: "load", timeout: timeoutMs });
    try { await page.waitForFunction("!!(window.__timelines && window.__timelines.main)", { timeout: timeoutMs }); }   // the expression must be a boolean (a timeline object is not accepted as truthy)
    catch { throw new Error("the page never registered its timeline" + (errors.length ? ": " + errors[0] : "")); }
    return await page.evaluate("window.__SS && Array.isArray(window.__SS.captions) ? JSON.parse(JSON.stringify(window.__SS.captions)) : null");
  } finally { if (browser) await browser.close().catch(() => {}); server.close(); fs.rmSync(profile, { recursive: true, force: true }); }
}

async function renderLocked(dir, draft) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json"));
  if (!fs.existsSync(path.join(d, "audio", "mix.wav"))) die(`audio/mix.wav is missing: run studio audio ${dir} first (it builds the sound; a failed run removes the old one)`);
  compose(dir);
  const out = path.join(d, "out"); fs.mkdirSync(out, { recursive: true });
  const prev = fs.readdirSync(out).filter(f => f.endsWith(".mp4") || f.startsWith("source-") || f === "check.json" || f === "captions.json");
  if (prev.some(f => f.endsWith(".mp4"))) {                                // keep the previous version with the sources that made it
    const h = path.join(d, "history", new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)); fs.mkdirSync(h, { recursive: true });
    for (const f of prev) fs.renameSync(path.join(out, f), path.join(h, f));
    say(`previous version kept in ${path.relative(d, h)}/`);
  }
  fs.rmSync(path.join(out, "captions.json"), { force: true });
  try {                                                                    // the page's caption record (only pages that call captions())
    const rec = await readCaptions(e, path.join(d, "comp"));
    if (rec) { fs.writeFileSync(path.join(out, "captions.json"), JSON.stringify(rec, null, 1)); say(`captions: ${rec.length} group(s) saved to out/captions.json`); }
  } catch (err) { say(`  ! could not read the caption record from the page: ${err.message}`); }
  const raw = path.join(out, "render-raw.mp4"), fin = path.join(out, `${proj.name}-${(proj.aspect || "16:9").replace(":", "x")}.mp4`);
  const args = ["render", path.join(d, "comp"), "-o", raw, "--fps", String(proj.fps || 30), "--player-ready-timeout", "60000"];
  if (draft) args.push("--quality", "draft");
  let r = hf(e, args, { soft: true });
  if (r.status !== 0) { say("render failed once; retrying (the first browser start can time out)"); hf(e, args); }
  // final sound from the lossless mix: gain searched through the limiter and measured, video untouched
  const tf = path.join(d, "timing.json"), total = fs.existsSync(tf) ? +readJSON(tf).TOTAL : null;
  const lu = normaliseLoudness(e, raw, fin, path.join(d, "comp", "audio", "mix.wav"), total);
  if (lu.silent) say("  ! the final sound is silent: the video has an audio track with no sound in it.");
  else say(`final loudness ${lu.I} LUFS, true peak ${lu.TP} dBTP`);
  if (!lu.silent && (!(Math.abs(lu.I - LUFS_TARGET) <= LUFS_TOLERANCE) || !(lu.TP <= TP_LIMIT))) say(`  ! the final sound is outside ${LUFS_TARGET} ± ${LUFS_TOLERANCE} LUFS with a true peak of at most ${TP_LIMIT} dBTP after three encodes`);
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

// takes the heavy lock (one setup, render or transcription at a time) and waits for it, saying so
export async function renderProject(dir, draft) {
  return withHeavyLock(H, `render ${path.basename(path.resolve(dir))}`, () => renderLocked(dir, draft), { log: say });
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  await renderProject(pos[0], !!flags.draft);
  return 0;
}
