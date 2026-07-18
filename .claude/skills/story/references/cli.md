# story CLI reference

`scripts/story.ts` in the genmedia-ui repo — the only write path into a
project's `story.db`. Run it from the repo root:

```bash
node scripts/story.ts <command> [flags]   # preferred — plain Node (≥ 23.6), no other tooling
npx tsx scripts/story.ts <command> …      # equivalent (any Node with deps installed)
bun run story <command> …                 # equivalent if bun is available
```

Requires the repo's dependencies installed (`npm install` or `bun install`
both work).

Every command prints JSON to stdout. Failures exit `1` with a JSON error
object on stderr (`{ "error": "...", "details"?, "issues"? }`). stderr may
also carry Node warnings (e.g. the experimental `node:sqlite` notice) —
parse stdout only.

## DB resolution (global flags on every command)

| Flag / source             | Meaning                                        |
| ------------------------- | ---------------------------------------------- |
| `--db <path>`             | exact DB file (highest precedence)             |
| `--project <dir>`         | uses `<dir>/story.db`                          |
| `STORY_DB_PATH` env       | fallback when neither flag is given            |
| `GENMEDIA_UI_PROJECT` env | fallback: uses `$GENMEDIA_UI_PROJECT/story.db` |
| default                   | `./story.db` in the **process cwd**            |

Watch the `GENMEDIA_UI_PROJECT` fallback: in a shell where it is exported
(e.g. the dev-server smoke-run), omitting `--project` does **not** give you
`./story.db` in the cwd — it silently reads/writes the env project's DB.

**Always pass `--project` (or `--db`).** The CLI is invoked from the repo
root (where `scripts/story.ts` lives), so the `./story.db` default points at
the repo, not your project. Opening a path that doesn't exist
creates a fresh, empty DB there — a typo'd `--project` silently gives you an
empty database, so double-check the path if a lookup unexpectedly fails.

## IDs

TEXT primary keys, human-friendly: `<prefix>_<slug>` with `_2`, `_3`, …
appended on collision. Prefixes: `seq_` `scn_` `shot_` `frm_` `chr_` `loc_`
`elm_` `gen_`. Auto-generated when omitted; every create accepts an explicit
`--id` (or `id` in batch JSON) and fails if it already exists. `import`
generates plan-style ids: `scn_01_<title>`, `shot_01a` (scene position +
letter), `frm_01a_start`, `chr_<name>`. Prefer passing explicit ids in
batches so follow-up commands are predictable.

## Commands

### create-sequence

```bash
node scripts/story.ts create-sequence --title T [--logline L] \
  [--script S | --script-file path] [--id id] --project <dir>
```

Prints the created row. `--script-file` reads the full script text from a
file (resolved from the cwd — use absolute paths).

### add-scene

```bash
node scripts/story.ts add-scene --sequence <id> --title T \
  [--script-excerpt S | --script-excerpt-file path] [--synopsis S] \
  [--location <locId>] [--order N] [--id id] --project <dir>
```

`--order` defaults to appending after the highest existing `order_index`.
`--location` must be a location id in the same sequence.

### add-shot

```bash
node scripts/story.ts add-shot --scene <id> --prompt P [--description D] \
  [--camera C] [--duration N] [--order N] [--id id] --project <dir>
```

`--prompt` is the video-generation prompt (required). `--duration` is
seconds (float ok). Auto-id is derived from the scene id + order (e.g.
`shot_01_dock_at_dusk_1`) — pass `--id shot_01a` if you want the compact
import-style id.

### set-frame (upsert)

```bash
node scripts/story.ts set-frame --shot <id> --role start|end --prompt P [--id id] \
  --project <dir>
```

Updates the shot's existing start/end frame prompt, or creates the frame if
missing (`UNIQUE(shot_id, role)`). This is the way to revise frame prompts.

### add-entity

```bash
node scripts/story.ts add-entity --sequence <id> --type character|location|element \
  --name N [--description D] [--prompt P] [--notes N] \
  [--kind prop|vehicle|creature|effect|other] [--id id] --project <dir>
```

`--kind` is only valid for `--type element`. `--prompt` is the
image-model-ready appearance prompt used for reference images.

### link / set-location

```bash
node scripts/story.ts link --scene <id> --character <chrId> --project <dir>
node scripts/story.ts link --scene <id> --element <elmId> --project <dir>
node scripts/story.ts set-location --scene <id> --location <locId> --project <dir>
```

`link` takes exactly one of `--character` / `--element`; duplicates are
no-ops. Entities must belong to the scene's sequence.

### record-generation

```bash
node scripts/story.ts record-generation \
  --target-type frame|shot|character|location|element --target-id <id> \
  --kind image|video|audio --path <asset path> \
  [--request-id R] [--endpoint-id E] [--params '<JSON object>'] \
  [--select] [--id id] --project <dir>
```

Attaches a generated asset to any promptable row. `--path` is the downloaded
file (project-relative like `story-assets/chr_mara/req_img_001.png`, or
absolute). `--select` also sets the target row's `selected_generation_id`
(the UI thumbnail). `--params` must be a JSON **object** — record the exact
prompt, seed, and key model params here for reproducibility (the genmedia
gallery does not store them). Output: `{ "generation": {...}, "selected": bool }`.

### update

```bash
node scripts/story.ts update <table> <id> --set field=value [--set field=value ...] \
  --project <dir>
```

Tables are plural (`sequences`, `scenes`, `shots`, `frames`, `characters`,
`locations`, `elements`). Only whitelisted fields:

| Table        | Updatable fields                                                                                                  |
| ------------ | ----------------------------------------------------------------------------------------------------------------- |
| `sequences`  | `title`, `logline`, `script`                                                                                      |
| `scenes`     | `title`, `script_excerpt`, `synopsis`, `notes`, `status`, `order_index`, `location_id`                            |
| `shots`      | `description`, `prompt`, `camera`, `notes`, `status`, `order_index`, `duration_seconds`, `selected_generation_id` |
| `frames`     | `prompt`, `notes`, `selected_generation_id`                                                                       |
| `characters` | `name`, `description`, `prompt`, `notes`, `selected_generation_id`                                                |
| `locations`  | `name`, `description`, `prompt`, `notes`, `selected_generation_id`                                                |
| `elements`   | `name`, `description`, `prompt`, `notes`, `kind`, `selected_generation_id`                                        |

`status` is `draft|ready|generating|review|done`. Nullable fields
(`location_id`, `selected_generation_id`, `duration_seconds`) accept
`null` or an empty value: `--set location_id=null`. A non-null
`selected_generation_id` must be a generation that targets that exact row
(same check the UI makes) — pointing at another row's generation fails.
Prints the updated row.

### delete

```bash
node scripts/story.ts delete <table> <id> --project <dir>
```

Cascades: deleting a sequence removes its scenes/shots/frames/entities;
deleting a scene removes its shots and frames. `generations` rows can also
be deleted (selected references become NULL).

### list / show

```bash
node scripts/story.ts list sequences --project <dir>          # + sceneCount, shotCount
node scripts/story.ts list scenes  [--sequence <id>] --project <dir>
node scripts/story.ts list shots   [--sequence <id>] --project <dir>
node scripts/story.ts list entities [--sequence <id>] --project <dir>  # {characters, locations, elements}
node scripts/story.ts show sequence <id> --project <dir>      # full JSON tree
```

`show sequence` returns
`{ sequence, scenes: [{...scene, characterIds, elementIds, shots: [{...shot, frames: {start, end}}]}], characters, locations, elements, generations }`
— the same data the UI loads, but note the shape is CLI-specific: here each
shot's `frames` is an object keyed by role (`{start, end}`, either may be
`null`), whereas the UI's `getSequence` returns `frames` as an array of rows.
Code against the shape you actually read.

### import (batch — one transaction)

```bash
node scripts/story.ts import --file batch.json --project <dir>
```

Writes an entire breakdown atomically (all-or-nothing). Batch shape
(**strict** — unknown keys are rejected with a zod issue list):

```jsonc
{
  "sequence": {
    "id": "seq_x", // optional; if it already EXISTS, new scenes are APPENDED to it
    // (existing scene/shot ids in the batch are rejected — the whole
    // import is one transaction and rolls back on any collision)
    "title": "…", // required when creating
    "logline": "…",
    "script": "…", // or:
    "scriptFile": "script.md", // resolved relative to the batch file
  },
  "characters": [{ "id?": "", "name": "…", "description": "", "prompt": "", "notes": "" }],
  "locations": [/* same shape */],
  "elements": [/* same shape + "kind": "prop|vehicle|creature|effect|other" */],
  "scenes": [
    {
      "id?": "scn_01_x",
      "title": "…",
      "scriptExcerpt": "…",
      "synopsis": "…",
      "location": "Harbor Dock", // name or id; resolved case-insensitively, created if missing
      "status": "draft", // optional
      "notes": "",
      "characters": ["Mara"], // names, ids, or full entity objects
      "elements": ["Brass Pocket Watch"],
      "shots": [
        {
          "id?": "shot_01a",
          "prompt": "…", // video prompt
          "description": "…",
          "camera": "…",
          "duration": 5, // seconds (alias: durationSeconds)
          "status": "draft",
          "notes": "",
          "frames": {
            "start": "…", // string shorthand = prompt, or {id?, prompt, notes}
            "end": "…",
          },
        },
      ],
    },
  ],
}
```

Entity name references resolve case-insensitively within the sequence and
are auto-created when missing (name-only, empty prompt — top-level entity
entries with full prompts should come first so scene refs hit them). Output
is `{ "created": { sequence, scenes, shots, frames, characters, locations,
elements, links }, ...full tree }` — check the counts.

## Worked example: 2-scene script → populated board

Project folder `myproj/` contains `script.md`:

```markdown
# THE LAST FERRY — 30-second teaser

## SCENE 1 — HARBOR DOCK, DUSK

Mara runs down the long wooden dock, boots hammering the wet planks.
The ferry horn sounds. She clutches a brass pocket watch on a chain.
The ferry is already pulling away from the pilings.

## SCENE 2 — FERRY DECK, NIGHT

Mara stands at the stern rail, soaked in spray, watching the dock
lights shrink. She opens the pocket watch: the hands are running
backwards. She smiles.
```

### Step 1 — write `myproj/batch.json`

Note how every frame prompt repeats Mara's full appearance ("early 30s,
short black hair, worn olive-green field jacket…") instead of saying "the
same woman" — image models have no memory between calls.

```json
{
  "sequence": {
    "id": "seq_last_ferry",
    "title": "The Last Ferry",
    "logline": "A woman races to catch a ferry that is already leaving — and finds time itself is on her side.",
    "scriptFile": "script.md"
  },
  "characters": [
    {
      "id": "chr_mara",
      "name": "Mara",
      "description": "Early-30s courier; determined, quietly amused by the impossible.",
      "prompt": "A woman in her early 30s with short black hair and sharp features, wearing a worn olive-green field jacket over a grey sweater, dark jeans, and scuffed leather boots, an antique brass pocket watch on a chain around her neck, cinematic film still, natural light"
    }
  ],
  "locations": [
    {
      "id": "loc_harbor_dock",
      "name": "Harbor Dock",
      "description": "A weathered wooden ferry dock at the edge of a small harbor town.",
      "prompt": "A long weathered wooden ferry dock at dusk, wet planks reflecting an orange sky, iron cleats and coiled ropes, small harbor-town lights in the background, cinematic wide shot"
    },
    {
      "id": "loc_ferry_deck",
      "name": "Ferry Deck",
      "description": "The open stern deck of an old car ferry.",
      "prompt": "The open stern deck of an old steel car ferry at night, white railings flaked with rust, deck lit by sodium lamps, dark churning wake behind, sea spray in the air, cinematic film still"
    }
  ],
  "elements": [
    {
      "id": "elm_pocket_watch",
      "name": "Brass Pocket Watch",
      "kind": "prop",
      "description": "An antique brass pocket watch whose hands run backwards.",
      "prompt": "An antique brass pocket watch on a chain, engraved case worn smooth, cream dial with black Roman numerals, macro product photo, warm directional light, shallow depth of field"
    }
  ],
  "scenes": [
    {
      "id": "scn_01_dock_at_dusk",
      "title": "Dock at Dusk",
      "location": "Harbor Dock",
      "characters": ["Mara"],
      "elements": ["Brass Pocket Watch"],
      "scriptExcerpt": "SCENE 1 — HARBOR DOCK, DUSK\nMara runs down the long wooden dock, boots hammering the wet planks. The ferry horn sounds. She clutches a brass pocket watch on a chain. The ferry is already pulling away from the pilings.",
      "synopsis": "Mara sprints down the dock as the ferry pulls away without her.",
      "shots": [
        {
          "id": "shot_01a",
          "description": "Mara sprints down the dock toward the departing ferry.",
          "camera": "low-angle tracking shot, running alongside her",
          "duration": 5,
          "prompt": "A woman with short black hair in a worn olive-green field jacket sprints down a weathered wooden dock at dusk, boots pounding the wet planks, a car ferry pulling away from the pilings ahead of her, camera tracks low alongside her at running speed, orange dusk sky, spray kicking up, cinematic",
          "frames": {
            "start": "A woman in her early 30s with short black hair and sharp features, wearing a worn olive-green field jacket over a grey sweater, dark jeans, and scuffed leather boots, mid-stride at the near end of a long weathered wooden ferry dock at dusk, wet planks reflecting an orange sky, a car ferry still at the far pilings, low-angle cinematic film still",
            "end": "A woman in her early 30s with short black hair, wearing a worn olive-green field jacket over a grey sweater, dark jeans, and scuffed leather boots, at the far end of a weathered wooden dock at dusk, reaching toward a car ferry that has pulled several meters away from the pilings, churned water between dock and hull, orange dusk sky, low-angle cinematic film still"
          }
        },
        {
          "id": "shot_01b",
          "description": "Close on the pocket watch clutched in her fist as the ferry horn sounds.",
          "camera": "macro close-up, slight handheld shake",
          "duration": 3,
          "prompt": "Extreme close-up of a woman's fist clenching an antique brass pocket watch on a chain, knuckles white, slight handheld shake, warm dusk light, the blurred shape of a departing ferry in the background bokeh, cinematic",
          "frames": {
            "start": "Extreme close-up of a woman's fist clenching an antique brass pocket watch with an engraved case worn smooth, chain trailing between her fingers, warm orange dusk light, blurred wooden dock planks in the background, macro cinematic film still, shallow depth of field",
            "end": "Extreme close-up of a woman's hand opening around an antique brass pocket watch with a cream dial and black Roman numerals, warm orange dusk light, the blurred silhouette of a car ferry in the background bokeh, macro cinematic film still, shallow depth of field"
          }
        }
      ]
    },
    {
      "id": "scn_02_stern_rail",
      "title": "Stern Rail at Night",
      "location": "Ferry Deck",
      "characters": ["Mara"],
      "elements": ["Brass Pocket Watch"],
      "scriptExcerpt": "SCENE 2 — FERRY DECK, NIGHT\nMara stands at the stern rail, soaked in spray, watching the dock lights shrink. She opens the pocket watch: the hands are running backwards. She smiles.",
      "synopsis": "Aboard after all, Mara opens the watch and sees its hands running backwards.",
      "shots": [
        {
          "id": "shot_02a",
          "description": "Mara at the stern rail, dock lights shrinking behind the wake.",
          "camera": "slow push-in from behind, then drift to her profile",
          "duration": 5,
          "prompt": "A woman with short black hair in a worn olive-green field jacket stands at the stern rail of an old car ferry at night, soaked in sea spray, harbor lights shrinking beyond the churning wake, camera pushes in slowly from behind and drifts to her profile, sodium deck lamps, cinematic",
          "frames": {
            "start": "A woman in her early 30s with short black hair, wearing a worn olive-green field jacket over a grey sweater, seen from behind at the white rust-flaked stern rail of an old car ferry at night, harbor lights small beyond the dark churning wake, sodium deck lamps overhead, sea spray in the air, cinematic film still",
            "end": "Profile of a woman in her early 30s with short black hair and sharp features, wearing a worn olive-green field jacket, damp with sea spray, at the stern rail of an old car ferry at night, sodium lamp light on her face, dark ocean behind, cinematic film still"
          }
        },
        {
          "id": "shot_02b",
          "description": "She opens the watch; the hands run backwards; she smiles.",
          "camera": "insert close-up tilting up to her face",
          "duration": 4,
          "prompt": "Close-up of hands opening an antique brass pocket watch under sodium lamp light at night, the second hand visibly ticking backwards, camera tilts up to a woman's face with short black hair breaking into a knowing smile, sea spray, cinematic",
          "frames": {
            "start": "Close-up of a woman's hands opening an antique brass pocket watch with a cream dial and black Roman numerals, night scene lit by sodium deck lamps, rust-flaked white ferry railing behind, cinematic film still, shallow depth of field",
            "end": "A woman in her early 30s with short black hair and sharp features, wearing a worn olive-green field jacket, smiling faintly down at an open antique brass pocket watch in her hands, night, sodium deck-lamp glow, sea spray glittering, cinematic film still"
          }
        }
      ]
    }
  ]
}
```

### Step 2 — import (one call, one transaction)

```bash
node scripts/story.ts import --project myproj --file myproj/batch.json
```

Output starts with the counts (then the full tree):

```json
{
  "created": {
    "sequence": true, "scenes": 2, "shots": 4, "frames": 8,
    "characters": 1, "locations": 2, "elements": 1, "links": 4
  },
  "sequence": { "id": "seq_last_ferry", "title": "The Last Ferry", … }
}
```

Frames got ids `frm_01a_start`, `frm_01a_end`, `frm_01b_start`, … derived
from the shot ids.

### Step 3 — media population (genmedia → record-generation)

Order: entity references → frames → shots. See the `genmedia` skill for
model discovery, `--async` polling, and upload details.

```bash
# 3a. Character reference image (repeat for locations/elements that matter)
genmedia run fal-ai/flux/dev \
  --prompt "A woman in her early 30s with short black hair and sharp features, wearing a worn olive-green field jacket over a grey sweater, dark jeans, and scuffed leather boots, an antique brass pocket watch on a chain around her neck, cinematic film still, natural light" \
  --download "myproj/story-assets/chr_mara/{request_id}.{ext}" --json
# -> request_id req_img_001, saved myproj/story-assets/chr_mara/req_img_001.png

node scripts/story.ts record-generation --project myproj \
  --target-type character --target-id chr_mara \
  --kind image --path story-assets/chr_mara/req_img_001.png \
  --request-id req_img_001 --endpoint-id fal-ai/flux/dev \
  --params '{"prompt":"A woman in her early 30s with short black hair…","seed":42}' \
  --select
# -> { "generation": { "id": "gen_chr_mara", … }, "selected": true }

# 3b. Frame stills — condition on the character ref for consistency
REF=$(genmedia upload myproj/story-assets/chr_mara/req_img_001.png --json | jq -r '.cdn_url')
genmedia run fal-ai/nano-banana-pro/edit \
  --image_urls "$REF" \
  --prompt "<frm_01a_start prompt, verbatim from the DB>" \
  --download "myproj/story-assets/frm_01a_start/{request_id}.{ext}" --json

node scripts/story.ts record-generation --project myproj \
  --target-type frame --target-id frm_01a_start \
  --kind image --path story-assets/frm_01a_start/req_img_002.png \
  --request-id req_img_002 --endpoint-id fal-ai/nano-banana-pro/edit --select

# 3c. Shots — image-to-video from the selected start frame
START=$(genmedia upload myproj/story-assets/frm_01a_start/req_img_002.png --json | jq -r '.cdn_url')
SUBMIT=$(genmedia run <image-to-video endpoint> \
  --image_url "$START" \
  --prompt "<shot_01a prompt, verbatim from the DB>" \
  --async --json)
# poll with `genmedia status`, download into myproj/story-assets/shot_01a/, then:

node scripts/story.ts record-generation --project myproj \
  --target-type shot --target-id shot_01a \
  --kind video --path story-assets/shot_01a/req_vid_001.mp4 \
  --request-id req_vid_001 --endpoint-id <image-to-video endpoint> --select

node scripts/story.ts update shots shot_01a --project myproj --set status=review
```

### Step 4 — iterate & query

```bash
# Full tree (re-read before editing — the human may have changed things in the UI)
node scripts/story.ts show sequence seq_last_ferry --project myproj

# Revise a frame prompt (upsert), then regenerate just that frame
node scripts/story.ts set-frame --project myproj --shot shot_01b --role end \
  --prompt "REVISED: Extreme close-up of an open antique brass pocket watch, cream dial, hands at midnight, warm dusk light, macro cinematic film still"

# Tweak fields
node scripts/story.ts update scenes scn_01_dock_at_dusk --project myproj --set status=ready
node scripts/story.ts update shots shot_01a --project myproj --set notes="human liked take 1"

# Add things after the fact
node scripts/story.ts add-entity --project myproj --sequence seq_last_ferry \
  --type element --name "Ferry Horn" --kind other --description "The mournful ferry horn"
node scripts/story.ts link --project myproj --scene scn_01_dock_at_dusk --element elm_ferry_horn
node scripts/story.ts add-scene --project myproj --sequence seq_last_ferry \
  --title "Epilogue" --synopsis "The dock, empty at dawn." --location loc_harbor_dock

# Flat listings
node scripts/story.ts list sequences --project myproj
node scripts/story.ts list entities --project myproj --sequence seq_last_ferry

# Raw read-only SQL (never write SQL — CLI only)
sqlite3 -json myproj/story.db \
  "SELECT id, status FROM shots ORDER BY id"
```

## Prompt-writing guidance

- **Shot `prompt` = video.** Describe motion, action, and camera over time:
  who moves where, what the camera does ("tracks low alongside her",
  "pushes in slowly"), atmosphere. Duration-appropriate: one clear action
  beat per shot.
- **Frame `prompt` = self-contained still.** It must stand alone as a
  text-to-image prompt. Bake in the entity's appearance text verbatim
  (copy from the entity's `prompt`); never "the same character as before",
  "him", or "the watch from shot 1" — the model has no context. Describe
  composition, lighting, and style ("low-angle cinematic film still").
- **Entity `prompt` = reference image.** Physical description an image
  model can render directly: age, build, hair, wardrobe, materials, era,
  lighting, style. Keep the wording stable — you will paste it into every
  frame prompt that features the entity.
- Start/end frames of one shot should differ only by what changes during
  the shot (pose, position, light), keeping everything else worded
  identically — that is what makes image-to-video interpolation coherent.

## Schema

Introspect the live schema with `sqlite3 <projectDir>/story.db .schema`;
the canonical DDL is `src/db/schema.sql` in the genmedia-ui repo (which
mirrors `SCHEMA_SQL` in `src/db/ddl.ts`).
Highlights: `frames` is `UNIQUE(shot_id, role)`; deletes cascade down
the tree; `generations` is polymorphic on `(target_type, target_id)`;
every mutation bumps the owning row's and the ancestor sequence's
`updated_at` (the UI's change signal).
