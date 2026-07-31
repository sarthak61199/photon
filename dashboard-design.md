# Dashboard Design — Image SaaS
### Stack: TanStack Start + TanStack Query + Tailwind (companion to `image-saas-design.md`)

---

## 1. Where the dashboard sits

```
apps/
  api/            # management API (unchanged)
  delivery/
  worker/
  dashboard/      # ← TanStack Start app
packages/
  db/  core/  storage/
```

The dashboard is **first-party**: its server functions import `packages/db` and the same service layer the API uses — it does *not* call the public REST API over HTTP. This gives you end-to-end types from PG row → server function → component, no API-key ceremony for your own UI, and the public API stays a clean product surface for customers only.

```
Browser ──(RSC/stream + server fns)──▶ TanStack Start server ──▶ packages/db → PG
                                                              └─▶ packages/storage → S3 presign
```

Why TanStack Start specifically fits here:

- **Server functions** (`createServerFn`) replace an internal BFF layer entirely.
- **Type-safe file routing with search params** — an asset browser is 90% filter state (tags, folder, cursor, sort); TanStack Router's validated `useSearch` makes filter state URL-first and shareable for free.
- **TanStack Query integration** — loaders seed the query cache on SSR, then the client owns revalidation (uploads finishing, usage polling).

---

## 2. Route map

```
routes/
  __root.tsx                     # theme, toaster, query client
  _auth.tsx                      # layout: redirects if session
  _auth/login.tsx
  _auth/signup.tsx
  _app.tsx                       # layout: session + org guard, sidebar shell
  _app/index.tsx                 # Overview (usage snapshot, recent uploads)
  _app/media.tsx                 # layout: filter bar
  _app/media/index.tsx           # asset grid  ?folder=&tag=&sort=&q=
  _app/media/$assetId.tsx        # asset detail + transform playground
  _app/presets/index.tsx
  _app/presets/$presetId.tsx
  _app/usage.tsx                 # charts, per-day table, plan limits
  _app/developers/keys.tsx
  _app/developers/webhooks.tsx
  _app/developers/logs.tsx       # recent webhook deliveries + purges
  _app/settings/general.tsx      # org slug, signed-URL toggle, defaults
  _app/settings/members.tsx
  _app/settings/billing.tsx
```

### Auth + org context

Session cookie (e.g. `better-auth` or hand-rolled with `oslo`), resolved once in `_app.tsx`'s `beforeLoad`, which puts `{ user, org }` into router context — every child route and server function reads org from there, never from client input:

```ts
// routes/_app.tsx
export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const session = await getSession(); // server fn, reads cookie
    if (!session) throw redirect({ to: "/login" });
    return { user: session.user, org: session.org };
  },
  component: AppShell,
});
```

```ts
// Every mutating server fn re-derives org server-side:
export const updateAsset = createServerFn({ method: "POST" })
  .validator(z.object({ assetId: z.string().uuid(), tags: z.array(z.string()) }))
  .handler(async ({ data }) => {
    const { org } = await requireSession();
    return assetService.update(org.id, data.assetId, { tags: data.tags });
    //                          ^ tenant isolation lives in the service layer
  });
```

---

## 3. The screens that matter

### 3.1 Media library (`/media`) — the workhorse

```
┌──────────────────────────────────────────────────────────────┐
│ ⌕ search        folder: products ▾   tag ▾   sort ▾  [Upload]│
├──────────────────────────────────────────────────────────────┤
│ ▦ ▦ ▦ ▦ ▦ ▦     justified rows, not a square grid —          │
│ ▦▦▦ ▦ ▦▦ ▦      thumbnails keep their aspect ratio           │
│ ▦ ▦▦ ▦ ▦ ▦▦     (it's an image product; don't crop the       │
│ ▦▦ ▦ ▦▦▦ ▦      customer's images to fit your UI)            │
└──────────────────────────────────────────────────────────────┘
```

- **Justified gallery layout** (Flickr-style rows) computed from stored `width/height` — no layout shift, and it quietly demos your own delivery: every thumbnail is served through your CDN as `w_480,f_auto,q_70`, `dpr` matched to the screen. The dashboard is customer zero.
- **Blurhash placeholders** from `assets.metadata` while thumbnails load.
- **Infinite scroll** with keyset pagination + `@tanstack/react-virtual` (grids of 100k assets must not render 100k nodes).
- Filter state lives in **validated search params**, so "all PNGs tagged `hero` in `/marketing`" is a copyable URL.
- Multi-select → bulk tag / move / delete with optimistic updates.

```ts
const search = z.object({
  q: z.string().optional(),
  folder: z.string().optional(),
  tag: z.string().optional(),
  sort: z.enum(["newest", "oldest", "largest"]).default("newest"),
});
export const Route = createFileRoute("/_app/media/")({
  validateSearch: search,
  loaderDeps: ({ search }) => search,
  loader: ({ context, deps }) =>
    context.queryClient.ensureInfiniteQueryData(assetListQuery(deps)),
});
```

**Upload:** drag-and-drop anywhere on the page (full-page drop overlay). Flow: server fn returns presigned POST → browser uploads straight to S3 with per-file progress → server fn `completeUpload` → asset row appears in grid as `pending` with a shimmer → flips to `ready` via polling of a lightweight `pendingAssets` query (upgrade path: SSE). API and dashboard use the identical ingest path, so the pipeline gets exercised constantly.

### 3.2 Asset detail + transform playground (`/media/$assetId`) — the signature

This screen is what makes the product feel like Cloudinary rather than a file manager. Split view:

```
┌───────────────────────────────┬──────────────────────────────┐
│                               │ TRANSFORM                    │
│                               │ width  [ 800 ]  height [ – ] │
│      live preview             │ crop   fill ▾   gravity auto▾│
│   (re-fetched through the     │ format auto ▾   quality ▓▓░ 80│
│    real delivery service      │ dpr 1 ▾   blur ░░░░ 0        │
│    on every change)           │──────────────────────────────│
│                               │ cdn.app.com/acme/w_800,      │
│                               │ c_fill,f_auto,q_80/products/ │
│                               │ shoe.jpg            [Copy]   │
│  1.2 MB → 84 KB  (−93%)       │ [Save as preset…]            │
├───────────────────────────────┴──────────────────────────────┤
│ File info · EXIF · tags · derivatives generated · references │
└───────────────────────────────────────────────────────────────┘
```

- Controls ↔ URL are **bidirectional**: tweak a slider and the URL string updates; paste/edit a URL and the controls parse it — it uses the same `parseTransforms` / `transformKey` from `packages/core`, so the playground can never drift from production behavior.
- Preview requests are debounced 300ms and hit the actual delivery service, so the customer sees true output *and* true latency.
- The **savings readout** (`1.2 MB → 84 KB`) is the product's value proposition rendered live on every interaction.
- "Save as preset" writes a `transform_presets` row and swaps the URL to `t_name` form.
- Below: derivative list (what's been generated, sizes, hit counts) with per-derivative purge.

### 3.3 Usage (`/usage`)

- Area chart: bandwidth + requests per day (from `usage_daily`), stacked bar for transforms, a storage line.
- Plan-limit bars with projected month-end ("on pace for 412 GB of 500 GB").
- Charts: **visx or vanilla d3** wrapped in ~3 components — a metering dashboard needs exactly line/area/bar, and owning them keeps the visual language consistent with the theme.

### 3.4 Developers (`/developers/*`)

- **Keys**: create → full key shown once in a modal with copy button, then only `prefix…` forever. Scope checkboxes, last-used column, revoke with confirm.
- **Webhooks**: endpoint list, per-event toggles, recent deliveries with status + response time, "redeliver" button, secret with reveal-on-hold.
- Every resource screen shows a **copy-as-curl** affordance — the dashboard should teach the API.

---

## 4. Visual design direction

Subject check: this is infrastructure *for images* used daily by developers and media managers. Two truths to honor: (a) the customer's images are the content — the chrome must recede; (b) the audience lives in editors and terminals — density and keyboard use are respected, not dumbed down.

**Direction: "the light table."** A photographic light table / darkroom contact-sheet sensibility: deep neutral surfaces that make imagery pop (galleries and photo tools use dark surrounds because judging color on white is harder), with amber signal accents recalling darkroom safelights. Not the generic near-black-plus-acid-green SaaS default — the palette is warm-neutral, the accent is functional (states and data), and imagery supplies all the color.

### Tokens

| Token | Value | Use |
|---|---|---|
| `surface-0` | `#141311` | app background (warm near-black, not blue-black) |
| `surface-1` | `#1D1B18` | cards, sidebar |
| `surface-2` | `#26231F` | hover, inputs |
| `line` | `#33302A` | hairline borders |
| `ink` | `#E8E4DC` | primary text (warm off-white) |
| `ink-dim` | `#8F887C` | secondary text, labels |
| `amber` | `#E0A64E` | primary actions, active states, chart series 1 |
| `signal-ok` / `signal-err` | `#7FB069` / `#D0654B` | webhook status, upload states |

Light mode is offered but dark is default — this is one of the rare product categories where that's a functional choice (image evaluation), not a fashion one.

### Type

- **Display / headings:** `Sohne` or `Untitled Sans` — quiet grotesk, medium weight, tight tracking. Headings are small (18–20px); this app has no marketing hero.
- **Body / UI:** same family at 13–14px — dashboards earn density.
- **Data / URLs / keys:** `Berkeley Mono` or `JetBrains Mono`. The transform URL, IDs, byte sizes, and code samples are first-class content here; the mono face does real work and appears constantly, which becomes part of the app's character.

### Signature element

The **live transform URL bar** on the asset detail screen: a monospace, syntax-highlighted URL where each `k_v` pair is a subtly pill-highlighted token that pulses amber when its control changes. It's the product's core concept (URL-as-API) made tangible, it appears in miniature in grid-item hover states, and it's the thing users will remember and screenshot.

### Restraint rules

- Motion: 120–160ms ease-out on state changes, blurhash→image crossfade, the URL-token pulse. Nothing else — no page transitions, no decorative scroll effects.
- One accent. Amber means "active/primary"; if everything glows, nothing does.
- Empty states direct: *"No assets yet. Drag images anywhere, or `POST /v1/uploads`."* with a copyable curl.
- Quality floor: fully keyboard-navigable grid (arrows + space to select), visible focus rings (`amber`, 2px), `prefers-reduced-motion` kills the pulse and crossfade, responsive down to a single-column mobile grid.

### Component base

Headless Radix primitives (dialog, dropdown, tooltip) styled directly with the tokens above — take shadcn/ui structure as reference but re-skin completely; default shadcn theming would erase the direction. Tailwind v4 with tokens as CSS variables so light mode is a variable swap.

---

## 5. Data-layer patterns

```ts
// One queryOptions factory per resource — shared by loaders and components.
export const assetListQuery = (f: AssetFilters) =>
  infiniteQueryOptions({
    queryKey: ["assets", f],
    queryFn: ({ pageParam }) => listAssets({ data: { ...f, cursor: pageParam } }),
    getNextPageParam: (last) => last.nextCursor,
    initialPageParam: null as string | null,
  });
```

- **Loaders `ensureQueryData`, components `useSuspenseQuery`** — SSR paints with data, client owns freshness.
- **Optimistic**: tag edits, renames, preset saves. **Pessimistic + confirm**: deletes, purges, key revokes (destructive ops in this product destroy CDN state).
- **Polling**: `pendingAssets` every 2s only while pending items exist; usage page refetches on window focus.
- Server functions validate with zod (`.validator`) and never trust an `orgId` from the client.

---

## 6. Build order

1. Shell: auth, `_app` layout, sidebar, theme tokens.
2. Media grid: list server fn → justified virtual grid → filters in search params.
3. Upload flow end-to-end (drop → presign → complete → pending → ready).
4. Asset detail + transform playground (reuses `packages/core` parser).
5. Developers: keys + webhooks.
6. Usage charts, then settings/members/billing.

Ship after step 4 — the playground plus upload is the demo that sells the product.
