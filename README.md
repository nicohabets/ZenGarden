# Zen Garden

A free, calm, isometric 3D zen garden. Rake sand, place and move stones, and tend a bonsai. The layout is generated from a seed. Your garden is saved only in this browser — there is no account and no database.

## Play

Open the site and the garden is ready.

| Action | Desktop | Phone / tablet |
| --- | --- | --- |
| Use the current tool | Left drag or click | One finger |
| Orbit the garden | Right drag | Two-finger drag |
| Pan | Shift + drag, or middle mouse | — |
| Zoom | Scroll wheel | Pinch |
| Tools | Toolbar, or keys `1`–`5` | Large toolbar buttons |

Tools:

- **Rake** — draw grooves in the sand
- **Stone** — tap empty sand to place a stone, drag a stone to move it
- **Water** — tap the bonsai
- **Prune** — tap foliage (two clusters always remain)
- **Bonsai** — drag the pot to a new place

**New garden** asks whether to keep the current garden or begin a fresh seeded layout. Ambient sound can be muted. First interaction may start the audio (browser autoplay rules).

## Persist

World state is written to `localStorage` (`zengarden.v1`) whenever you rake, place, prune, water, move, or leave the page. Returning to the same browser restores the sand, stones, bonsai, and camera. Clearing site data starts a new garden. Nothing is sent to a server.

## Develop

```bash
npm install
npm run dev
```

Vite serves the app at `http://localhost:5173`.

```bash
npm run build
npm run preview
```

`npm run build` typechecks and writes a static site to `dist/`.

## Test

```bash
npx playwright install --with-deps chromium
npm test
```

Playwright boots a production preview and checks that the app loads, the toolbar works, the canvas renders, persistence survives reload, and a mobile viewport can select a tool. GitHub Actions runs the same suite on pull requests.

## Deploy to Cloudflare (Workers Static Assets)

This is a static Three.js site. There is no Worker script, no Pages Functions, and no database. `wrangler.toml` uses Workers Static Assets (`[assets]`) plus a Vite build (`[build]`). It does **not** set `pages_build_output_dir` (that flag makes Wrangler treat the repo as a Pages project and break `wrangler deploy`).

### Git / dashboard (Workers Builds)

Cloudflare’s connected-repo pipeline runs `npm ci` (clean-install) and then the deploy command. Keep:

- **Deploy command:** `npx wrangler deploy`
- **Build command:** `npm run build` if the dashboard has a separate field and you want the Vite build to run before Wrangler starts. If that field is empty, Wrangler still runs `[build].command = "npm run build"` as part of `wrangler deploy`, which writes `dist/` before assets upload.
- **Output / assets directory:** `dist`
- **Node version:** 20 or newer

`not_found_handling = "single-page-application"` serves `index.html` for unknown paths.

### Local / CLI

```bash
npm ci
npx wrangler deploy
```

Or:

```bash
npm run deploy
```

That script is `npm run build && wrangler deploy` (`predeploy` also builds). Preview the Worker-assets setup locally:

```bash
npm run cf:preview
```

## Stack

TypeScript, Vite, Three.js. No React, no auth, no server store. The garden is an orthographic (isometric) scene with a rakeable sand texture, generated stones, moss, a water basin, and a bonsai you can water, prune, and move.
