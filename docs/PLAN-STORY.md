# PLAN-STORY.md — Local OpenStory: SQLite-backed story engine

A local version of OpenStory. A SQLite database becomes the source of truth for
**sequences → scenes → shots → frames**, plus reusable **characters, locations,
and elements**. Claude Code skills populate the database (split a script into
scenes, extract entities, write shot/frame prompts); the UI renders it all and
stays live via the existing SSE channel.

This supersedes the "no database" rule for _story structure_. The CLI gallery
(`~/.genmedia/gallery/...`) remains file-based and read-only; the legacy
`storyboard.json` flow keeps working untouched. The new DB does not mirror
either — it owns new state.

## Decisions (locked)

- **DB**: SQLite via `drizzle-orm` on the **`node:sqlite`** built-in driver
  (Node 24 here; no native deps). If drizzle's `node:sqlite` driver is missing
  in the installed version, check current drizzle docs (context7) — do NOT
  fall back to better-sqlite3 without confirming.
- **DB file: one per project folder** — `<projectDir>/story.db`, next to that
  project's `storyboard.json` and `takes/` (e.g. `sequence-1min/story.db`).
  The server resolves the project dir exactly like the legacy flow does
  (`projectDir()` in `src/lib/server/paths.ts`: `GENMEDIA_UI_PROJECT` env or
  cwd). `STORY_DB_PATH` env overrides the full path (tests use this). The CLI
  defaults to `./story.db` in its cwd, with `--project <dir>` / `--db <path>`
  flags. `story.db*` is gitignored. WAL mode on.
- **Migrations**: idempotent SQL applied automatically when the server opens
  the DB (CREATE TABLE IF NOT EXISTS style, plus a `meta` table with
  `schema_version` for future migrations). Keep a canonical
  `src/db/schema.sql` in sync — it is shipped inside the skill as reference.
- **Server-only**: all DB access lives under `src/db/` and is imported only
  from server functions / server routes (same pattern as `src/lib/server/`).
- **Skills write via a CLI**: `scripts/story.ts` (run with `bunx tsx` or
  `bun`), JSON in/out. Skills never hand-write SQL against the live DB for
  mutations (reads via `sqlite3` are fine and documented).
- **Live updates**: chokidar watches `data/story.db` + `story.db-wal` and
  emits an SSE `story-changed` event on the existing `/api/events` channel;
  the UI invalidates TanStack Query caches on it.
- **IDs**: TEXT primary keys, human-friendly: `<type>_<slug-or-nanoid>` (e.g.
  `seq_lighthouse`, `scn_01_arrival`, `shot_01a`, `chr_keeper`). The CLI
  auto-generates when not supplied. Timestamps are integer epoch millis.

## Data model

```
sequences 1─* scenes 1─* shots 1─* frames (start/end)
sequences 1─* characters / locations / elements   (entities scoped per sequence)
scenes    *─1 locations (primary location, nullable)
scenes    *─* characters (scene_characters)
scenes    *─* elements   (scene_elements)
generations: polymorphic takes for any promptable row (frame, shot, character,
             location, element) — one row per generated asset.
```

### Tables (canonical shapes — drizzle schema + schema.sql must match)

- `meta` — `key TEXT PK, value TEXT`. Holds `schema_version` (start at `'1'`).
- `sequences` — `id PK, title, logline TEXT DEFAULT '', script TEXT DEFAULT ''`
  (the full source script), `created_at INT, updated_at INT`.
- `scenes` — `id PK, sequence_id FK→sequences ON DELETE CASCADE,
order_index INT, title, script_excerpt TEXT DEFAULT ''` (the segment of the
  script this scene covers), `synopsis TEXT DEFAULT '',
location_id FK→locations ON DELETE SET NULL (nullable),
status TEXT DEFAULT 'draft'` (draft|ready|generating|review|done),
  `notes TEXT DEFAULT '', created_at, updated_at`.
- `shots` — `id PK, scene_id FK cascade, order_index INT,
description TEXT DEFAULT ''` (what happens), `prompt TEXT DEFAULT ''` (the
  video-generation prompt), `camera TEXT DEFAULT ''` (framing/movement),
  `duration_seconds REAL (nullable), status TEXT DEFAULT 'draft',
notes TEXT DEFAULT '',
selected_generation_id FK→generations ON DELETE SET NULL (nullable),
created_at, updated_at`.
- `frames` — `id PK, shot_id FK cascade, role TEXT CHECK(role IN
('start','end')), UNIQUE(shot_id, role), prompt TEXT DEFAULT ''` (the
  image-generation prompt), `notes TEXT DEFAULT '',
selected_generation_id (nullable, SET NULL), created_at, updated_at`.
- `characters` / `locations` / `elements` — identical shape:
  `id PK, sequence_id FK cascade, name, description TEXT DEFAULT ''` (who/what
  they are), `prompt TEXT DEFAULT ''` (visual appearance prompt for reference
  images), `notes TEXT DEFAULT '',
selected_generation_id (nullable, SET NULL), created_at, updated_at`.
  `elements` additionally has `kind TEXT DEFAULT 'prop'`
  (prop|vehicle|creature|effect|other).
- `scene_characters` — `scene_id FK cascade, character_id FK cascade,
PK(scene_id, character_id)`.
- `scene_elements` — same shape with `element_id`.
- `generations` — `id PK, target_type TEXT CHECK(target_type IN
('frame','shot','character','location','element')), target_id TEXT,
request_id TEXT DEFAULT '', endpoint_id TEXT DEFAULT '',
kind TEXT CHECK(kind IN ('image','video','audio')),
path TEXT` (absolute path or path under the repo; served through the
  existing media handler), `params TEXT DEFAULT '{}'` (JSON: seed, exact
  prompt, key params), `created_at`. Index on `(target_type, target_id)`.

Every mutation bumps the owning row's `updated_at` and the ancestor
`sequences.updated_at` (cheap "anything changed" signal for the UI).

## Deliverables by area

### 1. Foundation — `src/db/`

- `bun add drizzle-orm && bun add -d drizzle-kit` (drizzle-kit only if used
  for generation; hand-written migration SQL is fine and preferred for v1).
- `src/db/schema.ts` — drizzle table definitions (typed, matches above).
- `src/db/schema.sql` — canonical DDL (also copied into the skill).
- `src/db/index.ts` — `getDb(dbPath?: string)`: resolves
  `dbPath ?? STORY_DB_PATH ?? join(projectDir-like cwd resolution, 'story.db')`,
  caches open handles **per resolved path** (multiple project DBs can be open
  at once), WAL, foreign_keys ON, applies the idempotent migration, meta
  `schema_version = '1'`. Also export `storyDbPath()` (the default resolution)
  so the server and watcher agree on the path. Keep `src/db/` free of imports
  from `src/lib/server/` (the CLI imports it too); duplicate the tiny env/cwd
  resolution rather than importing paths.ts, or put the shared resolver in
  `src/db/db-path.ts`. Lazy only — no top-level side effects (vitest imports it).
- Unit tests against a temp-file DB (`STORY_DB_PATH` to scratch): schema
  round-trip, cascade deletes, unique (shot, role).

### 2. Server functions — `src/lib/server/story-functions.ts`

TanStack Start `createServerFn`, zod-validated, following the existing
patterns in `src/lib/server/functions.ts`:

- `listSequences` — id, title, logline, counts, updated_at.
- `getSequence({ id })` — the full tree: sequence → scenes (ordered, with
  location + character/element links) → shots (ordered) → frames, plus all
  entities and all generations for the sequence. One round-trip; the UI
  shapes it client-side.
- Mutations the UI needs: `updateSequence`, `createScene`/`updateScene`/
  `deleteScene`/`reorderScenes`, same trio for shots, `upsertFrame`,
  `updateEntity` (characters/locations/elements share one fn with a `type`
  discriminator), `linkSceneEntity`/`unlinkSceneEntity`,
  `selectGeneration({ targetType, targetId, generationId })`.
- All server fns operate on the **current project's** DB:
  `getDb(join(projectDir(), 'story.db'))` (respecting `STORY_DB_PATH`), using
  the existing `projectDir()` from `src/lib/server/paths.ts` — same project
  resolution as the legacy storyboard.
- Watcher: extend `src/lib/server/watcher.ts` (or add alongside) to watch the
  current project's DB file + `-wal` and broadcast `{ type: 'story-changed' }`
  on `/api/events`. Debounce ~150ms (WAL writes are chatty). Handle the file
  not existing yet (watch the dir, filter by name).

### 3. Story CLI — `scripts/story.ts`

The skills' write path. `bunx tsx scripts/story.ts <command> --json ...`.
Imports `src/db/` directly. Global flags on every command: `--db <path>`
(exact DB file) and `--project <dir>` (uses `<dir>/story.db`); default is
`./story.db` in the cwd — skills run from inside the project folder, same as
the legacy storyboard flow. Commands (all print JSON to stdout; non-zero exit

- JSON error on stderr on failure):

* `create-sequence --title T [--logline L] [--script-file path|--script S] [--id id]`
* `add-scene --sequence <id> --title T [--script-excerpt|--script-excerpt-file] [--synopsis] [--location <id>] [--order N] [--id id]`
* `add-shot --scene <id> --prompt P [--description] [--camera] [--duration N] [--order N] [--id id]`
* `set-frame --shot <id> --role start|end --prompt P` (upsert)
* `add-entity --sequence <id> --type character|location|element --name N [--description] [--prompt] [--kind]`
* `link --scene <id> --character <id>` / `link --scene <id> --element <id>` /
  `set-location --scene <id> --location <id>`
* `record-generation --target-type X --target-id Y --kind image|video|audio --path P [--request-id] [--endpoint-id] [--params JSON] [--select]`
* `update <table> <id> --set field=value ...` (whitelisted fields)
* `list sequences|scenes|shots|entities [--sequence id]` and
  `show sequence <id>` (full JSON tree — same shape as `getSequence`)
* `delete <table> <id>`

Batch mode matters for skills: `import --file batch.json` accepting
`{ sequence, scenes: [{..., shots: [{..., frames: {start, end}}], characters: [name...], elements: [...]}], characters: [...], locations: [...], elements: [...] }`
so a storyboard skill can write a whole breakdown in ONE call (single
transaction). Entity references inside scenes may be names — the importer
resolves/creates them.

Add package.json script: `"story": "tsx scripts/story.ts"`.

### 4. UI

Keep the existing routes working. New:

- `/story` — sequence library for the **current project's** DB (one DB per
  project folder; the "library" is the sequences inside it): cards with title,
  logline, scene/shot counts,
  entity avatars (selected reference images), updated_at. Create button.
- `/story/$sequenceId` — the board. Layout:
  - Left/main: scenes as vertical sections in order; each scene shows title,
    script excerpt (collapsible), synopsis, location chip, character chips,
    and its shots as a horizontal row of cards. A shot card shows start/end
    frame thumbnails (selected generation image, else prompt placeholder),
    the shot prompt (editable inline), camera/duration badges, status.
  - Right sidebar (tabs): **Characters / Locations / Elements** — cards with
    reference image (selected generation), name, description, appearance
    prompt (editable). Clicking an entity highlights scenes using it.
  - Script tab or collapsible top panel showing the full sequence script.
- Frame/shot detail (dialog or route): all generations for the target as a
  filmstrip, click to select (calls `selectGeneration`), prompt editing,
  notes.
- Live: subscribe to `story-changed` via the existing `use-live-events`
  hook and invalidate the sequence query.
- Reuse shadcn components in `src/components/ui/`; add missing ones with
  `bunx shadcn@latest add`. Media renders through the existing
  `/api/media` handler (see `src/lib/media-path.ts` for how paths are
  encoded).
- New components under `src/components/story/`.

### 5. Skills — `.claude/skills/story/`

`SKILL.md` + `references/schema.sql` + `references/cli.md`. The skill teaches
an agent to:

1. **Storyboard a script**: read a script/brief → split into scenes (each
   with its script excerpt + synopsis) → extract characters, locations,
   elements (dedup, write appearance prompts suited to image models) → write
   shot lists per scene (2–5 shots, each with a video prompt + start/end
   frame image prompts that reference entity appearance prompts for
   consistency) → write it all with ONE `story import --file` call.
2. **Populate media**: for any promptable row, generate with the `genmedia`
   CLI (reference the existing genmedia skill), then
   `record-generation ... --select` to attach the asset. Recommended order:
   entity reference images → frames (image models, using entity refs) →
   shots (image-to-video from start/end frames).
3. **Query state**: `show sequence <id>` for the full tree; raw `sqlite3`
   reads are OK (schema.sql is right there).

Prompt-writing guidance in the skill: shot prompts describe motion/action
for video models; frame prompts are fully self-contained still-image prompts
(no "same as before" references — bake the entity appearance text in).

### 6. Integration & polish

- `story.db*` in `.gitignore` (per-project DB files, incl. `-wal`/`-shm`).
- Root nav: link between `/` (legacy board) and `/story`.
- Seed: checked-in `docs/demo-story.json` (batch import format) built from
  the lighthouse content in `sequence-1min/`; import it into
  `sequence-1min/story.db` via `bun run story import --project sequence-1min
--file docs/demo-story.json`. Smoke-test the dev server with
  `GENMEDIA_UI_PROJECT=sequence-1min` so the UI shows the seeded project.
- `bun run typecheck && bun run lint && bun run test` clean. Follow the
  repo's strictness rules (no `any`, no `!`, `noUncheckedIndexedAccess`).
- Vitest must NOT import the vite config; DB tests use temp paths.

## Build order / parallelism

1. **Foundation** (blocking): deps, `src/db/*`, tests.
2. In parallel: **Server functions + watcher** and **Story CLI** (disjoint
   files; both import `src/db/`).
3. Then in parallel: **UI** (needs server fns) and **Skill** (needs CLI).
4. **Integration**: seed, nav, typecheck/lint/test green, smoke-run dev
   server.
5. **Review**: correctness pass over the whole diff, fix findings.

Only the foundation step touches `package.json` deps (plus shadcn adds in
the UI step). Agents must not edit `src/routeTree.gen.ts` (generated — run
`bun run generate-routes` after adding routes).
