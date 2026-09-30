import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { H, SKILL, die, say, run, env, hf, projDir, readJSON, parseArgs, needProjectFile } from "./common.mjs";
import { withHeavyLock } from "./lock.mjs";
import { frameLevels, refineWords } from "./wordsnap.mjs";

export const USAGE = "transcribe <dir> [file]";

// ---------------------------------------------------------------- transcribe / words
// Whisper small.en through `hyperframes transcribe --engine whisper`. HyperFrames merges Whisper's tokens into words itself
// (a leading space starts a word; punctuation stays with the word before) and returns one {id, text, start, end} per word;
// this module keeps text, start and end, moves each start to where the sound begins (wordsnap.mjs) and splits any entry that still holds several words the way captions() does.
const MODEL = "small.en", MODEL_MB = 470, SILENT_DB = -60, MIN_SECONDS = 0.1;
const IMPORT_EXT = [".srt", ".vtt", ".json"];                 // caption files are imported by HyperFrames, no Whisper needed

const r3 = x => Math.round(x * 1000) / 1000;

// one entry per word: {text, start, end}; entries that hold a phrase are shared out by word length; unusable entries are dropped
export function toWords(entries) {
  const words = [];
  for (const w of entries) {
    const start = Number(w?.start), end = Number(w?.end), parts = String(w?.text ?? "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length || !Number.isFinite(start) || !Number.isFinite(end)) continue;
    const tot = parts.reduce((a, p) => a + p.length + 1, 0); let t = start;
    for (const p of parts) { const dur = Math.max(0, end - start) * (p.length + 1) / tot; words.push({ text: p, start: r3(t), end: r3(t + dur) }); t += dur; }
  }
  return words;
}

// the plain reason a file cannot be transcribed, or null when it holds sound
function soundProblem(e, file) {
  const shown = path.basename(file);
  if (fs.statSync(file).size === 0) return `${shown} is an empty file, so there is nothing to transcribe. Make the audio first (studio cut, or studio voice and studio audio) or give another file.`;
  const p = run(e.ffprobe, ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type:format=duration", "-of", "json", file], { capture: true, soft: true });
  let j; try { j = JSON.parse(p.stdout); } catch { j = null; }
  if (p.status !== 0 || !j) return `${shown} is not an audio or video file ffmpeg can read.`;
  if (!j.streams?.length) return `${shown} has no audio track, so there is nothing to transcribe.`;
  if (!(Number(j.format?.duration) >= MIN_SECONDS)) return `${shown} has no sound in it (it is empty, 0 seconds long), so there is nothing to transcribe.`;
  const v = run(e.ffmpeg, ["-hide_banner", "-nostats", "-i", file, "-vn", "-af", "volumedetect", "-f", "null", "-"], { capture: true, soft: true }).stderr;
  const peak = (v.match(/max_volume: (-?[\d.]+|-inf) dB/) || [])[1];
  if (peak === "-inf" || (peak !== undefined && +peak <= SILENT_DB)) return `${shown} is silent (loudest point ${peak} dB), so there is nothing to transcribe.`;
  return null;
}

const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL}.bin`;

// which part transcription needs is missing, with our paths and the fix; "" when both are there
export function missingPart(e, dir) {
  const bin = e.whisper?.path, model = path.join(e.hf_home, ".cache", "hyperframes", "whisper", "models", `ggml-${MODEL}.bin`);
  const setup = `node "${path.join(SKILL, "scripts", "studio.mjs")}" setup`, srt = `import captions instead: studio transcribe ${dir} subs.srt`;
  if (!e.whisper?.available || !bin || !fs.existsSync(bin))
    return `the whisper-cli program is missing${bin ? ` (${bin})` : ""}. Run  ${setup}  to build it (it needs the Xcode command line tools for the compiler), or ${srt}`;
  if (!fs.existsSync(model))
    return `the Whisper model is missing (${model}). Run  ${setup}  to download it, or download ${MODEL_URL} on any computer and run  ${setup} --whisper-model <that file> , or ${srt}`;
  return "";
}

function hfFailure(r, e, dir) {
  let j = null; try { j = JSON.parse((r.stdout || "").trim().split("\n").pop()); } catch { /* not JSON: use the raw text */ }
  const text = (j?.reason === "whisper_unavailable" ? "HyperFrames could not start Whisper" : (j?.error || r.stderr || r.stdout || `HyperFrames exited with ${r.status}`)).toString().trim().slice(-600);
  const part = missingPart(e, dir);
  return `transcribe failed: ${text}${part ? `\n${part[0].toUpperCase()}${part.slice(1)}` : ""}\n(studio doctor shows what captions need)`;
}

async function transcribe(dir, media) {
  const e = env(), d = projDir(dir);
  if (!media && !fs.existsSync(path.join(d, "audio", "voice.wav"))) die(`audio/voice.wav is missing. Run studio cut ${dir} first, or give a file: studio transcribe ${dir} <audio, video or .srt/.vtt/.json>`);
  const src = media ? needProjectFile(d, media, "file") : path.join(d, "audio", "voice.wav");
  const imported = IMPORT_EXT.includes(path.extname(src).toLowerCase());
  if (!imported) {
    if (!e.whisper?.available) die(`words cannot be timed: ${missingPart(e, dir)}\n(studio doctor shows what captions need)`);
    const bad = soundProblem(e, src); if (bad) die(bad);
  }
  const run1 = () => {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "ss-transcribe-"));       // HyperFrames writes here, not into the project (it also rewrites .html files it finds)
    try {
      const model = path.join(e.hf_home, ".cache", "hyperframes", "whisper", "models", `ggml-${MODEL}.bin`);
      if (!imported && !fs.existsSync(model)) say(`First transcription on this computer: downloading the Whisper ${MODEL} model (about ${MODEL_MB} MB) from huggingface.co. This can take a few minutes.`);
      const args = ["transcribe", src, "-d", scratch, "--json", ...(imported ? [] : ["--engine", "whisper", "-m", MODEL])];
      const r = hf(e, args, { capture: true, soft: true });
      const out = path.join(scratch, "transcript.json");
      if (r.status !== 0 || !fs.existsSync(out)) die(hfFailure(r, e, dir));
      const entries = readJSON(out), words = imported ? entries : refineWords(toWords(entries), frameLevels(e.ffmpeg, src));
      if (!words.length) die(`no words found in ${path.basename(src)}. Whisper heard no speech; check that the audio has a voice in it.`);
      fs.writeFileSync(path.join(d, "transcript.json"), JSON.stringify(words, null, 1));
      return words;
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  };
  const words = imported ? run1() : await withHeavyLock(H, `transcribe ${path.basename(d)}`, run1, { log: say });
  say(`transcript.json written (${words.length} ${imported ? "entries" : "words"}). Fix misheard brand words with "caption_fixes" in project.json.`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  await transcribe(pos[0], pos[1]);
  return 0;
}
