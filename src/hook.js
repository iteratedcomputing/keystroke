import { accessSync, constants, existsSync, statSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 120_000;

export function resolveHookPath(env = process.env) {
  return path.resolve(env.KEYSTROKE_HOOK || "./hook");
}

export function hookStatus(hookPath) {
  if (!existsSync(hookPath)) {
    return { configured: false, reason: "missing" };
  }
  if (!statSync(hookPath).isFile()) {
    return { configured: false, reason: "not a file" };
  }
  try {
    accessSync(hookPath, constants.X_OK);
  } catch {
    return { configured: false, reason: "not executable" };
  }
  return { configured: true };
}

export function slugify(title) {
  const slug = (title || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export async function writeDraft({ title, content }) {
  const dir = await mkdtemp(path.join(tmpdir(), "keystroke-"));
  const date = new Date().toISOString().slice(0, 10);
  const filePath = path.join(dir, `${date}-${slugify(title)}.md`);
  await writeFile(filePath, content);
  return filePath;
}

export function runHook(
  hookPath,
  filePath,
  { title, durationMinutes, env = process.env } = {},
) {
  const timeout = Number(env.KEYSTROKE_HOOK_TIMEOUT) || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    execFile(
      hookPath,
      [filePath],
      {
        timeout,
        maxBuffer: 1024 * 1024,
        env: {
          ...env,
          KEYSTROKE_TITLE: title || "",
          KEYSTROKE_SLUG: slugify(title),
          KEYSTROKE_DURATION_MINUTES: String(durationMinutes || ""),
        },
      },
      (error, stdout, stderr) => {
        const code = error
          ? typeof error.code === "number"
            ? error.code
            : null
          : 0;
        resolve({
          ok: !error,
          code,
          timedOut: Boolean(error && error.killed),
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}
