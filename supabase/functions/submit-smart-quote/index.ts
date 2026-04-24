import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

type AttachmentEntry = { name: string; storage_path?: string };

type QuotePayload = {
  customer_name?: string;
  customer_email?: string;
  customer_phone?: string;
  project_address?: string;
  project_description?: string;
  project_type?: string;
  timing?: string;
  attachment_manifest?: Array<AttachmentEntry>;
  turnstile_token?: string;
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

const IMAGE_EXTS = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp|tiff?)$/i;
const MAX_VISION_IMAGES = 8;

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

async function getSignedImageUrls(
  admin: ReturnType<typeof createClient>,
  manifest: AttachmentEntry[],
): Promise<string[]> {
  const imagePaths = manifest
    .filter((m) => m.storage_path && IMAGE_EXTS.test(m.name))
    .map((m) => m.storage_path!)
    .slice(0, MAX_VISION_IMAGES);

  if (imagePaths.length === 0) return [];

  const signedUrls: string[] = [];
  for (const path of imagePaths) {
    const { data } = await admin.storage
      .from("quote-attachments")
      .createSignedUrl(path, 1800); // 30-minute URL for OpenAI to fetch
    if (data?.signedUrl) {
      signedUrls.push(data.signedUrl);
    }
  }
  return signedUrls;
}

async function runAiSummary(
  projectText: string,
  imageUrls: string[],
): Promise<{
  summary: string;
  model: string;
}> {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) {
    throw new Error("OPENAI_API_KEY not configured");
  }
  const model = "gpt-4o-mini";

  // Build user message content — text + optional vision images
  type ContentPart =
    | { type: "text"; text: string }
    | { type: "image_url"; image_url: { url: string; detail: "low" | "high" | "auto" } };

  const userContent: ContentPart[] = [{ type: "text", text: projectText }];
  for (const url of imageUrls) {
    userContent.push({
      type: "image_url",
      image_url: { url, detail: "low" },
    });
  }

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
            "You help a residential groundwork contractor in British Columbia. Write a concise, professional project summary for the client (3–6 short paragraphs max). Use plain, warm language. If site photos are included, describe what you observe and relate it to the scope of work. Do not invent site facts; only use details from the user message and attached images.",
        },
        {
          role: "user",
          content: userContent,
        },
      ],
      max_tokens: 1200,
      temperature: 0.4,
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
  const summary = data.choices?.[0]?.message?.content?.trim() ?? "";
  if (!summary) throw new Error("Empty AI response");
  return { summary, model };
}

async function sendNotificationEmail(params: {
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  project_address: string;
  project_description: string;
  project_type: string;
  timing: string;
  ai_summary: string | null;
  quote_id: string;
  attachment_count: number;
}): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return; // email is optional

  const fromAddress =
    Deno.env.get("RESEND_FROM_EMAIL") || "onboarding@resend.dev";
  const toAddress =
    Deno.env.get("QUOTE_NOTIFY_EMAIL") || "quotes@apexgroundworks.com";

  const lines = [
    `New Smart Quote from ${params.customer_name}`,
    "",
    `Name: ${params.customer_name}`,
    `Email: ${params.customer_email}`,
    params.customer_phone ? `Phone: ${params.customer_phone}` : null,
    `Address: ${params.project_address}`,
    params.project_type ? `Project type: ${params.project_type}` : null,
    params.timing ? `Timing: ${params.timing}` : null,
    `Attachments: ${params.attachment_count}`,
    "",
    "Description:",
    params.project_description,
    params.ai_summary
      ? `\n---\nAI Summary:\n${params.ai_summary}`
      : null,
    "",
    `Quote ID: ${params.quote_id}`,
  ]
    .filter((l) => l !== null)
    .join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromAddress,
      to: [toAddress],
      reply_to: params.customer_email,
      subject: `New Smart Quote — ${params.customer_name} — ${params.project_address}`,
      text: lines,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error("Resend email error", res.status, errText);
    // Non-fatal — don't fail the submission over email
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return jsonResponse(req, 405, { error: "Method not allowed" });
  }

  const secret = Deno.env.get("TURNSTILE_SECRET_KEY") ?? "";
  let payload: QuotePayload;
  try {
    payload = (await req.json()) as QuotePayload;
  } catch {
    return jsonResponse(req, 400, { error: "Invalid JSON body" });
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

  let manifest: AttachmentEntry[] = [];
  if (Array.isArray(payload.attachment_manifest)) {
    manifest = payload.attachment_manifest
      .map((x) => ({
        name: trimStr(x?.name, 500),
        storage_path: x?.storage_path ? trimStr(x.storage_path, 1000) : undefined,
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
  let ai_model: string | null = null;
  let ai_generated_at: string | null = null;
  let finalStatus = initialStatus;

  if (openaiConfigured) {
    // Resolve signed URLs for any uploaded images
    let imageUrls: string[] = [];
    try {
      imageUrls = await getSignedImageUrls(admin, manifest);
    } catch (e) {
      console.error("Signed URL error", e);
    }

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
        ? `\nAttachments (filenames): ${manifest.map((m) => m.name).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const ai = await runAiSummary(projectText, imageUrls);
      ai_summary = ai.summary;
      ai_model = ai.model;
      ai_generated_at = new Date().toISOString();
      finalStatus = "ai_ready";

      const { error: upErr } = await admin
        .from("quote_requests")
        .update({
          ai_summary,
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

  // Send notification email (non-blocking, optional)
  sendNotificationEmail({
    customer_name,
    customer_email,
    customer_phone,
    project_address,
    project_description,
    project_type,
    timing,
    ai_summary,
    quote_id: id,
    attachment_count: manifest.length,
  }).catch((e) => console.error("Email notification error", e));

  return jsonResponse(req, 200, {
    id,
    status: finalStatus,
    ai_summary,
    ai_model,
    ai_generated_at,
  });
});

