# Aarambh Admin (React)

React + TypeScript port of the Flutter `admin_web` panel. Same Firebase project
(`aarambh-20a47`), same backend (`https://api.aarambh.app`), same `role: 'admin'`
custom-claim gate.

## Stack

- **Vite 6** + React 19 + TypeScript (strict)
- **Tailwind CSS v4** + shadcn/ui primitives on Radix
- **TanStack Query** for server state (replaces Riverpod)
- **React Router 7** — every pane is a real URL, so a reload keeps your place
- **Firebase JS SDK** — Auth, Firestore, Storage
- **Recharts** for the workout charts

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm run build      # -> dist/
```

Sign in with a Google account (or email/password) that carries the
`role: 'admin'` custom claim. Anything else is signed straight back out.

## Deploy

Firebase Hosting is configured to serve `dist/` with an SPA rewrite:

```bash
npm run build
npx firebase deploy --only hosting
```

`firebase.json` caches hashed assets in `/assets/**` for a year and keeps
`index.html` uncached, so a deploy takes effect immediately.

## Layout

```
src/
  app/          shell + nav model
  auth/         admin claim resolution, auth context
  components/
    ui/         shadcn/ui primitives
    common/     shared app components (states, charts, pickers)
  data/         static exercise template database (157 entries)
  hooks/        TanStack Query hooks + Firestore subscriptions
  lib/          firebase, api client, formatting, csv
  pages/        one file per pane
  services/     repositories — the only layer that knows API vs Firestore
  types/        plain-TS models and parsers
```

See [ARCHITECTURE.md](ARCHITECTURE.md) for why it is layered this way.
