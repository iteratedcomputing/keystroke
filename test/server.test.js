import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { browserOpener, createApp } from "../src/server.js";

function makeHook(script) {
  const dir = mkdtempSync(path.join(tmpdir(), "keystroke-test-"));
  const hookPath = path.join(dir, "hook");
  writeFileSync(hookPath, `#!/bin/sh\n${script}\n`);
  chmodSync(hookPath, 0o755);
  return hookPath;
}

function listen(app) {
  return new Promise((resolve) => {
    app.listen(0, () => resolve(`http://localhost:${app.address().port}`));
  });
}

test("status reports version and unconfigured hook", async (t) => {
  const app = createApp({ hookPaths: ["/nonexistent/hook"] });
  t.after(() => app.close());
  const base = await listen(app);
  const body = await (await fetch(`${base}/api/status`)).json();
  assert.match(body.version, /^\d+\.\d+\.\d+$/);
  assert.equal(body.hook.configured, false);
  assert.equal(body.hook.hooks[0].reason, "missing");
});

test("status reports a configured hook", async (t) => {
  const app = createApp({ hookPaths: [makeHook("exit 0")] });
  t.after(() => app.close());
  const base = await listen(app);
  const body = await (await fetch(`${base}/api/status`)).json();
  assert.equal(body.hook.configured, true);
});

test("submit is rejected when no hook is configured", async (t) => {
  const app = createApp({ hookPaths: ["/nonexistent/hook"] });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/api/submit`, {
    method: "POST",
    body: JSON.stringify({ content: "# hi" }),
  });
  assert.equal(res.status, 409);
});

test("submit rejects empty content", async (t) => {
  const app = createApp({ hookPaths: [makeHook("exit 0")] });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/api/submit`, {
    method: "POST",
    body: JSON.stringify({ content: "   " }),
  });
  assert.equal(res.status, 400);
});

test("submit rejects invalid json", async (t) => {
  const app = createApp({ hookPaths: [makeHook("exit 0")] });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/api/submit`, {
    method: "POST",
    body: "not json",
  });
  assert.equal(res.status, 400);
});

test("submit writes the draft and runs the hook", async (t) => {
  const hookPath = makeHook('cat "$1"\necho "published $KEYSTROKE_SLUG"');
  const app = createApp({ hookPaths: [hookPath] });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/api/submit`, {
    method: "POST",
    body: JSON.stringify({
      title: "Test Post",
      content: "# hello\n",
      durationMinutes: 10,
    }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.match(body.file, /test-post\.md$/);
  assert.equal(await readFile(body.file, "utf8"), "# hello\n");
  assert.equal(body.hooks[0].stdout, "# hello\npublished test-post\n");
});

test("submit runs hooks in order and stops at the first failure", async (t) => {
  const first = makeHook('echo "first ran"');
  const second = makeHook('echo "second broke" >&2\nexit 1');
  const third = makeHook('echo "never runs"');
  const app = createApp({ hookPaths: [first, second, third] });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/api/submit`, {
    method: "POST",
    body: JSON.stringify({ content: "# hi" }),
  });
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.hooks.length, 3);
  assert.equal(body.hooks[0].stdout, "first ran\n");
  assert.equal(body.hooks[1].code, 1);
  assert.deepEqual(body.hooks[2], { path: third, skipped: true });
});

test("submit is rejected when any hook in the chain is missing", async (t) => {
  const app = createApp({
    hookPaths: [makeHook("exit 0"), "/nonexistent/hook"],
  });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/api/submit`, {
    method: "POST",
    body: JSON.stringify({ content: "# hi" }),
  });
  assert.equal(res.status, 409);
  const body = await res.json();
  assert.match(body.error, /\/nonexistent\/hook \(missing\)/);
});

test("submit surfaces hook failure", async (t) => {
  const app = createApp({
    hookPaths: [makeHook('echo "no remote" >&2\nexit 1')],
  });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/api/submit`, {
    method: "POST",
    body: JSON.stringify({ content: "# hi" }),
  });
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.hooks[0].code, 1);
  assert.equal(body.hooks[0].stderr.trim(), "no remote");
});

test("serves the index page", async (t) => {
  const app = createApp({ hookPaths: [makeHook("exit 0")] });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /text\/html/);
});

test("serves the bundled markdown renderer", async (t) => {
  const app = createApp({ hookPaths: [makeHook("exit 0")] });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/vendor/marked.esm.js`);
  assert.equal(res.status, 200);
});

test("blocks path traversal", async (t) => {
  const app = createApp({ hookPaths: [makeHook("exit 0")] });
  t.after(() => app.close());
  const base = await listen(app);
  const res = await fetch(`${base}/%2e%2e/package.json`);
  assert.equal(res.status, 404);
});

test("browserOpener picks the right command per platform", () => {
  const url = "http://localhost:7777";
  assert.deepEqual(browserOpener("darwin", url), {
    command: "open",
    args: [url],
  });
  assert.deepEqual(browserOpener("linux", url), {
    command: "xdg-open",
    args: [url],
  });
  assert.deepEqual(browserOpener("win32", url), {
    command: "cmd",
    args: ["/c", "start", "", url],
  });
});
