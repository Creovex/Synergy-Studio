#!/usr/bin/env node
// Synergy Studio CLI: make narrated motion-graphics videos with HyperFrames + GSAP + Kokoro.
// Node >= 20, built-ins only. Run `node studio.mjs help`.
// A thin dispatcher: every command lives in lib/<command>.mjs and exports USAGE and main(argv).
// Commands: setup doctor new budget say voice audio words compose stills render check cut transcribe silences scenes beats reference
import { die, say, H } from "./lib/common.mjs";

const [cmd, ...rest] = process.argv.slice(2);
const HELP = `Synergy Studio (lite): videos written as HTML + GSAP (+ SVG, canvas, three.js), rendered by HyperFrames.
Usage: node <skill>/scripts/studio.mjs <command> [args]. Full reference: references/commands.md. Tool home: ${H}
Modes (project.json "mode"): narrated (voice sets the timing) · footage (your clips, studio cut) · film (wordless, your music, scenes in seconds)
 once
  setup                     one-time install (HyperFrames + Chrome, Kokoro voice, ffmpeg; about 1.1 GB)
  doctor [--full]           check the install (--full also test renders a 60 fps and a three.js page)
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

const COMMANDS = ["setup", "doctor", "new", "budget", "say", "voice", "audio", "words", "compose", "stills", "render", "check",
                  "cut", "transcribe", "silences", "scenes", "beats", "reference"];
// setup and doctor report their own failures as messages; the other commands are loaded as they stand
const lib = async (name, argv) => { try { return await (await import(`./lib/${name}.mjs`)).main(argv); } catch (err) { die(err.message); } };
if (cmd === undefined || cmd === "help" || cmd === "--help" || cmd === "-h") say(HELP);
else if (cmd === "setup" || cmd === "doctor") process.exitCode = await lib(cmd, rest);
else if (COMMANDS.includes(cmd)) process.exitCode = await (await import(`./lib/${cmd}.mjs`)).main(rest);
else { say(HELP); die(`unknown command: ${cmd}`); }
