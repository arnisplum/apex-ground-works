import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type QuotePayload = {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  project_address?: string;
  project_description?: string;
  project_type?: string;
  timing?: string;
  attachment_manifest?: AttachmentManifestItem[];
  turnstile_token?: string;
};

type AttachmentManifestItem = {
  name: string;
  path?: string;
  bucket?: string;
  size?: number;
  type?: string;
  signed_url?: string;
};

type ParsedQuotePayload = QuotePayload & {
  files: File[];
};

type AiQuoteOutput = {
  project_line: string | null;
  project_description: string | null;
  owner_notes: string | null;
  summary: string;
  model: string;
};

const MAX_LEN = {
  name: 200,
  email: 320,
  phone: 80,
  address: 500,
  description: 20000,
  project_type: 200,
  timing: 200,
};

const ATTACHMENT_BUCKET = "quote-attachments";
const MAX_FILES = 10;
const MAX_FILE_SIZE = 25 * 1024 * 1024;

function allowedOrigins(): string[] {
  const raw = Deno.env.get("PUBLIC_SITE_ORIGIN") ?? "";
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function corsHeaders(req: Request): HeadersInit {
  const origins = allowedOrigins();
  const reqOrigin = req.headers.get("Origin");
  let allow = "*";
  if (origins.length > 0) {
    if (reqOrigin && origins.includes(reqOrigin)) {
      allow = reqOrigin;
    } else if (origins.length === 1) {
      allow = origins[0]!;
    } else {
      allow = origins[0] ?? "*";
    }
  }
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Max-Age": "86400",
  };
}

function jsonResponse(
  req: Request,
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req),
    },
  });
}

function trimStr(v: unknown, max: number): string {
  if (typeof v !== "string") return "";
  return v.trim().slice(0, max);
}

function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function formString(fd: FormData, key: string, fallbackKey?: string): string {
  const direct = fd.get(key);
  if (typeof direct === "string") return direct;
  if (fallbackKey) {
    const fallback = fd.get(fallbackKey);
    if (typeof fallback === "string") return fallback;
  }
  return "";
}

function parseJsonManifest(raw: FormDataEntryValue | null): AttachmentManifestItem[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((x) => {
        if (!x || typeof x !== "object") return null;
        const item = x as Record<string, unknown>;
        const name = trimStr(item.name, 500);
        if (!name) return null;
        return {
          name,
          path: trimStr(item.path, 1200) || undefined,
          bucket: trimStr(item.bucket, 100) || undefined,
          size: typeof item.size === "number" ? item.size : undefined,
          type: trimStr(item.type, 200) || undefined,
        };
      })
      .filter((x): x is AttachmentManifestItem => !!x)
      .slice(0, 25);
  } catch {
    return [];
  }
}

async function parseQuotePayload(req: Request): Promise<ParsedQuotePayload> {
  const contentType = req.headers.get("Content-Type") ?? "";
  if (contentType.toLowerCase().includes("multipart/form-data")) {
    const fd = await req.formData();
    const files = fd
      .getAll("attachments")
      .filter((v): v is File => v instanceof File && v.size > 0)
      .slice(0, MAX_FILES);

    return {
      customer_name: formString(fd, "customer_name", "Name"),
      customer_email: formString(fd, "customer_email", "Email"),
      customer_phone: formString(fd, "customer_phone", "Phone"),
      project_address: formString(fd, "project_address", "Project address"),
      project_description: formString(
        fd,
        "project_description",
        "Project description",
      ),
      project_type: formString(fd, "project_type", "Project type"),
      timing: formString(fd, "timing", "Timing"),
      turnstile_token: formString(fd, "turnstile_token"),
      attachment_manifest: parseJsonManifest(fd.get("attachment_manifest")),
      files,
    };
  }

  const payload = (await req.json()) as QuotePayload;
  return { ...payload, files: [] };
}

function safeObjectName(name: string): string {
  const fallback = "attachment";
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function isAllowedAttachment(file: File): boolean {
  if (file.size > MAX_FILE_SIZE) return false;
  if (file.type.startsWith("image/")) return true;
  if (file.type.startsWith("video/")) return true;
  if (file.type === "application/pdf") return true;
  return /\.(jpe?g|png|webp|gif|pdf|heic|heif)$/i.test(file.name);
}

function attachmentContentType(file: File): string {
  if (file.type && file.type !== "application/octet-stream") return file.type;
  if (/\.jpe?g$/i.test(file.name)) return "image/jpeg";
  if (/\.png$/i.test(file.name)) return "image/png";
  if (/\.webp$/i.test(file.name)) return "image/webp";
  if (/\.gif$/i.test(file.name)) return "image/gif";
  if (/\.heic$/i.test(file.name)) return "image/heic";
  if (/\.heif$/i.test(file.name)) return "image/heif";
  if (/\.pdf$/i.test(file.name)) return "application/pdf";
  if (/\.mp4$/i.test(file.name)) return "video/mp4";
  if (/\.mov$/i.test(file.name)) return "video/quicktime";
  if (/\.webm$/i.test(file.name)) return "video/webm";
  return "application/octet-stream";
}

async function uploadAttachments(
  admin: ReturnType<typeof createClient>,
  quoteId: string,
  files: File[],
): Promise<AttachmentManifestItem[]> {
  const manifest: AttachmentManifestItem[] = [];
  for (const [index, file] of files.slice(0, MAX_FILES).entries()) {
    if (!isAllowedAttachment(file)) {
      throw new Error(
        `Attachment ${file.name} is too large or not an accepted file type.`,
      );
    }
    const safeName = safeObjectName(file.name);
    const path = `${quoteId}/${String(index + 1).padStart(2, "0")}-${crypto.randomUUID()}-${safeName}`;
    const contentType = attachmentContentType(file);
    const uploadFile =
      file.type === contentType
        ? file
        : new File([await file.arrayBuffer()], file.name, { type: contentType });
    const { data, error } = await admin.storage
      .from(ATTACHMENT_BUCKET)
      .upload(path, uploadFile, {
        contentType,
        cacheControl: "3600",
        upsert: false,
      });

    if (error || !data?.path) {
      console.error("Attachment upload error", error);
      throw new Error(`Could not upload attachment ${file.name}.`);
    }

    manifest.push({
      name: file.name,
      path: data.path,
      bucket: ATTACHMENT_BUCKET,
      size: file.size,
      type: contentType,
    });
  }
  return manifest;
}

async function attachmentManifestForResponse(
  admin: ReturnType<typeof createClient>,
  manifest: AttachmentManifestItem[],
): Promise<AttachmentManifestItem[]> {
  const paths = manifest
    .filter((item) => item.bucket === ATTACHMENT_BUCKET && item.path)
    .map((item) => item.path!);

  if (!paths.length) return manifest;

  const { data, error } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrls(paths, 60 * 60 * 24);

  if (error || !data) {
    console.error("Attachment signed URL error", error);
    return manifest;
  }

  return manifest.map((item) => {
    if (item.bucket !== ATTACHMENT_BUCKET || !item.path) return item;
    const signed = data.find((entry) => entry.path === item.path);
    return signed?.signedUrl ? { ...item, signed_url: signed.signedUrl } : item;
  });
}

async function verifyTurnstile(
  token: string,
  secret: string,
  remoteip: string | null,
): Promise<boolean> {
  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  if (remoteip) body.set("remoteip", remoteip);
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body,
    },
  );
  const json = (await res.json()) as { success?: boolean };
  return json.success === true;
}

function aiFieldText(value: unknown, max: number): string {
  if (typeof value === "string") return value.trim().slice(0, max);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (!item || typeof item !== "object") return "";
        return Object.values(item as Record<string, unknown>)
          .map((v) => (typeof v === "string" ? v.trim() : ""))
          .filter(Boolean)
          .join(": ");
      })
      .filter(Boolean)
      .join("\n")
      .slice(0, max);
  }
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, v]) => {
        if (typeof v === "string" && v.trim()) return `${key}: ${v.trim()}`;
        if (Array.isArray(v)) {
          const parts = v
            .map((x) => (typeof x === "string" ? x.trim() : ""))
            .filter(Boolean);
          if (parts.length) return `${key}: ${parts.join(", ")}`;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n")
      .slice(0, max);
  }
  return "";
}

function parseAiJson(content: string): Omit<AiQuoteOutput, "model"> {
  const cleaned = content
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    const projectDescription = aiFieldText(parsed.project_description, 6000);
    const ownerNotes = aiFieldText(parsed.owner_notes, 6000);
    const projectLine = aiFieldText(parsed.project_line, 240);
    const summary = projectDescription || aiFieldText(parsed.summary, 6000);
    return {
      project_line: projectLine || null,
      project_description: projectDescription || summary || null,
      owner_notes: ownerNotes || null,
      summary: summary || content.trim(),
    };
  } catch {
    return {
      project_line: null,
      project_description: content.trim(),
      owner_notes: null,
      summary: content.trim(),
    };
  }
}

async function runAiSummary(projectText: string): Promise<AiQuoteOutput> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const model = "gpt-4o-mini";
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content:
            "You write professional construction project summaries for Apex Ground Works, a residential excavation, drainage, retaining wall, and groundwork contractor in British Columbia. Return only valid JSON with keys: project_line, project_description, owner_notes. project_line is a short construction scope label for the owner pipeline. project_description is a concise, client-facing construction summary based only on the intake: describe the requested work, existing site concern, likely construction focus, and any practical review considerations from the customer's notes or attachments. Use direct professional language, not a thank-you note, sales pitch, or greeting. Do not invent dimensions, materials, site conditions, pricing, engineering requirements, permits, or timelines not provided. owner_notes are private estimator notes: likely service category, urgency, access/photo cues, follow-up questions, and risks.",
        },
        {
          role: "user",
          content: projectText,
        },
      ],
      max_tokens: 1200,
      temperature: 0.4,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error("OpenAI error", res.status, errText);
    throw new Error("OpenAI request failed");
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!content) throw new Error("Empty AI response");
  return { ...parseAiJson(content), model };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, 405, { error: "Method not allowed" });
  }

  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  let payload: ParsedQuotePayload;
  try {
    payload = await parseQuotePayload(req);
  } catch {
    return jsonResponse(req, 400, { error: "Invalid quote submission" });
  }

  if (secret) {
    const tok = trimStr(payload.turnstile_token ?? "", 4000);
    if (!tok) {
      return jsonResponse(req, 400, { error: "Missing Turnstile verification" });
    }
    const ip = req.headers.get("CF-Connecting-IP") ??
      req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ?? null;
    const ok = await verifyTurnstile(tok, secret, ip);
    if (!ok) {
      return jsonResponse(req, 403, { error: "Turnstile verification failed" });
    }
  }

  const customer_name = trimStr(payload.customer_name, MAX_LEN.name);
  const customer_email = trimStr(payload.customer_email, MAX_LEN.email);
  const customer_phone = trimStr(payload.customer_phone, MAX_LEN.phone);
  const project_address = trimStr(payload.project_address, MAX_LEN.address);
  const project_description = trimStr(
    payload.project_description,
    MAX_LEN.description,
  );
  const project_type = trimStr(payload.project_type, MAX_LEN.project_type);
  const timing = trimStr(payload.timing, MAX_LEN.timing);

  if (!customer_name || !customer_email || !project_address || !project_description) {
    return jsonResponse(req, 400, {
      error: "Missing required fields",
      fields: ["customer_name", "customer_email", "project_address", "project_description"],
    });
  }
  if (!isValidEmail(customer_email)) {
    return jsonResponse(req, 400, { error: "Invalid email address" });
  }

  let manifest: AttachmentManifestItem[] = [];
  if (Array.isArray(payload.attachment_manifest)) {
    manifest = payload.attachment_manifest
      .map((x) => ({
        name: trimStr(x?.name, 500),
        path: trimStr(x?.path, 1200) || undefined,
        bucket: trimStr(x?.bucket, 100) || undefined,
        size: typeof x?.size === "number" ? x.size : undefined,
        type: trimStr(x?.type, 200) || undefined,
      }))
      .filter((x) => x.name.length > 0)
      .slice(0, 25);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return jsonResponse(req, 500, { error: "Server configuration error" });
  }

  const openaiConfigured = !!Deno.env.get("OPENAI_API_KEY");
  const initialStatus = openaiConfigured ? "ai_processing" : "submitted";

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const insertRow = {
    status: initialStatus,
    source: "smart_quote",
    customer_name,
    customer_email,
    customer_phone: customer_phone || null,
    project_address,
    project_description,
    project_type: project_type || null,
    timing: timing || null,
    attachment_manifest: manifest,
  };

  const { data: row, error: insErr } = await admin
    .from("quote_requests")
    .insert(insertRow)
    .select("id")
    .single();

  if (insErr || !row?.id) {
    console.error("Insert error", insErr);
    return jsonResponse(req, 500, { error: "Could not save quote request" });
  }

  const id = row.id as string;
  let ai_summary: string | null = null;
  let ai_project_description: string | null = null;
  let owner_notes: string | null = null;
  let project_line: string | null = null;
  let ai_model: string | null = null;
  let ai_generated_at: string | null = null;
  let finalStatus = initialStatus;

  if (payload.files.length) {
    try {
      const uploaded = await uploadAttachments(admin, id, payload.files);
      manifest = uploaded.length ? uploaded : manifest;
      const { error: attErr } = await admin
        .from("quote_requests")
        .update({ attachment_manifest: manifest })
        .eq("id", id);
      if (attErr) {
        console.error("Attachment manifest update error", attErr);
        return jsonResponse(req, 500, {
          error: "Could not save uploaded attachment details",
        });
      }
    } catch (e) {
      console.error("Attachment pipeline error", e);
      return jsonResponse(req, 400, {
        error:
          e instanceof Error
            ? e.message
            : "Could not save one or more attachments",
      });
    }
  }

  if (openaiConfigured) {
    const projectText = [
      `Name: ${customer_name}`,
      `Email: ${customer_email}`,
      customer_phone ? `Phone: ${customer_phone}` : null,
      `Address: ${project_address}`,
      `Project type: ${project_type || "—"}`,
      `Timing: ${timing || "—"}`,
      "",
      "Description:",
      project_description,
      manifest.length
        ? `\nAttachments saved: ${manifest.map((m) => {
          const detail = [m.name, m.type, m.size ? `${m.size} bytes` : ""]
            .filter(Boolean)
            .join(" · ");
          return detail;
        }).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const ai = await runAiSummary(projectText);
      ai_summary = ai.summary;
      ai_project_description = ai.project_description;
      owner_notes = ai.owner_notes;
      project_line = ai.project_line;
      ai_model = ai.model;
      ai_generated_at = new Date().toISOString();
      finalStatus = "ai_ready";

      const { error: upErr } = await admin
        .from("quote_requests")
        .update({
          ai_summary,
          ai_project_description,
          owner_notes,
          project_line,
          ai_model,
          ai_generated_at,
          status: finalStatus,
        })
        .eq("id", id);

      if (upErr) {
        console.error("AI update error", upErr);
        finalStatus = "ai_failed";
        await admin.from("quote_requests").update({ status: "ai_failed" }).eq(
          "id",
          id,
        );
      }
    } catch (e) {
      console.error("AI pipeline error", e);
      finalStatus = "ai_failed";
      await admin.from("quote_requests").update({ status: "ai_failed" }).eq(
        "id",
        id,
      );
    }
  }

  const responseManifest = await attachmentManifestForResponse(admin, manifest);

  return jsonResponse(req, 200, {
    id,
    status: finalStatus,
    ai_summary,
    ai_project_description,
    owner_notes,
    project_line,
    attachment_manifest: responseManifest,
    ai_model,
    ai_generated_at,
  });
});
