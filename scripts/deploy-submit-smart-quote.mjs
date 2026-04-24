/**
 * Deploy submit-smart-quote Edge Function via Supabase Management API.
 * Requires SUPABASE_ACCESS_TOKEN in .env (Dashboard → Account → Access Tokens).
 * Usage: node scripts/deploy-submit-smart-quote.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

function loadEnvFile() {
  const p = path.join(root, ".env");
  if (!fs.existsSync(p)) return;
  const text = fs.readFileSync(p, "utf8");
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq < 1) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}

loadEnvFile();

const token = process.env.SUPABASE_ACCESS_TOKEN;
const ref =
  process.env.SUPABASE_PROJECT_REF ||
  process.env.SUPABASE_URL?.replace(/^https?:\/\/([^.]+)\.supabase\.co\/?$/, "$1");

if (!token) {
  console.error(
    "Missing SUPABASE_ACCESS_TOKEN. Add it to .env:\n" +
      "  1. Open https://supabase.com/dashboard/account/tokens\n" +
      "  2. Create a token with Edge Functions write (or org owner).\n" +
      "  3. SUPABASE_ACCESS_TOKEN=sbp_...\n",
  );
  process.exit(1);
}

if (!ref) {
  console.error("Set SUPABASE_PROJECT_REF or SUPABASE_URL in .env.");
  process.exit(1);
}

const slug = "submit-smart-quote";
const entryPath = path.join(
  root,
  "supabase",
  "functions",
  slug,
  "index.ts",
);
const content = fs.readFileSync(entryPath, "utf8");

const body = {
  metadata: {
    name: slug,
    entrypoint_path: "index.ts",
    verify_jwt: false,
  },
  files: [{ name: "index.ts", content }],
};

const url = `https://api.supabase.com/v1/projects/${ref}/functions/deploy?slug=${encodeURIComponent(slug)}`;

let res = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify(body),
});

let text = await res.text();

if (!res.ok && res.status === 400) {
  const fd = new FormData();
  fd.append(
    "metadata",
    new Blob([JSON.stringify(body.metadata)], { type: "application/json" }),
  );
  fd.append(
    "file",
    new Blob([content], { type: "application/typescript" }),
    "index.ts",
  );
  res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  text = await res.text();
}

console.log(res.status, text);
if (!res.ok) process.exit(1);
