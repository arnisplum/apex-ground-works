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
  attachment_manifest?: Array<{ name: string }>;
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

async function runAiSummary(projectText: string): Promise<{
  summary: string;
  model: string;
}> {
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
            "You help a residential groundwork contractor in British Columbia. Write a concise, professional project summary for internal review (3–6 short paragraphs max). Use plain language. Do not invent site facts; only use details from the user message.",
        },
        {
          role: "user",
          content: projectText,
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

  let manifest: Array<{ name: string }> = [];
  if (Array.isArray(payload.attachment_manifest)) {
    manifest = payload.attachment_manifest
      .map((x) => ({ name: trimStr(x?.name, 500) }))
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
        ? `\nAttachments (filenames only): ${manifest.map((m) => m.name).join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    try {
      const ai = await runAiSummary(projectText);
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

  return jsonResponse(req, 200, {
    id,
    status: finalStatus,
    ai_summary,
    ai_model,
    ai_generated_at,
  });
});
