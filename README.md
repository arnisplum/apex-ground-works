# Apex Ground Works — marketing site

Warm, residential-friendly static website for Apex Ground Works (Lower Mainland).

**Launch scope:** advertisement pages only — home, services, projects, trust, and a mailto contact form. No client login. No Smart Quote / admin / estimating in the public nav.

Future work lives in [`docs/FUTURE.md`](docs/FUTURE.md).

## Local preview

```bash
npm run serve:site
```

Open `http://127.0.0.1:4177`.

## Deploy (static)

This repo is ready as a **static site** (HTML/CSS/JS + media). No build step required.

### Render

1. [New Static Site](https://dashboard.render.com/static/new) → connect `arnisplum/apex-ground-works`
2. Branch: `main`
3. Build command: `true` (or leave blank if the UI allows)
4. Publish directory: `.`
5. Deploy

Optional: use the Blueprint in [`render.yaml`](render.yaml).

### Any static host

Upload or point the host at the repo root. Entry file is `index.html`. Ensure `/media`, `/css`, `/js`, and `/services` are published with the site.

## Contact

The homepage contact form opens an email draft to `quotes@apexgroundworks.com`. Change the address in `index.html` (`data-mailto-to` and the visible mailto links) when you have a final inbox.
