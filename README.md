# ThatsTooBright

ThatsTooBright is a Windows desktop utility that helps reduce eye strain by reminding users to dim brightness based on configurable time and threshold settings.

This repository is structured so you can:
- keep the desktop app source and builds in one place
- deploy a modern Astro download page to Railway from the same repo

## Project Layout

- `main.js`, `preload.js`, `public/`, `build/`, `scripts/` -> Electron desktop app
- `site/` -> Astro download website
- `nixpacks.toml` -> Railway build/start instructions for deploying the Astro site

## Desktop App (local)

From repo root:

```bash
npm install
npm run start
npm run build
```

Built executable:

- `dist/ThatsTooBright.exe`

## Website (local)

From `site/`:

```bash
npm install
npm run dev
```

Production build:

```bash
npm run build
npm run start
```

## Deploying to Railway

1. Push this repo to GitHub (`thatstoobright`).
2. In Railway, create a new project from the GitHub repo.
3. Railway will use `nixpacks.toml` at repo root to:
   - install `site/` dependencies
   - build the Astro site
   - run the Astro server
4. Add your real download link in:
   - `site/src/pages/index.astro`
   - `downloadUrl` constant

Recommended download target:

- GitHub Releases latest asset URL, e.g.  
  `https://github.com/<your-username>/thatstoobright/releases/latest/download/ThatsTooBright.exe`
