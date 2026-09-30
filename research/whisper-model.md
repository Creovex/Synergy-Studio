# Whisper model for `hyperframes transcribe` (HyperFrames 0.8.92)

Date: 2026-09-30. Scope: the installed copy under the tool home. Nothing was run except `transcribe --help`; no model or binary was downloaded.

Notation: `TH` = `/Users/blaze/Library/Application Support/SynergyStudioLite`. `PKG` = `TH/node/node_modules/hyperframes`. All package line numbers are in `PKG/dist/` (bundled, so chunk names are hashed).

## Summary

1. HyperFrames uses the **whisper.cpp command line program `whisper-cli`**, run as a child process. It is not a Node binding and not Python. The binary is **not bundled** and **not installed on this machine** (see section 1).
2. The model file is `ggml-small.en.bin`, fetched from `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`. The code checks only that the file exists. There is no size or hash check.
3. Cache folder: `~/.cache/hyperframes/whisper/models/`, which is `TH/node/hf-home/.cache/hyperframes/whisper/models/` under our setup. There is no environment variable or flag to move it.
4. Placing the file by hand there is enough for the model. **Whisper itself (`whisper-cli`) must also be present**, and today it is missing, so a model file alone will not make `transcribe` work.

## 1. Which Whisper implementation, and does it need a binary

Implementation: whisper.cpp, invoked as the `whisper-cli` executable.

- `PKG/package.json` (lines 22 to 39, `dependencies`) lists no Whisper package, no `nodejs-whisper`, no `@xenova/transformers`. `TH/node/node_modules` has none either.
- `chunk-CU2N7HZD.js:335-338` runs `execFileSync(whisper.executablePath, whisperArgs, ...)`.
- The binary is resolved by `findWhisper()` in `chunk-OAF4XJOW.js:120-122`, in this order:
  1. Env var `HYPERFRAMES_WHISPER_PATH`, if the path exists (`chunk-OAF4XJOW.js:49-55`).
  2. `whisper-cli` on `PATH` via `which`, then on macOS `/opt/homebrew/bin/whisper-cli` and `/usr/local/bin/whisper-cli` (`chunk-OAF4XJOW.js:56-65`).
  3. A copy HyperFrames built itself at `~/.cache/hyperframes/whisper/whisper.cpp/build/bin/whisper-cli` or `.../build/whisper-cli` (`chunk-OAF4XJOW.js:66-76`).
- If none is found, `ensureWhisper()` (`chunk-OAF4XJOW.js:144-166`) tries, in order:
  1. On macOS with `brew` on PATH: `brew install whisper-cpp` (lines 147-158). Needs network (Homebrew).
  2. If `git` and `cmake` are both on PATH: `git clone --depth 1 https://github.com/ggml-org/whisper.cpp.git` into the build folder, then `cmake -B build` and `cmake --build build --config Release -j` (lines 77-119, repo URL at line 67). Needs network (GitHub) and a C compiler.
  3. Otherwise it throws `WhisperUnavailableError`: `whisper-cpp not found. Install: brew install whisper-cpp` (line 165, text from lines 123-125).

State on this machine (checked 2026-09-30, read only):

- `which whisper-cli` finds nothing; `/opt/homebrew/bin/whisper-cli` and `/usr/local/bin/whisper-cli` do not exist.
- `TH/node/hf-home/.cache/hyperframes/` contains only `chrome/`. No `whisper/` folder exists yet.
- `TH/bin/` holds only `ffmpeg` and `ffprobe`.
- `brew` exists at `/opt/homebrew/bin/brew`; `git` at `/usr/bin/git`; `cmake` is not installed.
- Consequence: on a blocked network the binary step fails before the model step (`transcribe` calls `ensureWhisper` first, then `ensureModel`; `chunk-CU2N7HZD.js:289-294`). **The model fallback below is necessary but not sufficient**; the `whisper-cli` binary needs its own offline route (section 4, step 0).

Whisper is not the only engine. `--engine auto` prefers Parakeet (sherpa-onnx) when it is installed and covers the language (`transcribe-ZUVU222E.js:245-249`). Parakeet is not installed here (`sherpaParakeetInstalled()`, `sherpa-7DHFDVXD.js:171-174`), so `auto` falls to Whisper. To pin our behaviour to the documented Whisper `small.en`, pass `--engine whisper`.

## 2. Model file, URL, size, hash

- Default model name: `small.en` (`chunk-OAF4XJOW.js:20`, `DEFAULT_MODEL`). The CLI also uses it when `--model` is absent (`transcribe-ZUVU222E.js:275`).
- File name: `ggml-small.en.bin` (`chunk-OAF4XJOW.js:168`, `` `ggml-${model}.bin` ``).
- URL: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin` (`chunk-OAF4XJOW.js:32-34`). It redirects (HTTP 301/302/303/307/308, up to 10 hops) to a Hugging Face CDN host; the downloader follows them (`chunk-X5HWXQPU.js:2-4`, `:49-70`). A network that allows only `huggingface.co` but not the CDN host would still fail. The CDN host name was not read from the code: UNCONFIRMED.
- Size: the code does not state or check it. Expected size is about 465 MiB (about 488 MB) from general knowledge of the whisper.cpp `small.en` file: UNCONFIRMED (not verified against Hugging Face in this session).
- Hash: **none**. `ensureModel` (`chunk-OAF4XJOW.js:167-177`) only tests `existsSync(modelPath)`, downloads with `downloadFile(url, modelPath)` and rechecks `existsSync`. No `maxBytes`, no checksum. A truncated or wrong file placed by hand will be accepted silently and fail later inside `whisper-cli`.
- Download mechanics (`chunk-X5HWXQPU.js:38-110`): streams to `<dest>.<pid>.<uuid>.tmp`, then `renameSync` to the final name on success, so a failed download leaves no half file under the real name. Idle timeout is 30 s (`DEFAULT_DOWNLOAD_TIMEOUT_MS`, `:2`, applied at `:94`). It uses `https.get` directly; no proxy environment handling was seen in that function: UNCONFIRMED whether `HTTPS_PROXY` has any effect.
- The Parakeet model has hashes (`sherpa-7DHFDVXD.js:78-103`), but that is a different engine and is not what `transcribe` uses under `--engine whisper`.

Optional integrity check to run yourself (upstream published values, not from this package): whisper.cpp's `models/download-ggml-model.sh` lists a SHA1 for each model. The value recalled for `small.en` is `db8a495a91d927739e50b3fc1cc4c6b8f6c2d022`: UNCONFIRMED, confirm against the upstream script or the Hugging Face file page before relying on it.

## 3. Cache folder and overrides

- Code: `var MODELS_DIR = join(homedir(), ".cache", "hyperframes", "whisper", "models")` (`chunk-OAF4XJOW.js:19`). It is computed once at load from `os.homedir()`.
- Relative to home: `~/.cache/hyperframes/whisper/models/ggml-small.en.bin`.
- Absolute under our tool home (because every call sets `HOME=TH/node/hf-home`):
  `/Users/blaze/Library/Application Support/SynergyStudioLite/node/hf-home/.cache/hyperframes/whisper/models/ggml-small.en.bin`
- Folder does not exist yet. `ensureModel` creates it with `mkdirSync(MODELS_DIR, { recursive: true })` (line 170). Its parent `hf-home/.cache/hyperframes/` exists (holds `chrome/`).
- Overrides: **none for the model folder.** The only lever is `HOME` (Node's `os.homedir()` reads `HOME` on macOS). `--model` changes the name only, not the folder. `--dir` is the output folder for the transcript, not the cache.
- Related overrides that do exist:
  - `HYPERFRAMES_WHISPER_PATH`: path to the `whisper-cli` binary (`chunk-OAF4XJOW.js:50`).
  - `HYPERFRAMES_FFMPEG_PATH`, `HYPERFRAMES_FFPROBE_PATH`: ffmpeg and ffprobe (`chunk-PJ3HDUCY.js:12-13`, `:95-102`).
  - `HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS`: whisper run timeout (`transcribe-ZUVU222E.js:181`).
- Language side effect: with `--language` other than `en` and a `.en` model, the code drops `.en` and needs `ggml-small.bin` instead (`chunk-CU2N7HZD.js:264-270`). If no language is given and the model ends in `.en`, no language detection runs and no switch happens (line 299). So for English work with `small.en`, only `ggml-small.en.bin` is needed.

## 4. Manual fallback (steps and commands)

Step 0, get the `whisper-cli` binary onto the machine (needed as well; not covered by the model file):

- Easiest: on a network that allows Homebrew, run `brew install whisper-cpp`, which places `whisper-cli` in `/opt/homebrew/bin/`. HyperFrames finds that path itself on macOS (`chunk-OAF4XJOW.js:60`), even if `PATH` lacks it.
- Or build from source on another network (needs cmake and a C compiler) and copy the result, then point to it: `export HYPERFRAMES_WHISPER_PATH=/path/to/whisper-cli`. Note a hand copied binary may need its sibling `.dylib` files from the same build folder: UNCONFIRMED for a Homebrew build; a source build with default settings links static, also UNCONFIRMED.
- Our tool must then pass that variable through to HyperFrames, or install to `/opt/homebrew/bin` or `/usr/local/bin`.

Step 1, download the model on a network that can reach Hugging Face (any machine):

```sh
curl -L --fail -o ggml-small.en.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin
ls -l ggml-small.en.bin        # expect roughly 488 MB (UNCONFIRMED exact size)
shasum -a 1 ggml-small.en.bin  # compare with the upstream SHA1 (UNCONFIRMED value above)
```

Step 2, copy it to the target Mac by any means (USB, cloud drive, `scp`).

Step 3, place it where HyperFrames looks, with exactly this name:

```sh
TH="$HOME/Library/Application Support/SynergyStudioLite"
mkdir -p "$TH/node/hf-home/.cache/hyperframes/whisper/models"
cp ggml-small.en.bin "$TH/node/hf-home/.cache/hyperframes/whisper/models/ggml-small.en.bin"
ls -l "$TH/node/hf-home/.cache/hyperframes/whisper/models/"
```

Step 4, confirm HyperFrames uses it without a network. The check for the model is `existsSync` only (`chunk-OAF4XJOW.js:169`), so when the file is present no download is attempted. To prove it offline:

1. Turn Wi-Fi off, or block `huggingface.co` (for example, unplug or use a firewall rule).
2. Run a short clip with the tool's exact environment. `--json` prints a machine readable result:

```sh
TH="$HOME/Library/Application Support/SynergyStudioLite"
HOME="$TH/node/hf-home" HYPERFRAMES_SKIP_SKILLS=1 HYPERFRAMES_NO_TELEMETRY=1 \
PATH="$TH/bin:/opt/homebrew/bin:$PATH" \
"$TH/runtime/node/bin/node" "$TH/node/node_modules/hyperframes/bin/hyperframes.mjs" \
  transcribe short.wav --engine whisper --model small.en --language en --dir /tmp/hf-check --json
```

3. Success looks like one JSON line with `"ok":true,"engine":"whisper","model":"small.en"` and a `transcriptPath` (`transcribe-ZUVU222E.js:330-341`), and `/tmp/hf-check/transcript.json` exists. The absence of the message `Downloading model small.en...` is the proof (that text is only emitted in `ensureModel`, `chunk-OAF4XJOW.js:171`). With `--json` the spinner is off, so also check that the run finished quickly and that no `*.tmp` file appeared in the models folder.
4. If the failure text mentions `whisper-cpp not found`, the model is fine and the binary (step 0) is the problem. Under `--json` that case prints `{"ok":false,"skipped":true,"reason":"whisper_unavailable"}` and exits 1 (`transcribe-ZUVU222E.js:362-371`).

This end to end run was **not performed** in this research (instruction: do not run transcribe). The whole fallback is therefore UNCONFIRMED in practice; it is derived from reading the code.

## 5. The `transcribe` command

Help text (run with the tool environment) and code (`transcribe-ZUVU222E.js:86-179`):

| Flag | Meaning |
| --- | --- |
| `<INPUT>` (required) | Audio or video file, or a transcript file to import (`.json`, `.srt`, `.vtt`) |
| `-d, --dir` | Project directory; output goes here. Default: the input file's own folder (line 153), although the help says current directory |
| `-e, --engine` | `auto` (default), `parakeet` or `whisper` |
| `-m, --model` | Whisper model, default `small.en`. Listed options: `tiny.en, base.en, small.en, medium.en, large-v3` (help text; code accepts any name and builds `ggml-<name>.bin`) |
| `-l, --language` | Language code, for example `en`. Passed as `--language` to whisper-cli (`chunk-CU2N7HZD.js:326-328`) |
| `--json` | Print a one line JSON result instead of a spinner |
| `--to` (srt or vtt) | Export a caption sidecar from an existing transcript file; input must be `.json/.srt/.vtt` |
| `-o, --output` | Output path for the SRT/VTT sidecar |
| `--preserve-cues` | Keep each entry as its own cue when exporting |
| `--optional` | If whisper is unavailable, skip and exit 0 |
| `--timeout` | Whisper timeout in ms, minimum 5000; env `HYPERFRAMES_TRANSCRIBE_TIMEOUT_MS`. Default is auto scaled: at least 300 s, 10 s per audio second times a model factor (small.en factor 1), capped at 12 h (`chunk-CU2N7HZD.js:53-92`) |

There is no separate word timestamp flag; word times are always produced. The whisper.cpp call is (`chunk-CU2N7HZD.js:316-329`):
`whisper-cli --model <ggml file> --output-json-full --output-file <dir>/transcript --dtw <model with - replaced by .> --suppress-nst [--language <code>] <16 kHz mono wav>`.
`--dtw small.en` enables token level timing; `--suppress-nst` suppresses non speech tokens.

Accepted inputs to transcribe: audio `.mp3 .wav .m4a .aac .ogg .flac`; video `.mp4 .webm .mov .mkv .avi` (`chunk-CU2N7HZD.js:181-188`). Anything else throws `Unsupported file type`.

Outputs:

- `<dir>/transcript.json`: written by whisper.cpp, then **overwritten** by HyperFrames with a normalized array (`transcribe-ZUVU222E.js:317-328`, `loadTranscript` at `normalize-O76AC4HE.js:275-295`). Shape:

```json
[
  { "id": "w0", "text": "Hello", "start": 0.12, "end": 0.48 },
  { "id": "w1", "text": "world.", "start": 0.48, "end": 0.9 }
]
```

  `start` and `end` are seconds rounded to 3 decimals; `id` is `w<index>`. Tokens are merged into words (`parseWhisperCpp`, `normalize-O76AC4HE.js:73-97`): leading space starts a new word, punctuation and contractions join the previous word, `[_...` and `[BLANK` tokens are dropped, then fragments are merged and zero length words get interpolated times. Words before a detected long silent intro (`speechOnsetSeconds`) are removed (`stripBeforeOnset`, line 296-298; onset only reported if at least 3 s, `chunk-CU2N7HZD.js:136-180`).
- With `--json`, stdout is one line (`transcribe-ZUVU222E.js:330-341`):

```json
{"ok":true,"engine":"whisper","model":"small.en","wordCount":123,"durationSeconds":45.6,"speechOnsetSeconds":null,"transcriptPath":"<dir>/transcript.json"}
```

  Failure: `{"ok":false,"error":"..."}` (exit 1); unavailable: `{"ok":false,"skipped":true,"reason":"whisper_unavailable"}`. Note `durationSeconds` is the last token end time, not the media length (`chunk-CU2N7HZD.js:358,372`).
- Side effect: `patchCaptionHtml(dir, words)` rewrites any `const script = [...]` or `const TRANSCRIPT = [...]` block in every `.html` file under `dir` (recursive) (`normalize-O76AC4HE.js:299-324`, called at `transcribe-ZUVU222E.js:329`). Point `--dir` at a scratch folder, not at a composition, if you do not want HTML touched.
- Also remember `whisper-cli` `--output-json-full` first writes `transcript.json` in raw whisper.cpp form (`transcription[].tokens[].offsets.from/to` in ms); the raw form is replaced before the command exits.

## 6. ffmpeg

Yes, ffmpeg (and ffprobe) are used, and they run before Whisper sees audio.

- whisper.cpp needs 16 kHz mono PCM WAV. `prepareAudio` skips conversion only for a `.wav` that ffprobe reports as `pcm_s16le`, 16000 Hz, 1 channel (`chunk-CU2N7HZD.js:226-260`). Every other input is converted with `ffmpeg -i <in> -ar 16000 -ac 1 -f wav` to a temp file in `os.tmpdir()`; video also uses `-vn` (`:210-224`). If ffmpeg is missing it throws `ffmpeg is required to prepare audio` (or `...extract audio from video`).
- ffprobe is used for duration (timeout scaling) and the WAV check; a missing ffprobe only degrades those (`:105-128`, `:229-243`).
- Which binary: `findFfBinary` (`chunk-PJ3HDUCY.js:95-102`): first env `HYPERFRAMES_FFMPEG_PATH` (must exist), else `which ffmpeg` on `PATH`, then `./.hyperframes/bin/ffmpeg` relative to the current directory, then common install directories (`COMMON_BIN_DIRS`, defined in the same file; contents not read: UNCONFIRMED). With the tool's `PATH="TH/bin:$PATH"` it finds `TH/bin/ffmpeg`, which exists. Whether `PATH` order or an env var is what the app sets is not verified.
- The Parakeet engine has its own audio preparation (`prepareSherpaWav`); not covered here.

## Largest gap

The `whisper-cli` binary is absent and not bundled, so placing `ggml-small.en.bin` alone does not make `transcribe` work on a blocked network. `brew install whisper-cpp` or a source build needs its own network, and `cmake` is not installed. The offline plan must supply a `whisper-cli` executable (via `HYPERFRAMES_WHISPER_PATH` or `/opt/homebrew/bin`) as well as the model. Secondary gaps: exact model size and SHA1 are UNCONFIRMED, the code has no integrity check, and no offline end to end run was performed.

## Sources

Files read (all under `/Users/blaze/Library/Application Support/SynergyStudioLite/node/node_modules/hyperframes/`):

- `package.json`
- `dist/chunk-OAF4XJOW.js` (whisper manager: model folder, URL, binary discovery, install steps)
- `dist/chunk-CU2N7HZD.js` (whisper run: ffmpeg preparation, arguments, timeouts, output parsing)
- `dist/chunk-X5HWXQPU.js` (`downloadFile`)
- `dist/chunk-PJ3HDUCY.js` (ffmpeg and ffprobe discovery)
- `dist/chunk-TVCRUG2S.js` (`findFFmpeg` wrapper, install hints)
- `dist/transcribe-ZUVU222E.js` (CLI command, flags, JSON result)
- `dist/transcribe-AZ3MXBCY.js` (re-export)
- `dist/normalize-O76AC4HE.js` (transcript parsing and normalization)
- `dist/sherpa-7DHFDVXD.js` (Parakeet engine, for the hash contrast and the `auto` engine)

Also read: `TH/env.json`, and directory listings of `TH/bin`, `TH/models`, `TH/node/hf-home`. Command run: `hyperframes transcribe --help` with the tool environment.

URLs (named in code, not fetched): `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.en.bin`, `https://github.com/ggml-org/whisper.cpp.git`.

Date: 2026-09-30.
