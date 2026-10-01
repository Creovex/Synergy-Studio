// studio sounds [--font f]: the installed SoundFont's programs and drum kits, so a score names real ones.
// The listing comes from instruments.py (it loads the font with tinysoundfont); this command passes it through.
import path from "node:path";
import { SKILL, say, die, run, env, parseArgs } from "./common.mjs";
import { layout } from "./paths.mjs";

export const USAGE = "sounds [--font f]";

export async function main(argv) {
  const { flags, pos } = parseArgs(argv);
  const unknown = Object.keys(flags).find((k) => k !== "font");
  if (unknown || pos.length) die(`sounds does not know "${unknown ? `--${unknown}` : pos[0]}". Usage: sounds [--font <id>]`);
  if (flags.font === true) die("--font needs a font id. Usage: sounds [--font <id>]");
  const e = env();
  const args = [path.join(SKILL, "scripts", "instruments.py"), "list", "--soundfonts", layout(e.home).soundfonts];
  if (flags.font) args.push("--font", flags.font);
  const r = run(e.python, args, { capture: true, soft: true });
  if (r.error) die(`the Python of the tool home failed to start: ${r.error.message}`);
  if (r.status !== 0) {
    const text = (r.stderr || r.stdout || "").trim().split("\n").filter(Boolean);
    die((text.reverse().find((l) => l.startsWith("ERROR")) ?? text[0] ?? `instruments.py exited with ${r.status}`).replace(/^ERROR: /, ""));
  }
  say(r.stdout.trimEnd());
  return 0;
}
