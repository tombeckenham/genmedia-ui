# Companion skills

Skills that teach a Claude Code agent how to collaborate with genmedia-ui.

## `storyboard`

The contract for the shared `storyboard.json` — the file the app and the Claude
agent both read and write. It teaches the agent the schema, the
`takes/<scene-id>/` download convention, async job tracking via `pending[]`, the
UI→Claude direction queue (`requests[]`), and the habit of re-reading the board
before generating so it only regenerates the scenes you flagged. This is what
closes the loop: you star/note/queue in the UI, the agent drains it and
regenerates just those scenes.

It complements the `genmedia` skill that ships with the
[`genmedia` CLI](https://www.npmjs.com/package/@fal-ai/genmedia-cli) (which
covers running models); install both.

### Install

**Straight from GitHub (Claude Code plugin marketplace)** — this repo is a
plugin marketplace, so inside Claude Code:

```
/plugin marketplace add tombeckenham/genmedia-ui
/plugin install storyboard@genmedia-ui
```

**Or copy the folder** — user-level (all projects) or project-level (checked
into the repo you're generating in):

```bash
# User-level: available in every project
cp -r docs/skill/storyboard ~/.claude/skills/

# or project-level: scoped to one project
mkdir -p /path/to/your/project/.claude/skills
cp -r docs/skill/storyboard /path/to/your/project/.claude/skills/
```

**Other agents** — `SKILL.md` is an open format, so the same folder works
beyond Claude Code:

- **OpenAI Codex CLI**: copy into `~/.codex/skills/` (personal) or
  `.codex/skills/` (project).
- **xAI Grok Build**: copy into `~/.grok/skills/` or `.grok/skills/` — or do
  nothing: Grok reads Claude Code skill locations (and marketplaces) directly.

Then run Claude Code in the same directory you pointed `GENMEDIA_UI_PROJECT` at,
and it will pick up the `storyboard` skill when it sees a `storyboard.json` (or
when you ask it to build/continue a storyboard, or "check the board").

The skill is the human-readable mirror of the zod schema in
`src/lib/schemas/storyboard.ts` — keep the two in sync when the schema evolves
(additively; bump `schema_version` only on a breaking change).
