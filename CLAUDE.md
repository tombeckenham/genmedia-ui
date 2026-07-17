# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Bun is the package manager and script runner.

```bash
bun install            # install deps
bun run dev            # dev server on http://localhost:3000
bun run build          # production build (vite + nitro)
bun run typecheck      # tsc (no emit)
bun run lint           # oxlint --type-aware (via tsgolint)
bun run test           # vitest run (all tests)
bunx vitest run path/to/file.test.tsx        # single test file
bunx vitest run -t "test name"               # single test by name
bun run format         # oxfmt + oxlint --fix
bun run check          # oxfmt --check
bunx shadcn@latest add <component>           # add a shadcn/ui component
```

## TypeScript & lint strictness (non-negotiable)

This repo is deliberately strict. Do not weaken these settings; write code that passes them.

Linting is **oxlint** with type-aware rules (`oxlint-tsgolint`), configured in `.oxlintrc.json`; formatting is **oxfmt** (`.oxfmtrc.json`). There is no eslint or prettier — oxlint's type-aware mode runs on the native TS toolchain, which is what allows this repo to use TypeScript 7 (typescript-eslint could not).

- **No `any`** — explicit (`no-explicit-any`) or flowing through expressions (`no-unsafe-assignment/argument/call/member-access/return` are all errors). Type unknown data as `unknown` and narrow with checks or zod.
- **Casting is limited** — no `!` non-null assertions, no `as` on object literals, and redundant assertions are errors. Prefer narrowing; use `as` only when you genuinely know more than the compiler.
- `noUncheckedIndexedAccess` is on: indexing arrays/records yields `T | undefined` — handle it.
- `exactOptionalPropertyTypes` is intentionally **off** (it breaks prop spreading in Radix/shadcn components).
- `src/routeTree.gen.ts` is generated (excluded from lint and formatting) — never edit it by hand.

## Architecture

TanStack Start app (SSR, file-based routing) built with Vite 8 and served by Nitro.

- **Routing**: files in `src/routes/` generate `src/routeTree.gen.ts` (regenerate with `bun run generate-routes`; the vite dev server also regenerates it). `src/router.tsx` builds the router and wires TanStack Query SSR integration (`setupRouterSsrQueryIntegration`); the query client comes from `src/integrations/tanstack-query/root-provider.tsx`.
- **Vitest is decoupled from the app build**: `vitest.config.ts` is standalone (jsdom + react plugin only) and must not import `vite.config.ts` — loading the nitro/tanstack-start plugin stack hangs the test runner.
- **UI**: Tailwind CSS 4 (configured via `src/styles.css`, no tailwind config file) + shadcn/ui components in `src/components/ui/`. Icons from `lucide-react`. Path aliases `#/*` and `@/*` both map to `src/*`.
- **No database — the filesystem is the state layer.** This app is a companion UI for `@fal-ai/genmedia-cli` (source: `/Users/tom/code/fal-ai/genmedia-cli`). Generation history is owned by the CLI in `~/.genmedia/gallery/sessions/<session_id>/data.json` (schema: `SessionPayload` in the CLI's `src/lib/gallery-template.ts`) — treat it as read-only and re-read the whole file on change (it is rewritten, not appended). Project intent (scenes, selected takes, notes) lives in a `storyboard.json` shared with the Claude Code agent driving the CLI; write it atomically (temp file + rename). Do not introduce a database to mirror this state.
