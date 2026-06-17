# NetSec Katas — frontend

A single-page web app for the kata curriculum. It reads the kata markdown
directly from `../modules/` at build time (the katas stay the single source of
truth — there is no separate copy and no backend).

## Stack

- **React 19** + **Vite 6** (TypeScript)
- **React Router 7** (library mode, `createBrowserRouter`)
- **shadcn/ui** components on **Tailwind CSS v4** (new-york style, neutral base)
- **react-markdown** + **remark-gfm** for rendering (tables, ASCII diagrams)
- Progress tracking via `localStorage` (no account needed)

## Run

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

```bash
npm run build      # type-check + production build to dist/
npm run preview    # serve the built app
```

## How content loads

`src/lib/katas.ts` uses `import.meta.glob("../../../modules/**/kata*.md")` to
pull every kata in as raw text, then parses the `# Kata NN — Title` heading and
the `> **Track:** … **Module:** … **Prereqs:** … **Time:** …` blockquote into
structured metadata. Add a new kata markdown file under `modules/` and it shows
up automatically — no code change required.

`vite.config.ts` sets `server.fs.allow: ['..']` so the dev server may read the
markdown that lives above this folder.

## Layout (all names lowercase-hyphenated)

```
frontend/
├── index.html
├── package.json
├── vite.config.ts
├── components.json            # shadcn config
└── src/
    ├── app.tsx                # router
    ├── main.tsx
    ├── index.css             # tailwind v4 + theme tokens
    ├── lib/
    │   ├── katas.ts          # markdown loader + parser
    │   └── utils.ts          # cn()
    ├── hooks/
    │   └── use-progress.ts   # localStorage progress store
    ├── components/
    │   ├── ui/               # shadcn primitives (button, card, badge)
    │   ├── app-sidebar.tsx
    │   ├── kata-markdown.tsx
    │   ├── progress-bar.tsx
    │   └── theme-toggle.tsx
    └── routes/
        ├── root-layout.tsx
        ├── home-page.tsx
        ├── kata-page.tsx
        └── not-found-page.tsx
```
