# Runtime pins research

Research date: 2026-09-30 (UTC 05:15 at first fetch). Machine: macOS, Apple Silicon (darwin arm64).
All values below were read from the official index or registry named in each section on that date. Versions and hashes are identifiers and are quoted exactly. Signed redirect URLs (with tokens) were deliberately not recorded.

## 1. Node.js 22 LTS

Source: https://nodejs.org/dist/index.json, read 2026-09-30. The three newest `v22.*` entries:

```
v22.23.3 2026-09-23 Jod
v22.23.2 2026-07-28 Jod
v22.23.1 2026-06-22 Jod
```

Result: newest v22 is `v22.23.3`, released 2026-09-23, `lts` name `Jod`.

Archive name for darwin arm64: `node-v22.23.3-darwin-arm64.tar.gz`
Download URL pattern: https://nodejs.org/dist/v22.23.3/node-v22.23.3-darwin-arm64.tar.gz

Lines copied literally from https://nodejs.org/dist/v22.23.3/SHASUMS256.txt (read 2026-09-30), filtered for the five requested archives:

```
23b25245dcfb9af7262f8ff142e9e2e0af025368117329e7a7458a51e5922f53  node-v22.23.3-darwin-arm64.tar.gz
8a677b0219178efd6eb0e475457c4afb452b521a92f6e67845a73bd85727f2a8  node-v22.23.3-darwin-x64.tar.gz
a44aeb94849a299b22df10b9e622ec2f605c2183501bc40590705131de7c740f  node-v22.23.3-linux-arm64.tar.xz
df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de  node-v22.23.3-linux-x64.tar.xz
2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71  node-v22.23.3-win-x64.zip
```

Note: the SHASUMS256.txt file itself is not signature checked here (SHASUMS256.txt.sig was not fetched). UNCONFIRMED: GPG signature verification of the SHASUMS file.

## 2. uv

Source: https://api.github.com/repos/astral-sh/uv/releases/latest, read 2026-09-30.

```
tag_name: 0.12.21
published_at: 2026-09-29T21:14:06Z
```

Result: tag `0.12.21` (no `v` prefix), published 2026-09-29T21:14:06Z.
Download base: https://github.com/astral-sh/uv/releases/download/0.12.21/

Contents of each `.sha256` file, fetched from that base (read 2026-09-30), copied literally:

```
== uv-aarch64-apple-darwin.tar.gz.sha256
b88bda573e566ef9bced66b155fe0408626fbbc053aee1c30ba686f0728c9447  uv-aarch64-apple-darwin.tar.gz
== uv-x86_64-apple-darwin.tar.gz.sha256
2b336763b396ec6afa20c5a8b083538ca7402445b868311979d740a4344c17d8  uv-x86_64-apple-darwin.tar.gz
== uv-x86_64-unknown-linux-gnu.tar.gz.sha256
23f02075b652bb1df64178cfae41b5caf160822e720e2663568f3f5d63bc52c0  uv-x86_64-unknown-linux-gnu.tar.gz
== uv-aarch64-unknown-linux-gnu.tar.gz.sha256
030b69227b40af8c1981b7301793dc66e71ed3c796ea8688209dd268bd91ec51  uv-aarch64-unknown-linux-gnu.tar.gz
== x86_64-pc-windows-msvc: uv-x86_64-pc-windows-msvc.zip.sha256
5d223efa0bf00208c3853246af09420419dfbd352536aa6bb8163d6170e23890  uv-x86_64-pc-windows-msvc.zip
```

Cross check: the GitHub API `digest` field for each asset (sha256 of the asset itself) matched these five values for the assets checked (aarch64-apple-darwin, x86_64-apple-darwin, both linux gnu, windows msvc). Asset sizes in bytes from the API: aarch64-apple-darwin 17001427; x86_64-apple-darwin 20741769; x86_64-unknown-linux-gnu 19782662; aarch64-unknown-linux-gnu 18943621; x86_64-pc-windows-msvc 17992232.

Also verified locally: I downloaded `uv-aarch64-apple-darwin.tar.gz` to the session scratchpad only (not installed, not extracted) and `shasum -a 256` returned `b88bda573e566ef9bced66b155fe0408626fbbc053aee1c30ba686f0728c9447`, identical to the `.sha256` file.

Archive layout (from `tar tzf` and `unzip -l` of the downloaded archives, listing only):

```
uv-aarch64-apple-darwin.tar.gz:
uv-aarch64-apple-darwin/
uv-aarch64-apple-darwin/uvx
uv-aarch64-apple-darwin/uv

uv-x86_64-unknown-linux-gnu.tar.gz:
uv-x86_64-unknown-linux-gnu/
uv-x86_64-unknown-linux-gnu/uv
uv-x86_64-unknown-linux-gnu/uvx

uv-x86_64-pc-windows-msvc.zip (flat, no folder):
uv.exe
uvw.exe
uvx.exe
```

So the tar archives contain one top-level folder named after the archive without the extension (`uv-<target>/`), holding `uv` and `uvx`. The Windows zip has NO top-level folder; the three `.exe` files are at the zip root. Not listed for x86_64-apple-darwin and aarch64-unknown-linux-gnu tars (same naming pattern assumed, UNCONFIRMED by listing).

## 3. Pillow

Source: https://pypi.org/pypi/pillow/json, read 2026-09-30.

Current release: `12.3.0` (`requires_python` `>=3.10`). Files uploaded 2026-07-01 (first wheel 2026-07-01T11:53:27Z, sdist 2026-07-01T11:56:38Z).

cp311 macOS arm64 wheel exists: YES, filename copied from the JSON:

```
pillow-12.3.0-cp311-cp311-macosx_11_0_arm64.whl  (uploaded 2026-07-01T11:53:49Z)
```

Other macOS cp311 wheel: `pillow-12.3.0-cp311-cp311-macosx_10_10_x86_64.whl`.

## 4. @modelcontextprotocol/sdk

Source: https://registry.npmjs.org/@modelcontextprotocol/sdk, read 2026-09-30.

```
dist-tags: {'latest': '1.31.0'}
time[1.31.0]: 2026-09-28T18:59:36.307Z
license: MIT
```

Result: `latest` is `1.31.0`, published 2026-09-28T18:59:36.307Z.

## 5. @anthropic-ai/mcpb (Claude Desktop bundle tool)

Source: https://registry.npmjs.org/@anthropic-ai/mcpb, read 2026-09-30.

```
dist-tags: {'latest': '2.1.2'}
time[2.1.2]: 2025-12-04T04:57:44.382Z
license: MIT
```

Result: `latest` is `2.1.2`, published 2025-12-04T04:57:44.382Z, licence MIT. No version carries an npm `deprecated` flag. Registry document `modified` is 2026-06-04T18:24:48Z (metadata change, not a new version; newest versions are 2.1.0, 2.1.1, 2.1.2 all on 2025-12-04).

UNCONFIRMED: that this is the currently recommended tool in Anthropic's own documentation. I confirmed only the package under the `@anthropic-ai` scope and its `latest` tag; I did not read an Anthropic docs page naming it, and the registry `repository` and `homepage` fields were empty in the fields I inspected.

## 6. Fixed pins

### npm (source: https://registry.npmjs.org/<name>, read 2026-09-30)

```
YES hyperframes 0.8.92                       2026-09-29T16:26:44.931Z  latest=0.8.95  deprecated=None
YES gsap 3.14.2                              2025-12-12T21:12:52.670Z  latest=3.15.0  deprecated=None
YES three 0.186.1                            2026-09-24T14:42:21.301Z  latest=0.186.1 deprecated=None
YES @ffprobe-installer/ffprobe 2.1.2         2023-08-25T23:15:20.872Z  latest=2.1.2   deprecated=None
YES @fontsource/inter 5.3.0                  2026-07-19T03:40:13.819Z  latest=5.3.0   deprecated=None
YES @fontsource/manrope 5.3.0                2026-07-19T03:41:44.130Z  latest=5.3.0   deprecated=None
YES @fontsource/cormorant-garamond 5.3.0     2026-07-19T03:38:07.935Z  latest=5.3.0   deprecated=None
YES @fontsource/jost 5.3.0                   2026-07-19T03:40:27.338Z  latest=5.3.0   deprecated=None
```

All eight exist and none is deprecated. Two pins are behind `latest`: `hyperframes` (0.8.92 vs latest 0.8.95) and `gsap` (3.14.2 vs latest 3.15.0). The hyperframes pin is only one day old and its line is moving fast.

### PyPI (source: https://pypi.org/pypi/<name>/<version>/json, read 2026-09-30)

kokoro-onnx 0.6.1: exists, uploaded 2026-08-19T00:40:35Z, not yanked. `requires_python` `<3.14,>=3.10` (so Python 3.14 is excluded). Wheel: `kokoro_onnx-0.6.1-py3-none-any.whl`, a pure py3 wheel that installs on macOS arm64 (also an sdist). Declared `requires_dist`:

```
['espeakng-loader>=0.2.4', 'numpy>=2.0.2', 'onnxruntime>=1.20.1', 'phonemizer>=3.4.0', 'onnxruntime-gpu>=1.20.1; (platform_machine == "x86_64" and sys_platform != "darwin") and extra == "gpu"']
```

soundfile 0.14.0: exists, uploaded 2026-06-06 (wheels 08:58:33Z onward), not yanked. `requires_python` `>=3.10`. macOS arm64 wheel: `soundfile-0.14.0-py2.py3-none-macosx_11_0_arm64.whl` (py2.py3 tag, works for cp311). Also `py2.py3-none-any` and macOS x86_64 wheels. Declared `requires_dist`:

```
['cffi>=1.0', 'numpy', 'typing-extensions']
```

imageio-ffmpeg 0.6.0: exists, uploaded 2025-01-16 (macOS arm64 wheel at 21:34:00Z), not yanked. `requires_python` `>=3.9`. macOS arm64 wheel: `imageio_ffmpeg-0.6.0-py3-none-macosx_11_0_arm64.whl` (py3 tag, works for cp311; it bundles an ffmpeg binary). Declared `requires_dist`: `None` (the JSON field is null, so no declared dependencies).

## 7. Kokoro model files (HEAD only, nothing downloaded)

Command: `curl -sSIL <url> | grep -iE '^(HTTP|content-length|content-type|location|etag|last-modified)'`. Read 2026-09-30. The first hop is a 302 to a signed release-assets URL (token omitted below); the final hop is the real file response.

```
== kokoro-v1.0.int8.onnx
HTTP/2 302
content-length: 0                      (redirect hop, not the file)
HTTP/2 200
last-modified: Tue, 28 Jan 2025 21:54:59 GMT
etag: "0x8DD3FE669218D3C"
content-type: application/octet-stream
content-length: 92361271

== voices-v1.0.bin
HTTP/2 302
content-length: 0                      (redirect hop, not the file)
HTTP/2 200
last-modified: Sun, 09 Feb 2025 06:23:03 GMT
etag: "0x8DD48D235797DC5"
content-type: application/octet-stream
content-length: 28214398
```

Result: `kokoro-v1.0.int8.onnx` is 92361271 bytes; `voices-v1.0.bin` is 28214398 bytes.

UNCONFIRMED: SHA-256 of both model files. GitHub's release asset API was not queried for a `digest`, and the files were not downloaded, so no hash is available from this research. The setup script can check size only until a hash is obtained. This is the largest gap for hash pinning.

## Not confirmed (summary)

1. LARGEST GAP: SHA-256 for the two Kokoro model files (only byte sizes known).
2. Node SHASUMS256.txt GPG signature not verified.
3. uv tar layout for x86_64-apple-darwin and aarch64-unknown-linux-gnu not listed (only aarch64-apple-darwin, x86_64-linux-gnu and Windows zip listed).
4. Whether `@anthropic-ai/mcpb` is named as the recommended tool in Anthropic docs (only npm registry evidence).
5. Pillow: only the presence of the cp311 arm64 wheel was checked, not its declared dependencies (none were asked for).

## Sources

All read on 2026-09-30.

1. https://nodejs.org/dist/index.json
2. https://nodejs.org/dist/v22.23.3/SHASUMS256.txt
3. https://api.github.com/repos/astral-sh/uv/releases/latest
4. https://github.com/astral-sh/uv/releases/download/0.12.21/ (the five `.sha256` files and the archives `uv-aarch64-apple-darwin.tar.gz`, `uv-x86_64-unknown-linux-gnu.tar.gz`, `uv-x86_64-pc-windows-msvc.zip`)
5. https://pypi.org/pypi/pillow/json
6. https://registry.npmjs.org/@modelcontextprotocol/sdk
7. https://registry.npmjs.org/@anthropic-ai/mcpb
8. https://registry.npmjs.org/hyperframes , /gsap , /three , /@ffprobe-installer/ffprobe , /@fontsource/inter , /@fontsource/manrope , /@fontsource/cormorant-garamond , /@fontsource/jost
9. https://pypi.org/pypi/kokoro-onnx/0.6.1/json , https://pypi.org/pypi/soundfile/0.14.0/json , https://pypi.org/pypi/imageio-ffmpeg/0.6.0/json
10. https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.int8.onnx (HEAD)
11. https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin (HEAD)
