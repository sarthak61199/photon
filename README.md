# img

Cloudinary/Gumlet-style image SaaS. Architecture and design docs:

- [`image-saas-design.md`](./image-saas-design.md) — backend architecture, schema, delivery hot path.
- [`dashboard-design.md`](./dashboard-design.md) — TanStack Start dashboard.

## Layout

```
apps/
  api/            # Hono management API
  delivery/       # Hono delivery/transform hot path
  worker/         # pg-boss job consumers
  dashboard/      # TanStack Start dashboard
packages/
  db/             # drizzle schema + client
  core/           # transform parser, url signing, shared types
  storage/        # S3 client wrapper
```

## Dev setup

```sh
cp .env.example .env
docker compose up -d       # local Postgres + MinIO
pnpm install
pnpm dev
```

## Tooling

- Package manager: pnpm workspaces
- Task runner: Turborepo
- Lint/format: Biome
- DB: Drizzle
- Tests: Vitest
