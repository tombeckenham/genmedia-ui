# Mission Control — 3-minute demo script

**The story you're telling:** "I'm directing a film. Claude is my generation crew.
Mission Control is the shared set where we both work — I never touch a model, I
just direct." The project is the **Lighthouse Teaser** in [`demo/`](../demo): 3
scenes, multiple takes each, already on the board — two of them showing a
`needs-review` beacon because Claude just delivered new takes.

**One-line setup before you talk:** dev server running against `demo/`, browser
full-screen on the board, a Claude Code terminal open in the `demo/` directory.
(Full checklist at the bottom — run it 10 minutes before you're on.)

---

## The four beats (target ~3:00)

### Beat 1 — "This is the set" (0:00 – 0:30)

- **Show:** the board, already populated — "Drone approach", "Waves at the rocks",
  "The keeper". Two cards glow purple with a **Needs review** badge.
- **Say:** "This is a teaser for a lighthouse film. I described three shots to
  Claude; it generated them with fal.ai models through the genmedia CLI.
  Everything here is driven by two files on disk — no database. Those purple
  badges mean Claude just delivered fresh takes and it's my turn to pick."
- **Do:** point at scene 1's note ("More golden hour warmth, slower push-in") —
  "That's a note I left for Claude, right on the card."

### Beat 2 — "I ask, it generates, live" (0:30 – 1:15) ⭐ WOW #1

- **Do:** on a scene, type a note and click the **Regenerate** button (the ⟳ next
  to the status). The card immediately shows **"Queued for Claude"**.
- **Say:** "I just queued direction for Claude — no terminal, no model picker."
- **Do:** in the Claude terminal: _"Check the board and act on my notes."_
- **Watch:** Claude re-reads the board, drains the request, regenerates **only**
  that scene, and a new take appears in the **Runs feed the moment it finishes** —
  no refresh. The card's "Queued" hint clears and it flips to Needs review. ⭐
  _This is the live payoff; let it land._
- **Talking point:** "Scene 1 already has a third take that came through exactly
  this loop earlier — I clicked Regenerate, Claude picked it up off the board and
  made it. It's baked into the demo now."

> If the fal API is slow or you're offline, **skip the live regenerate** — the
> board already has loop-generated takes committed in `demo/`. Click Regenerate to
> show the "Queued for Claude" hint (that's local and always works), say "Claude
> drains this and regenerates just that scene", and move on. (See Fallbacks.)

### Beat 3 — "I pick the take" (1:15 – 2:10) ⭐ WOW #2 (the flipper)

- **Do:** click scene 1's thumbnail → full-screen flipper opens (it has **3
  takes**).
- **Do:** press `→` `←` a few times — "Flipping is instant; the neighbours are
  already loaded." Press `c` — "Compare two takes side by side, playback synced."
  Press `esc` to leave compare.
- **Do:** on the take you like, press `space` (star) then `enter` (select).
  "Selecting marks the scene **ready** — that's my pick, and it's in the
  storyboard file, so Claude sees it too." Press `esc` → back on the board, the
  card now shows your chosen take.

### Beat 4 — "Assemble the cut and export" (2:10 – 3:00) ⭐ WOW #3

- **Do:** click **Play sequence** (top right) → `/sequence`. The selected take of
  every scene plays back to back as one movie, scrubber marking scene boundaries.
- **Say:** "This is the teaser — the takes I picked, in order, straight from the
  board."
- **Do:** click **Export**. "And this stitches them into one mp4, entirely in the
  browser — WebCodecs, no server, audio muxed in." The file downloads.
- **Close:** "That's the whole loop: I direct in Mission Control, Claude
  generates, we're always on the same board — and it ends as a real deliverable."

---

## Where the wow moments are

1. **Regenerate → live take in the feed** (Beat 2) — direction in the UI, a new
   generation streaming back with no refresh.
2. **Instant, keyboard-driven flipping + compare** (Beat 3) — feels like editing
   dailies, not clicking through a gallery.
3. **One-click client-side mp4 export** (Beat 4) — the picks become a real file on
   stage.

---

## Fallback plan (rehearse these too)

In priority order — the demo must survive a flaky network or stage laptop:

- **fal API slow/down during Beat 2:** the teaser (including loop-generated takes)
  is committed in `demo/`. Click Regenerate to show the "Queued for Claude" hint
  (fully local), narrate the drain, and skip the live wait. Beats 3–4 are 100%
  local and need no network.
- **A clip won't play/decode:** each scene folder has a `still.png`
  (`demo/takes/scene-0N/still.png`) poster to show the shot; the sequence player
  also skips a broken clip with a toast rather than hanging.
- **Export misbehaves on stage:** close on the **sequence player** instead (the
  cut plays back to back in the browser) — that's the deliberate export fallback.
  If even that stalls, close on the board with every scene's take selected.
- **Whole app misbehaves:** have a screen recording of a clean run queued.

---

## Pre-demo checklist (run ~10 min before)

**Environment**

- [ ] `genmedia` CLI works and is authenticated (`genmedia setup` done); a cheap
      test generation succeeds — confirms the fal key before you're on stage.
- [ ] Dev server points at the demo project:
      `GENMEDIA_UI_PROJECT=$(pwd)/demo bun run dev`. Note the URL it prints —
      it's `http://localhost:3000`, or the next free port (e.g. 3001) if 3000 is
      taken.
- [ ] Browser open **full-screen** on the board; zoom set for the room; TanStack
      devtools closed (bottom-right).

**State reset (so every rehearsal starts clean)**

- [ ] `storyboard.json` in its committed state: `git checkout demo/storyboard.json`
      (keeps the two Needs-review beacons and the loop-generated take).
- [ ] A warm genmedia **gallery session** so the Runs feed isn't empty (the feed
      reads `~/.genmedia/gallery`, not `demo/takes`). If empty, run one generation
      from `demo/` first, or point at a gallery that has the teaser session.
- [ ] Confirm the session shown in the picker (top right) is the one your Claude
      terminal will write to, if you're doing the live Beat 2.

**Windows/terminals**

- [ ] Terminal A: Claude Code, cwd = `demo/`, `storyboard` skill installed, ready
      to type the "check the board" ask.
- [ ] Terminal B: the dev server (leave running, don't show it).
- [ ] Browser: the board — the only thing the audience sees.

**Timing**

- [ ] Rehearsed to ~3:00 with the live Beat 2, and ~2:15 on the all-local
      fallback path.
