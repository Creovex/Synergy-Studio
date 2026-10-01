#!/bin/bash
# L12 test 6: projects without a score file give the same bytes with the new code as with 8b279e1.
set -u
R="$(cd "$(dirname "$0")/../.." && pwd)"; T="$R/tmp/reg"; NODE="$HOME/Library/Application Support/SynergyStudioLite/runtime/node/bin/node"
NEW="$R/skills/synergy-studio/scripts/studio.mjs"; BASE="$T/basecode/skills/synergy-studio/scripts/studio.mjs"
rm -rf "$T/basecode" "$T/in" "$T/base" "$T/new"; mkdir -p "$T/basecode" "$T/in"
(cd "$R" && git archive 8b279e1 skills/synergy-studio | tar -x -C "$T/basecode")
for n in hydration-tips three-product footage-captions; do cp -R "$R/skills/synergy-studio/examples/$n" "$T/in/$n"; done
mkdir -p "$T/in/footage-captions/src/footage" && cp "$R/reference/videos/onescan.mp4" "$T/in/footage-captions/src/footage/clip.mp4"
"$NODE" "$NEW" voice "$T/in/hydration-tips" >/dev/null && "$NODE" "$NEW" voice "$T/in/three-product" >/dev/null && "$NODE" "$NEW" cut "$T/in/footage-captions" >/dev/null || { echo "input prep failed"; exit 1; }
"$NODE" "$NEW" new "$T/in/film-starter" --mode film --aspect 9:16 --length 12 >/dev/null
python3 - "$T/in/film-starter/project.json" <<'PY'
import json, sys; p = json.load(open(sys.argv[1])); p["scenes"] = [{"id": "s1", "start": 0, "end": 6}, {"id": "s2", "start": 6, "end": 12}]
p["cues"] = {"door": {"t": 3.0, "sync": True}, "bell": {"t": 9.5, "sync": True, "sfx": "pop"}}; p.pop("events", None); json.dump(p, open(sys.argv[1], "w"), indent=2)
PY
for side in base new; do
  cp -R "$T/in" "$T/$side"; S=$([ $side = base ] && echo "$BASE" || echo "$NEW")
  "$NODE" "$S" score "$T/$side/film-starter" > "$T/$side-film-score.log" 2>&1
  for n in hydration-tips three-product footage-captions film-starter; do "$NODE" "$S" audio "$T/$side/$n" > "$T/$side-$n.log" 2>&1 || echo "$side $n audio FAILED"; done
done
for n in hydration-tips three-product footage-captions film-starter; do
  for f in timing.json timing.js project.json audio/mix_raw.wav audio/mix.wav audio/mix-report.json audio/layers.json src/assets/score.wav; do
    [ -f "$T/base/$n/$f" ] || [ -f "$T/new/$n/$f" ] || continue
    a=$(shasum -a 256 "$T/base/$n/$f" 2>/dev/null | cut -c1-16); b=$(shasum -a 256 "$T/new/$n/$f" 2>/dev/null | cut -c1-16)
    [ "$a" = "$b" ] && r=SAME || r=DIFFERENT; printf "%-6s %-17s %-22s %s %s\n" "$r" "$n" "$f" "$a" "$b"
  done
done
diff <(sed 's/[0-9.]* LUFS//' "$T/base-hydration-tips.log") <(sed 's/[0-9.]* LUFS//' "$T/new-hydration-tips.log") && echo "hydration-tips audio output: same text"
# falsifier: the same comparison must see a difference once a project has a score file
cp -R "$T/new/hydration-tips" "$T/new-falsifier"; printf '{"tempo": {"bpm": 100}, "tracks": {"p": {"program": 0, "notes": [["1:1", "C4", "1/4"]]}}}' > "$T/new-falsifier/src/score.json"
"$NODE" "$NEW" audio "$T/new-falsifier" > "$T/new-falsifier.log" 2>&1
a=$(shasum -a 256 "$T/base/hydration-tips/audio/mix_raw.wav" | cut -c1-16); b=$(shasum -a 256 "$T/new-falsifier/audio/mix_raw.wav" | cut -c1-16)
[ "$a" != "$b" ] && echo "FALSIFIER-OK hydration-tips with a score file: mix_raw.wav differs ($a vs $b)" || echo "FALSIFIER-FAILED: the comparison did not see the score"
rm -rf "$T/new-falsifier"
