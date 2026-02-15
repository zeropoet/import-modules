# lotusMap

A Next.js host shell that renders selectable repo "faces" and previews linked GitHub Pages apps.

## Live URL

`https://zeropoet.github.io/lotus-map/`

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Environment

Copy `.env.example` to `.env.local` and adjust values if needed.

- `NEXT_PUBLIC_APP_SOURCE_MODE=github|local`
- `NEXT_PUBLIC_GITHUB_OWNER=zeropoet`
- `NEXT_PUBLIC_SPAWN_RATIO_PERCENT=1..100`

## Build

```bash
npm run build
```

Static export output is generated in `out/` for GitHub Pages deployment.
