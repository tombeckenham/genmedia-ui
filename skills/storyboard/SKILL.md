---
name: storyboard
description: >
  Collaborate with the genmedia-ui storyboard board while generating media with
  the genmedia CLI. Use this whenever a project directory contains a
  storyboard.json, or the user asks to build/continue a storyboard, teaser, or
  multi-scene sequence, or says "check the board". Teaches the shared
  storyboard.json contract, the scene download convention, async job tracking,
  and the re-read-before-you-generate habit.
---

# storyboard workflow

`storyboard.json` (in the project dir) is the shared brain between you and the
genmedia-ui app. The **human drives the UI** (reordering scenes, starring takes,
writing notes, queuing requests); **you drive the CLI** (generating takes,
downloading them, recording them). You edit the same file, so treat it as
live shared state, never as something you own.

Load the `genmedia` skill for how to run models; this skill covers the board
contract, the collaboration loop, and getting the board in front of the human.

## Step zero: open the board and hand the human the link

The board is the Mission Control app (genmedia-ui). The loop only works if the
human can see it — so before you start generating, make sure the app is
running against **this** project and give the human a clickable link.

1. **Probe for a running board.** Mission Control answers
   `GET /api/health` with `{"app":"mission-control","projectDir":"…"}`:

   ```bash
   for port in 3000 3001 3002 3003; do
     curl -sf --max-time 1 "http://localhost:$port/api/health" && echo " ← port $port"
   done
   ```

   Use the server whose `projectDir` is this project's absolute path. A server
   whose `projectDir` differs is showing a different project — don't reuse it.

2. **Not running? Start it** from a genmedia-ui checkout (clone once if the
   human doesn't have one), in the background:

   ```bash
   git clone https://github.com/tombeckenham/genmedia-ui   # once
   cd genmedia-ui && bun install                            # once
   GENMEDIA_UI_PROJECT=/abs/path/to/project bun run dev     # keep running
   ```

   Vite prints the real URL (`Local: http://localhost:3000/` — it auto-picks
   the next free port if 3000 is busy); confirm with the health probe.

3. **Open it and show the link.** `open http://localhost:<port>/` (macOS;
   `xdg-open` on Linux), and **always print the URL in chat** so the human can
   click it — e.g. `Board: http://localhost:3000/`. Repeat the link whenever
   you tell them takes are ready to review.

## Two rules that never bend

1. **Re-read before every write.** The UI rewrites the whole file on any edit.
   Never patch a copy you read earlier — read the current file at the moment you
   write, mutate, and save in one step (the `jq … > tmp && mv` pattern below does
   exactly this).
2. **Write atomically.** Write a temp file in the same directory, then `mv` it
   over `storyboard.json`. A rename is atomic, so the UI never reads a
   half-written file. Never redirect straight into `storyboard.json`.

```bash
# Read-modify-write, atomic, re-reads current state. Bump updated_at every time.
NOW=$(( $(date +%s) * 1000 ))
jq --argjson now "$NOW" '<filter> | .updated_at = $now' storyboard.json > storyboard.json.tmp \
  && mv storyboard.json.tmp storyboard.json
```

If `storyboard.json` does not exist yet, create it with `emptyStoryboard` shape
(below) before the first write.

**Keep the read→write window tight.** There is no lock — writes are
last-writer-wins. If the UI saves between your read and your `mv`, one side's
change is lost. So always read and write in a _single_ `jq … > tmp && mv`
pipeline, and never do slow work (generating, downloading, polling) in between a
read and its write — read the board again immediately before each write.

## Schema (v1 — source of truth, mirror it exactly)

```jsonc
{
  "schema_version": 1, // literal 1; bump only on a breaking change
  "title": "Lighthouse Teaser",
  "updated_at": 1752800000000, // epoch ms; set on every write
  "scenes": [
    {
      "id": "scene-01", // stable slug; drives download paths (below)
      "title": "Drone approach",
      "prompt": "aerial drone shot of a lighthouse at dusk...",
      "status": "ready", // draft | queued | generating | ready | needs-review
      "notes": "more golden hour", // human → you. Direction. Honor it.
      "selected_take": "req_abc123", // request_id the human chose, or null
      "starred": ["req_abc123"], // request_ids the human liked
      "takes": [
        {
          "request_id": "req_abc123",
          "endpoint_id": "fal-ai/veo3",
          "path": "takes/scene-01/req_abc123.mp4", // PROJECT-RELATIVE
          "kind": "video", // image | video | audio | model | other
          "params": { "seed": 42 }, // OPTIONAL; your reproducibility metadata (UI ignores it)
        },
      ],
      "pending": [
        // async jobs in flight (you record these)
        { "request_id": "req_def456", "endpoint_id": "fal-ai/veo3" },
      ],
    },
  ],
  "requests": [
    // UI → you direction queue; drain + remove
    {
      "id": "r1",
      "type": "regenerate",
      "scene_id": "scene-01",
      "note": "warmer",
      "created_at": 1752800000000,
    },
  ],
}
```

Field notes:

- `id` MUST be a lowercase slug matching `^[a-z0-9][a-z0-9_-]*$`. It is used raw
  in download paths, so a stray character could escape `takes/`. Use `scene-01`,
  `scene-02`, …
- `status` meanings: `draft` (no takes yet) · `queued` (async job submitted, not
  started) · `generating` (job running) · `needs-review` (takes landed, awaiting
  the human's pick) · `ready` (**human/UI only** — set when the human selects a
  take). **You never set `ready`.** When takes land you set `needs-review`; when
  you start regenerating a scene you may move it back to `generating`.
- `starred` is **human intent — never touch it.** `selected_take` is also human
  intent: never overwrite or clear a non-null value. One exception — if a scene
  has takes but `selected_take` is `null`, you MAY set an initial default (your
  best/first take) so the board isn't empty; the human's choice always wins
  afterward.
- Evolve additively; keep `schema_version: 1`.

## The habit loop (do this every time, before generating anything)

1. **Re-read the board.** `cat storyboard.json | jq .`
2. **Drain `requests[]`** (the UI direction queue). Handle each entry, then
   **remove it by `id`** so it is not reprocessed:
   - `type: "regenerate"` (`{scene_id, note}`) — fold `note` into that scene's
     direction, set the scene `generating`, regenerate it (see "Generating &
     attaching"), then remove the request.
   - **any other `type`** — act on `scene_id` + `note` best-effort, remove it
     once handled, and **never error** on an unrecognized type. The vocabulary
     grows additively; `regenerate` is the only type the UI emits today.

   Removing a handled request (`r1`):

   ```bash
   jq --argjson now "$(( $(date +%s) * 1000 ))" \
     '.requests |= map(select(.id != "r1")) | .updated_at = $now' \
     storyboard.json > storyboard.json.tmp && mv storyboard.json.tmp storyboard.json
   ```

3. **Read `notes` and takes as direction.** A scene's `notes` is explicit human
   feedback — fold it into the next prompt. A take that is in `takes[]` but is
   **not** `starred` and **not** `selected_take` after review is a soft reject:
   the human looked and didn't pick it, so change something (prompt, seed, model)
   rather than regenerating the same thing.
4. **Only touch scenes that ask for it.** Regenerate a scene only when its
   `status`/`notes` or a drained request calls for it. Leave `ready` scenes with
   a `selected_take` alone unless told otherwise. Never regenerate the whole
   board by default.

## Generating & attaching a take

Download convention (so the UI can auto-attach by scene): always download into
`takes/<scene-id>/` and record a **project-relative** path.

```bash
# Sync (fast) model — download straight into the scene folder:
genmedia run <endpoint_id> --prompt "…" --download "takes/scene-01/{request_id}.{ext}" --json
```

Then record the take on that scene and set it `needs-review` (re-read + atomic).
Remember: **you never set `ready`** — that is the human picking a take in the UI.

```bash
NOW=$(( $(date +%s) * 1000 ))
jq --argjson now "$NOW" \
  '(.scenes[] | select(.id == "scene-01")) |= (
      .takes += [{
        "request_id": "req_abc123",
        "endpoint_id": "fal-ai/veo3",
        "path": "takes/scene-01/req_abc123.mp4",
        "kind": "video"
      }]
      | .status = "needs-review"
   ) | .updated_at = $now' \
  storyboard.json > storyboard.json.tmp && mv storyboard.json.tmp storyboard.json
```

Use the `{request_id}` and `{ext}` placeholders so the on-disk filename matches
the `request_id` you record — that is how the UI and you stay in sync. Do not
invent your own filenames.

## Async jobs (slow video etc.) — track in `pending[]`

When you submit with `--async`, you get a `request_id` back immediately.
**Record it in the scene's `pending[]` right away** and set the scene `queued`
(it becomes `generating` once the job is actually running), so the UI can show a
spinner and poll status:

```bash
# 1. Submit
genmedia run <endpoint_id> --prompt "…" --async --json   # -> request_id, endpoint_id

# 2. Record pending immediately
NOW=$(( $(date +%s) * 1000 ))
jq --argjson now "$NOW" \
  '(.scenes[] | select(.id == "scene-01")) |= (
      .pending += [{ "request_id": "req_def456", "endpoint_id": "fal-ai/veo3" }]
      | .status = "queued"
   ) | .updated_at = $now' \
  storyboard.json > storyboard.json.tmp && mv storyboard.json.tmp storyboard.json
```

When the job finishes, download it into the scene folder, then in one write:
**move it from `pending[]` to `takes[]`** and set status. If `pending` is now
empty, the scene is done generating.

```bash
genmedia status <endpoint_id> req_def456 --download "takes/scene-01/{request_id}.{ext}" --json

NOW=$(( $(date +%s) * 1000 ))
jq --argjson now "$NOW" \
  '(.scenes[] | select(.id == "scene-01")) |= (
      .pending |= map(select(.request_id != "req_def456"))
      | .takes += [{ "request_id": "req_def456", "endpoint_id": "fal-ai/veo3", "path": "takes/scene-01/req_def456.mp4", "kind": "video" }]
      | .status = (if (.pending | length) == 0 then "needs-review" else "generating" end)
   ) | .updated_at = $now' \
  storyboard.json > storyboard.json.tmp && mv storyboard.json.tmp storyboard.json
```

Always drain `pending[]` as jobs complete — a lingering `pending` entry leaves
the UI spinning forever.

## Reproducibility caveat (the gallery does not have your params)

The genmedia gallery `data.json` does **not** store full run parameters — no
seed, no model params, `prompt` only when you passed `--prompt`, `modality`
often null for explicit endpoints. So **do not rely on the gallery to remember
how a take was made.** If a value matters for reproducing or iterating on a take
(seed, guidance scale, key params, the exact prompt), record it yourself in the
take entry. This is an additive, forward-compatible field:

```jsonc
{
  "request_id": "req_abc123",
  "endpoint_id": "fal-ai/veo3",
  "path": "takes/scene-01/req_abc123.mp4",
  "kind": "video",
  "params": { "seed": 42, "prompt": "aerial drone shot…", "guidance_scale": 7 }, // optional, your notes
}
```

`params` is optional metadata for **your** reproducibility — the UI does not read
or display it, but it is preserved across UI rewrites, so it is a safe place to
stash whatever you'll need later.

When the human asks for "the same but warmer", reuse the recorded `seed`/params
and change only what the note asks — otherwise you cannot reproduce the shot.

## Quick reference

| Situation                  | Do                                                                          |
| -------------------------- | --------------------------------------------------------------------------- |
| Before generating anything | re-read board, drain `requests[]`, read `notes`/rejected takes              |
| Any write                  | re-read + `jq … > tmp && mv`, bump `updated_at`                             |
| Downloaded a take          | append to `scenes[].takes[]` with project-relative path, set `needs-review` |
| Submitted `--async`        | append to `scenes[].pending[]`, set `queued`                                |
| Async job finished         | move `pending[]` → `takes[]`; `needs-review` if no pending left             |
| Handled a UI request       | act on it, then remove from `requests[]` by `id`                            |
| `starred`                  | never touch it                                                              |
| `selected_take`            | never overwrite non-null; may set a default only when it's `null`           |
| `ready` status             | never set it — that's the human picking in the UI                           |
| Need a param later         | store it in the take entry's `params`; the gallery won't have it            |
