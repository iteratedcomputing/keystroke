import { marked } from "/vendor/marked.esm.js";

const SESSION_KEY = "keystroke.session";
const DURATIONS = [10, 15, 30, 45, 60];

const $ = (id) => document.getElementById(id);
const screens = ["setup", "select", "write", "done"];

let session = null;
let ticker = null;
let submitting = false;

function show(name) {
  for (const screen of screens) {
    $(`screen-${screen}`).hidden = screen !== name;
  }
  const writing = name === "write";
  $("timer").hidden = !writing;
  $("preview-toggle").hidden = !writing;
  $("ship-now").hidden = !writing;
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

function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

async function fetchStatus() {
  return (await fetch("/api/status")).json();
}

function renderSetup(status) {
  $("setup-snippet").textContent = [
    "cat > hook <<'EOF'",
    "#!/bin/sh",
    'echo "publishing $1"',
    "EOF",
    "chmod +x hook",
    "",
    `# looked for: ${status.hook.path} (${status.hook.reason})`,
    "# or point elsewhere: export KEYSTROKE_HOOK=/path/to/hook",
  ].join("\n");
  show("setup");
}

function renderSelect() {
  const container = $("durations");
  container.replaceChildren();
  for (const minutes of DURATIONS) {
    const button = document.createElement("button");
    button.innerHTML = `${minutes}<small>min</small>`;
    button.addEventListener("click", () => startSession(minutes));
    container.append(button);
  }
  show("select");
}

function startSession(minutes) {
  session = {
    deadline: Date.now() + minutes * 60_000,
    durationMinutes: minutes,
    title: "",
    content: "",
  };
  saveSession();
  renderWrite();
}

function renderWrite() {
  $("title").value = session.title;
  $("editor").value = session.content;
  $("title").disabled = false;
  $("editor").disabled = false;
  updateWordCount();
  updatePreview();
  show("write");
  $("editor").focus();
  tick();
  ticker = setInterval(tick, 250);
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

async function submit(reason) {
  if (submitting) return;
  submitting = true;
  clearInterval(ticker);
  $("title").disabled = true;
  $("editor").disabled = true;

  const { title, content, durationMinutes } = session;
  if (!content.trim()) {
    clearSession();
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
    result = { ok: false, stderr: String(error) };
  }

  if (result.ok) {
    clearSession();
    renderDone({
      ok: true,
      heading: "shipped",
      message: `your post is out of your hands now. draft kept at ${result.file}.`,
      output: result.stdout.trim(),
    });
  } else {
    renderDone({
      ok: false,
      heading: "hook failed",
      message: result.file
        ? `your words are safe at ${result.file}. fix the hook and ship it by hand.`
        : (result.error ?? "could not reach the server."),
      output: [result.stdout, result.stderr].filter(Boolean).join("\n").trim(),
    });
    clearSession();
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

$("preview-toggle").addEventListener("click", () => {
  const preview = $("preview");
  preview.hidden = !preview.hidden;
  $("panes").classList.toggle("split", !preview.hidden);
  $("preview-toggle").classList.toggle("active", !preview.hidden);
  updatePreview();
});

$("ship-now").addEventListener("click", () => submit("manual"));

$("write-again").addEventListener("click", () => renderSelect());

$("recheck").addEventListener("click", init);

$("title").addEventListener("input", () => {
  session.title = $("title").value;
  saveSession();
});

$("editor").addEventListener("input", () => {
  session.content = $("editor").value;
  saveSession();
  updateWordCount();
  updatePreview();
});

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

window.addEventListener("beforeunload", (event) => {
  if (session && !submitting) event.preventDefault();
});

async function init() {
  let status;
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
  if (!status.hook.configured) {
    renderSetup(status);
    return;
  }
  session = loadSession();
  if (session) {
    renderWrite();
  } else {
    renderSelect();
  }
}

init();
