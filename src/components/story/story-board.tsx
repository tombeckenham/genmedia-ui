import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ArrowLeft, ChevronDown, Clapperboard, ScrollText } from 'lucide-react'
import { EmptyState } from '#/components/ui/empty-state'
import { EntitySidebar } from '#/components/story/entity-sidebar'
import { GenerationsDialog } from '#/components/story/generations-dialog'
import { SceneSection } from '#/components/story/scene-section'
import {
  indexGenerations,
  type DetailTarget,
  type EntityHighlight,
} from '#/components/story/story-shape'
import { cn } from '#/lib/utils'
import type { SequenceTree } from '#/lib/server/story-queries'

export function StoryBoard({ tree }: { tree: SequenceTree }) {
  const [showScript, setShowScript] = useState(false)
  const [highlight, setHighlight] = useState<EntityHighlight | null>(null)
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null)

  const genIndex = useMemo(() => indexGenerations(tree.generations), [tree.generations])
  const shotCount = tree.scenes.reduce((sum, scene) => sum + scene.shots.length, 0)

  return (
    <div className="flex h-dvh flex-col bg-zinc-950 text-zinc-100">
      <header className="flex shrink-0 flex-wrap items-center gap-4 border-b border-zinc-800/80 px-6 py-3">
        <Link
          to="/story"
          aria-label="Back to the sequence library"
          className="flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-200"
        >
          <ArrowLeft className="size-4" />
        </Link>
        <div className="flex min-w-0 flex-1 items-baseline gap-3">
          <h1 className="truncate text-lg font-semibold tracking-tight">{tree.sequence.title}</h1>
          {tree.sequence.logline !== '' && (
            <p className="hidden truncate text-sm text-zinc-500 sm:block">
              {tree.sequence.logline}
            </p>
          )}
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span>
            {tree.scenes.length} scene{tree.scenes.length === 1 ? '' : 's'} · {shotCount} shot
            {shotCount === 1 ? '' : 's'}
          </span>
          {tree.sequence.script !== '' && (
            <button
              type="button"
              onClick={() => {
                setShowScript((prev) => !prev)
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md border border-zinc-800 px-3 py-1.5 text-sm font-medium transition-colors hover:bg-zinc-900',
                showScript ? 'text-teal-300' : 'text-zinc-300',
              )}
            >
              <ScrollText className="size-4" /> Script
              <ChevronDown
                className={cn('size-3 transition-transform', showScript && 'rotate-180')}
              />
            </button>
          )}
        </div>
      </header>

      {showScript && (
        <div className="shrink-0 border-b border-zinc-800/80 bg-zinc-900/30 px-6 py-4">
          <pre className="max-h-72 overflow-y-auto font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-400">
            {tree.sequence.script}
          </pre>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto">
          {tree.scenes.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={Clapperboard}
                title="No scenes yet"
                hint="Ask Claude to storyboard the script — it splits it into scenes, extracts characters and locations, and writes shot lists into this board."
              />
            </div>
          ) : (
            <div className="flex flex-col gap-4 p-6">
              {tree.scenes.map((scene, index) => (
                <SceneSection
                  key={scene.id}
                  scene={scene}
                  index={index}
                  tree={tree}
                  genIndex={genIndex}
                  highlight={highlight}
                  onOpenDetail={setDetailTarget}
                />
              ))}
            </div>
          )}
        </main>

        <aside className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-zinc-800/80 p-4 xl:w-96">
          <EntitySidebar
            tree={tree}
            genIndex={genIndex}
            highlight={highlight}
            onHighlight={setHighlight}
            onOpenDetail={setDetailTarget}
          />
        </aside>
      </div>

      <GenerationsDialog
        tree={tree}
        target={detailTarget}
        genIndex={genIndex}
        onClose={() => {
          setDetailTarget(null)
        }}
      />
    </div>
  )
}
