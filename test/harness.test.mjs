// Fast checks of the gate harness itself (test/harness/): no renders, no Whisper, no Kokoro.
// The scorers and parsers are exercised on synthetic data so that a harness that cannot tell good from bad is caught here.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HARNESS = path.join(path.dirname(fileURLToPath(import.meta.url)), "harness");
const load = (name) => import(pathToFileURL(path.join(HARNESS, name)).href);

// ---------------------------------------------------------------- T4 scorer

const syntheticClips = (rate = 24000) => Array.from({ length: 20 }, (_, i) => {
  const seconds = 0.35 + 0.02 * (i % 9), lead = 0.02 + 0.005 * (i % 5), clip = new Float32Array(Math.round(seconds * rate));
  for (let k = Math.round(lead * rate); k < clip.length; k++) clip[k] = 0.3;
  return clip;
});

test("T4 fixture: 20 different words, 19 gaps of 0.30 to 0.70 s", async () => {
  const { WORDS, GAPS } = await load("t4-scorer.mjs");
  assert.equal(WORDS.length, 20);
  assert.equal(new Set(WORDS).size, 20);
  assert.equal(GAPS.length, 19);
  assert.ok(GAPS.every((g) => g >= 0.30 && g <= 0.70));
});

test("T4 true onset is the first sample above 0.01 in absolute value", async () => {
  const { firstOver, trueOnsets } = await load("t4-scorer.mjs");
  assert.equal(firstOver(Float32Array.from([0, 0.01, -0.011, 0.5])), 2);
  assert.equal(firstOver(new Float32Array(10)), -1);
  const { onsets, duration } = trueOnsets(syntheticClips(), Array(19).fill(0.5), 24000);
  assert.equal(onsets.length, 20);
  assert.ok(onsets.every((t, i) => i === 0 || t > onsets[i - 1]) && duration > onsets[19]);
});

test("T4 scorer passes true timings with small jitter and fails evenly spaced fake timings", async () => {
  const { GAPS, trueOnsets, scoreOnsets, uniformTimings } = await load("t4-scorer.mjs");
  const { onsets, duration } = trueOnsets(syntheticClips(), GAPS, 24000);
  const jitter = onsets.map((t, i) => t + (i % 2 ? 0.04 : -0.03));
  const good = scoreOnsets(onsets, jitter);
  assert.ok(good.pass, `median ${good.median}, p95 ${good.p95}`);
  const fake = scoreOnsets(onsets, uniformTimings(20, duration));
  assert.ok(!fake.pass, `uniform timings passed: median ${fake.median}, p95 ${fake.p95}`);
});

test("T4 scorer thresholds: median 80 ms and 95th percentile 200 ms, a missing word is an infinite error", async () => {
  const { scoreOnsets, MAX_MEDIAN_ERROR_S, MAX_P95_ERROR_S, percentile } = await load("t4-scorer.mjs");
  assert.equal(MAX_MEDIAN_ERROR_S, 0.08);
  assert.equal(MAX_P95_ERROR_S, 0.2);
  const truth = Array.from({ length: 20 }, (_, i) => i);
  const shifted = (d) => truth.map((t) => t + d);
  assert.ok(scoreOnsets(truth, shifted(0.079)).pass);
  assert.ok(!scoreOnsets(truth, shifted(0.081)).pass);
  const oneOff = shifted(0.05); oneOff[19] = truth[19] + 0.19;
  assert.ok(scoreOnsets(truth, oneOff).pass, "one word at 190 ms is inside the 95th percentile");
  const twoOff = shifted(0.05); twoOff[19] = truth[19] + 0.25; twoOff[18] = truth[18] + 0.25;
  assert.ok(!scoreOnsets(truth, twoOff).pass, "two words at 250 ms are not");
  const oneMissing = shifted(0.01); oneMissing[3] = null;
  const r = scoreOnsets(truth, oneMissing);
  assert.equal(r.missing, 1);
  assert.ok(r.pass, "a single missing word is the 20th of 20 and stays above the 95th percentile rank");
  const twoMissing = shifted(0.01); twoMissing[3] = null; twoMissing[4] = null;
  assert.ok(!scoreOnsets(truth, twoMissing).pass);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20], 0.95), 19);
});

test("T4 alignment matches transcript words to the list in order, ignoring case and punctuation", async () => {
  const { alignToWords } = await load("t4-scorer.mjs");
  const starts = alignToWords(["window", "garden", "planet"], [{ text: "Window.", start: 0.1 }, { text: "uh", start: 0.9 }, { text: "garden,", start: 1.5 }, { text: "planet", start: 2.6 }]);
  assert.deepEqual(starts, [0.1, 1.5, 2.6]);
  assert.deepEqual(alignToWords(["window", "garden"], [{ text: "window garden", start: 1 }]), [1, 1]);
  assert.deepEqual(alignToWords(["window", "garden"], [{ text: "garden", start: 1 }]), [null, 1]);
});

// ---------------------------------------------------------------- captions

const PAGE = `<script>
// captions({top: "1", size: 1});   a commented call
const {tl, captions, finish} = SS.start();
/* captions({top: 2}) */
captions({top: "72%", size: 64, highlight: "var(--accent)", style: "pop"});
finish();
</script>`;

test("captions call: found once, comments ignored, arguments read, removal leaves the rest", async () => {
  const lib = await load("captions-lib.mjs");
  const calls = lib.findCaptionsCalls(PAGE);
  assert.equal(calls.length, 1);
  assert.deepEqual(lib.readCaptionsArgs(calls[0].text), { top: "72%", size: 64 });
  const { html, removed } = lib.stripCaptionsCalls(PAGE);
  assert.equal(removed, 1);
  assert.equal(lib.findCaptionsCalls(html).length, 0);
  assert.ok(html.includes("const {tl, captions, finish} = SS.start();") && html.includes("finish();"));
  assert.equal(lib.stripCaptionsCalls("no call here").removed, 0);
});

test("captions call: nested brackets and strings do not end the call early", async () => {
  const lib = await load("captions-lib.mjs");
  const src = 'captions({font: "a)b", size: 80, top: 1500, x: fn(1, (2))}); after();';
  const [call] = lib.findCaptionsCalls(src);
  assert.equal(src.slice(call.end), "; after();");
  assert.deepEqual(lib.readCaptionsArgs(call.text), { top: "1500", size: 80 });
  assert.equal(lib.readCaptionsArgs("captions({})").size, 72);
  assert.equal(lib.readCaptionsArgs("captions({})").top, null);
});

test("caption band: top in px or percent, height 2.5 times the size, clipped to the frame", async () => {
  const { bandRect } = await load("captions-lib.mjs");
  assert.deepEqual(bandRect("1400", 72, 1920), { y0: 1400, y1: 1580 });
  assert.deepEqual(bandRect("1400px", 72, 1920), { y0: 1400, y1: 1580 });
  assert.deepEqual(bandRect("72%", 64, 1920), { y0: 1382, y1: 1542 });
  assert.deepEqual(bandRect("1800", 100, 1920), { y0: 1800, y1: 1920 });
  assert.throws(() => bandRect("calc(50% + 4px)", 72, 1920));
});

test("caption band difference: mean absolute difference over the band rows only", async () => {
  const { meanAbsDiff } = await load("captions-lib.mjs");
  const W = 4, H = 10, a = new Uint8Array(W * H * 3), b = new Uint8Array(W * H * 3);
  assert.equal(meanAbsDiff(a, b, W, 2, 5), 0);
  for (let y = 3; y < 5; y++) for (let x = 0; x < W * 3; x++) b[y * W * 3 + x] = 90;            // rows 3 and 4 differ by 90
  assert.equal(meanAbsDiff(a, b, W, 2, 5), 60);                                                    // 2 of 3 rows
  assert.equal(meanAbsDiff(a, b, W, 5, 10), 0, "a difference outside the band does not count");
  assert.throws(() => meanAbsDiff(a, new Uint8Array(3), W, 0, 1));
  assert.throws(() => meanAbsDiff(a, b, W, 4, 4));
});

test("caption coverage: 90 percent of the transcript words in range, matched in order", async () => {
  const { captionCoverage } = await load("captions-lib.mjs");
  const words = "the quick brown fox jumps over the lazy dog again and again today".split(" ");
  const transcript = words.map((text, i) => ({ text, start: i, end: i + 0.5 }));
  const record = (list) => [{ start: 0, end: 99, words: list.map((text, i) => ({ text, start: i, end: i + 0.5 })) }];
  assert.equal(captionCoverage(transcript, record(words), 99).ratio, 1);
  const withPunct = words.map((w, i) => (i % 3 === 0 ? w[0].toUpperCase() + w.slice(1) + "," : w));
  assert.equal(captionCoverage(transcript, record(withPunct), 99).ratio, 1, "case and punctuation are ignored");
  const dropped = words.filter((_, i) => i !== 4);
  const c = captionCoverage(transcript, record(dropped), 99);
  assert.equal(c.matched, 12); assert.deepEqual(c.missing, ["jumps"]);
  assert.ok(c.ratio < 0.93 && c.ratio > 0.9);
  assert.ok(captionCoverage(transcript, record(words.slice(0, 6)), 99).ratio < 0.9);
  assert.equal(captionCoverage(transcript, [], 99).ratio, 0, "an empty record covers nothing");
  assert.equal(captionCoverage(transcript, record(words), 5.5).total, 6, "only words that start inside the video count");
  assert.equal(captionCoverage([{ text: "hora sale", start: 0, end: 1 }], record(["HAURA", "sale"]), 9, { hora: "HAURA" }).ratio, 1, "caption_fixes are applied first");
});

// ---------------------------------------------------------------- the footage warning matcher

test("late audio clip: the warning matcher accepts a warning line and ignores ordinary output", async () => {
  const { WARNING_LINE } = await load("late-audio-clip.mjs");
  assert.equal(WARNING_LINE("cut: base.mp4\n  ! clip.mp4: audio starts 0.178 s after the video; shift it with -itsoffset").length, 1);
  assert.equal(WARNING_LINE("WARNING: audio stream starts 0.2 s later than the video stream").length, 1);
  assert.equal(WARNING_LINE("cut: src/assets/base.mp4 (1080x1920, 2.00 s) and audio/voice.wav").length, 0);
});

// ---------------------------------------------------------------- T0 contract parser

const SAMPLE = `# Sample

Run \`studio audio <dir> --only s2\` then \`studio render <dir> --draft\`; \`studio words <dir>\` writes estimated word times to \`transcript.json\`.
Later \`studio beats <dir> song.mp3 --start 4\` → \`beats.json\`, and \`studio silences <dir> clip.mp4\` (silences-clip.json).
Do it with \`studio fly <dir> --wings 2\`. Then you write \`src/index.html\` after \`studio audio\`.

3. Write scenes (\`lib.js\` helpers \`rise fadeIn\` with times \`V("s2", 0.4)\` and \`at("s2", "card")\`; scene times are in \`T\`). Options: \`opts\` is not a helper. Also \`draw()\` is unrelated. See \`count()\` in lib.js.

\`\`\`js
const {tl, pop: p, finish} = SS.start();
const {ink, rr} = K;
\`\`\`

| Command | Arguments | Writes |
|---|---|---|
| \`stills\` | \`<dir> [t1 t2 …] [--platform p]\` | \`stills/sheet.jpg\`, \`stills/frame-*.png\`, \`$HOME/…\` |
| \`voice\` | \`<dir> [--only s2\\|s4]\` | \`audio/vo/<id>.wav\` |

| Field | Meaning |
|---|---|
| \`edit\` | not a command, has \`--nothing\` |

Tools here: studio_render and studio_check.
`;

test("contract parser: commands and flags come from code spans, fences and Command tables", async () => {
  const { collect, unique } = await load("t0-parse.mjs");
  const facts = collect([{ file: "S.md", text: SAMPLE }]);
  const cmds = unique(facts.commands, (c) => c.name).map((c) => c.name).sort();
  assert.deepEqual(cmds, ["audio", "beats", "fly", "render", "silences", "stills", "voice", "words"]);
  const flags = unique(facts.commands.flatMap((c) => c.flags.map((f) => ({ ...c, flag: f }))), (x) => `${x.name} --${x.flag}`).map((x) => `${x.name} --${x.flag}`).sort();
  assert.deepEqual(flags, ["audio --only", "beats --start", "fly --wings", "render --draft", "stills --platform", "voice --only"]);
});

test("contract parser: written files follow a verb, an arrow, brackets or the Writes column, and nothing else", async () => {
  const { collect, unique } = await load("t0-parse.mjs");
  const files = unique(collect([{ file: "S.md", text: SAMPLE }]).files, (f) => `${f.cmd} ${f.path}`).map((f) => `${f.cmd} ${f.path}`).sort();
  assert.deepEqual(files, ["beats beats.json", "silences silences-clip.json", "stills stills/frame-*.png", "stills stills/sheet.jpg", "voice audio/vo/<id>.wav", "words transcript.json"]);
});

test("contract parser: helpers come from SS.start destructuring and helper sentences; parameters and other spans do not", async () => {
  const { collect, unique } = await load("t0-parse.mjs");
  const facts = collect([{ file: "S.md", text: SAMPLE }]);
  const helpers = unique(facts.helpers, (h) => h.name).map((h) => h.name).sort();
  assert.deepEqual(helpers, ["T", "V", "at", "count", "fadeIn", "finish", "pop", "rise", "tl"]);
  assert.deepEqual(unique(facts.sketch, (h) => h.name).map((h) => h.name).sort(), ["ink", "rr"]);
  assert.deepEqual(unique(facts.tools, (t) => t.name).map((t) => t.name).sort(), ["studio_check", "studio_render"]);
});

test("contract checker: help sections, file matching and the code's real helper and sketch keys", async () => {
  const c = await load("t0-contract.mjs");
  const sections = c.helpSections("Usage\n once\n  setup     install\n  new <dir>  skeleton\n            [--mode narrated]\n            [--aspect 16:9]\n  doctor    check\n");
  assert.ok(sections.get("new").includes("--aspect") && !sections.get("setup").includes("--aspect") && sections.has("doctor"));
  const sources = [{ file: "x.mjs", text: 'path.join(d, "stills", "sheet.jpg"); "frame-"; ".png"; "-share.mp4"' }];
  assert.ok(c.mentionsFile(sources, "stills/sheet.jpg"));
  assert.ok(c.mentionsFile(sources, "stills/frame-*.png"));
  assert.ok(c.mentionsFile(sources, "-share.mp4"));
  assert.ok(!c.mentionsFile(sources, "stills/final-sheet.jpg"));
  const lib = c.libKeys(c.DEFAULT_CODE), sketch = c.sketchKeys(c.DEFAULT_CODE);
  for (const k of ["rise", "pop", "captions", "finish", "V", "S", "at", "T", "EV", "TOTAL", "tl"]) assert.ok(lib.includes(k), `SS.start() lacks ${k}`);
  assert.ok(!lib.includes("fly"));
  for (const k of ["ink", "rr", "frame", "paperBG", "rng", "hash", "use"]) assert.ok(sketch.includes(k), `the sketch kit lacks ${k}`);
  assert.deepEqual(c.toolList({ result: { tools: [{ name: "studio_a" }] } }), ["studio_a"]);
  assert.deepEqual(c.toolList(["studio_b"]), ["studio_b"]);
});

// ---------------------------------------------------------------- fixture measurement

test("audio lag: the envelope correlation finds a known delay and sign", async () => {
  const { envelope, bestLag } = await load("audio-lib.mjs");
  const rate = 8000, burst = (start) => Float32Array.from({ length: rate * 3 }, (_, i) => (i >= start * rate && i < (start + 0.4) * rate ? Math.sin(i * 0.3) : 0));
  const a = envelope(burst(0.5)), b = envelope(burst(0.6));
  assert.deepEqual([bestLag(a, b, 50).windows, bestLag(b, a, 50).windows], [10, -10]);
  assert.equal(bestLag(a, a, 50).windows, 0);
});
