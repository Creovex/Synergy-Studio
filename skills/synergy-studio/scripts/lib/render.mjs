import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { H, die, say, run, env, hf, readJSON, copy, projDir, parseArgs } from "./common.mjs";
import { compose } from "./compose.mjs";
import { withHeavyLock } from "./lock.mjs";

export const USAGE = "render <dir> [--draft]";

// ---------------------------------------------------------------- render
const LUFS_TARGET = -14, LUFS_TOLERANCE = 0.4, TP_LIMIT = -1.5;    // the final MP4 must land at -14 ± 0.5 LUFS with a true peak of at most -1.5 dBTP

// measure integrated loudness and true peak of a file's audio with ffmpeg's ebur128
function measure(e, file) {
  const lo = run(e.ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const I = +(lo.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)[0], TP = +(lo.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)[0];
  return { I, TP };
}

// AAC encoding shifts loudness and peaks slightly. Pass one measures the render with loudnorm; pass two applies that measurement
// linearly (no dynamic processing) while encoding; the finished file is measured again and, if it is outside the target, the peak
// ceiling is lowered by the overshoot and the encode is repeated (at most three encodes). Video is copied untouched.
export function normaliseLoudness(e, raw, fin) {
  const m = run(e.ffmpeg, ["-hide_banner", "-nostats", "-i", raw, "-vn", "-af", `loudnorm=I=${LUFS_TARGET}:TP=${TP_LIMIT}:LRA=11:print_format=json`, "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const j = (() => { try { return JSON.parse(m.slice(m.lastIndexOf("{"), m.lastIndexOf("}") + 1)); } catch { return null; } })();
  if (!j || !Number.isFinite(+j.input_i)) die("could not measure the loudness of the render (ffmpeg loudnorm gave no numbers)");
  let ceiling = TP_LIMIT, last = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const af = `loudnorm=I=${LUFS_TARGET}:TP=${ceiling}:LRA=11:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
    run(e.ffmpeg, ["-loglevel", "error", "-y", "-i", raw, "-c:v", "copy", "-af", af, "-ar", "48000", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", fin]);
    last = measure(e, fin);
    const over = last.TP - TP_LIMIT;
    if (Math.abs(last.I - LUFS_TARGET) <= LUFS_TOLERANCE && over <= 0) break;
    if (over > 0) ceiling = +(ceiling - over - 0.1).toFixed(2);
    else ceiling = Math.min(ceiling, TP_LIMIT);
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
  // AAC encoding lowers loudness slightly: normalise the final file again (two passes), video untouched
  const lu = normaliseLoudness(e, raw, fin);
  say(`final loudness ${lu.I} LUFS, true peak ${lu.TP} dBTP`);
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
