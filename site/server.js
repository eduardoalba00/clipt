// Serves the built site (dist/) with no dependencies. Railway runs `npm start`.
import { createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("./dist", import.meta.url));
const port = Number(process.env.PORT) || 3000;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".txt": "text/plain; charset=utf-8",
  ".mp4": "video/mp4",
};

function file(path) {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

function resolve(pathname) {
  try {
    const path = normalize(join(root, decodeURIComponent(pathname)));
    return path === root || path.startsWith(root + sep) ? path : null;
  } catch {
    return null;
  }
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let path = resolve(url.pathname);
  if (!path) {
    res.writeHead(400).end("Bad request");
    return;
  }
  let stat = file(path);
  if (!stat) {
    // One page: anything unknown gets it.
    path = join(root, "index.html");
    stat = file(path);
  }
  if (!stat) {
    res.writeHead(404).end("Not found");
    return;
  }
  const hashed = path.includes(`${join(root, "assets")}`);
  res.writeHead(200, {
    "Content-Type": TYPES[extname(path)] ?? "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": hashed ? "public, max-age=31536000, immutable" : "public, max-age=300",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") res.end();
  else createReadStream(path).pipe(res);
}).listen(port, () => console.log(`useclipt.dev on :${port}`));
