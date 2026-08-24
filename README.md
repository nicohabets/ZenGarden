# Zen Garden

A free, calm, isometric 3D zen garden in the spirit of Ryoan-ji: a pale gravel court, odd-numbered ishi-gumi stone groups, and concentric rings around moss islands. Place and move stones, and tend a bonsai at the edge of the court. The layout is generated from a seed. Your garden is saved only in this browser — there is no account and no database.

## Play

Open the site and the garden is ready.

| Action | Desktop | Phone / tablet |
| --- | --- | --- |
| Use the current tool | Left drag or click | One finger |
| Orbit the garden | Right drag | Two-finger drag |
| Pan | Shift + drag, or middle mouse | — |
| Zoom | Scroll wheel | Pinch |
| Tools | Toolbar, or keys `1`–`5` | Large toolbar buttons |

Atmosphere: a rectangular white-grey gravel court with weathered granite and basalt stones in five ishi-gumi groups (15 stones, odd counts), moss islands at their bases, a quieter bonsai at the edge, stone lanterns with a warm glow, koi in the basin, wind in the foliage, falling petals after watering, and a season mark (春夏秋冬) that turns with care.

Tools:

- **Rake** — draw grooves; circling a stone pulls even rings, a long pull stays straight
- **Stone** — tap empty sand to place a stone, drag a stone to move it
- **Water** — tap the bonsai
- **Prune** — tap foliage (two clusters always remain)
- **Bonsai** — drag the pot to a new place

**New garden** asks whether to keep the current garden or begin a fresh seeded layout.

## Persist

World state is written to `localStorage` (`zengarden.v1`) whenever you rake, place, prune, water, move, or leave the page. Court mass is a compressed height field (`hf1` / `hf1r`); if the quota is tight the save slims the sand and keeps the rest. Grains are rebuilt from that field. Returning to the same browser restores the sand, stones, bonsai, and camera. Clearing site data starts a new garden. Nothing is sent to a server.

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
- **workers.dev:** enabled (`workers_dev = true`). Production is `https://zengarden.<your-subdomain>.workers.dev` (or `https://zengarden.workers.dev` on some accounts).
- **Preview URLs:** enabled (`preview_urls = true`) so each Workers Build gets a clickable `https://<version>-zengarden.<subdomain>.workers.dev` link.

The Wrangler `name` is `zengarden` to match the existing Cloudflare Workers Builds service — do not rename it or a second Worker will be created.

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

TypeScript, Vite, Three.js. No React, no auth, no server store. Court mass is a height field (160×94 desktop, 128×75 mobile): rake tines scoop grit, banks receive that mass, then sand slumps at a 30° repose. The visible court is instanced irregular grains (plus a pale grit bed). A denser near-field follows the camera so a 30cm view is thousands of shards, not a stamped atlas. Mobile uses a smaller grain budget and dirty updates. Stones sit in the sand. Moss islands are lumpy mounds. Shadows skip on phones; DPR is capped. Rake UX is unchanged — freehand curves, snap-to-circles, straight pulls. No audio.
