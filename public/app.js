import { marked } from "/vendor/marked.esm.js";

const SESSION_KEY = "keystroke.session";
const DURATIONS = [10, 15, 30, 45, 60];

const $ = (id) => document.getElementById(id);
const screens = ["setup", "select", "write", "done"];

let status = null;
let session = null;
let ticker = null;
let submitting = false;
let dirty = false;

function timed() {
  return Boolean(session?.deadline);
}

function show(name) {
  for (const screen of screens) {
    $(`screen-${screen}`).hidden = screen !== name;
  }
  const writing = name === "write";
  $("timer").hidden = !(writing && timed());
  $("preview-toggle").hidden = !writing;
  $("ship-now").hidden = !(writing && timed());
  for (const id of ["new-post", "save", "start-timer"]) {
    $(id).hidden = !(writing && !timed());
  }
  $("publish").hidden = !(writing && !timed() && status?.hook.configured);
}

function blankSession() {
  return {
    deadline: null,
    durationMinutes: null,
    title: "",
    content: "",
    file: null,
  };
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

function saveSession() {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function resetSession() {
  session = blankSession();
  dirty = false;
  saveSession();
}

async function fetchStatus() {
  return (await fetch("/api/status")).json();
}

function renderSetup() {
  $("setup-snippet").textContent = [
    "cat > hook <<'EOF'",
    "#!/bin/sh",
    'echo "publishing $1"',
    "EOF",
    "chmod +x hook",
    "",
    ...status.hook.hooks.map(
      (h) => `# looked for: ${h.path} (${h.reason || "ok"})`,
    ),
    "# or point elsewhere: export KEYSTROKE_HOOK=/path/to/hook",
    "# chain hooks with colons: export KEYSTROKE_HOOK=./prepare:./publish",
  ].join("\n");
  show("setup");
}

function renderSelect() {
  const container = $("durations");
  container.replaceChildren();
  for (const minutes of DURATIONS) {
    const button = document.createElement("button");
    button.innerHTML = `${minutes}<small>min</small>`;
    button.addEventListener("click", () => startTimer(minutes));
    container.append(button);
  }
  show("select");
}

function startTimer(minutes) {
  session.deadline = Date.now() + minutes * 60_000;
  session.durationMinutes = minutes;
  saveSession();
  renderWrite();
}

function renderWrite() {
  clearInterval(ticker);
  $("title").value = session.title;
  $("editor").value = session.content;
  $("title").disabled = false;
  $("editor").disabled = false;
  $("editor").placeholder = timed()
    ? "start typing. the clock is running."
    : "start typing.";
  updateWordCount();
  updatePreview();
  updateSaveStatus();
  show("write");
  $("editor").focus();
  if (timed()) {
    tick();
    ticker = setInterval(tick, 250);
  }
}

function tick() {
  const remaining = session.deadline - Date.now();
  if (remaining <= 0) {
    $("timer").textContent = "00:00";
    submit("time");
    return;
  }
  const totalSeconds = Math.ceil(remaining / 1000);
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  $("timer").textContent = `${minutes}:${seconds}`;
  $("timer").classList.toggle("urgent", totalSeconds <= 60);
}

function updateWordCount() {
  const words = $("editor").value.trim().split(/\s+/).filter(Boolean).length;
  $("word-count").textContent = `${words} word${words === 1 ? "" : "s"}`;
}

function updatePreview() {
  if (!$("preview").hidden) {
    $("preview").innerHTML = marked.parse($("editor").value);
  }
}

function updateSaveStatus() {
  const file = session.file;
  $("save-status").textContent = file
    ? `${dirty ? "edited since save" : "saved"} · ${file}`
    : "";
}

async function save() {
  if (!session.content.trim() && !session.title.trim()) return true;
  try {
    const res = await fetch("/api/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: session.title,
        content: session.content,
        file: session.file,
      }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error);
    session.file = body.file;
    dirty = false;
    saveSession();
    updateSaveStatus();
    return true;
  } catch (error) {
    $("save-status").textContent = `save failed: ${error.message}`;
    return false;
  }
}

async function newPost() {
  if (!(await save())) return;
  resetSession();
  renderWrite();
}

function requestTimer() {
  if (!status.hook.configured) {
    renderSetup();
    return;
  }
  renderSelect();
}

async function submit(reason) {
  if (submitting) return;
  submitting = true;
  clearInterval(ticker);
  $("title").disabled = true;
  $("editor").disabled = true;

  const { title, content, durationMinutes } = session;
  if (!content.trim()) {
    resetSession();
    renderDone({
      ok: false,
      heading: "nothing to ship",
      message: "the clock ran out on an empty page. that happens.",
    });
    submitting = false;
    return;
  }

  $("done-heading").textContent =
    reason === "time" ? "time. shipping..." : "shipping...";
  $("done-heading").classList.remove("failed");
  $("done-message").textContent = "";
  $("done-output").hidden = true;
  show("done");
  $("write-again").hidden = true;

  let result;
  try {
    const res = await fetch("/api/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, content, durationMinutes }),
    });
    result = await res.json();
  } catch (error) {
    result = { ok: false, error: String(error) };
  }

  const output = (result.hooks ?? [])
    .map((h) => {
      if (h.skipped) return `$ ${h.path}\n(skipped)`;
      const body = [h.stdout, h.stderr].filter(Boolean).join("").trim();
      return `$ ${h.path}\n${body || "(no output)"}`;
    })
    .join("\n\n");

  if (result.ok) {
    resetSession();
    renderDone({
      ok: true,
      heading: "shipped",
      message: `your post is out of your hands now. draft kept at ${result.file}.`,
      output,
    });
  } else {
    const failed = (result.hooks ?? []).find((h) => !h.ok && !h.skipped);
    renderDone({
      ok: false,
      heading: failed ? "hook failed" : "something broke",
      message: result.file
        ? `${failed.path} exited ${failed.timedOut ? "by timeout" : failed.code}. your words are safe at ${result.file}. fix the hook and ship it by hand.`
        : (result.error ?? "could not reach the server."),
      output,
    });
    resetSession();
  }
  submitting = false;
}

function renderDone({ ok, heading, message, output }) {
  $("done-heading").textContent = heading;
  $("done-heading").classList.toggle("failed", !ok);
  $("done-message").textContent = message;
  $("done-output").textContent = output || "";
  $("done-output").hidden = !output;
  $("write-again").hidden = false;
  show("done");
}

function togglePreview() {
  const preview = $("preview");
  preview.hidden = !preview.hidden;
  $("panes").classList.toggle("split", !preview.hidden);
  $("preview-toggle").classList.toggle("active", !preview.hidden);
  updatePreview();
}

$("preview-toggle").addEventListener("click", togglePreview);

window.keystroke = {
  save: () => !$("screen-write").hidden && !timed() && save(),
  newPost: () => !$("screen-write").hidden && !timed() && newPost(),
  togglePreview: () => !$("screen-write").hidden && togglePreview(),
  draftsDir: () => status?.draftsDir,
};

$("ship-now").addEventListener("click", () => submit("manual"));
$("publish").addEventListener("click", () => submit("manual"));
$("save").addEventListener("click", save);
$("new-post").addEventListener("click", newPost);
$("start-timer").addEventListener("click", requestTimer);
$("select-back").addEventListener("click", renderWrite);
$("setup-back").addEventListener("click", renderWrite);
$("write-again").addEventListener("click", () =>
  session ? renderWrite() : location.reload(),
);

$("recheck").addEventListener("click", async () => {
  status = await fetchStatus();
  if (status.hook.configured) renderSelect();
  else renderSetup();
});

function edited() {
  session.title = $("title").value;
  session.content = $("editor").value;
  dirty = true;
  saveSession();
  updateWordCount();
  updatePreview();
  updateSaveStatus();
}

$("title").addEventListener("input", edited);
$("editor").addEventListener("input", edited);

$("editor").addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    event.preventDefault();
    const editor = event.target;
    const { selectionStart, selectionEnd, value } = editor;
    editor.value = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    editor.selectionStart = editor.selectionEnd = selectionStart + 2;
    editor.dispatchEvent(new Event("input"));
  }
});

document.addEventListener("keydown", (event) => {
  if (!event.metaKey && !event.ctrlKey) return;
  if ($("screen-write").hidden || timed()) return;
  const key = event.key.toLowerCase();
  if (key === "s") {
    event.preventDefault();
    save();
  } else if (key === "n" && event.shiftKey) {
    event.preventDefault();
    newPost();
  }
});

window.addEventListener("beforeunload", (event) => {
  if (timed() && !submitting) event.preventDefault();
});

async function init() {
  try {
    status = await fetchStatus();
  } catch {
    renderDone({
      ok: false,
      heading: "server unreachable",
      message: "is `make dev` still running?",
    });
    return;
  }
  $("version").textContent = `v${status.version}`;
  session = { ...blankSession(), ...(loadSession() ?? {}) };
  renderWrite();
}

init();
