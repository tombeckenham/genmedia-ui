# genmedia-ui — Build Plan

72-hour fal hackathon. A local companion UI for `@fal-ai/genmedia-cli`: the human directs, Claude Code (with the genmedia skill) produces, and this app is the shared canvas between them.

**Core narrative:** not a video editor — a film production UI where the crew is an agent. The human never leaves the director's chair: watch generations stream in, flip versions, pick takes, leave notes; Claude reads the board and regenerates.

## Architecture (decided)

- **No database.** State is files:
  - `storyboard.json` (in the user's project dir) — intent: scenes, order, prompts, selected take per scene, stars, notes. Read/written by both this app and Claude. Always write atomically (temp file + rename).
  - `~/.genmedia/gallery/sessions/<session_id>/data.json` — generation history, owned by the CLI, **read-only** to us. Whole-file rewrites, so re-read on mtime change. Schema: `SessionPayload` in genmedia-cli `src/lib/gallery-template.ts`.
  - `~/.genmedia/gallery/last-session.json` — pointer to the active session.
- **TanStack Start server routes** are the bridge: read gallery manifests, serve local media files (browser can't fetch `file://`), chokidar + SSE for live updates, shell out to `genmedia ... --json` when the UI triggers CLI work.
- **Claude is the generator; the UI is review/direct.** The loop closes via a companion skill that teaches Claude the storyboard schema and the habit of re-reading the board before regenerating.
- Video stitching/export happens client-side with **mediabunny** (WebCodecs).

## Phases

### Phase 1 — Data layer & contracts

The foundation everything else sits on.

1. Zod schemas + TS types for `SessionPayload` / `RunRecord` / `GalleryFile` (mirroring the CLI) and for our own `storyboard.json` (draft below).
2. **Server functions** (`createServerFn`) for all data operations — typed end-to-end, used directly in loaders/TanStack Query:
   - `listSessions()` — gallery sessions (or shell out to `genmedia gallery list --json`).
   - `getSession(id)` — parsed `data.json`.
   - `getStoryboard()` / `updateStoryboard(patch)` — read/write storyboard.json (atomic write).
   - `getModelSchema(endpointId)`, `pollJob(...)` — CLI shell-outs.
3. **Server routes** only where the browser consumes a raw URL (these can't be server functions):
   - `GET /api/media?path=...` — stream a local media file with correct content-type + `Range` support (video elements need a URL and scrubbing needs range requests). Restrict to known roots (gallery dir + project dir).
   - `GET /api/events` — SSE for `EventSource`; chokidar on `sessions/*/data.json`, `last-session.json`, and the storyboard. Emit coarse "changed" events; client refetches via query invalidation.
4. Storyboard file location: project dir passed via env/CLI arg when launching the app (`GENMEDIA_UI_PROJECT=...` or `--project`), defaulting to cwd.

**Done when:** opening the app shows raw JSON of the active session and storyboard, and editing either file on disk updates the page without reload.

### Phase 2 — Live activity feed

The "mission control" feel; most demoable per unit effort.

1. Session picker (active session from `last-session.json` by default).
2. Reverse-chronological feed of runs: thumbnail, endpoint, prompt, duration, time. New runs animate in via SSE-triggered refetch.
3. In-flight async jobs: poll `genmedia status <endpoint> <request_id> --json` server-side for queued jobs Claude has started (requires Claude to note request_ids in the storyboard — see skill), show spinners.

**Done when:** running `genmedia run ...` in a terminal makes the result appear in the app within ~1s.

### Phase 3 — Storyboard board

1. Horizontal scene cards: selected take thumbnail (or placeholder), title, prompt excerpt, status chip (`draft / queued / generating / ready / needs-review`).
2. Drag to reorder scenes (persist to storyboard.json).
3. Attach generations to scenes: auto-match by `scene_id` convention (see skill), plus manual drag from activity feed onto a card.
4. Per-scene notes field ("more golden hour, slower push-in") — saved to the storyboard for Claude to read.

**Done when:** a storyboard Claude wrote renders as cards, reordering + notes round-trip through the file, and Claude can read the changes.

### Phase 4 — Version flipper

1. Click a scene → full-screen filmstrip of all its candidates (images and videos).
2. Keyboard: ←/→ flip, `space` star/select, `esc` back. Instant flipping is the point — preload neighbors.
3. Side-by-side compare mode (two candidates, synced playback for video).
4. Selection writes `selected_take` to the storyboard.

**Done when:** flipping 10 candidates feels instant and selection survives reload + is visible to Claude.

### Phase 5 — Sequence player & export

1. **Preview:** gapless playback of selected takes in scene order — two stacked `<video>` elements, preload next, swap on `ended`.
2. **Export:** mediabunny concat of selected takes → single mp4, client-side, download. Normalize resolution/fps at export time; re-encode when codecs mismatch.
3. Scrubber across the whole sequence with scene boundaries marked.

**Done when:** "Play" watches the whole cut with no visible seams; "Export" produces an mp4 that plays in QuickTime.

### Phase 6 — Close the loop with Claude

1. Companion skill (`docs/skill/` → installed as `storyboard` skill): teaches Claude the storyboard.json schema, the scene_id naming convention for `--download` paths, recording request_ids for async jobs, and the habit: _before generating, re-read the board; treat notes + rejected takes as direction._
2. "Direction queue": UI writes structured requests (`regenerate scene 2 with note X`) into `storyboard.json.requests[]`; skill tells Claude to drain them.
3. Stretch — schema-driven tweak forms: `genmedia schema <endpoint> --json` → auto-generated shadcn form → re-run via server shell-out.

**Done when:** the full demo loop runs: ask Claude for a 3-scene teaser → board fills → star/note in UI → tell Claude "check the board" → only rejected scenes regenerate → export mp4.

### Phase 7 — Polish & demo

- Empty states, dark mode pass, app name/logo.
- Seed project + rehearsed demo script (pre-generated fallback content in case of API slowness on stage).
- README rewrite: what it is, quickstart, architecture sketch.

## storyboard.json — draft schema (v1)

```jsonc
{
  "schema_version": 1,
  "title": "Lighthouse Teaser",
  "updated_at": 1752800000000,
  "scenes": [
    {
      "id": "scene-01", // used in --download paths: ./takes/scene-01/{request_id}.mp4
      "title": "Drone approach",
      "prompt": "aerial drone shot of a lighthouse at dusk...",
      "status": "ready", // draft | queued | generating | ready | needs-review
      "notes": "more golden hour", // human → Claude
      "selected_take": "req_abc123", // request_id of chosen candidate
      "starred": ["req_abc123"],
      "takes": [
        {
          "request_id": "req_abc123",
          "endpoint_id": "fal-ai/veo3",
          "path": "takes/scene-01/req_abc123.mp4",
          "kind": "video",
        },
      ],
      "pending": [
        // async jobs in flight (Claude records these)
        { "request_id": "req_def456", "endpoint_id": "fal-ai/veo3" },
      ],
    },
  ],
  "requests": [], // UI → Claude direction queue
}
```

Keep `schema_version` and evolve additively; both the UI (zod) and the skill reference this section as the source of truth.

## Priorities & cut lines

**Never cut:** live board (P2), version flipper with starring (P4), stitched preview (P5.1), notes-back-to-Claude (P3.4 + P6.1).

**Cut first if time bleeds:** per-clip trim/in-out points, audio track lane, fal Assets API (collections/characters), schema-driven forms (P6.3), compare mode (P4.3).

**Known risks:**

- mediabunny export with mixed codecs/resolutions → mitigate by re-encoding at export, and by having the preview player as the demo fallback.
- Gallery `data.json` lacks full run params (no seed/params, `modality` null for explicit endpoints, `prompt` only when `--prompt` used) → the skill must record anything we need beyond that into storyboard.json; don't assume the gallery has it.
- Session matching: gallery sessions key off the Claude Code conversation — a new conversation = new session. UI should merge takes by storyboard reference, not by session, so restarts don't orphan media.
