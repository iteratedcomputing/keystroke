import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  hookStatus,
  resolveHookPath,
  runHook,
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

test("resolveHookPath uses KEYSTROKE_HOOK when set", () => {
  assert.equal(
    resolveHookPath({ KEYSTROKE_HOOK: "/tmp/custom-hook" }),
    "/tmp/custom-hook",
  );
});

test("resolveHookPath defaults to ./hook", () => {
  assert.equal(resolveHookPath({}), path.resolve("./hook"));
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

test("runHook times out long-running hooks", async () => {
  const hookPath = makeHook("sleep 5");
  const result = await runHook(hookPath, "/tmp/post.md", {
    env: { KEYSTROKE_HOOK_TIMEOUT: "100" },
  });
  assert.equal(result.ok, false);
  assert.equal(result.timedOut, true);
});
