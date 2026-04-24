# Apex Ground Works — backend, API, DB, and pipeline

This document is the **source of truth** for the Smart Quote backend, how data moves through the system, and how we grow toward staff tools (photos, estimating pipeline, hours, field workers). The public marketing site stays static HTML; **new behavior** lives behind Supabase + small serverless APIs.

---

## 1. Goals (phased)

| Phase | Scope |
|--------|--------|
| **v1** | Persist Smart Quote submissions, generate **AI project summary** server-side, estimators view queue in a **small admin web app** (Google OAuth + invite gate). |
| **v2** | Photo / document pipeline (Storage + metadata tables), richer quote → project promotion. |
| **v3+** | Estimating pipeline stages, hours, crew tracking — same auth and DB project, new tables and UI routes. |

---

## 2. High-level architecture

```text
┌─────────────────┐     POST JSON       ┌──────────────────────────┐
│ quote.html      │ ──────────────────► │ Edge Function (or other) │
│ quote-preview   │                     │ submit-smart-quote         │
│ (static site)   │                     └───────────┬──────────────┘
└─────────────────┘                                 │
        │                                             │ service role
        │ sessionStorage (UX fallback / legacy)       ▼
        │                                     ┌───────────────────┐
        └────────────────────────────────────►│ Supabase Postgres │
                                              │ + Auth + Storage  │
                                              └─────────┬─────────┘
                                                        │
                                                        │ read / update
                                                        ▼
                                              ┌───────────────────┐
                                              │ Admin SPA         │
                                              │ Google OAuth      │
                                              │ invite-gated      │
                                              └───────────────────┘
```

- **Never** put the OpenAI (or other) API key or the Supabase **service role** key in the static site.
- **Public form** either calls an **Edge Function** with a **single public URL** (no DB secrets in the browser), or uses the **anon** key with strict **RLS** (insert-only for quotes). This repo standardizes on **Edge Function for submit + AI** so validation, rate limits, and keys stay in one place.

---

## 3. Data pipeline (Smart Quote)

1. **Customer** completes Step 1 on `quote.html` (fields already defined in `js/site.js` / form `name` attributes).
2. **Client** sends `POST` to `submit-smart-quote` with JSON body (mirror draft keys → snake_case in API).
3. **Function** validates input (required fields, max lengths, optional attachment metadata if sent later).
4. **Function** inserts row into `quote_requests` with `status = 'ai_processing'`.
5. **Function** calls the **LLM** with a fixed system prompt + structured user content; writes `ai_summary`, `ai_model`, `ai_generated_at`; sets `status = 'ai_ready'` or `ai_failed`.
6. **Response** returns `{ id, preview_markdown | preview_html }` for redirect to preview (e.g. `quote-preview.html?id=<uuid>` or a future `/quote/preview/:id`).
7. **Estimator** opens admin app → lists `quote_requests` where `status` in useful filters → opens detail, updates `status`, adds `quote_notes`.

**Email:** optional parallel step (Resend, etc.) triggered from the same function after successful insert.

---

## 4. Database design (v1)

### 4.1 `quote_requests`

Customer-facing intake aligned with the current form:

| Column | Maps from form |
|--------|----------------|
| `customer_name` | `Name` |
| `customer_email` | `Email` |
| `customer_phone` | `Phone` |
| `project_address` | `Project address` |
| `project_description` | `Project description` |
| `project_type` | `Project type` (optional) |
| `timing` | `Timing` (optional) |
| `attachment_manifest` | JSON array of filenames for now (uploads to Storage in v2) |

Plus: `id`, `created_at`, `updated_at`, `status`, `source`, `ai_summary`, `ai_model`, `ai_generated_at`.

### 4.2 `staff_profiles`

One row per **authorized** staff user (tied to `auth.users`).

- `id` → `auth.users.id`
- `email`, `role` (`admin` | `estimator`)

### 4.3 `staff_invites`

Admin-created invites before first login.

- `email`, `role`, `invited_by`, `expires_at`, `accepted_at`

**Auth hook:** on first `auth.users` insert (Google sign-up), a trigger creates `staff_profiles` **only if** a pending `staff_invites` row exists for that email (case-insensitive). Then marks the invite accepted.

### 4.4 `quote_notes` (optional v1.1)

Append-only or versioned internal notes: `quote_request_id`, `author_id`, `body`, `created_at`.

---

## 5. Row Level Security (RLS) principles

- **Anonymous:** `INSERT` on `quote_requests` only (if using direct client insert); **no** `SELECT` of other people’s rows. Prefer **Edge Function + service role** and keep table **no anon policies** for stricter control.
- **Staff (`staff_profiles`):** `SELECT` all quotes; `UPDATE` on `quote_requests` for status / assignment fields; `INSERT` on `quote_notes`.
- **Invites:** no direct client access; admin actions go through **service role** (Edge Function) or Supabase Dashboard for early days.

---

## 6. Admin (estimator) UI

- **Stack (recommended):** Vite + React (or Next.js) deployed on Vercel/Netlify, env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Login:** `signInWithOAuth({ provider: 'google' })`.
- **Gate:** after session exists, require `select * from staff_profiles where id = auth.uid()` — if empty, show “no access; contact admin”.
- **Pages v1:** Login → **Queue** (table) → **Quote detail** (fields + AI summary + status dropdown + save).

Design language should follow `.cursor/rules/apex-design-system.mdc` where practical (warm neutrals, DM Sans, pill buttons).

---

## 7. API surface (v1)

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `POST /functions/v1/submit-smart-quote` | Optional anon key in header; rate limit body | Validate, insert quote, run AI, return preview + id |
| `GET` quote by id | **Not** public without signed token; preview can use short-lived JWT or session from POST response | Future hardening |

Admin reads/writes via **Supabase client** with user JWT + RLS (list/update quotes, insert notes).

---

## 8. Repo layout (target)

```text
docs/
  BACKEND-ARCHITECTURE.md    ← this file
supabase/
  migrations/                ← SQL migrations (versioned)
  functions/
    submit-smart-quote/      ← Edge Function (public POST)
admin/                       ← Vite React app (estimator UI)
```

---

## 9. First moves (implementation order)

Do these in order so nothing blocks the next step. For CLI and Dashboard steps, see **[SUPABASE-SETUP.md](./SUPABASE-SETUP.md)**.

1. **Supabase project** — Create project (dev/staging first). Note **project ref**, URL, anon key, service role key (server only).
2. **Apply migration** — Run `supabase link` + `supabase db push`, or paste `supabase/migrations/*.sql` into SQL Editor and run once.
3. **Auth** — Enable **Google** provider; set redirect URLs per Supabase docs. Create **first admin invite** row in `staff_invites` for your Google email, then sign in once to materialize `staff_profiles`.
4. **Edge Function `submit-smart-quote`** — Validate payload, insert `quote_requests`, call LLM, update row, return JSON CORS-enabled for your static site origin.
5. **Wire `js/site.js`** — On Step 1 submit: `POST` to the function URL with `fetch`, then redirect to preview with `id` (keep `sessionStorage` fallback until stable).
6. **Admin SPA skeleton** — Login + queue page listing `quote_requests` ordered by `created_at` desc.
7. **Hardening** — `read_only` MCP on prod data, CORS allowlist, optional Turnstile, email notifications.

---

## 10. Security reminders

- Do not connect **production** PII to the Supabase **MCP** or to experimental agents without `read_only` and project scoping.
- Review every **tool call** and migration in staging before production.
- Service role keys **only** in Edge Function secrets / CI, never in the static repo or client bundle.

---

## 11. Changelog

| Date | Change |
|------|--------|
| 2026-04-15 | Initial architecture + migration `20260415000001_init_backend.sql`. |
