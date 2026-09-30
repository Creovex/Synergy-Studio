import fs from "node:fs";
import path from "node:path";
import { SKILL, SAFE, SIZES, LOOKS, die, say, parseArgs } from "./common.mjs";

const PLATFORMS = [...Object.keys(SAFE), "youtube", "linkedin", "x", "website"];
export const USAGE = "new <dir> [--mode narrated|footage|film] [--aspect 16:9|9:16|1:1|4:5] [--platform tiktok|reels|shorts|meta|youtube|linkedin|x|website] [--length 30] [--look paper|midnight|bold|luxe]";

// ---------------------------------------------------------------- new
function newProject(dir, opts) {
  if (!dir) die("usage: studio new <folder> [--mode narrated|footage|film] [--aspect 16:9|9:16|1:1|4:5] [--platform tiktok|reels|shorts|meta|youtube|linkedin|x|website] [--length 30] [--look paper|midnight|bold|luxe]");
  const mode = opts.mode || "narrated"; if (!["narrated", "footage", "film"].includes(mode)) die("--mode must be narrated, footage or film");
  if (opts.look && !LOOKS.includes(opts.look)) die("--look must be one of " + LOOKS.join(", ") + " (for a canvas film use the sketch kit: references/illustration.md)");
  if (opts.length !== undefined && (opts.length === true || !(+opts.length > 0))) die("--length needs a number of seconds, e.g. --length 30");
  const d = path.resolve(dir);
  if (fs.existsSync(path.join(d, "project.json"))) die(`${d} already has a project`);
  const aspect = opts.aspect || "16:9"; if (!SIZES[aspect]) die("aspect must be one of " + Object.keys(SIZES).join(", "));
  const plat = opts.platform || (aspect === "9:16" ? "tiktok" : "");
  if (plat && !PLATFORMS.includes(plat)) die("platform must be " + PLATFORMS.slice(0, -1).join(", ") + " or " + PLATFORMS[PLATFORMS.length - 1]);
  fs.mkdirSync(path.join(d, "src", "assets"), { recursive: true });
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
    else { proj.music = "warm"; proj.transition_whoosh = false; }   // a generated bed until the user's track is added (studio_file_add, then music {file, start, gain_db})
  }
  fs.writeFileSync(path.join(d, "project.json"), JSON.stringify(proj, null, 2));
  let html = fs.readFileSync(path.join(SKILL, "template", "index.html"), "utf8");
  if (opts.look) html = html.replace('data-look="paper"', `data-look="${opts.look}"`);
  fs.writeFileSync(path.join(d, "src", "index.html"), html);
  for (const f of ["brief.md", "shots.md", "feedback.md"])
    fs.writeFileSync(path.join(d, f), fs.readFileSync(path.join(SKILL, "template", f), "utf8").replace(/\{\{NAME\}\}/g, proj.name));
  const steps = { narrated: `  1. studio budget ${dir}, then write the narration in project.json (scenes[].say)\n  2. studio voice ${dir}   3. studio audio ${dir}   (then studio words ${dir}, add events, studio audio again)`,
    footage: `  1. put clips in src/footage/ and list them in project.json "edit.clips" (src, in, out)\n  2. studio cut ${dir}   3. studio transcribe ${dir}   4. set scenes (start/end s of the edit)   5. studio audio ${dir}`,
    film: `  1. music starts as the generated "warm" bed; for the user's track add it with studio_file_add and set "music": {"file": "src/assets/<song>", "start": 0, "gain_db": -3}\n  2. set scenes (start/end in seconds, e.g. one per bar)   3. studio audio ${dir}` }[mode];
  say(`New ${mode} project: ${d}  (${aspect}${plat ? ", " + plat : ""}, ${proj.length} s)\n  0. fill brief.md and shots.md (the plan) and get the user's OK\n${steps}\n  then: write src/index.html → studio stills ${dir} (look!) → studio render ${dir} → studio check ${dir}`);
}

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  newProject(pos[0], flags);
  return 0;
}
