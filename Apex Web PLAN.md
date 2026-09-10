# Apex Ground Works — Web project plan

Created: 2026-04-10 · Updated: 2026-09-10

## Launch goal (now)

Ship a **static advertisement website** as soon as possible:

- Homepage hero, trust, services, process, project gallery
- Service detail pages
- Simple **mailto contact** form (no accounts, no online estimates)
- Ready for static hosting (Render / Netlify / similar)

Smart Quote, Supabase, admin, and estimator tools are deferred — see [`docs/FUTURE.md`](docs/FUTURE.md).

## Design reference

- **Master UI:** shared tokens in `css/styles.css` (`:root` variables); homepage + contact as the live public baseline.
- **Brand copy / positioning:** `apex-ground-works.md`.

## Tasks

- [x] Global tokens: warm page backgrounds, neutral text, `#2f6f6a` accent, soft borders, pill buttons, soft shadows.
- [x] Landing hero with photo + warm scrim; sections use eyebrows (TRUST, SERVICES, PROJECTS, CONTACT).
- [x] Contact section with warm card + styled fields + mailto handoff (`js/site.js`).
- [x] Project gallery grid using optimized `media/images/web/` assets.
- [x] Public nav/CTAs point to contact (Smart Quote unlinked / noindex).
- [x] Deploy docs + `render.yaml` for static hosting.
- [ ] Replace `quotes@apexgroundworks.com` if a different production inbox is preferred.
- [ ] Point custom domain at the static host after first deploy.

## Files (public launch)

| File | Purpose |
|------|---------|
| `index.html` | Home / landing + contact |
| `services/*.html` | Service detail pages |
| `css/styles.css` | Shared design system |
| `js/site.js` | Mailto form + gallery lightbox |
| `README.md` | Local preview + deploy |
| `docs/FUTURE.md` | Deferred Smart Quote / admin / backend |
