# Future pile — not in this launch

Public launch is a **static advertisement site** only: homepage, services, gallery, trust, and a simple mailto contact form. No client accounts. No estimator menus.

Keep building these later without blocking go-live:

## Smart Quote + backend
- Public Smart Quote intake (`quote.html`, `quote-preview.html`)
- Supabase Edge Function `submit-smart-quote`
- AI project summary / image vision
- Attachment storage bucket + signed URLs
- Resend (or similar) quote notification email
- Turnstile bot protection

## Staff / estimator tools
- Admin SPA (`admin/`) — Google OAuth, invite gate
- Quote queue, status updates, internal notes
- Photo / document review for estimators

## Later product phases
- Quote → project promotion
- Estimating pipeline stages
- Hours / crew tracking
- Production contact inbox wiring beyond `quotes@apexgroundworks.com` mailto

## Reference docs (when ready)
- `docs/BACKEND-ARCHITECTURE.md`
- `docs/SUPABASE-SETUP.md`
- `.env.example`
