import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { slugify } from "./hook.js";

export function resolveDraftsDir(env = process.env) {
  return path.resolve(
    env.KEYSTROKE_DRAFTS_DIR || path.join(homedir(), "Documents", "keystroke"),
  );
}

function freshPath(dir, title) {
  const base = `${new Date().toISOString().slice(0, 10)}-${slugify(title)}`;
  let candidate = path.join(dir, `${base}.md`);
  for (let n = 2; existsSync(candidate); n++) {
    candidate = path.join(dir, `${base}-${n}.md`);
  }
  return candidate;
}

export async function saveDraft({ dir, title, content, file }) {
  await mkdir(dir, { recursive: true });
  const reuse =
    typeof file === "string" &&
    file.endsWith(".md") &&
    path.dirname(path.resolve(file)) === dir;
  const target = reuse ? path.resolve(file) : freshPath(dir, title);
  await writeFile(target, content);
  return target;
}
