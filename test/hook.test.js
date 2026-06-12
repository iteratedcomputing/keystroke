import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  hookStatus,
  hooksStatus,
  resolveHookPaths,
  runHook,
  runHooks,
  slugify,
  writeDraft,
} from "../src/hook.js";

function makeHook(script, { executable = true } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "keystroke-test-"));
  const hookPath = path.join(dir, "hook");
  writeFileSync(hookPath, `#!/bin/sh\n${script}\n`);
  if (executable) chmodSync(hookPath, 0o755);
  return hookPath;
}

test("resolveHookPaths uses KEYSTROKE_HOOK when set", () => {
  assert.deepEqual(resolveHookPaths({ KEYSTROKE_HOOK: "/tmp/custom-hook" }), [
    "/tmp/custom-hook",
  ]);
});

test("resolveHookPaths splits colon-separated hooks in order", () => {
  assert.deepEqual(
    resolveHookPaths({ KEYSTROKE_HOOK: "/tmp/prepare::./publish" }),
    ["/tmp/prepare", path.resolve("./publish")],
  );
});

test("resolveHookPaths defaults to ./hook", () => {
  assert.deepEqual(resolveHookPaths({}), [path.resolve("./hook")]);
});

test("hooksStatus requires every hook to be configured", () => {
  const good = makeHook("exit 0");
  const status = hooksStatus([good, "/nonexistent/hook"]);
  assert.equal(status.configured, false);
  assert.deepEqual(status.hooks, [
    { path: good, configured: true },
    { path: "/nonexistent/hook", configured: false, reason: "missing" },
  ]);
});

test("hookStatus reports missing hook", () => {
  assert.deepEqual(hookStatus("/nonexistent/hook"), {
    configured: false,
    reason: "missing",
  });
});

test("hookStatus reports non-executable hook", () => {
  const hookPath = makeHook("exit 0", { executable: false });
  assert.deepEqual(hookStatus(hookPath), {
    configured: false,
    reason: "not executable",
  });
});

test("hookStatus accepts an executable file", () => {
  const hookPath = makeHook("exit 0");
  assert.deepEqual(hookStatus(hookPath), { configured: true });
});

test("slugify normalizes titles", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("  Spaces  &  Symbols  "), "spaces-symbols");
  assert.equal(slugify(""), "untitled");
  assert.equal(slugify(undefined), "untitled");
});

test("writeDraft writes a dated markdown file", async () => {
  const filePath = await writeDraft({ title: "My Post", content: "# hi\n" });
  assert.match(path.basename(filePath), /^\d{4}-\d{2}-\d{2}-my-post\.md$/);
  assert.equal(await readFile(filePath, "utf8"), "# hi\n");
});

test("runHook passes the file path and env, captures stdout", async () => {
  const hookPath = makeHook(
    'echo "file=$1 title=$KEYSTROKE_TITLE slug=$KEYSTROKE_SLUG"',
  );
  const result = await runHook(hookPath, "/tmp/post.md", { title: "My Post" });
  assert.equal(result.ok, true);
  assert.equal(result.code, 0);
  assert.equal(
    result.stdout.trim(),
    "file=/tmp/post.md title=My Post slug=my-post",
  );
});

test("runHook reports a failing hook", async () => {
  const hookPath = makeHook('echo "boom" >&2\nexit 3');
  const result = await runHook(hookPath, "/tmp/post.md");
  assert.equal(result.ok, false);
  assert.equal(result.code, 3);
  assert.equal(result.stderr.trim(), "boom");
});

test("bundled wordcount hook counts words without publishing", async () => {
  const filePath = await writeDraft({
    title: "Demo",
    content: "one two three\n",
  });
  const hookPath = path.resolve("hooks/wordcount.sh");
  const result = await runHook(hookPath, filePath);
  assert.equal(result.ok, true);
  assert.match(result.stdout, /counted 3 words/);
  assert.match(result.stdout, /nothing was published/);
});

test("runHooks runs sequentially and later hooks see earlier edits", async () => {
  const filePath = await writeDraft({ title: "Chain", content: "body\n" });
  const first = makeHook(
    'echo "prepended" > "$1.tmp"\ncat "$1" >> "$1.tmp"\nmv "$1.tmp" "$1"',
  );
  const second = makeHook('cat "$1"');
  const result = await runHooks([first, second], filePath);
  assert.equal(result.ok, true);
  assert.equal(result.hooks.length, 2);
  assert.equal(result.hooks[1].stdout, "prepended\nbody\n");
});

test("runHooks stops at the first failure and skips the rest", async () => {
  const first = makeHook('echo "nope" >&2\nexit 2');
  const second = makeHook("exit 0");
  const result = await runHooks([first, second], "/tmp/post.md");
  assert.equal(result.ok, false);
  assert.equal(result.hooks[0].code, 2);
  assert.deepEqual(result.hooks[1], { path: second, skipped: true });
});

test("runHook times out long-running hooks", async () => {
  const hookPath = makeHook("sleep 5");
  const result = await runHook(hookPath, "/tmp/post.md", {
    env: { KEYSTROKE_HOOK_TIMEOUT: "100" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
});
