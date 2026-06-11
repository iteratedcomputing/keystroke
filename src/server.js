import http from "node:http";
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { hookStatus, resolveHookPath, runHook, writeDraft } from "./hook.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const VERSION = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
).version;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function serveStatic(res, publicDir, urlPath) {
  const relative = urlPath === "/" ? "index.html" : urlPath.slice(1);
  const filePath = path.resolve(publicDir, relative);
  if (filePath !== publicDir && !filePath.startsWith(publicDir + path.sep)) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    sendJson(res, 404, { error: "not found" });
    return;
  }
  res.writeHead(200, {
    "content-type":
      MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
  });
  createReadStream(filePath).pipe(res);
}

export function createApp({
  hookPath,
  publicDir = PUBLIC_DIR,
  env = process.env,
} = {}) {
  const resolvedPublicDir = path.resolve(publicDir);
  const markedDir = path.join(__dirname, "..", "node_modules", "marked", "lib");

  return http.createServer(async (req, res) => {
    const urlPath = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const hook = hookPath || resolveHookPath(env);

    if (req.method === "GET" && urlPath === "/api/status") {
      sendJson(res, 200, {
        version: VERSION,
        hook: { path: hook, ...hookStatus(hook) },
      });
      return;
    }

    if (req.method === "POST" && urlPath === "/api/submit") {
      const status = hookStatus(hook);
      if (!status.configured) {
        sendJson(res, 409, { error: `hook not configured: ${status.reason}` });
        return;
      }
      let body;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { error: "invalid json body" });
        return;
      }
      const { title, content, durationMinutes } = body;
      if (typeof content !== "string" || content.trim() === "") {
        sendJson(res, 400, { error: "content is required" });
        return;
      }
      const filePath = await writeDraft({ title, content });
      const result = await runHook(hook, filePath, {
        title,
        durationMinutes,
        env,
      });
      sendJson(res, 200, { file: filePath, ...result });
      return;
    }

    if (req.method === "GET" && urlPath === "/vendor/marked.esm.js") {
      serveStatic(res, markedDir, "/marked.esm.js");
      return;
    }

    if (req.method === "GET") {
      serveStatic(res, resolvedPublicDir, urlPath);
      return;
    }

    sendJson(res, 405, { error: "method not allowed" });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 7777;
  const hook = resolveHookPath();
  const status = hookStatus(hook);
  createApp().listen(port, () => {
    console.log(`keystroke v${VERSION} on http://localhost:${port}`);
    console.log(
      status.configured
        ? `hook: ${hook}`
        : `hook not configured (${status.reason}): create an executable at ${hook} or set KEYSTROKE_HOOK`,
    );
  });
}
