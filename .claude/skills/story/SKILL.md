---
name: story
description: >
  Populate and query the per-project SQLite story database (sequences → scenes
  → shots → frames, plus characters/locations/elements) that drives the
  genmedia-ui /story board. Use whenever the user asks to "storyboard this
  script", "break down this script", "populate the story db", "turn this
  brief into scenes/shots", "generate frames / reference images / videos for
  the sequence", or mentions story.db or the story board. Teaches the batch
  import workflow, media population via the genmedia CLI +
  record-generation, and how to read state back.
---

# story workflow

The story database (`story.db`) is the source of truth for a filmable
breakdown: **sequences → scenes → shots → frames (start/end)**, plus reusable
**characters, locations, and elements** scoped per sequence, and
**generations** (media takes attached to any promptable row). The genmedia-ui
`/story` board renders it live — the app watches the DB file and refreshes on
every write, so each CLI call you make shows up in the UI immediately.

All writes go through the story CLI (`bun run story ...` from the genmedia-ui
repo). **Never mutate the DB with hand-written SQL** — the CLI keeps ids,
`updated_at` bumps, and referential checks consistent. Read-only `sqlite3`
queries are fine (introspect the live schema with
`sqlite3 <projectDir>/story.db .schema`; the canonical DDL lives in the
genmedia-ui repo at `src/db/schema.sql`).

For the complete command reference with a worked end-to-end example, see
[references/cli.md](references/cli.md). Load the `genmedia` skill for how to
run generation models — this skill only covers the story DB contract.

## Rule zero: point every command at the project folder

The DB is **per project folder**: `<projectDir>/story.db`, next to that
project's `storyboard.json` and `takes/` (e.g. `sequence-1min/story.db`) —
the same project-dir convention as the legacy storyboard flow. But `bun run`
resets the cwd to the repo root, so the CLI's `./story.db` default will land
in the **wrong place** if you rely on your shell's cwd.

Therefore: **pass `--project <projectDir>` on every `bun run story` command**
(or `--db <path>` for an exact file). Precedence: `--db` > `--project` >
`STORY_DB_PATH` env > `$GENMEDIA_UI_PROJECT/story.db` (when that env is set,
as it is in the dev-server smoke-run) > `./story.db` in the cwd.

```bash
cd <genmedia-ui repo root>
bun run story list sequences --project sequence-1min
```

Output is JSON on stdout; failures exit 1 with a JSON `{ "error": ... }` on
stderr. Parse stdout only — stderr may also carry Node warnings.

## Workflow 1 — script → full breakdown (one import call)

Given a script or brief, build the entire breakdown **in your head first**,
then write it to the DB with a single `import` call (one transaction — no
half-written state on the board):

1. **Split into scenes.** Each scene gets a `title`, its `scriptExcerpt`
   (the verbatim segment of the script it covers), and a one-line `synopsis`.
2. **Extract entities and dedupe.** Characters, locations, elements
   (props/vehicles/creatures/effects). One entry per distinct thing, however
   many times the script mentions it. For each, write a `description` (who or
   what it is) and a `prompt` — an **image-model-ready appearance prompt**: a
   self-contained visual description you could paste straight into a
   text-to-image model to get a reference image (age, build, hair, wardrobe,
   materials, era, lighting, "cinematic film still", etc.).
3. **Write 2–5 shots per scene.** Each shot has:
   - `prompt` — the **video-generation prompt**: describe motion, action, and
     camera movement over time ("she sprints…, camera tracks alongside…").
   - `description` (what happens), `camera` (framing/movement), `duration`
     (seconds).
   - `frames.start` and `frames.end` — **still-image prompts** for the first
     and last frame. Each must be fully self-contained: bake the entity
     appearance text in verbatim; **never** write "the same woman as before"
     — image models have no memory. Consistency comes from repeating the
     exact appearance wording.
4. **Write it all in ONE call**: build a `batch.json` and run
   `bun run story import --project <dir> --file batch.json`. Scene entity
   references may be plain names ("Mara") — the importer resolves them
   case-insensitively against the sequence's entities and creates any that
   are missing. Prefer explicit ids in the batch (`seq_…`, `scn_01_…`,
   `shot_01a`, `chr_…`) so later commands are predictable.

The import prints `{ created: counts, ...fullTree }` — verify the counts.
Importing again with the same `sequence.id` **appends new scenes** to the
existing sequence (it never replaces), and scene/shot ids that already
exist are rejected (the whole import rolls back — it is one transaction).
So for revisions of individual rows use `update` / `set-frame` / `delete`
instead (see cli.md).

## Workflow 2 — populate media (genmedia → record-generation)

Every promptable row (character, location, element, frame, shot) can carry
generations. Generate with the `genmedia` CLI (load that skill), download
into the project folder, then attach with `record-generation`. Recommended
order — each stage feeds the next:

1. **Entity reference images** (characters, locations, key elements): run an
   image model with the entity's `prompt`, then record.
2. **Frames**: run an image model with each frame's `prompt`. For character
   consistency, prefer an image-editing/reference-conditioned model fed the
   character's selected reference image (upload it with `genmedia upload`).
3. **Shots**: image-to-video from the frames — upload the shot's selected
   start (and end, if the model supports it) frame image, run a video model
   with the shot's `prompt`, record with `--kind video`.

Download convention: save assets inside the project folder (e.g.
`<projectDir>/story-assets/<target-id>/{request_id}.{ext}`) and pass that
path to `record-generation`. Use `--select` to make the new generation the
row's selected take (it also becomes the thumbnail in the UI):

```bash
genmedia run fal-ai/flux/dev \
  --prompt "<the row's prompt, verbatim>" \
  --download "sequence-1min/story-assets/chr_mara/{request_id}.{ext}" --json

bun run story record-generation --project sequence-1min \
  --target-type character --target-id chr_mara \
  --kind image --path story-assets/chr_mara/req_img_001.png \
  --request-id req_img_001 --endpoint-id fal-ai/flux/dev \
  --params '{"prompt":"<exact prompt>","seed":42}' --select
```

Record `--params` with the exact prompt, seed, and key model params — the
genmedia gallery does not store them, and you will need them to iterate
("same but warmer") later. Statuses (`draft | ready | generating | review |
done` on scenes and shots) are shared with the human driving the UI: set
`status=generating` while jobs run and `status=review` when takes land
(`bun run story update shots <id> --set status=review`); leave `done` and
already-human-edited fields to the human. A non-null
`selected_generation_id` you did not set is a human pick — don't overwrite
it; `--select` on a fresh row or your own iteration is fine.

## Workflow 3 — query state

- `bun run story show sequence <id> --project <dir>` — the full JSON tree
  (sequence → scenes with `characterIds`/`elementIds` → shots → frames as
  `{start, end}`, plus all entities and all generations). It carries the
  same data the UI loads (the exact JSON shape differs — see cli.md);
  re-read it before a batch of edits, since the human may have changed
  prompts, notes, or selections in the UI.
- `bun run story list sequences|scenes|shots|entities [--sequence <id>]
--project <dir>` — flat listings (sequences include scene/shot counts).
- Raw reads are fine: `sqlite3 <projectDir>/story.db "SELECT ..."` (add
  `-json` for parseable output; `.schema` shows the DDL).
  Reads only — never write SQL to the live DB.

## Quick reference

| Situation                       | Do                                                                    |
| ------------------------------- | --------------------------------------------------------------------- |
| Any `bun run story` command     | pass `--project <projectDir>` (or `--db`)                             |
| Fresh script/brief              | full breakdown → ONE `import --file batch.json`                       |
| Frame prompt tweak              | `set-frame --shot <id> --role start\|end --prompt "…"` (upsert)       |
| Other field tweak               | `update <table> <id> --set field=value` (whitelisted fields — cli.md) |
| Generated an asset              | download into project folder → `record-generation … --select`         |
| Before editing existing content | `show sequence <id>` — respect human edits and selections             |
| Human's selected take           | never overwrite a `selected_generation_id` you did not set            |
| Inspect state                   | `show sequence` / `list …` / read-only `sqlite3`                      |
| Mutating SQL                    | never — CLI only                                                      |
