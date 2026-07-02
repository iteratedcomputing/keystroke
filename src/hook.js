import { accessSync, constants, existsSync, statSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const DEFAULT_TIMEOUT_MS = 120_000;

export function resolveHookPaths(env = process.env) {
  return (env.KEYSTROKE_HOOK || "./hook")
    .split(":")
    .filter(Boolean)
    .map((p) => path.resolve(p));
}

export function parseHookArgs(argv = []) {
  const env = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (typeof token !== "string" || !token.startsWith("--x-")) continue;
    const body = token.slice(4);
    const eq = body.indexOf("=");
    let key, value;
    if (eq !== -1) {
      key = body.slice(0, eq);
      value = body.slice(eq + 1);
    } else {
      key = body;
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        value = next;
        i++;
      } else {
        value = "1";
      }
    }
    if (!key) continue;
    env["KEYSTROKE_" + key.toUpperCase().replace(/-/g, "_")] = value;
  }
  return env;
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

export function hooksStatus(hookPaths) {
  const hooks = hookPaths.map((p) => ({ path: p, ...hookStatus(p) }));
  return { configured: hooks.every((h) => h.configured), hooks };
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
          path: hookPath,
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

export async function runHooks(hookPaths, filePath, opts = {}) {
  const results = [];
  for (const [index, hookPath] of hookPaths.entries()) {
    const result = await runHook(hookPath, filePath, opts);
    results.push(result);
    if (!result.ok) {
      for (const skippedPath of hookPaths.slice(index + 1)) {
        results.push({ path: skippedPath, skipped: true });
      }
      return { ok: false, hooks: results };
    }
  }
  return { ok: true, hooks: results };
}
