# How Synergy Studio Makes a Video

**The architecture of the whole app, as built.** From a sentence typed to Claude to a finished, checked MP4: every
tool, every step and every idea behind it, explained from the ground up, then described module by module.

- **Status:** describes version 0.4.0 (lite L13). Keep it true: see C9 at the end.
- **Readers:** Part A and Part B are written for someone comfortable with computers who has not met these tools
  (a college student); no term is used before it is explained. Part C is the developer reference: every module, every
  data format, every flow. Builders read C first and A and B when a concept is unclear.
- **The PDF** (`dist/architecture.pdf`) is built from this file by `node scripts/build-architecture-pdf.mjs`. The
  appendices of all tools and of the command line are generated from the code at build time.

Conventions: `monospace` marks a name you would type or see in a file. A *tool* written `studio_audio` is something
Claude calls; a *command* written `studio audio` is the same action typed in a terminal. Boxes titled **What is it?**
define a term, **Why it matters** explains a design choice, **Worked example** shows real numbers.

## Part A1. The big picture

Imagine a small film studio. A **director** reads the client's request and plans the film. A **script** says what is
said and when. **Actors** speak the lines. A **composer** writes the music. An **animator** draws each scene. A
**camera crew** films every frame. A **sound engineer** mixes voices, music and effects to the right loudness, and
**quality control** measures the result before it goes out. Synergy Studio has a part for each job:

| Film studio job | In Synergy Studio |
|---|---|
| Director, writer, animator | **Claude**, an AI model, following a written instruction manual called the **skill** |
| The script and the plan | `project.json` (settings, lines, timings) and `brief.md` (the plan) |
| The drawings and motion | A **web page** (`src/index.html`) animated with the **GSAP** library |
| Actors | **Kokoro**, a speech synthesis model that turns text into a voice |
| Composer and band | Generated music beds, the user's song, or a **score file** played on sampled instruments by **tinysoundfont** or on toy synthesizers |
| Camera crew | **HyperFrames**, which plays the page in a hidden browser and captures it frame by frame |
| Editing room and sound engineer | **FFmpeg**, plus Python scripts that build the soundtrack |
| Quality control | The **checks** (`studio check`): eleven measurements plus sync, captions and balance lines |
| Front desk | The **MCP server**, which lets Claude ask for each job by name |

The journey in one sentence: you type a request to Claude; Claude reads the skill, plans the video, writes the page
and the settings, then calls tools that make the voice, build the soundtrack, take preview pictures, render the MP4
and measure it; Claude looks at the results, fixes what is wrong and hands you the file.

```diagram
You: "make a 15 s video about drinking water"
        |
        v
Claude reads the skill, plans, writes project.json and src/index.html
        |   calls tools through MCP
        v
voice (Kokoro) -> audio (timing + mix) -> stills (preview frames)
        |
        v
render (HyperFrames + FFmpeg) -> check (measurements) -> open (deliver the MP4)
```

> **Why it matters: why not an AI video generator?** AI video models paint pixels from noise. They cannot promise that
> a sound lands on an exact frame, that a brand colour is exact, or that a rebuild gives the same result. Synergy Studio
> writes the video as code and data: every animation and every sound has a time computed from the script, so a door
> slam lands on the frame where the door closes, and building the same project twice gives the same frames and sound.

## Part A2. The ideas you need first

### A2.1 Claude, tools and tool calls

> **What is it? A large language model.** Claude is a large language model (LLM): a program trained on a great deal of
> text that reads a conversation and writes the next reply. On its own it can only produce text; it cannot open files,
> run programs or render video.

To act in the world Claude uses **tools**. A tool is a named action, described in plain words, with a list of inputs.
Claude decides when a tool would help and writes a short structured request (a **tool call**: the tool's name and its
inputs). The application running Claude carries it out and returns the result as text or images; Claude reads it and
decides what to do next. A whole video takes a few dozen calls. Two Claude applications matter here:

- **Claude Code**: runs in a terminal (the text window where you type commands). Synergy Studio installs into it as a **plugin**.
- **Claude Desktop**: the chat application for Mac and Windows. Synergy Studio installs into it as an **extension**. It
  cannot browse the web and cannot see the file path of a video dragged into the chat.

### A2.2 MCP, the Model Context Protocol

> **What is it? A protocol.** A protocol is an agreed format for two programs to talk, like the rules of a phone call.
> HTTP is the protocol of the web. MCP, the Model Context Protocol, is an open protocol for connecting AI applications to tools.

MCP has two sides. The **client** is the AI application (Claude Code or Claude Desktop). The **server** is a program
that offers tools; Synergy Studio's is `mcp/server.mjs`. The client starts the server as a separate program and talks
to it through **stdio** (standard input and output: the server reads requests on its input stream and writes answers on
its output stream, one message per line). Each message is **JSON** (JavaScript Object Notation: names and values in
braces) following **JSON-RPC 2.0**: a request carries an `id`, a `method` and `params`; the answer carries the same `id`
and a `result` or an `error`. A server offers three kinds of things:

- **Tools**: actions Claude can call (41, all named `studio_*`).
- **Resources**: documents Claude can read (the skill, its references, the examples).
- **Prompts**: ready-made starting requests (`new-video`, `improve-video`).

> **Worked example: one tool call on the wire.**
> `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"studio_audio","arguments":{"name":"water-video"}}}`
> is answered by `{"jsonrpc":"2.0","id":7,"result":{"content":[{"type":"text","text":"... wrote timing.js and audio/mix.wav (-14.0 LUFS)"}]}}`.
> Claude never sees the braces: it sees the tool's description and the text of the result.

> **Why it matters.** Because MCP is a standard, one server works in Claude Code and Claude Desktop: the same 41 tools,
> instructions and results appear in both.

### A2.3 Skills, plugins and extensions

A **skill** is an instruction manual for Claude written in Markdown (plain text where `#` marks a heading and `-` a list
item). The main skill is `skills/synergy-studio/SKILL.md` with 21 references in `references/` (planning, the page,
music, review). A second skill, `skills/music-for-picture/`, teaches composing music for film. The skill is the
**contract**: the code must provide every command, file and helper the skill names, and test T0 proves it.

A **plugin** is how Claude Code installs a package: a manifest (`.claude-plugin/plugin.json`), the skills, and
`.mcp.json`, which says how to start the server. An **extension bundle** (`dist/synergy-studio.mcpb`, a zip file) does
the same for Claude Desktop. Both carry the same server and skills.

### A2.4 Programs, the command line and runtimes

A **command line interface** (CLI) is a program controlled by a typed command and its arguments, for example
`node studio.mjs audio <project>`. Synergy Studio's CLI is `skills/synergy-studio/scripts/studio.mjs` with 27 commands.
The MCP tools never do the work themselves: each runs the matching command, so behaviour lives in one place.

Programs need a **runtime** to run them:

- **Node.js** runs JavaScript outside a browser (the CLI and the server). Its packages come from **npm**.
- **Python** runs the sound and measurement scripts. Its packages (numpy for arrays of numbers, soundfile for WAV
  files, Pillow for images) come from **PyPI**. A **virtual environment** (venv) is a private folder of packages for
  one application.
- **uv** creates the venv and installs packages exactly as listed in a **lock file** (`requirements.lock`), which
  records each package's exact version and checksum.

Synergy Studio downloads its own copies of Node, uv, Python and the rest into a private folder, the **tool home**, so
it never depends on or changes other software on the computer.

### A2.5 A video as a web page: HTML, CSS, JavaScript and GSAP

- **HTML** describes the elements (headings, pictures, boxes); each can have an `id` and attributes.
- **CSS** describes how they look (colours, fonts, sizes, positions).
- **JavaScript** changes the page over time.

Pages can also hold **SVG** (vector drawings), a **canvas** (a rectangle a script paints pixel by pixel; the sketch
kit draws hand-drawn films there) and **three.js** (a 3D library).

> **What is it? GSAP and timelines.** GSAP (the GreenSock Animation Platform) is a JavaScript animation library. Its
> key idea is the **timeline**: a list of animations, each at a time ("at 2.4 s, move the card up 40 pixels over
> 0.5 s"). A timeline can be jumped to any moment (**seeking**): asking for the page at 7.233 s gives exactly the same
> picture every time. That property lets a page become a video.

The helper library `template/lib.js` wraps GSAP in short words Claude uses: `rise`, `pop`, `count`, `drawIn`,
`stagger`, `kenburns`, `punch`, `captions` and more, placed at times from the script such as `V("s2", 0.4)` (0.4 s after
scene 2's narration starts), `at("s2", "card")` (an event) or `CUE.slam` (a cue).

### A2.6 HyperFrames and headless Chrome

> **What is it? HyperFrames.** HyperFrames is an open source command line tool (by HeyGen, Apache-2.0, version 0.8.92
> here) that turns an HTML page into a video. Its pages are **compositions**: the root element states width, height,
> frame rate and duration; each scene has `data-start` and `data-duration`; an `<audio>` element names the soundtrack.

HyperFrames opens the page in **headless Chrome** (Chrome running with no window, driven by a program). For each frame
(at 30 fps, one every 1/30 s) it **seeks** the page's GSAP timeline to that frame's exact time, waits for the page to
settle and **captures** the picture; then it hands the pictures and the audio to FFmpeg to encode an MP4. Because each
frame is taken at an exact time rather than recorded live, a slow computer makes a render slower but never changes a
frame. HyperFrames also offers `lint`, `validate`, `snapshot`, `transcribe` and other commands; Synergy Studio uses
`render` and `lint` on every video and lets Claude run a safe list of the others on plain HyperFrames projects.

### A2.7 FFmpeg, codecs and containers

**FFmpeg** is a free command line program that reads, converts, cuts, mixes, measures and writes almost any audio or
video; **FFprobe** only reads facts about a file. Synergy Studio uses them for encoding, mixing, loudness measurement,
frame extraction and black or frozen frame detection.

- A **codec** compresses audio or video: **H.264** for pictures and **AAC** for sound, which every device plays.
- A **container** holds the compressed streams with their timing: **MP4**.
- A **WAV** file holds uncompressed sound (a list of samples, A2.8). Mixing is done in WAV so nothing is lost before the final encode.

### A2.8 Sound as numbers

Sound is air pressure going up and down. A microphone or synthesizer turns it into numbers called **samples**, taken
many times a second: the **sample rate**, 24,000 per second (24 kHz) for the voice and 48,000 (48 kHz) for music and the
final video. A sample rate describes pitches only up to half its value, so 48 kHz keeps cymbals and shakers that 24 kHz
would lose. **Mono** is one list of samples, **stereo** two.

Samples run from -1 to +1. Level is measured in **decibels** (dB): every 6 dB is about a doubling of the signal, 20 dB is ten times.

- **dBFS**: decibels relative to the largest sample (0 dBFS; -6 dBFS is half of it).
- **LUFS**: how loud a whole programme sounds to people, measured with a standard filter (ITU-R BS.1770, EBU R128).
  Social platforms play at about **-14 LUFS**, Synergy Studio's target.
- **True peak** (dBTP): the highest point of the wave between samples, found by **oversampling** (computing extra
  points in between). Above about -1 dBTP a file can distort when compressed or played.

Four sound tools appear later: a **limiter** keeps peaks under a ceiling by turning the sound down very briefly; a
**compressor** turns loud passages down more gently; **ducking** lowers music while someone speaks; **reverb** imitates
a room's echoes, made here by **convolution** (each sample triggers a copy of a room's **impulse response** and the
copies are summed). **Cross-correlation** compares two signals at every delay and reports where they match best; the
checks use it to prove the MP4's sound is not shifted.

### A2.9 Speech: Kokoro and Whisper

**Kokoro** is a text-to-speech model (82 million parameters, Apache-2.0). Synergy Studio runs a compressed copy (88 MB)
with **ONNX Runtime**, an engine that runs machine learning models on an ordinary processor. Text first becomes
**phonemes** (the sounds of speech) through the eSpeak NG library; Kokoro then produces a 24 kHz voice. Ten voices, US
and UK, female and male. Nothing is sent anywhere.

**Whisper** is a speech-to-text model by OpenAI (MIT), run through **whisper.cpp**, a fast C++ program built during
setup. It makes captions for footage and **listens back** to every line Kokoro spoke, comparing the words heard with
the words written. That gives Claude ears: it cannot hear audio, but it can read what Whisper heard.

### A2.10 Music as numbers: MIDI, SoundFonts and tinysoundfont

**Tempo** is in beats per minute (BPM); 120 BPM is a beat every 0.5 s. Beats group into **bars**; the **meter** 4/4
means four beats per bar; each beat divides into four **sixteenths**. **Swing** delays every second sixteenth slightly
for a human feel.

**MIDI** describes music as events, not sound: "note 60 (middle C) on, velocity 100", then "note 60 off". **Velocity**
(1 to 127) is how hard a note is played. **General MIDI** numbers 128 instruments 0 to 127 (0 grand piano, 33 fingered
bass, 55 orchestra hit) and the drum kits, where each note is a drum (36 kick, 38 snare).

> **What is it? A SoundFont and a synthesizer.** A SoundFont (`.sf2`, compressed `.sf3`) is a file of recorded
> instrument samples with rules for playing them at any pitch and velocity; Synergy Studio installs MuseScore General
> (40 MB, MIT). A synthesizer plays note events through it; Synergy Studio uses **tinysoundfont** (MIT), which renders
> offline, sample by sample, into memory.

Synergy Studio also has **toy sounds**: instruments made from simple waves (sine, square, sawtooth) and noise, for a
playful cartoon sound, with no SoundFont.

### A2.11 Determinism, seeds and checksums

A process is **deterministic** if the same input always gives exactly the same output. Computers break this through
random numbers, the clock, and timing between parallel tasks. Synergy Studio removes all three from its videos:

- **Seeds**: anything that should look random (paper grain, a hand-drawn wobble, a shaker's loudness) comes from a
  generator started from a fixed number, or from a **hash** (a function that turns any input into a fixed-looking
  number; the same input always gives the same hash).
- **No clock**: the page may not read the time of day or use timers; everything sits on the timeline.
- **Seeking**: each frame is captured at an exact time.

A **checksum** (SHA-256) is a hash of a file's bytes. Setup records the checksum of every download and refuses a file
whose checksum differs.

## Part B1. The architecture: three layers and two folders

```diagram
You, in Claude Code or Claude Desktop
        |  your request
        v
Layer 1  THE SKILL        SKILL.md + 21 references + the music skill: what to do, in what order, how to judge it
        |  Claude calls tools (MCP: JSON-RPC over stdio)
        v
Layer 2  THE MCP SERVER   mcp/server.mjs: 41 tools, path rules, jobs for long work, logs
        |  each tool runs a command
        v
Layer 3  THE CLI          studio.mjs, 27 commands: runs the Python scripts, HyperFrames, FFmpeg, Kokoro, Whisper, tinysoundfont
```

| Folder | Where (Mac) | What lives there |
|---|---|---|
| **Tool home** (one per computer) | `~/Library/Application Support/SynergyStudioLite` | Node, uv, npm packages (HyperFrames, GSAP, three.js, fonts) and HyperFrames' Chrome, the Python venv, the Kokoro model, the SoundFonts, FFmpeg and FFprobe, whisper.cpp, `env.json`, `jobs/`, `server.log`, `locks/heavy.lock` |
| **Projects home** | `~/Movies/Synergy Studio` | one folder per video (B3) |

On Windows: `%LOCALAPPDATA%\SynergyStudioLite` and `%USERPROFILE%\Videos\Synergy Studio`. `SYNERGY_STUDIO_HOME` and
`SYNERGY_STUDIO_PROJECTS` move them. Nothing is installed system wide; nothing needs administrator rights.

> **Why it matters: why three layers?** The skill changes without touching code; the server serves any client without
> knowing how videos are made; the CLI does the work and is tested on its own. A fix in one place reaches Claude Code,
> Claude Desktop and the terminal at once.

## Part B2. Installation: setup, doctor and synctest

When the tools are missing, Claude calls `studio_setup_start`, which runs `studio setup` as a background job (5 to 15
minutes, about 2 GB). Each of the eleven steps checks its real state first and says "already done" when there is
nothing to do, so running setup again repairs only what is broken.

| # | Step | What it does and why |
|---|---|---|
| 1 | Node runtime | Pinned Node.js (v22.23.3) from nodejs.org, checked against the official checksums; runs HyperFrames and the jobs |
| 2 | uv | Pinned uv (0.12.21) from GitHub, checksum verified |
| 3 | npm packages | Exact versions of HyperFrames 0.8.92, GSAP 3.14.2, three.js 0.186.1, FFprobe and four font families |
| 4 | Python venv | Python 3.11 venv from `requirements.lock`, installed with `--require-hashes`: Kokoro, soundfile, Pillow, numpy, imageio-ffmpeg, tinysoundfont (its playback only dependency `pyaudio` excluded) |
| 5 | Kokoro model files | The voice model (88 MB) and voices (28 MB), checksums pinned |
| 6 | SoundFont | MuseScore General (40 MB) from the MuseScore mirror, checksum pinned, recorded in `soundfonts/fonts.json` |
| 7 | FFmpeg and FFprobe | Copied into `bin/`, architecture checked, signed ad hoc on macOS |
| 8 | whisper.cpp | Built from a pinned source release with cmake and Apple's command line developer tools (macOS) |
| 9 | Whisper model | The English small model (about 466 MB) |
| 10 | Render browser | HyperFrames fetches its headless Chrome |
| 11 | env.json | Records every path |

**Doctor** (`studio_doctor`) prints one PASS, WARN or FAIL line per part with the fix; `full` adds a 1 s 60 fps test
render and a 1 s three.js render. **Synctest** proves once per computer that picture and sound line up through the whole
pipeline: a black 10 s video with one-frame white flashes at 2.0, 4.5 and 7.0 s and 50 ms beeps at the same moments goes
through the normal compose and render path; flashes are found by brightness above 200 of 255, beeps by the ends of the
silences, and every pair must be within one frame. It reruns when HyperFrames or its browser changes version.

## Part B3. Anatomy of a project

| File | Written by | What it is |
|---|---|---|
| `project.json` | Claude | Settings and script |
| `brief.md`, `shots.md`, `feedback.md` | Claude and you | The plan, the shot list, your notes (KEEP, CUT and WHY) |
| `src/index.html` | Claude | The page: the video itself |
| `src/score.json` | Claude (optional) | Music written as data (B7) |
| `src/assets/`, `src/footage/` | you, via `studio_file_add` | Logos, photos, fonts, songs, clips |
| `audio/vo/s1.wav` ..., `durations.json` | `voice` | Narration per scene and its length |
| `timing.json`, `timing.js` | `audio` | Every scene, event and cue time (B5) |
| `audio/mix.wav` | `audio` | The finished soundtrack at -14 LUFS |
| `comp/` | `compose` | The render-ready copy of the page |
| `stills/` | `stills`, `check` | Contact sheets for Claude to look at |
| `out/<name>-9x16.mp4` | `render` | The video; earlier versions move to `history/` |

| Field of project.json | Meaning |
|---|---|
| `mode` | `narrated` (the voice sets the timing), `footage` (your clips, cut by `studio cut`), `film` (wordless; scenes in seconds) |
| `aspect`, `fps`, `platform`, `length` | 16:9, 9:16, 1:1 or 4:5; 24, 25, 30 or 60 fps; the platform's safe area; the target length |
| `voice`, `speed`, `lexicon` | A Kokoro voice; speech speed; pronunciation fixes |
| `scenes` | narrated `{"id", "say"}`; film and footage `{"id", "start", "end"}` |
| `events` | named moments inside a scene, seconds after its narration starts, optionally with a sound effect |
| `cues` | the cue sheet: named moments in absolute seconds shared by page, music and checks; `"sync": true` asks `check` to measure them |
| `music` | `warm`, `calm`, `upbeat`, `none`, or your song `{"file", "start", "gain_db"}` |
| `edit` | the footage cut list, grade and voice cleaning |

Unknown fields are refused, so a misspelt field never silently does nothing.

## Part B4. One video, step by step

What happens when you ask "Use Synergy Studio to make a 15 second 9:16 video about drinking water before coffee":

1. **Read the guide.** `studio_guide` returns SKILL.md and the list of references. The server's greeting tells Claude to call it first.
2. **Check the installation.** `studio_doctor`; if not set up, `studio_setup_start` (B2).
3. **Plan.** No tool: Claude names the kind of video, the audience, the one message, a tone card and a shot list. For a
   story or a brand's first video it may ask questions or show beat sheets first ("a full build is the most expensive
   way to learn the idea was wrong").
4. **Create the project.** `studio_project_new` (`name`, `aspect`, `platform`, `length`): the folder, a starter
   `project.json`, a starter page and the brief, shot list and feedback templates.
5. **Budget the words.** `studio_budget` prints how many words fit each scene for the target length.
6. **Write the script.** `studio_file_write` of `project.json`: the server checks the path is inside the project and
   writable, writes it, and reads the first and last line back as proof.
7. **Make the voice.** `studio_voice` (a job). `voice.py` rewrites text the voice misreads (2 a.m. becomes 2 AM, 20%
   becomes 20 percent, Dr. becomes Doctor), warns about what it cannot fix (web addresses, prices, symbols), has Kokoro
   speak each scene, trims silence, stores each length in `durations.json`, flags lines over 3.5 words per second, then
   Whisper hears every line back and reports words heard differently, with their time.
8. **Time and mix the sound.** `studio_audio`: `audio.py` computes every time from the voice (B5), writes `timing.js`,
   builds the music, ducks it, adds effects, measures the balance; the CLI masters to -14 LUFS (B6).
9. **Time the moments.** `studio_words` estimates word times; Claude places `events` on key words and calls `studio_audio` again.
10. **Write the page.** `studio_file_write` of `src/index.html`: one scene element per scene and a GSAP timeline built
    with the `lib.js` helpers, every time taken from `timing.js` (patterns from `studio_example`).
11. **Preview.** `studio_stills` (a job). First **compose**: a **lint** (an automatic code review) refuses anything that
    would change from render to render or break: `Math.random`, clock time, timers, CSS animations and transitions, GSAP
    `.from()` and `.fromTo()`, internet links, scenes with no element, elements without an `id`, unknown cue names. The
    `{{...}}` placeholders are filled, files are copied into `comp/`, HyperFrames' lint runs. Frames are captured at 0.3 s,
    the middle and narration end of each scene and the last half second, joined into a **contact sheet** (a grid of
    thumbnails), plus a **safe area guide** of what the app's buttons would cover. Claude looks at them.
12. **Fix and repeat** until every frame is right (contrast, clutter, text cut off, empty frames).
13. **Render.** `studio_render` (a job), B8.
14. **Check.** `studio_check` (a job), B9. Every FAIL is fixed and every WARN fixed or explained.
15. **Deliver.** `studio_open` plays the MP4, shows it in Finder or copies it to a folder. Claude says what it could not check.

## Part B5. Timing: how every moment is computed

Narrated scenes run: scene start, then **pre** (or **lead** for the first scene), then the narration, then **post**
(plus **hold** for a silent scene, plus **tail** after the last), then scene end. Defaults are 0.4, 0.3, 0.7 and 2.0 s
for 9:16 and 0.9, 0.6, 1.2 and 2.5 s otherwise.

> **Worked example.** A 9:16 video, narration lengths 3.10 s and 4.20 s. Scene 1: start 0.00, narration from 0.40 to
> 3.50, end 4.20. Scene 2: start 4.20, narration from 4.50 to 8.70, end 8.70 + 0.7 + 2.0 = 11.40. An event
> `{"s2": {"card": 1.4}}` is at 4.50 + 1.4 = 5.90 s. A cue `{"slam": 9.0}` is at 9.0 s whatever the voice does.

`audio` writes these numbers to `timing.js` as `window.TIMING = {T, EV, CUE, SYNC, TOTAL, fps}`. The page, the music
anchors and the checks all read them, so changing one word moves every animation, effect and hit with it.

## Part B6. Sound: voice, music, effects and loudness

The soundtrack has three layers: the **voice**, the **music** and the **effects** (`pop`, `click`, `whoosh` on events and
cues, and a soft whoosh at each scene change).

Choosing the music engine. The rule: write a score only when the music carries meaning (a genre, an emotion, hits on
the picture); background music is the bed.

| The video | Engine |
|---|---|
| Background: calm, ambient, looping, utility clips | **Generated bed** `warm` (96 BPM), `calm` (72 BPM), `upbeat` (118 BPM): soft chords and a pluck from a seeded generator |
| Cartoon, kids, chiptune | **Toy sounds** in the score file (B7) |
| A genre (Afrobeats, hip-hop, lo-fi), warm, premium, documentary, cinematic | **Real instruments** in the score file (B7) |
| Comedy | Both in one score: a real playful orchestra with toy hits on the gags |
| You gave a song | Your file, from a start, at a gain |
| A film with no music yet | The starter score: a soft bed and a placeholder hit per cue |

**Ducking and balance.** The voice's loudness is measured every 50 ms; where it speaks the music is multiplied by about
0.4 (about 8 dB quieter), smoothed over 0.3 s. `audio` warns when the music sits less than **6 dB** under the voice while
it speaks, or an effect is more than **3 dB** above the voice's usual level; `check` shows it as `sound balance`.

**Loudness that corrects itself.** A limiter holds peaks under a ceiling but takes away loudness, so a one-pass
`loudnorm` lands too quiet on music full of hits. Synergy Studio searches: measure and guess the gain; apply the gain
and a 4x oversampled limiter; measure again; correct by the miss (up to four tries) until within 0.1 LU. It warns when
the limiter takes more than 6 dB, and stops with the reason when -14 cannot be reached within 1 LU.

## Part B7. Music written as data: the score file

Claude writes music as data in `src/score.json`, never as audio code:

```json
{
  "tempo": {"bpm": 104, "meter": "4/4", "swing": 0.5, "max_stretch": 0.06},
  "anchors": [{"bar": 1, "at": 0}, {"bar": 5, "at": "s2.drop"}],
  "tracks": {
    "drums": {"kit": "standard", "grids": [{"bars": "5-8", "kick": "x.....x.x.......", "shaker": "oxoxoxoxoxoxoxox"}]},
    "bass":  {"program": 33, "notes": [["5:1", "A1", "1/8"], ["5:2:3", "A1", "1/16"]]},
    "keys":  {"program": 4, "rhythm": "..x...x...x...x.", "chords": [["1:1", "Am9", "1/1"]]},
    "toy":   {"synth": "musicbox", "notes": [["7:1", "E5", "1/8"]]}
  },
  "hits": [{"at": "s3.slam", "sound": "impact"}, {"at": "cue:fall", "sound": "boing"}]
}
```

- **Positions** are `"bar:beat:sixteenth"` from 1; **grids** are 16 characters per bar (`x` hit, `X` accent, `o` ghost, `.` rest).
- **Programs** are General MIDI numbers; **kits** are drum kits (`standard`, `tr808`, `brush` and the synthetic `toy`);
  **synth** tracks use toy instruments (`pizz`, `bell`, `musicbox`, `whistle`, `pad`, `bass`, `stab`, `square`).
- **Hits**: real (`impact`, `sting`, `roll`) and toy (`boing`, `bonk`, `pop`, `squeak`, `splat`, `puff`, `slide_up`,
  `slide_down`, `tink`, `thud`, `nope`, `tweet`, `ring`, `thunder` start on their time; `whoosh` and `shimmer` are
  centred on it; `riser` ends on it).
- **Names for moments**: seconds, `cue:<name>`, `<scene>.<event>`, `<scene>.start`, `<scene>.end`. Any other name is
  refused with the list of names that exist.

> **Worked example: solving the tempo.** Bar 1 must start at 0.5 s and bar 9 when the logo lands at 19.0 s. That is
> 8 bars x 4 beats = 32 beats in 18.5 s: 0.578125 s per beat, so 60 / 0.578125 = **103.78 BPM**, a -0.21% stretch from
> 104. The limit is 6% (`max_stretch`); anchors needing more are refused with the tempo they would need ("need 156.00
> BPM, +50.0% from bpm 104"). Bar 9 lands within one sample (1/48,000 s).

How the file becomes sound:

1. **Check** (`score_file.py`): every problem listed at once with its fix (unknown drum, chord, kit or name; a grid not
   16 steps; a stretch too large; notes before 0 s; no notes).
2. **Compile**: positions become seconds through the solved tempo and swing; each note becomes an event (time, channel,
   key, velocity, length, dry, gain, group). Humanising comes from a hash of the seed, never a random generator.
3. **Check the instruments** (`instruments.py`): every preset is looked up in the SoundFont and a missing one is
   refused, never replaced; every key is sounded alone for 100 ms and a silent one is refused by name.
4. **Render sample-accurately**: events are sorted (a note-off before a note-on at the same sample) and the synthesizer
   generates exactly up to each event. Rendering in 512-sample blocks would push notes up to 10.7 ms late. Measured:
   percussive notes begin 0.12 to 4.00 ms after their time, never early; sixteen kicks all at the same offset.
5. **Per-track passes**: each track is played on its own and scaled by its `gain_db` exactly (-40 to +24 dB); the
   report lists each track's peak and flags one buried more than 30 dB under the loudest.
6. **Toy sounds** (`toys.py`) are computed from waves and noise and added the same way; a toy only score needs no font.
7. **Reverb**: kicks and basses dry; the rest through a convolution reverb from a fixed noise stream (`room` 0.8 s, `hall` 2 s).
8. **The report**: solved tempo, every anchor against its target in samples, every hit, each track's peak, note count,
   render time. Claude fixes the file, never the audio.

Into the soundtrack: `audio` mixes the score at 48 kHz stereo through a gentle **bus compressor** (3:1, at most 6 dB;
measured to cut the final limiter's work on an Afrobeats film from 6.9 dB to 2.8 dB at the same loudness), ducked under
the voice and kept 10 dB under it while it speaks. The score replaces a generated bed or the starter score; on your song
it plays on top, with a warning if it also has melody.

## Part B8. Rendering: from page to MP4

1. **Compose** again, so the render uses the latest page.
2. **Keep history**: the previous MP4 and its sources move to `history/<time>/`.
3. **Captions record**: the page is opened once in the render browser to save which word was shown when.
4. **HyperFrames renders**: headless Chrome loads `comp/index.html`; for each frame (450 for 15 s at 30 fps) the
   timeline is seeked and the frame captured; FFmpeg encodes H.264. A failed first start is retried once.
5. **Master from the lossless mix**: the final sound comes from `audio/mix.wav`, not from the compressed audio HyperFrames
   muxed, trimmed to the timeline, through the same gain search and limiter, encoded as AAC. The finished file is
   measured again; outside -14 ± 0.3 LUFS or above -1.5 dBTP, the gain or ceiling is corrected and it is encoded again
   (at most three encodes). The video stream is copied untouched.
6. **Share copy** when over 25 MB.

> **Why it matters: why master from the WAV?** Every lossy encode changes the sound. Taking the final sound from the
> lossless mix compresses it once, and measuring the finished file means the number shown is the number the platform measures.

## Part B9. The checks: how the result is measured

| Check | How it is measured | Pass |
|---|---|---|
| Video stream | FFprobe codec and size | H.264 at the project size |
| Frame rate | FFprobe | equals `fps` |
| Audio stream | FFprobe | AAC present |
| Duration | FFprobe against `timing.json` | within ± 0.15 s |
| Target length | against `length` | at most 5% over |
| Loudness | FFmpeg `ebur128` (EBU R128) | -14 ± 1 LUFS |
| True peak | the same meter, oversampled | at most -1.0 dBTP |
| No black frames | FFmpeg `blackdetect` | none of 0.5 s or more |
| Nothing frozen | FFmpeg `freezedetect` | no still stretch of 4 s or more |
| Audio against mix | both at 8 kHz mono, loudness every 10 ms, cross-correlated over ± 0.5 s (`syncaudio.py`) | shift within a frame, correlation at least 0.9, last 2 s match, no silence where the mix has sound |
| Captions | `out/captions.json` against the transcript | every word present, none more than 150 ms early |
| `sync <cue>` | the sharp onset nearest the cue within ± 0.15 s (`sync.py`) | within ± 1.5 frames |
| `voice heard back`, `sound balance` | Whisper's comparison; the layer levels | PASS or WARN (fix or explain) |

Other ways to look: `studio_stills` with `cues: true` shoots every cue 4 frames before, on and 6 after; `studio_inspect`
draws a stretch of the video on one time axis (frames, words, voice, music and effect levels, warnings in red);
`studio_brand_check` measures how much of each frame is in the brand colour (ACCENT at most 15%, FLOODED over 35%).

## Part B10. Inside the MCP server

1. **initialize**: the client names its protocol version; the server answers within one second with its name, version
   and one instruction ("Synergy Studio makes and improves videos. Call studio_guide first and follow it.").
   It never installs anything before answering. Supported versions: 2025-11-25, 2025-06-18, 2025-03-26, 2024-11-05.
2. **tools/list**: 41 tools, each with a description saying when to use it (Claude Desktop may see nothing else) and an input schema.
3. **tools/call**: inputs checked against the schema (`schema.mjs`), the CLI command run, the result returned.
4. **resources/read** and **prompts/get** serve the documents and the two prompts.

**Jobs.** A tool should answer within about 30 s; long work runs as a **job**. The server starts `jobrunner.mjs`
detached, on the tool home's Node; the runner runs the CLI command, writing `jobs/<id>.json` and `jobs/<id>.log`; the
tool answers at once with a `job_id`. Claude calls `studio_job_status` with `wait_sec: 25` until `done` or `failed`; the
final answer holds the result text and contact sheets as images. Quick tools wait 20 s and become a job if the work runs
longer. Records survive a server restart. Heavy work waits on `locks/heavy.lock`.

> **Why it matters: structured results.** Claude Code passes a tool's `structuredContent` to the model instead of its
> text when both are present. Finished jobs once returned only `{job_id, state, exit_code}`, so the model saw "done" but
> not the check lines. Every structured result now also carries the whole text as `message` (proof: "NO PASS LINES"
> before, all ten lines quoted after; `test/mcp.test.mjs` asserts it).

**Safety rules.** Paths are resolved inside the project and refused if they leave it. Claude may write only
`project.json`, `brief.md`, `shots.md`, `feedback.md`, `src/**` and subtitle files, so it can write the page and the score
but never a script that runs: the tools only run the bundled code. Images return as JPEG, at most 1600 px wide and 1 MB.
`server.log` has one line per call (tool, time, ok or the first line of the error), tagged with the process and the client.

## Part B11. Footage, captions and the other tools

| Tool | What it does |
|---|---|
| `studio_project_list` | The projects in the projects home, with their last change and whether an MP4 exists |
| `studio_file_list`, `studio_file_read` | The files of a project with sizes; one text file (up to 200 KB) or an image |
| `studio_compose` | The compose step alone: every lint error and warning, or "composed" (stills and render run it anyway) |
| `studio_synctest` | The picture against sound proof of B2, as a job |
| `studio_job_log` | The last lines of a job's log, for progress or the full error |
| `studio_project_import` | A footage project from an existing video, with a contact sheet of the source |
| `studio_cut` | Cuts `edit.clips`, orders, crops to the aspect at `crop_x`, grades, cleans the voice; warns when a clip's sound and picture start more than a frame apart |
| `studio_transcribe` | Whisper word times, or imports a `.srt`, `.vtt` or `.json` |
| `studio_silences`, `studio_scenes` | Pauses (to cut dead air) and shot changes in a clip |
| `studio_beats` | The beat grid of a song |
| `studio_look_from` | Measures a reference (palette by k-means in the Lab colour space, contrast, grain, edges, cut rhythm) and drafts a look as CSS |
| `studio_frames`, `studio_reference_study` | A contact sheet of any video; the cut rhythm of a reference |
| `studio_cues`, `studio_score`, `studio_sounds` | The cue sheet; the score file; the instruments, kits and toy sounds |
| `studio_say` | One line of speech, to check a pronunciation |
| `studio_import_hyperframes`, `studio_hyperframes` | A plain HyperFrames project and a safe list of HyperFrames commands on it |
| `studio_export` | Copies only a project's sources to a folder |

Captions: a page calls `captions()`; word times come from `studio_words` (estimated from the script, narrated) or Whisper
(footage). The render saves which word was shown when; `check` proves every word appeared and none came early.

## Part C1. Repository map

```diagram
.claude-plugin/          plugin.json (name, version) and marketplace.json (the local marketplace for Claude Code)
.mcp.json                how Claude Code starts the server: node ${CLAUDE_PLUGIN_ROOT}/mcp/server.mjs
bundle/manifest.json     the Claude Desktop extension manifest (tools are filled in at pack time)
mcp/                     the MCP server (C2.3)
skills/synergy-studio/   SKILL.md, references/ (21), examples/ (3 runnable projects), template/ (C2.4), scripts/ (C2.1, C2.2)
skills/music-for-picture/ the composer skill: SKILL.md, references/ (score-format, genres, action-sounds, gm-map)
scripts/                 pack-bundle.mjs (builds dist/synergy-studio.mcpb), build-architecture-pdf.mjs (this document)
docs/ARCHITECTURE.md     this document
test/                    node tests (*.test.mjs) and harness/ (gate test scripts); tests/: pytest
research/                decisions researched during the build (MCP protocol, plugins, bundles, Whisper, pins, fps)
LITE.md                  the specification and its table of changes made during the build
BUILD_LOG.md             the public record of every task with literal test output
AGENTS.md README.md NOTICE.md
ledger/ reference/ dist/ tmp/   not committed: build evidence, reference videos, built files, scratch
```

## Part C2. Module reference

### C2.1 CLI modules (`skills/synergy-studio/scripts/`)

`studio.mjs` is the entry: it lists the 27 commands and imports `lib/<command>.mjs`, whose `main(argv)` returns the exit code.

| Module | Role |
|---|---|
| `common.mjs` | Shared helpers: the tool home, `die` and `say`, `run` (spawn without a shell), `env()` from env.json, project paths, `parseArgs`, `hf()` to run HyperFrames |
| `paths.mjs` | Tool home and projects home per platform, the layout of every path in the home (`layout(home)`), executable names |
| `env.mjs` | Reads and writes `env.json`; the environment every child runs with (PATH, HyperFrames variables) |
| `run.mjs` | Child processes and resumable, checksum-verified downloads |
| `lock.mjs` | The heavy lock (one setup, render or transcription at a time; a dead owner's lock is taken over) |
| `setup.mjs` | The eleven setup steps, pins and checksums, the SoundFont table, `--whisper-model`, `--soundfont` |
| `doctor.mjs` | The doctor lines, the full test renders, synctest freshness |
| `synctest.mjs` | Flash and beep video through compose and render; the one-frame judgement |
| `new.mjs` | Starter project, page and templates |
| `budget.mjs` | Words that fit per scene |
| `say.mjs` | One line of speech to `audio/say.wav` |
| `voice.mjs` | Runs `voice.py`; voice ids; the crash-at-exit guard (a run id marker) |
| `listen.mjs` | Compares what Whisper heard with what the voice was given |
| `audio.mjs` | Runs `audio.py`, then masters `mix_raw.wav` to `mix.wav` through `master.mjs` |
| `master.mjs` | Loudness that corrects itself: gain search through the 4x limiter, measured until within tolerance |
| `words.mjs` | Estimated word times for narrated captions |
| `transcribe.mjs` | Whisper through HyperFrames, or subtitle import |
| `wordsnap.mjs` | Moves Whisper word starts onto the audio's real onsets |
| `compose.mjs` | The lint, placeholder filling, file copying into `comp/`, typed cue warnings |
| `stills.mjs` | Frames at default, given, cue or range times; the contact sheet and the safe area guide |
| `render.mjs` | Compose, history, captions record, HyperFrames render, mastering from the lossless mix, share copy |
| `check.mjs` | The check lines and `out/check.json` |
| `cues.mjs` | The cue sheet in time order |
| `score.mjs` | `src/score.json` through `audio.py --score-only`, or the bundled starter score |
| `sounds.mjs` | Lists the font's programs and kits and the toy sounds (`instruments.py list`) |
| `import.mjs`, `cut.mjs` | Footage projects and the cut |
| `silences.mjs`, `scenes.mjs`, `beats.mjs` | Pauses, shot changes, beat grid |
| `reference.mjs`, `frames.mjs` | Reference study; contact sheet of any video |
| `look.mjs` | Look measurement and look cards |
| `brand.mjs` | Brand colour coverage |
| `inspect.mjs` | The inspect picture and timeline |

### C2.2 Python scripts (`skills/synergy-studio/scripts/`)

| Script | Role |
|---|---|
| `voice.py` | Kokoro narration per scene, silence trimmed, durations, the run marker |
| `speech.py` | Spoken forms, risky text, pauses inside a line, the layer balance and levels |
| `audio.py` | Timing, music (beds, song), ducking, effects, the score stem (48 kHz stereo, bus compressor), `mix_raw.wav`, `layers.json`, `mix-report.json`; `--score-only` |
| `score_file.py` | Checks and compiles `src/score.json` (positions, tempo solve, swing, humanising, chords, bends, hits, toy events) |
| `instruments.py` | Fonts, preset and silent key checks, sample-accurate passes, reverb, report, listing, float WAV writer |
| `toys.py` | Toy instruments, toy kit and cartoon hits from waves and noise |
| `syncaudio.py` | Audio in an MP4 against its mix |
| `sync.py` | Onset of each sync cue |
| `beats.py` | Beat grid of a song |
| `look.py` | Look measurement |
| `brand_coverage.py` | Brand colour share per image |
| `inspect_video.py` | The inspect picture |

### C2.3 MCP server (`mcp/`)

| Module | Role |
|---|---|
| `server.mjs` | stdio JSON-RPC: initialize, tools, resources, prompts, ping; logging |
| `tools.mjs` | The 41 tools: descriptions, input schemas, handlers that run the CLI; job start and status; structured results with `message` |
| `jobs.mjs` | Job records, waiting, progress text, images of a finished job |
| `jobrunner.mjs` | The detached process that owns one job |
| `files.mjs` | Project names, path safety, the file tools, export |
| `content.mjs` | The guide, references (with the music skill), examples, resources, prompts |
| `context.mjs` | Paths, version, the Node that runs jobs, logs |
| `hyperframes.mjs` | Plain HyperFrames import and the allowed command list |
| `images.mjs` | JPEG images for results |
| `schema.mjs` | Input checking against the published schemas |

### C2.4 Page templates (`skills/synergy-studio/template/`)

`index.html` (starter page), `lib.js` (the `SS.start()` helpers and `CUE`), `looks.css` (four looks), `sketch.js` (the
hand-drawn canvas kit), `look-card.html`, `score.py` (the starter score: a standalone synth script copied into film
projects), `brief.md`, `shots.md`, `feedback.md`.

## Part C3. Data formats

| File | Shape |
|---|---|
| `<home>/env.json` | `arch, bin, browser{path, version}, ffmpeg, ffprobe, hf_home, home, hyperframes, hyperframes_version, installed_at, kokoro_model, kokoro_voices, node, node_modules, node_version, npm_cli, platform, projects, python, python_version, synctest{...}, uv, uv_version, whisper` |
| `<home>/jobs/<id>.json` | `id, label, kind, state (queued, running, done, failed), created, started, ended, exit_code, result{text, json}, command, cmd{node, args, cwd}, project, attach{files, globs}, heavy, home, log, runner_pid` |
| `<home>/soundfonts/fonts.json` | `{"default": id, "fonts": {id: {"file", "sha256", "source"}}}` |
| `timing.json` / `timing.js` | `T{scene: {start, vo, vo_end, end, dur}}, EV{scene: {event: offset}}, CUE{name: seconds}, SYNC[names], TOTAL, fps, aspect, platform, safe` |
| `audio/score-report.json` | `font, font_file, bpm, bpm_solved, bar1_s, anchors[{bar, at, target_s, bar_s, off_samples}], hits[{sound, at, t}], notes, toy_sounds, channels, pitched_tracks, raw_peak, raw_peak_dbfs, length_s, render_s, reverb, track_peaks_dbfs, warnings` |
| `audio/mix-report.json`, `audio/layers.json` | the balance (`voice_db, music_under_db, music_ok, effects[]`); levels every 50 ms of voice, music and effects with the effect events |
| `out/check.json` | `file, checks[...], sheet, pass` |
| compiled score (in memory) | `notes[(t, channel, key, velocity, length, dry, gain, group)]`, `toys[{kind, name, key, vel, length, t, start, dry, gain, group, pan}]`, `controls`, `programs[(channel, bank, preset, is_drums, label)]`, tempo facts |

## Part C4. Control flow of the main commands

```diagram
audio    lib/audio.mjs -> audio.py <proj> <ffmpeg> <soundfonts>
           timing.json/js -> [src/score.json? instruments.render_project -> score_file.compile_score -> toys.render + tinysoundfont passes -> reverb]
           -> music (bed | song | score stem: bus compressor, duck, 10 dB under the voice) -> effects -> speech.balance
           -> mix_raw.wav (24 kHz mono path unchanged without a score; 48 kHz stereo float with one)
         -> master.masterGain (search through the 4x limiter) -> ffmpeg -> audio/mix.wav
score    lib/score.mjs -> src/score.json ? audio.py --score-only (timing + render + report) : template/score.py -> src/assets/score.wav
stills   compose (lint, fill, copy, hyperframes lint) -> HyperFrames snapshots at chosen times -> contact sheet + safe guide
render   compose -> history -> captions record (puppeteer in the render browser) -> hyperframes render
           -> normaliseLoudness (lossless mix, trim, gain search, AAC, measure, up to 3 encodes) -> share copy
check    ffprobe facts -> ebur128 -> blackdetect -> freezedetect -> syncaudio.py -> captions -> sync.py per cue -> balance, heard back
MCP      tools/call -> schema check -> studioSync (wait 20 s) or studioJob -> jobrunner -> studio.mjs <command> -> jobs/<id>.json
```

## Part C5. Conventions

- **Exit codes**: 0 success, 1 a usage or setup error, 2 a failed check. Errors start `ERROR:` and say what to do next.
- **Dependencies**: Node built ins only in the CLI and server; Python packages from the hashed lock; every download
  pinned and checksummed; nothing system wide.
- **Determinism**: no clock, no unseeded random numbers, frames seeked, float WAVs written without libsndfile's PEAK
  chunk (it holds the write time), noise from fixed PCG64 bit streams.
- **Writing rules** (AGENTS.md): no version labels in prose; no dash as punctuation; anything unproven is PENDING or BLOCKED with the reason.
- **Releases**: the version rises together in `plugin.json`, `bundle/manifest.json`, `mcp/context.mjs` and `package.json`
  (test `version.test.mjs`); Claude Code updates an installed plugin only when it changes. Commits: `lite L<n>: <what changed>`.

## Part C6. Tests

| Where | What |
|---|---|
| `test/*.test.mjs` (node) | `lib-setup`, `lib-soundfont`, `lib-page` (lint rules), `lib-sound`, `lib-master`, `lib-cues`, `lib-footage`, `lib-look`, `lib-brand`, `lib-listen`, `lib-voice-guard`, `mcp` (T14), `harness`, `version`, `architecture-doc` (this document covers every tool, command and module) |
| `tests/test_*.py` (pytest) | `audio`, `speech`, `voice`, `beats`, `look`, `brand`, `inspect`, `sync`, `syncaudio`, `score_file`, `instruments`, `toys` |
| `test/harness/` | T0 contract (`t0-contract.mjs`), T4 word timing, T5 examples, T6 determinism, T7s synctest falsifier, T15 MCP end to end, L12 music film (`l12-music-mcp.mjs`), heavy hits (`l12-loud-hits.mjs`), regression against 8b279e1 (`l12-regression.sh`), the full pass (`l12-fullpass.sh`) |

Every test has its threshold fixed before its first run and a falsifier that must fail (a 512-sample block renderer, a
hit moved 3 frames, a made-up command in the skill text). Gate tests T0 to T18 are listed in LITE.md section 11.

## Part C7. Limits

- Proven on macOS on Apple Silicon; Windows and Linux are written for but untested (no Whisper build on Windows; the
  Desktop bundle is macOS only).
- Videos are judged by measurements and by Claude reading stills, not by a person; nobody has yet listened to the scores.
- Kokoro is English first, with ten voices.
- Claude Desktop has no web access and no path for a video dragged into the chat.
- The toy voices exist twice: `toys.py` and the standalone starter `template/score.py`.

## Part C8. History of the architecture

| Level | What the architecture gained |
|---|---|
| L0 to L5 | The CLI from the owner's code, the tool home and setup, compose and its lint, footage, looks, checks and the harness |
| L6, L7 | The MCP server, packaging for Claude Code and Claude Desktop, the adopted skill text |
| L8 to L10 | Live Claude runs, the video tests, rendering from the lossless mix |
| L11 | Jobs on the tool home's Node, logs per client, delivery, voice and sound checks, `studio_inspect`, the cue sheet, self-correcting loudness, brand colour roles |
| L12 | Real instruments: the score file, tinysoundfont, SoundFonts in setup and doctor, `studio_sounds`, the music skill, 48 kHz stereo score mixing, the bus compressor |
| L13 | Toy sounds in the score file, the engine rule, structured results carrying `message`, this document |

## Part C9. Keeping this document true

- Every change that adds, removes or changes a tool, command, module, data format, flow, threshold or limit updates
  this document in the same commit (AGENTS.md working rules).
- `test/architecture-doc.test.mjs` fails when a tool, a CLI command, a script or a server module exists in the code but
  is not named here.
- Build the PDF with `node scripts/build-architecture-pdf.mjs` (needs the tool home's render browser); it writes
  `dist/architecture.pdf` and adds the generated appendices of all tools and of the command line help.
- Before working on the app, read Part C first; it is faster and more reliable than memory.

## Glossary

| Term | Meaning |
|---|---|
| AAC | The audio codec of the MP4 |
| Anchor | In a score file, a rule that a bar starts at a given moment; two anchors set the tempo |
| Bar, beat, sixteenth | Musical time: a bar holds beats (four in 4/4); a beat holds four sixteenths |
| BPM | Beats per minute: the tempo |
| Bus compressor | A compressor on a whole group of sounds (here the score) |
| Canvas | An element a script paints pixel by pixel |
| Checksum (SHA-256) | A fingerprint of a file's bytes |
| CLI | Command line interface |
| Codec | A method of compressing audio or video (H.264, AAC) |
| Composition | HyperFrames' word for a page that is a video |
| Compose | The step that lints the page and fills in every time into `comp/` |
| Contact sheet | A grid of small frames from a video |
| Container | The file format holding compressed streams and timing (MP4) |
| Convolution reverb | Reverb made by replaying a room's response for every sample |
| Cross-correlation | Comparing two signals at every delay to find where they match best |
| Cue sheet | Named moments in absolute seconds shared by page, music and checks |
| dB, dBFS, dBTP | Decibels; relative to the largest sample; of the true peak |
| Determinism | The same input always giving the same output |
| Ducking | Turning music down while a voice speaks |
| Falsifier | A deliberately broken version a test must fail |
| FFmpeg, FFprobe | Programs that convert, mix and measure audio and video (FFprobe only reads) |
| Frame rate (fps) | Pictures per second |
| General MIDI | A standard numbering of 128 instruments and the drum sounds |
| GSAP | A JavaScript animation library with seekable timelines |
| Hash | A function turning any input into a fixed-looking number |
| Headless Chrome | Chrome with no window, driven by a program |
| HyperFrames | The tool that renders an HTML composition to video by seeking and capturing each frame |
| Job | Long work run as a separate process and polled with `studio_job_status` |
| JSON, JSON-RPC | A text format of names and values; a request and answer convention in JSON |
| Kokoro | The local text-to-speech model |
| Limiter | Keeps peaks under a ceiling by turning the sound down briefly |
| Lint | An automatic review that refuses known mistakes |
| Lock file | Exact package versions and checksums |
| LUFS | Perceived loudness; social platforms play at about -14 |
| MCP | Model Context Protocol: how an AI application (client) talks to a program that offers tools (server) |
| MIDI, velocity | Music as note events; how hard a note is played |
| npm, PyPI | The JavaScript and Python package registries |
| ONNX Runtime | An engine that runs machine learning models on an ordinary processor |
| Plugin, extension | How Claude Code and Claude Desktop install the server and skills |
| Protocol | An agreed format for two programs to talk |
| Runtime | A program that runs programs written in a language |
| Sample, sample rate | One number of a sound; how many per second |
| Score file | `src/score.json`: music as data |
| Seed, seek | The fixed start of a random-looking sequence; jumping a timeline to a moment |
| Skill | An instruction manual for Claude |
| SoundFont, synthesizer | Recorded instrument samples; the program that plays notes through them |
| stdio | The input and output streams through which client and server exchange messages |
| Swing | Delaying every second sixteenth for a laid-back feel |
| three.js | A JavaScript 3D library |
| Tool, tool call | A named action Claude can ask for; the request itself |
| Toy sounds | Playful instruments and cartoon effects from waves and noise |
| True peak | The highest point of the wave between samples |
| uv, venv | A tool that installs Python packages exactly; a private folder of packages |
| WAV | An uncompressed audio file |
| Whisper | The speech-to-text model: captions and listening back |
