import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { readFile } from "node:fs/promises";

const root = process.cwd();
const port = Number(process.env.PORT || 4177);

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
};

createServer(async (req, res) => {
  let pathname = decodeURIComponent((req.url || "/").split("?")[0] || "/");
  if (pathname === "/") pathname = "/index.html";
  pathname = normalize(pathname).replace(/^(\.\.[\\/])+/, "");

  const file = join(root, pathname);
  if (!file.toLowerCase().startsWith(root.toLowerCase())) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const data = await readFile(file);
    res.writeHead(200, {
      "Content-Type": types[extname(file).toLowerCase()] || "application/octet-stream",
    });
    res.end(data);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}).listen(port, () => {
  console.log(`Serving http://127.0.0.1:${port}`);
});
