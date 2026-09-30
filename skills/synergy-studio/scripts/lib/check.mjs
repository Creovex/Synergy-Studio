import fs from "node:fs";
import path from "node:path";
import { SKILL, SIZES, die, say, run, env, readJSON, projDir, sheet, parseArgs } from "./common.mjs";
import { videoSheet } from "./frames.mjs";

export const USAGE = "check <dir>";

const EARLY_MS = 150;                                   // a caption word may not light up more than this before its transcript start

// ---- pieces of the checks that are worth testing on their own
// a plain HyperFrames folder: the root element of its own index.html carries the size and duration
export function pageRoot(html) {
  const tag = (String(html).match(/<[a-z][^>]*\bdata-composition-id\b[^>]*>/i) || String(html).match(/<[a-z][^>]*\bid=["']root["'][^>]*>/i) || [""])[0];
  const num = k => { const m = tag.match(new RegExp(`\\bdata-${k}=["']?([\\d.]+)`)); return m ? +m[1] : null; };
  return { duration: num("duration"), width: num("width"), height: num("height"), fps: num("fps") };
}

// the arguments of the page's captions(...) call, or null when the page never calls it (comments do not count)
export function captionsCall(html) {
  const code = String(html).replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:\\])\/\/[^\n]*/g, "$1");
  const m = /(?:^|[^\w$])captions\s*\(/.exec(code); if (!m) return null;
  let i = m.index + m[0].length, depth = 1, quote = "";
  const start = i;
  for (; i < code.length && depth > 0; i++) {
    const ch = code[i];
    if (quote) { if (ch === quote && code[i - 1] !== "\\") quote = ""; continue; }
    if (ch === '"' || ch === "'" || ch === "`") quote = ch; else if (ch === "(") depth++; else if (ch === ")") depth--;
  }
  const args = code.slice(start, i - 1), num = k => { const x = args.match(new RegExp(`\\b${k}\\s*:\\s*(-?[\\d.]+)\\s*[,}]`)); return x ? +x[1] : null; };
  return { args, from: num("from"), to: num("to") };
}

// transcript entries split into single words the way captions() does (a phrase's time is shared out by word length)
export function splitWords(entries) {
  const words = [];
  for (const w of entries) {
    const parts = String(w.text).trim().split(/\s+/).filter(Boolean), tot = parts.reduce((a, p) => a + p.length + 1, 0); let t = +w.start;
    for (const p of parts) { const dd = (w.end - w.start) * (p.length + 1) / tot; words.push({ text: p, start: t, end: t + dd }); t += dd; }
  }
  return words;
}

// words the captions must show against the words the page recorded: what is missing and how early the earliest highlight is (seconds)
export function compareCaptions(expected, recorded) {
  const flat = recorded.flatMap(g => g.words || []), missing = []; let ptr = 0, maxEarly = 0;
  for (const w of expected) {
    let j = ptr; while (j < flat.length && !(flat[j].text === w.text && Math.abs(flat[j].start - w.start) <= 2)) j++;
    if (j === flat.length) { missing.push(w); continue; }
    maxEarly = Math.max(maxEarly, w.start - flat[j].start); ptr = j + 1;
  }
  return { missing, maxEarly };
}

function captionsLine(d, proj, html, dur, add) {
  const call = captionsCall(html); if (!call) return;
  const rec = path.join(d, "out", "captions.json");
  if (!fs.existsSync(rec)) return add("captions", false, "out/captions.json is missing (studio render saves it when the page calls captions())");
  let recorded; try { recorded = readJSON(rec); if (!Array.isArray(recorded)) throw new Error("not a list"); } catch (err) { return add("captions", false, `out/captions.json cannot be read (${err.message}); render again`); }
  const wf = path.join(d, "comp", "words.js"), tf = path.join(d, "transcript.json"); let entries = [];
  try {
    if (fs.existsSync(wf)) entries = JSON.parse(fs.readFileSync(wf, "utf8").replace(/^\s*window\.WORDS\s*=\s*/, "").replace(/;\s*$/, ""));   // what the page really used, caption_fixes applied
    else if (fs.existsSync(tf)) entries = readJSON(tf);
  } catch (err) { return add("captions", false, `the transcript cannot be read (${err.message})`); }
  const from = call.from ?? 0, to = call.to ?? dur;
  const expected = splitWords(entries).filter(w => w.start >= from && w.start < to && w.start < dur);
  if (!expected.length) return add("captions", false, "the page calls captions() but transcript.json has no words inside the video: run studio transcribe");
  const { missing, maxEarly } = compareCaptions(expected, recorded), early = Math.round(maxEarly * 1000);
  const ok = !missing.length && early <= EARLY_MS;
  add("captions", ok, ok ? `${expected.length} transcript words all in out/captions.json; earliest highlight ${Math.max(0, early)} ms before its word (max ${EARLY_MS})`
    : (missing.length ? `${missing.length} of ${expected.length} transcript words are not in out/captions.json (${missing.slice(0, 5).map(w => `"${w.text}" at ${w.start.toFixed(1)} s`).join(", ")}${missing.length > 5 ? ", …" : ""}); render again` : "") +
      (early > EARLY_MS ? `${missing.length ? "; " : ""}a word is highlighted ${early} ms before its start (max ${EARLY_MS})` : ""));
}

// a path named in project.json, resolved inside the project folder; null when it leaves the folder
export function insideProject(d, rel) {
  const full = path.resolve(d, String(rel)), r = path.relative(d, full);
  return r && !r.startsWith("..") && !path.isAbsolute(r) ? full : null;
}

// 7.9 A: the sound in the MP4 against the mix it was made from
function mixLine(e, mp4, mix, fps, add, label = "audio/mix.wav", { hasAudio = true, seconds } = {}) {
  if (!hasAudio) return add("audio against mix", false, "no audio stream in the video, so it cannot be compared with the mix");
  if (!mix || !fs.existsSync(mix)) return add("audio against mix", false, `${label} ${mix ? "is missing" : "is not inside the project folder"}: ${label === "audio/mix.wav" ? "run studio audio first" : 'project.json "mix" must name the mixed audio file inside the project'}`);
  const r = run(e.python, [path.join(SKILL, "scripts", "syncaudio.py"), mp4, mix, String(fps), e.ffmpeg, ...(seconds ? [String(seconds)] : [])], { capture: true, soft: true });
  let j; try { j = JSON.parse(r.stdout); } catch { return add("audio against mix", false, (r.stderr || "the comparison did not run").trim().split("\n").pop()); }
  const lagText = `lag ${j.lag_ms} ms (${j.lag_frames} frame${Math.abs(j.lag_frames) === 1 ? "" : "s"}), correlation ${j.correlation}`;
  add("audio against mix", j.pass, j.pass ? `${lagText}; last 2 s match; no silent stretch where the mix has sound` : `${lagText}: ${j.problems.join("; ")}`);
}

// ---------------------------------------------------------------- check
function check(dir) {
  const e = env(), d = projDir(dir), proj = readJSON(path.join(d, "project.json")), plain = proj.kind === "hyperframes";
  const page = plain ? pageRoot(fs.existsSync(path.join(d, "index.html")) ? fs.readFileSync(path.join(d, "index.html"), "utf8") : "") : null;
  const timing = plain ? null : readJSON(path.join(d, "timing.json"));
  const out = path.join(d, "out"); const mp4 = [out, ...(plain ? [path.join(d, "renders")] : [])].filter(fs.existsSync).flatMap(o => fs.readdirSync(o).filter(f => f.endsWith(".mp4") && !/-share\.mp4$|^render-raw/.test(f)).map(f => path.join(o, f)))[0];
  if (!mp4) die("no video yet: run `studio render` first");
  fs.mkdirSync(out, { recursive: true });
  const res = { file: mp4, checks: [] }; const add = (name, ok, info) => res.checks.push({ name, ok, info });
  const pr = JSON.parse(run(e.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,duration:format=duration", "-of", "json", mp4], { capture: true }).stdout);
  const v = pr.streams.find(s => s.codec_type === "video"), a = pr.streams.find(s => s.codec_type === "audio"), dur = +pr.format.duration;
  const [W, Hh] = plain ? [page.width, page.height] : SIZES[proj.aspect || "16:9"], fps = proj.fps || page?.fps || 30;
  add("video stream", !!v && v.codec_name === "h264" && (W === null || v.width === W) && (Hh === null || v.height === Hh), v ? `${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate}` : "missing");
  const [fn, fd] = String(v?.r_frame_rate).split("/").map(Number), rate = fd ? fn / fd : fn;
  add("frame rate", Number.isFinite(rate) && Math.abs(rate - fps) < 0.01, Number.isFinite(rate) ? `${+rate.toFixed(3)} fps (project fps ${fps})` : "unreadable");
  add("audio stream", !!a && a.codec_name === "aac", a ? a.codec_name : "missing (every data-start element needs an id)");
  const total = plain ? page.duration : timing.TOTAL;
  add("duration", total !== null && Math.abs(dur - total) <= 0.15, total === null ? `${dur.toFixed(2)} s (index.html has no data-duration on its root element to compare with)` : `${dur.toFixed(2)} s (${plain ? "data-duration" : "timeline"} ${total} s ± 0.15 s)`);
  if (proj.length) add("target length", dur <= proj.length * 1.05, `${dur.toFixed(1)} s (target ${proj.length} s)` + (dur < proj.length * 0.8 ? ` — note: ${Math.round(100 - 100 * dur / proj.length)}% shorter than the target; fine if on purpose` : ""));
  const lo = a ? run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"], { capture: true, soft: true }).stderr : "";
  const I = +(lo.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop()?.match(/-?[\d.]+/)[0], TP = +(lo.match(/Peak:\s+(-?[\d.]+) dBFS/g) || []).pop()?.match(/-?[\d.]+/)[0];
  const why = !a ? "no audio stream in the video" : "the loudness could not be measured (the audio is silent or unreadable)";
  add("loudness", Number.isFinite(I) && Math.abs(I + 14) <= 1, Number.isFinite(I) ? `${I} LUFS (target -14 ±1)` : why);
  add("true peak", Number.isFinite(TP) && TP <= -1.0, Number.isFinite(TP) ? `${TP} dBTP (max -1.0)` : why);
  const bl = run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-vf", "blackdetect=d=0.5:pic_th=0.98", "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const blacks = (bl.match(/black_start/g) || []).length; add("no black frames", blacks === 0, `${blacks} black stretch(es) ≥ 0.5 s`);
  const fr = run(e.ffmpeg, ["-hide_banner", "-i", mp4, "-vf", "freezedetect=n=0.001:d=4", "-an", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const frozen = [...fr.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map(m => `${(+m[1]).toFixed(1)} s for ${(+m[2]).toFixed(1)} s`);
  add("nothing frozen ≥ 4 s", frozen.length === 0, frozen.length ? "still at " + frozen.join(", ") + " (add motion there)" : "ok");
  if (!plain || proj.mix) mixLine(e, mp4, plain ? insideProject(d, proj.mix) : path.join(d, "audio", "mix.wav"), fps, add, plain ? String(proj.mix) : undefined, { hasAudio: !!a, seconds: +v?.duration || undefined });
  if (!plain) { const src = path.join(d, "src", "index.html"); if (fs.existsSync(src)) captionsLine(d, proj, fs.readFileSync(src, "utf8"), dur, add); }
  const sd = path.join(d, "stills"); fs.mkdirSync(sd, { recursive: true });
  if (plain) videoSheet(e, mp4, path.join(sd, "final-sheet.jpg"), { n: 8 });
  else {
    const frames = Object.entries(timing.T).map(([s, t]) => { const f = path.join(sd, `final-${s}.jpg`);
      run(e.ffmpeg, ["-loglevel", "error", "-y", "-ss", String(Math.min(t.vo_end, t.end - 0.5)), "-i", mp4, "-frames:v", "1", "-q:v", "3", f], { soft: true }); return f; });
    sheet(e, frames, path.join(sd, "final-sheet.jpg"), W, Hh);
  }
  res.sheet = path.join(sd, "final-sheet.jpg"); res.pass = res.checks.every(c => c.ok);
  fs.writeFileSync(path.join(out, "check.json"), JSON.stringify(res, null, 2));
  for (const c of res.checks) say(`${c.ok ? "PASS" : "FAIL"}  ${c.name}: ${c.info}`);
  say(`contact sheet: ${res.sheet}\n${res.pass ? "All automatic checks passed. Now LOOK at the contact sheet and watch the video before delivering." : "Fix the FAIL lines (references/checks-and-fixes.md), then render and check again."}`);
  if (!res.pass) process.exit(2);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  check(pos[0]);
  return 0;
}
