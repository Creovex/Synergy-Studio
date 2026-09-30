// The tools of the Synergy Studio server. Every CLI command is a tool here and the server only calls the CLI
// (skills/synergy-studio/scripts/studio.mjs); it never reimplements it. Long work runs as a job.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SKILL_DIR, STUDIO_MJS, UserError, home, paths, projectsRoot, tryEnv, notSetUpText, studioNode, hyperframesEnv, expandHome } from "./context.mjs";
import { newJobId, startJob, waitForJob, readJob, logLines, isFinal, jobImages, dropJob, progressText, MAX_WAIT_SEC } from "./jobs.mjs";
import { existingProject, projectPath, resolveInside, writeProjectFile, listProjectFiles, readProjectFile, addProjectFile, listProjects, latestMp4, exportProject, NAME_RE, checkName } from "./files.mjs";
import { importHyperframes, planHyperframes, ALLOWED_COMMANDS, JOB_COMMANDS } from "./hyperframes.mjs";
import { resolvedSkill, guideAppendix, readReference, referenceNames } from "./content.mjs";
import { imageContent } from "./images.mjs";
import { pathToFileURL } from "node:url";

const SYNC_WAIT_SEC = 20;
const RESULT_LIMIT = 12000;
const PLATFORMS = ["tiktok", "reels", "shorts", "meta", "youtube", "linkedin", "x", "website"];
const LOOKS = ["paper", "midnight", "bold", "luxe"];
const ASPECTS = ["16:9", "9:16", "1:1", "4:5"];
const MODES = ["narrated", "footage", "film"];
const VOICES = ["af_heart", "af_bella", "af_nova", "af_sky", "am_michael", "am_adam", "bf_emma", "bf_isabella", "bm_george", "bm_lewis"];
const CLI_TOOL = { setup: "studio_setup_start", doctor: "studio_doctor", new: "studio_project_new", import: "studio_project_import", reference: "studio_reference_study", frames: "studio_frames", look: "studio_look_from" };
const CLI_COMMANDS = new Set(["setup", "doctor", "new", "budget", "say", "voice", "audio", "words", "compose", "stills", "render", "check", "cut", "transcribe", "silences", "scenes", "beats", "reference", "frames", "synctest", "import", "look"]);

// ---------------------------------------------------------------- results
const text = (value, extra = {}) => ({ content: [{ type: "text", text: value }], ...extra });
const fail = (value) => ({ content: [{ type: "text", text: value }], isError: true });

// The CLI talks about `studio audio`; here that is the tool studio_audio.
export function toolWords(value) {
  return String(value)
    .replace(/node "?[^\s"]*studio\.mjs"?\s+(\w+)/g, (m, c) => (CLI_COMMANDS.has(c) ? (CLI_TOOL[c] ?? `studio_${c}`) : m))
    .replace(/\bstudio (\w+)\b/g, (m, c) => (CLI_COMMANDS.has(c) ? (CLI_TOOL[c] ?? `studio_${c}`) : m));
}

const tail = (value, chars) => (value.length > chars ? value.slice(value.length - chars) : value);
// Progress bars, colours and render trace lines from child programs are noise in a tool result (the log keeps them).
const NOISE = /\[Render:trace\]|^\[static-dedup\]|[\u2588\u2591]{3}/;
const clean = (value) =>
  value
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/[^\n]*\r(?!\n)/g, "")
    .split("\n")
    .filter((line) => !NOISE.test(line))
    .join("\n");

function resultText(job) {
  const result = job.result ?? {};
  if (job.kind === "hyperframes") {
    if (result.json !== null && result.json !== undefined) return tail(JSON.stringify(result.json, null, 2), RESULT_LIMIT);
    return tail(clean(result.text ?? ""), 4096);
  }
  return toolWords(tail(clean(result.text ?? ""), RESULT_LIMIT));
}

const jobStarted = (id, label) =>
  text(`${JSON.stringify({ job_id: id, state: "queued" })}\n${label} runs as a job. Call studio_job_status with this job_id and wait_sec 25 until it is done; studio_job_log shows the log.`, { structuredContent: { job_id: id } });

const seconds = (job) => (job.started && job.ended ? Math.round((Date.parse(job.ended) - Date.parse(job.started)) / 1000) : null);

// ---------------------------------------------------------------- running the CLI
function startStudio({ label, args, project, attach, id, cwd, node }) {
  const jobId = id ?? newJobId();
  startJob({
    id: jobId,
    label,
    node: node ?? studioNode(tryEnv()),
    args: [STUDIO_MJS, ...args],
    cwd: cwd ?? project ?? os.tmpdir(),
    env: process.env,
    project: project ?? null,
    attach,
  });
  return jobId;
}

// Runs a job and waits a short while. Finished in time: the result, and the job files are removed. Otherwise it
// keeps running and the answer names the job.
async function waitOrJob({ id, label, signal, after, tempFiles = [] }) {
  const job = await waitForJob(id, SYNC_WAIT_SEC, signal);
  if (!isFinal(job)) {
    return text(`${JSON.stringify({ job_id: id, state: job.state })}\n${label} has not finished after ${SYNC_WAIT_SEC} s and keeps running as a job. Call studio_job_status with this job_id and wait_sec 25.`, { structuredContent: { job_id: id } });
  }
  const failed = job.state === "failed";
  let body = resultText(job);
  if (!failed && after) body = `${body}${await after(job)}`;
  if (failed) body = `${body}${job.exit_code === null ? "" : `\n(exit code ${job.exit_code})`}`;
  const content = [{ type: "text", text: body || `${label} finished.` }, ...(await jobImages(job))];
  dropJob(id);
  for (const file of tempFiles) fs.rmSync(file, { force: true });
  return { content, ...(failed ? { isError: true } : {}) };
}

async function studioSync({ label, args, project, attach, id, signal, after, tempFiles }) {
  const jobId = startStudio({ label, args, project, attach, id });
  return waitOrJob({ id: jobId, label, signal, after, tempFiles });
}

const studioJob = ({ label, args, project, attach, node }) => jobStarted(startStudio({ label, args, project, attach, node }), label);

const sheetAttach = (project, files = [], globs = []) => ({ files: files.map((f) => path.join(project, f)), globs: globs.map(([dir, pattern]) => ({ dir: path.join(project, dir), pattern })) });

// ---------------------------------------------------------------- inputs
const flagArgs = (pairs) => pairs.flatMap(([flag, value]) => (value === undefined || value === null || value === false ? [] : value === true ? [`--${flag}`] : [`--${flag}`, String(value)]));

function userFile(value, label) {
  const full = path.resolve(expandHome(value));
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    throw new UserError(`${label} ${full} does not exist. Give the full path of a file on this computer.`);
  }
  if (!stat.isFile()) throw new UserError(`${label} ${full} is not a file.`);
  return full;
}

// A file inside the project, as an absolute path.
function projectFile(dir, rel, label) {
  const { full } = resolveInside(dir, rel);
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new UserError(`${label} ${rel} is not a file in the project. Add it with studio_file_add, then give its path inside the project (for example src/footage/clip.mp4).`);
  return full;
}

const nameProp = { type: "string", pattern: NAME_RE.source, description: "The project name: lower case letters, digits and hyphens, at most 40 characters. Its folder is in the projects folder." };
const ann = (readOnlyHint, destructiveHint, idempotentHint, openWorldHint) => ({ readOnlyHint, destructiveHint, idempotentHint, openWorldHint });
const READ = ann(true, false, true, false);
const WRITE_GENERATED = ann(false, false, true, false);

export const TOOLS = [];
function define(name, description, properties, required, annotations, handler, options = {}) {
  TOOLS.push({ name, description, properties, required, annotations, handler, needsHome: options.needsHome ?? false, title: options.title });
}

// ---------------------------------------------------------------- guide, references, doctor, setup
define(
  "studio_guide",
  "Returns the Synergy Studio guide (SKILL.md) that says how to make and improve videos with these tools, plus the list of references. Call this first in every conversation and follow it.",
  {},
  [],
  READ,
  async () => ({ content: [{ type: "text", text: resolvedSkill() }, { type: "text", text: guideAppendix() }] }),
  { title: "Read the guide" },
);

define(
  "studio_reference",
  "Returns one reference file of the skill (craft, design, footage, hyperframes, review and more) as text. Use it when the guide points to a reference or before a step that needs its detail.",
  { name: { type: "string", description: `The reference name without .md. Available: ${referenceNames().join(", ")}.` } },
  ["name"],
  READ,
  async ({ name }) => text(readReference(name)),
  { title: "Read a reference" },
);

define(
  "studio_doctor",
  "Checks the Synergy Studio installation and prints one PASS or FAIL line per part. Use it before starting work or when something fails. With full true it also runs test renders as a job.",
  { full: { type: "boolean", description: "Also run the 60 fps and three.js test renders (starts a job; takes a minute or two)." } },
  [],
  READ,
  async ({ full }, ctx) => {
    if (!tryEnv()) return text(`Not set up. ${notSetUpText()}`);
    if (full) return studioJob({ label: "doctor --full", args: ["doctor", "--full"] });
    return studioSync({ label: "doctor", args: ["doctor"], signal: ctx.signal });
  },
  { title: "Check the installation" },
);

define(
  "studio_setup_start",
  "Installs everything Synergy Studio needs on this computer (render engine, voice, ffmpeg, about 1 GB, 5 to 10 minutes) as a job. Use it when studio_doctor says the tools are not set up.",
  { whisper_model: { type: "string", description: "Optional full path of a Whisper model file (ggml-small.en.bin) downloaded elsewhere, to place it without downloading." } },
  [],
  ann(false, false, true, true),
  async ({ whisper_model }) => {
    const model = whisper_model === undefined ? undefined : userFile(whisper_model, "The Whisper model file");
    // The runtime Node is not installed yet, so setup runs with the Node that runs this server.
    return studioJob({ label: "setup", args: ["setup", ...flagArgs([["whisper-model", model]])], node: process.execPath });
  },
  { title: "Set up the tools" },
);

// ---------------------------------------------------------------- projects
define(
  "studio_project_new",
  "Creates a new video project with a starter page, project.json, brief, shot list and feedback templates. Use it after the plan is agreed and before writing narration or the page.",
  {
    name: nameProp,
    aspect: { type: "string", enum: ASPECTS, description: "Picture shape: 16:9, 9:16, 1:1 or 4:5 (default 16:9)." },
    platform: { type: "string", enum: PLATFORMS, description: "Where it will be published; sets safe areas (9:16 defaults to tiktok)." },
    length: { type: "number", minimum: 1, description: "Target length in seconds." },
    look: { type: "string", enum: LOOKS, description: "Starting look, written as data-look in the starter page (not a project field)." },
    mode: { type: "string", enum: MODES, description: "narrated (voice sets the timing), footage (the user's clips) or film (wordless, music)." },
  },
  ["name"],
  ann(false, false, false, false),
  async ({ name, aspect, platform, length, look, mode }, ctx) => {
    const dir = projectPath(name);
    fs.mkdirSync(projectsRoot(), { recursive: true });
    return studioSync({
      label: "new",
      args: ["new", dir, ...flagArgs([["mode", mode], ["aspect", aspect], ["platform", platform], ["length", length], ["look", look]])],
      signal: ctx.signal,
      after: async () => `\nProject folder: ${dir}\nFiles: project.json, brief.md, shots.md, feedback.md, src/index.html`,
    });
  },
  { title: "Start a project" },
);

define(
  "studio_project_import",
  "Makes a footage project from a finished video file on this computer: copies it in, prints its facts and returns a contact sheet. Use it to improve an existing video (captions, cuts, an end card).",
  {
    name: nameProp,
    video_path: { type: "string", description: "The full path of the video file on this computer (a video attached in the chat has no path; ask the user for it)." },
    aspect: { type: "string", enum: ASPECTS, description: "Picture shape of the new project (default 9:16)." },
  },
  ["name", "video_path"],
  ann(false, false, false, false),
  async ({ name, video_path, aspect }, ctx) => {
    const dir = projectPath(name);
    const video = userFile(video_path, "The video");
    fs.mkdirSync(projectsRoot(), { recursive: true });
    return studioSync({
      label: "import",
      args: ["import", dir, video, ...flagArgs([["aspect", aspect]])],
      attach: sheetAttach(dir, ["stills/source-sheet.jpg"]),
      signal: ctx.signal,
      after: async () => `\nProject folder: ${dir}`,
    });
  },
  { needsHome: true, title: "Import a video" },
);

define(
  "studio_project_list",
  "Lists the video projects in the projects folder with their kind, picture shape, last change and whether a finished MP4 exists. Use it to find a project to continue or to check a name is free.",
  {},
  [],
  READ,
  async () => {
    const { root, projects } = listProjects();
    if (!projects.length) return text(`No projects yet in ${root}. Make one with studio_project_new.`);
    const lines = projects.map((p) => `${p.name}${p.valid_name ? "" : " (name not usable by these tools)"}  ${p.kind}${p.aspect ? ` ${p.aspect}` : ""}  changed ${p.last_change}  mp4: ${p.has_mp4 ? "yes" : "no"}`);
    return text(`Projects in ${root}\n${lines.join("\n")}`);
  },
  { title: "List projects" },
);

define(
  "studio_frames",
  "Returns a contact sheet image of any video file, without making a project. Use it to look at a video the user names before planning changes or matching its style.",
  {
    video_path: { type: "string", description: "The full path of the video file on this computer." },
    n: { type: "integer", minimum: 1, maximum: 60, description: "How many tiles, spread over the video (default 12)." },
    out: { type: "string", description: "Optional .jpg path to keep the sheet at, inside the projects folder or the tool home." },
  },
  ["video_path"],
  READ,
  async ({ video_path, n, out }, ctx) => {
    const video = userFile(video_path, "The video");
    const id = newJobId();
    let target = path.join(paths().jobs, `${id}-frames.jpg`);
    const temp = [];
    if (out === undefined) temp.push(target);
    else {
      target = path.resolve(expandHome(out));
      const allowed = [projectsRoot(), home()].some((root) => !path.relative(root, target).startsWith("..") && !path.isAbsolute(path.relative(root, target)));
      if (!/\.jpe?g$/i.test(target) || !allowed) throw new UserError("out must be a .jpg path inside the projects folder or the tool home.");
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    return studioSync({
      id,
      label: "frames",
      args: ["frames", video, ...flagArgs([["n", n]]), "--out", target],
      attach: { files: [target], globs: [] },
      signal: ctx.signal,
      tempFiles: temp,
    });
  },
  { needsHome: true, title: "Contact sheet of a video" },
);

define(
  "studio_reference_study",
  "Studies a reference video for a project: a contact sheet (one frame every few seconds) and the cut rhythm. Use it when the user gives a video whose style should be matched, before writing the concept.",
  {
    name: nameProp,
    video_path: { type: "string", description: "The full path of the reference video on this computer." },
    every: { type: "number", minimum: 0.1, description: "Seconds between frames on the sheet (default 2)." },
  },
  ["name", "video_path"],
  WRITE_GENERATED,
  async ({ name, video_path, every }, ctx) => {
    const dir = existingProject(name);
    return studioSync({
      label: "reference",
      args: ["reference", dir, userFile(video_path, "The video"), ...flagArgs([["every", every]])],
      project: dir,
      attach: sheetAttach(dir, ["reference/sheet.jpg"]),
      signal: ctx.signal,
    });
  },
  { needsHome: true, title: "Study a reference video" },
);

// ---------------------------------------------------------------- files
define(
  "studio_file_list",
  "Lists every file in a project with its size. Use it to see what exists (pages, audio, stills, renders) before reading, writing or rendering.",
  { name: nameProp },
  ["name"],
  READ,
  async ({ name }) => text(listProjectFiles(name)),
  { title: "List project files" },
);

define(
  "studio_file_read",
  "Reads a file of a project: text up to 200 KB, or a picture (jpg or png) as an image. Use it to look at the page, project.json, a still or a contact sheet.",
  { name: nameProp, path: { type: "string", description: "Path inside the project, for example src/index.html or stills/sheet.jpg." } },
  ["name", "path"],
  READ,
  async ({ name, path: rel }) => ({ content: await readProjectFile(name, rel) }),
  { title: "Read a project file" },
);

define(
  "studio_file_write",
  "Writes a text file of a project. Allowed: project.json, brief.md, shots.md, feedback.md, anything under src/, and .srt or .vtt files. Use it to write the narration, the page and the plan.",
  {
    name: nameProp,
    path: { type: "string", description: "Path inside the project, for example project.json or src/index.html." },
    content: { type: "string", description: "The complete new content of the file." },
  },
  ["name", "path", "content"],
  ann(false, true, true, false),
  async ({ name, path: rel, content }) => text(writeProjectFile(name, rel, content)),
  { title: "Write a project file" },
);

define(
  "studio_file_add",
  "Copies a file the user has (logo, photo, clip, song, font) into a project: into src/assets/, src/assets/fonts/ or src/footage/. Use it to bring the user's own material into the video.",
  {
    name: nameProp,
    from_path: { type: "string", description: "The full path of the user's file on this computer." },
    to: { type: "string", description: "Optional: src/assets, src/assets/fonts, src/footage, or a file path inside one of them. Default: chosen from the file type." },
  },
  ["name", "from_path"],
  ann(false, true, true, false),
  async ({ name, from_path, to }) => text(addProjectFile(name, from_path, to)),
  { title: "Add a user file" },
);

// ---------------------------------------------------------------- build steps that answer at once
define(
  "studio_compose",
  "Checks the page and project.json against the rules, fills in timings and copies the files into comp/. Use it to see every lint error and warning; stills and render run it for you anyway.",
  { name: nameProp },
  ["name"],
  WRITE_GENERATED,
  async ({ name }, ctx) => {
    const dir = existingProject(name);
    return studioSync({ label: "compose", args: ["compose", dir], project: dir, signal: ctx.signal, after: async () => "\ncomposed" });
  },
  { needsHome: true, title: "Compose the page" },
);

define(
  "studio_budget",
  "Prints how many words fit in each scene for the project's target length. Use it before writing the narration of a narrated video.",
  { name: nameProp },
  ["name"],
  READ,
  async ({ name }, ctx) => {
    const dir = existingProject(name);
    return studioSync({ label: "budget", args: ["budget", dir], project: dir, signal: ctx.signal });
  },
  { title: "Word budget" },
);

for (const [command, description, title] of [
  ["audio", "Builds the scene timing, music, sound effects and the final mix at -14 LUFS for a project. Use it after the voice (narrated) or after cut and scenes are set (footage, film); run it again after changing events.", "Timing and mix"],
  ["words", "Writes estimated word times of the narration to transcript.json so captions and sound effects can be timed. Use it on a narrated project after audio, then run audio again.", "Estimate word times"],
  ["cut", "Trims, orders, crops and grades the clips listed in project.json edit.clips into src/assets/base.mp4 and cleans the voice. Use it on a footage project before transcribe.", "Cut the clips"],
]) {
  define(
    `studio_${command}`,
    description,
    { name: nameProp },
    ["name"],
    WRITE_GENERATED,
    async ({ name }, ctx) => {
      const dir = existingProject(name);
      return studioSync({ label: command, args: [command, dir], project: dir, signal: ctx.signal });
    },
    { needsHome: true, title },
  );
}

define(
  "studio_beats",
  "Finds the tempo and beat grid of a song in the project (70 to 180 BPM) and writes beats.json. Use it to time cuts and scenes to the music of a footage or film project.",
  {
    name: nameProp,
    song: { type: "string", description: "Path of the song inside the project, for example src/assets/song.mp3 (add it with studio_file_add)." },
    start: { type: "number", minimum: 0, description: "Seconds into the song where the video's music begins; beat times count from here." },
  },
  ["name", "song"],
  WRITE_GENERATED,
  async ({ name, song, start }, ctx) => {
    const dir = existingProject(name);
    return studioSync({ label: "beats", args: ["beats", dir, projectFile(dir, song, "The song"), ...flagArgs([["start", start]])], project: dir, signal: ctx.signal });
  },
  { needsHome: true, title: "Beat grid" },
);

const jsonAfter = (dir, prefix, clip) => async () => {
  const file = path.join(dir, `${prefix}-${path.basename(clip, path.extname(clip))}.json`);
  try {
    const body = fs.readFileSync(file, "utf8");
    return `\n${path.basename(file)}:\n${body.length > 20000 ? `${body.slice(0, 20000)}\n[cut]` : body}`;
  } catch {
    return "";
  }
};

define(
  "studio_silences",
  "Finds pauses and speech pieces in a clip of the project, to cut dead air. Use it on footage before choosing in and out points; the result is printed and written as JSON.",
  {
    name: nameProp,
    clip: { type: "string", description: "Path of the clip inside the project, for example src/footage/c1.mp4." },
    db: { type: "number", maximum: -1, description: "Silence level in dB below zero (default -32)." },
    min: { type: "number", minimum: 0.05, description: "Shortest pause in seconds (default 0.4)." },
  },
  ["name", "clip"],
  WRITE_GENERATED,
  async ({ name, clip, db, min }, ctx) => {
    const dir = existingProject(name);
    return studioSync({ label: "silences", args: ["silences", dir, projectFile(dir, clip, "The clip"), ...flagArgs([["db", db], ["min", min]])], project: dir, signal: ctx.signal, after: jsonAfter(dir, "silences", clip) });
  },
  { needsHome: true, title: "Find pauses" },
);

define(
  "studio_scenes",
  "Finds the shot changes in a clip of the project. Use it to find usable shots in footage before trimming; the result is printed and written as JSON.",
  {
    name: nameProp,
    clip: { type: "string", description: "Path of the clip inside the project, for example src/footage/c1.mp4." },
    threshold: { type: "number", minimum: 0.01, maximum: 0.99, description: "Change sensitivity between 0 and 1 (default 0.3; lower finds softer cuts)." },
  },
  ["name", "clip"],
  WRITE_GENERATED,
  async ({ name, clip, threshold }, ctx) => {
    const dir = existingProject(name);
    return studioSync({ label: "scenes", args: ["scenes", dir, projectFile(dir, clip, "The clip"), ...flagArgs([["threshold", threshold]])], project: dir, signal: ctx.signal, after: jsonAfter(dir, "scenes", clip) });
  },
  { needsHome: true, title: "Find shot changes" },
);

define(
  "studio_say",
  "Speaks one line with the project's voice and writes audio/say.wav, so the user can play it to check how a name or word is pronounced. Fix wrong sounds with lexicon in project.json.",
  {
    name: nameProp,
    text: { type: "string", minLength: 1, description: "The line to speak, in normal spelling." },
    voice: { type: "string", enum: VOICES, description: "Voice id (default: the project's voice)." },
  },
  ["name", "text"],
  WRITE_GENERATED,
  async ({ name, text: line, voice }, ctx) => {
    const dir = existingProject(name);
    return studioSync({
      label: "say",
      args: ["say", dir, line, ...flagArgs([["voice", voice]])],
      project: dir,
      signal: ctx.signal,
      after: async () => `\nSpeech file for the user to play: ${path.join(dir, "audio", "say.wav")}`,
    });
  },
  { needsHome: true, title: "Say one line" },
);

// ---------------------------------------------------------------- jobs
define(
  "studio_voice",
  "Speaks every scene's narration with the local Kokoro voice into audio/vo/ and writes durations.json; flags lines that are too fast. Use it after the narration is in project.json. Runs as a job.",
  { name: nameProp, only: { type: "array", items: { type: "string", pattern: "^s\\d+$" }, description: "Scene ids to redo, for example [\"s2\",\"s4\"]. Default: all scenes." } },
  ["name"],
  WRITE_GENERATED,
  async ({ name, only }) => {
    const dir = existingProject(name);
    return studioJob({ label: "voice", args: ["voice", dir, ...flagArgs([["only", only?.length ? only.join(",") : undefined]])], project: dir });
  },
  { needsHome: true, title: "Narration voice" },
);

define(
  "studio_transcribe",
  "Gets word times for a footage project: transcribes audio/voice.wav with Whisper, or imports a .srt, .vtt or .json caption file. Use it after cut so captions match the edit. Runs as a job.",
  { name: nameProp, file: { type: "string", description: "Optional path inside the project of a clip to transcribe, or of a .srt, .vtt or .json file to import." } },
  ["name"],
  ann(false, false, true, true),
  async ({ name, file }) => {
    const dir = existingProject(name);
    return studioJob({ label: "transcribe", args: ["transcribe", dir, ...(file ? [projectFile(dir, file, "The file")] : [])], project: dir });
  },
  { needsHome: true, title: "Word times" },
);

define(
  "studio_look_from",
  "Measures the look of reference images or videos (palette, contrast, grain, cut rhythm) and drafts a custom look for the project, returning a look card image. Or draws the card of a built in look with card. Runs as a job.",
  {
    name: nameProp,
    files: { type: "array", items: { type: "string" }, minItems: 1, description: "Full paths of reference images or videos on this computer (the CLI option --from)." },
    card: { type: "string", enum: LOOKS, description: "Instead of files: draw the card of a built in look, to compare looks." },
  },
  ["name"],
  WRITE_GENERATED,
  async ({ name, files, card }) => {
    const dir = existingProject(name);
    if ((files === undefined) === (card === undefined)) throw new UserError("Give either files (reference images or videos) or card (a built in look), not both and not neither.");
    if (card) return studioJob({ label: "look", args: ["look", dir, "--card", card], project: dir, attach: sheetAttach(dir, [`stills/look-card-${card}.jpg`]) });
    const resolved = files.map((f) => userFile(f, "The reference file"));
    return studioJob({ label: "look", args: ["look", dir, "--from", ...resolved], project: dir, attach: sheetAttach(dir, ["stills/look-card.jpg"]) });
  },
  { needsHome: true, title: "Look from a reference" },
);

define(
  "studio_stills",
  "Composes the page and renders frames at key moments (or at the times given), returning the contact sheet and, for 9:16, the safe area guide as images. Use it to look at the video before rendering. Runs as a job.",
  {
    name: nameProp,
    times: { type: "array", items: { type: "number", minimum: 0 }, description: "Seconds to capture, for example [1.5, 4]. Default: the hook frame, each scene's middle and end, and the last half second." },
    platform: { type: "string", enum: PLATFORMS, description: "Safe area guide to draw (default: the project's platform)." },
  },
  ["name"],
  WRITE_GENERATED,
  async ({ name, times, platform }) => {
    const dir = existingProject(name);
    return studioJob({
      label: "stills",
      args: ["stills", dir, ...(times ?? []).map(String), ...flagArgs([["platform", platform]])],
      project: dir,
      attach: sheetAttach(dir, ["stills/sheet.jpg"], [["stills", "^safe-[a-z]+\\.jpg$"]]),
    });
  },
  { needsHome: true, title: "Preview stills" },
);

define(
  "studio_render",
  "Renders the project to an MP4 in out/ with the loudness fixed, keeping the previous render in history/. Use it when the stills look right. Runs as a job; follow it with studio_check.",
  { name: nameProp, draft: { type: "boolean", description: "A fast, lower quality render to check motion." } },
  ["name"],
  WRITE_GENERATED,
  async ({ name, draft }) => {
    const dir = existingProject(name);
    return studioJob({ label: "render", args: ["render", dir, ...flagArgs([["draft", draft === true]])], project: dir });
  },
  { needsHome: true, title: "Render the video" },
);

define(
  "studio_check",
  "Runs the automatic checks on the rendered MP4 (format, frame rate, sound, loudness, black and frozen frames, sync, captions) and returns the lines and a final contact sheet. Works on plain HyperFrames projects too. Runs as a job.",
  { name: nameProp },
  ["name"],
  WRITE_GENERATED,
  async ({ name }) => {
    const dir = existingProject(name);
    return studioJob({ label: "check", args: ["check", dir], project: dir, attach: sheetAttach(dir, ["stills/final-sheet.jpg"]) });
  },
  { needsHome: true, title: "Check the video" },
);

define(
  "studio_synctest",
  "Proves picture and sound line up for the whole pipeline on this computer, with a test video of flashes and beeps. Use it after setup or when the render engine changed. Runs as a job.",
  { beep_offset: { type: "integer", description: "Test only: place the beeps this many frames late, to prove the test can fail." } },
  [],
  WRITE_GENERATED,
  async ({ beep_offset }) => studioJob({ label: "synctest", args: ["synctest", ...flagArgs([["beep-offset", beep_offset]])] }),
  { needsHome: true, title: "Sync test" },
);

define(
  "studio_job_status",
  "Shows the state of a job started by another tool and waits up to wait_sec (at most 25) for it to finish. When it is done it returns the result, with contact sheets and look cards as images.",
  {
    job_id: { type: "string", description: "The job_id returned by the tool that started the job." },
    wait_sec: { type: "number", minimum: 0, maximum: MAX_WAIT_SEC, description: "Seconds to wait for it to finish (default 20, at most 25)." },
  },
  ["job_id"],
  READ,
  async ({ job_id, wait_sec }, ctx) => {
    const job = await waitForJob(job_id, wait_sec ?? 20, ctx.signal);
    const head = `Job ${job.id} (${job.label})`;
    if (!isFinal(job)) return text(`${head}: ${progressText(job)}`, { structuredContent: { job_id: job.id, state: job.state } });
    const took = seconds(job);
    const summary = `${head}: ${job.state}${job.exit_code === null ? "" : ` (exit code ${job.exit_code})`}${took === null ? "" : `, ${took} s`}`;
    const body = resultText(job);
    return { content: [{ type: "text", text: `${summary}\n${body}`.trim() }, ...(await jobImages(job))], structuredContent: { job_id: job.id, state: job.state, exit_code: job.exit_code } };
  },
  { title: "Job status" },
);

define(
  "studio_job_log",
  "Returns the last lines of a job's log. Use it to see progress or the full error of a job that is running or failed.",
  {
    job_id: { type: "string", description: "The job_id returned by the tool that started the job." },
    lines: { type: "integer", minimum: 1, maximum: 500, description: "How many lines from the end (default 40)." },
  },
  ["job_id"],
  READ,
  async ({ job_id, lines }) => {
    readJob(job_id);
    return text(toolWords(logLines(job_id, lines ?? 40)) || "(the log is empty so far)");
  },
  { title: "Job log" },
);

// ---------------------------------------------------------------- output
define(
  "studio_open",
  "Gives the absolute path and the file:// link of the project's newest finished MP4. Use it at the end to tell the user where the video is, or to find it again.",
  { name: nameProp },
  ["name"],
  READ,
  async ({ name }) => {
    const dir = existingProject(name);
    const mp4 = latestMp4(dir);
    if (!mp4) throw new UserError(`Project ${name} has no rendered MP4 yet. Run studio_render first.`);
    return text(`${mp4.file}\n${pathToFileURL(mp4.file).href}\n${mp4.size} bytes, made ${new Date(mp4.mtimeMs).toISOString()}`);
  },
  { title: "Where the video is" },
);

define(
  "studio_export",
  "Copies a project's sources (project.json, src/, brief.md, shots.md, feedback.md) to a folder, for filing in a repository. Never copies comp, stills, audio, out, history or footage. Refuses a non empty dest unless overwrite is true.",
  {
    name: nameProp,
    dest: { type: "string", description: "Absolute path of the destination folder, for example /Users/me/repo/media/my-video." },
    overwrite: { type: "boolean", description: "Allow writing into a dest that exists and is not empty (default false)." },
  },
  ["name", "dest"],
  ann(false, true, true, false),
  async ({ name, dest, overwrite }) => text(exportProject(name, dest, overwrite === true)),
  { title: "Export the sources" },
);

// ---------------------------------------------------------------- plain HyperFrames projects
define(
  "studio_import_hyperframes",
  "Copies a plain HyperFrames project folder (its own index.html with a HyperFrames root composition) into the projects folder as a project of kind hyperframes. Refuses a folder without such an index.html.",
  {
    folder: { type: "string", description: "The full path of the HyperFrames project folder on this computer." },
    name: nameProp,
  },
  ["folder", "name"],
  ann(false, false, false, false),
  async ({ folder, name }) => text(importHyperframes(folder, name)),
  { title: "Import a HyperFrames folder" },
);

define(
  "studio_hyperframes",
  `Runs the installed HyperFrames on a project: ${ALLOWED_COMMANDS.join(", ")}. Use it for plain HyperFrames projects (lint, render as a job, snapshot). Publishing, cloud, install and preview commands are refused.`,
  {
    name: nameProp,
    command: { type: "string", description: `One of: ${ALLOWED_COMMANDS.join(", ")}.` },
    args: { type: "array", items: { type: "string" }, description: "Flags and their values only, for example [\"-o\", \"out/video.mp4\"]. Paths must stay inside the project. The project folder is passed for you." },
  },
  ["name", "command"],
  ann(false, false, false, true),
  async ({ name, command, args }, ctx) => {
    const env = tryEnv();
    const dir = existingProject(name);
    const plan = planHyperframes(dir, command, args ?? []);
    const label = `hyperframes ${command}`;
    const id = newJobId();
    const outFlag = (args ?? []).findIndex((a) => a === "-o" || a === "--output");
    const snapDir = command === "snapshot" ? (outFlag >= 0 ? path.resolve(dir, String(args[outFlag + 1] ?? "snapshots")) : path.join(dir, "snapshots")) : null;
    startJob({
      id,
      label,
      kind: "hyperframes",
      node: env.node,
      args: [env.hyperframes, ...plan.argv],
      cwd: dir,
      env: hyperframesEnv(env),
      heavy: plan.job,
      project: dir,
      attach: { files: [], globs: snapDir ? [{ dir: snapDir, pattern: "\\.png$" }] : [] },
    });
    if (plan.job) return jobStarted(id, label);
    return waitOrJob({ id, label, signal: ctx.signal });
  },
  { needsHome: true, title: "Run HyperFrames" },
);

export { JOB_COMMANDS, checkName, SKILL_DIR };
