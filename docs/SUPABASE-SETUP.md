# Supabase — link, migrate, deploy

Follow these steps after copying [`.env.example`](../.env.example) to `.env` and pasting your project values.

## 1. Create or open a project

In the [Supabase Dashboard](https://supabase.com/dashboard), create a project (or open an existing one). Note:

- **Project ref** — subdomain of `https://<project_ref>.supabase.co`
- **URL & keys** — **Project Settings → API** (`SUPABASE_URL`, anon key, service role key)

## 2. Authenticate the Supabase CLI

The CLI needs either a browser login or a **Personal Access Token** (Dashboard → **Account** → **Access Tokens**).

```bash
npx supabase login
```

Or add `SUPABASE_ACCESS_TOKEN=sbp_...` to your `.env` (see [`.env.example`](../.env.example)) so scripts and non-interactive deploys work.

Then link the project:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

`YOUR_PROJECT_REF` matches `SUPABASE_PROJECT_REF` in `.env`.

## 3. Apply database migrations

**Option A — CLI (linked project)**

```bash
npm run db:push
```

This applies everything under `supabase/migrations/`, including `quote_requests`, RLS, and staff invite hooks.

**Option B — SQL Editor**

Paste each migration file in order (Dashboard → SQL → New query) and run.

## 4. First staff user (Google)

1. **Authentication → Providers** — enable **Google** and configure Client ID / secret.
2. **Authentication → URL configuration** — add site URL and redirect URLs for your admin app and Supabase callback URLs.
3. Run in SQL Editor (replace email):

```sql
insert into public.staff_invites (email, role)
values ('you@yourdomain.com', 'admin');
```

4. Sign in once with Google using that email. Trigger `handle_new_user_staff_invite` creates `staff_profiles`.

## 5. Edge Function secrets

Dashboard → **Edge Functions → Secrets**, or from the repo root:

```bash
npx supabase secrets set --env-file .env
```

Required for `submit-smart-quote` at minimum: `SUPABASE_SERVICE_ROLE_KEY` (often auto-provided), `PUBLIC_SITE_ORIGIN`, and optionally `OPENAI_API_KEY`, `TURNSTILE_SECRET_KEY`.

## 6. Deploy the submit function

**Option A — PAT in `.env` (no browser)**

```bash
npm run deploy:function
```

Uses [`scripts/deploy-submit-smart-quote.mjs`](../scripts/deploy-submit-smart-quote.mjs) and the Management API. Requires `SUPABASE_ACCESS_TOKEN` in `.env`.

**Option B — Supabase CLI (after `supabase login`)**

```bash
npm run functions:deploy
```

`verify_jwt` is disabled for this function in [`supabase/config.toml`](../supabase/config.toml) so browsers can call it without a Supabase session.

After the first real deploy (not the placeholder), set **Edge Function secrets** in the Dashboard so the function can reach Postgres and optional OpenAI: `PUBLIC_SITE_ORIGIN`, `OPENAI_API_KEY`, and ensure `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are available to the function (often injected automatically; confirm under **Edge Functions → submit-smart-quote → Secrets**).

## 7. Wire the static site

Set the full function URL on `<body>` of pages that load `js/site.js`:

```html
<body data-quote-submit-url="https://YOUR_PROJECT_REF.supabase.co/functions/v1/submit-smart-quote">
```

Use the same origin(s) you listed in `PUBLIC_SITE_ORIGIN` for CORS.

## 8. RLS tightening (after function works)

Migration `20260421000002_remove_anon_insert_quote_requests.sql` removes anonymous `INSERT` on `quote_requests` so only the Edge Function (service role) writes rows. Apply with `db:push` once you no longer need direct anon inserts.

## 9. Storage bucket (file uploads)

Migration `20260424000003_quote_attachments_bucket.sql` creates the private `quote-attachments` bucket and allows anonymous uploads. Apply with `db:push`.

Then paste your **anon key** (Dashboard → Project Settings → API → anon / public) into the `data-supabase-anon-key` attribute on `<body>` in `quote.html` and `quote-preview.html`. With this set, the form uploads photo/PDF attachments to `quote-attachments/{uuid}/` before navigating to the preview page, and the Edge Function generates signed URLs so the OpenAI Vision API can analyze site photos.

## 10. Email notifications (Resend)

1. Create a free account at [resend.com](https://resend.com) and add/verify your sending domain.
2. Create an API key and set it as an Edge Function secret:
   ```bash
   npx supabase secrets set RESEND_API_KEY=re_...
   npx supabase secrets set RESEND_FROM_EMAIL=noreply@apexgroundworks.com
   npx supabase secrets set QUOTE_NOTIFY_EMAIL=quotes@apexgroundworks.com
   ```
3. Re-deploy the function: `npm run functions:deploy`

The Edge Function sends a notification email to `QUOTE_NOTIFY_EMAIL` (default `quotes@apexgroundworks.com`) after every successful submission, including the AI summary and file count. Email is non-fatal — if `RESEND_API_KEY` is not set, the submission still succeeds.

## 11. Staff admin app (`admin/`)

```bash
cd admin
copy .env.example .env
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (same as Dashboard API keys).
npm install
npm run dev
```

Open the printed local URL (e.g. `http://localhost:5173`). Sign in with Google using an email that exists in `staff_invites`.

---

See [BACKEND-ARCHITECTURE.md](./BACKEND-ARCHITECTURE.md) for the full pipeline and admin app.
