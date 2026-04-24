# Apex Ground Works — Web project plan

Created: 2026-04-10 · Updated: 2026-04-12

## Goals

- Present Apex Ground Works as a **warm, residential-friendly** local specialist — not a heavy civil or SaaS-cold brand.
- Keep **one visual system** across the marketing site: the **Smart Quote** page (`quote.html`) and `css/styles.css` are the baseline for colors, type, spacing, cards, buttons, and forms.
- Ship a calm **landing** (`index.html`), **project gallery**, **trust** section, **services**, and **contact** that all feel like the same product as Smart Quote.

## Design reference

- **Master UI:** `quote.html` + shared tokens in `css/styles.css` (`:root` variables).
- **Brand copy / positioning:** `apex-ground-works.md` (includes the Web design system summary).

## Tasks

- [x] Global tokens: warm page backgrounds, neutral text, `#2f6f6a` accent, soft borders, pill buttons, soft shadows.
- [x] Landing hero with photo + warm scrim; sections use eyebrows (TRUST, SERVICES, PROJECTS, CONTACT).
- [x] Smart Quote intake form (`quote.html`) aligned with form styling rules.
- [x] Contact section with warm card + styled fields + mailto handoff (`js/site.js`).
- [x] Project gallery grid using optimized `media/images/web/` assets.
- [ ] Replace placeholder `mailto` target with production inbox when available.
- [ ] Optional: server-side form handler or hosted form for quotes if mailto is not enough.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Home / landing |
| `quote.html` | Smart Quote (style baseline) |
| `css/styles.css` | Shared design system |
| `js/site.js` | Mailto form helper |
| `apex-ground-works.md` | Company + web system notes |
