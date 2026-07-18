import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Volume2, VolumeX, X } from 'lucide-react'
import { formatClock, locateTime, resolveSequence, totalDuration } from '#/lib/export/sequence'
import type { Storyboard } from '#/lib/schemas/storyboard'
import { cn } from '#/lib/utils'
import { ExportButton } from './export-button'

type Slot = 0 | 1

function prefixSum(values: number[], upto: number): number {
  let sum = 0
  for (let i = 0; i < upto && i < values.length; i++) sum += values[i] ?? 0
  return sum
}

// Measure each clip's duration up-front (metadata only) via throwaway <video>
// elements, so the scrubber has real scene boundaries before playback reaches
// each clip.
function useClipDurations(urls: string[]): number[] {
  // `urls` is referentially stable via useMemo in the caller, so it's a safe
  // effect dependency: it only changes when the resolved sequence changes.
  const [durations, setDurations] = useState<number[]>(() => urls.map(() => 0))

  useEffect(() => {
    setDurations(urls.map(() => 0))
    const videos = urls.map((url, index) => {
      const video = document.createElement('video')
      video.preload = 'metadata'
      video.src = url
      const onMeta = () => {
        setDurations((prev) => {
          const next = [...prev]
          next[index] = Number.isFinite(video.duration) ? video.duration : 0
          return next
        })
      }
      video.addEventListener('loadedmetadata', onMeta)
      return video
    })
    return () => {
      for (const video of videos) {
        video.removeAttribute('src')
        video.load()
      }
    }
  }, [urls])

  return durations
}

export function SequencePlayer({ storyboard }: { storyboard: Storyboard | null }) {
  const navigate = useNavigate()
  const items = useMemo(() => resolveSequence(storyboard), [storyboard])
  const urls = useMemo(() => items.map((item) => item.url), [items])
  const durations = useClipDurations(urls)

  const [currentIndex, setCurrentIndex] = useState(0)
  const [activeSlot, setActiveSlot] = useState<Slot>(0)
  const [playing, setPlaying] = useState(true)
  const [muted, setMuted] = useState(true)
  const [clipTime, setClipTime] = useState(0)

  const videoRef0 = useRef<HTMLVideoElement>(null)
  const videoRef1 = useRef<HTMLVideoElement>(null)
  const refForSlot = useCallback((slot: Slot) => (slot === 0 ? videoRef0 : videoRef1), [])
  // Offset (seconds) to apply to the active clip once it's ready — set on seek.
  const seekOffsetRef = useRef(0)

  const otherSlot: Slot = activeSlot === 0 ? 1 : 0
  const total = totalDuration(durations)
  const elapsed = prefixSum(durations, currentIndex) + clipTime
  const currentItem = items[currentIndex]

  const jumpTo = useCallback(
    (index: number, offset: number) => {
      if (items.length === 0) return
      const clamped = Math.max(0, Math.min(index, items.length - 1))
      seekOffsetRef.current = offset
      setClipTime(offset)
      setActiveSlot(0)
      setCurrentIndex(clamped)
    },
    [items.length],
  )

  const advance = useCallback(() => {
    if (currentIndex + 1 >= items.length) {
      setPlaying(false)
      return
    }
    seekOffsetRef.current = 0
    setClipTime(0)
    setActiveSlot((slot) => (slot === 0 ? 1 : 0))
    setCurrentIndex((index) => index + 1)
  }, [currentIndex, items.length])

  // Drive the active element: apply any pending seek, then play/pause. The
  // inactive element stays paused while it preloads the next clip.
  useEffect(() => {
    const active = refForSlot(activeSlot).current
    const inactive = refForSlot(otherSlot).current
    if (inactive !== null) inactive.pause()
    if (active === null) return undefined

    active.muted = muted
    const offset = seekOffsetRef.current
    seekOffsetRef.current = 0

    const apply = () => {
      if (offset > 0 && Math.abs(active.currentTime - offset) > 0.05) {
        active.currentTime = offset
      }
      if (playing) void active.play().catch(() => {})
      else active.pause()
    }

    if (active.readyState >= 1) {
      apply()
      return undefined
    }
    const onReady = () => {
      apply()
      active.removeEventListener('loadedmetadata', onReady)
    }
    active.addEventListener('loadedmetadata', onReady)
    return () => {
      active.removeEventListener('loadedmetadata', onReady)
    }
  }, [currentIndex, activeSlot, otherSlot, playing, muted, refForSlot])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return
      }
      switch (event.key) {
        case ' ':
          event.preventDefault()
          setPlaying((value) => !value)
          break
        case 'ArrowLeft':
          event.preventDefault()
          jumpTo(currentIndex - 1, 0)
          break
        case 'ArrowRight':
          event.preventDefault()
          jumpTo(currentIndex + 1, 0)
          break
        case 'm':
        case 'M':
          event.preventDefault()
          setMuted((value) => !value)
          break
        case 'Escape':
          event.preventDefault()
          void navigate({ to: '/' })
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
    }
  }, [currentIndex, jumpTo, navigate])

  const seekToClientX = (clientX: number, rect: DOMRect) => {
    if (total <= 0) return
    const ratio = Math.max(0, Math.min((clientX - rect.left) / rect.width, 1))
    const target = ratio * total
    const { index, offset } = locateTime(durations, target)
    jumpTo(index, offset)
  }

  if (items.length === 0) {
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black text-zinc-200">
        <p className="text-sm text-zinc-400">No scenes with takes to play yet.</p>
        <button
          type="button"
          onClick={() => {
            void navigate({ to: '/' })
          }}
          className="text-sm text-teal-400 hover:text-teal-300"
        >
          Back to the board
        </button>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black text-zinc-100">
      <header className="flex items-center justify-between gap-4 px-4 py-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{currentItem?.sceneTitle ?? '—'}</div>
          <div className="text-xs text-zinc-500">
            Scene {currentIndex + 1} / {items.length}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <ExportButton items={items} title={storyboard?.title ?? 'sequence'} />
          <button
            type="button"
            aria-label="Close (Esc)"
            onClick={() => {
              void navigate({ to: '/' })
            }}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
          >
            <X className="size-4" /> Esc
          </button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        {([0, 1] as const).map((slot) => {
          const index = slot === activeSlot ? currentIndex : currentIndex + 1
          const item = items[index]
          const isActive = slot === activeSlot
          return (
            <video
              key={slot}
              ref={refForSlot(slot)}
              src={item?.url}
              playsInline
              preload="auto"
              className={cn(
                'absolute inset-0 size-full object-contain transition-opacity duration-100',
                isActive ? 'opacity-100' : 'pointer-events-none opacity-0',
              )}
              onTimeUpdate={(event) => {
                if (isActive) setClipTime(event.currentTarget.currentTime)
              }}
              onEnded={() => {
                if (isActive) advance()
              }}
            />
          )
        })}
      </main>

      <div className="flex flex-col gap-2 px-4 py-3">
        <button
          type="button"
          aria-label="Seek"
          className="group relative h-2 w-full cursor-pointer rounded-full bg-zinc-800"
          onClick={(event) => {
            seekToClientX(event.clientX, event.currentTarget.getBoundingClientRect())
          }}
        >
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-teal-400"
            style={{ width: total > 0 ? `${(elapsed / total) * 100}%` : '0%' }}
          />
          {/* Scene boundary ticks */}
          {durations.map((_, index) => {
            if (index === 0 || total <= 0) return null
            const left = (prefixSum(durations, index) / total) * 100
            return (
              <span
                key={index}
                className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-zinc-950"
                style={{ left: `${left}%` }}
              />
            )
          })}
        </button>

        <div className="flex items-center gap-4 text-xs text-zinc-400">
          <button
            type="button"
            aria-label={playing ? 'Pause (space)' : 'Play (space)'}
            onClick={() => {
              setPlaying((value) => !value)
            }}
            className="flex items-center gap-1 text-zinc-200 hover:text-white"
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </button>
          <button
            type="button"
            aria-label={muted ? 'Unmute (m)' : 'Mute (m)'}
            onClick={() => {
              setMuted((value) => !value)
            }}
            className="flex items-center gap-1 hover:text-zinc-100"
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <span className="tabular-nums">
            {formatClock(elapsed)} / {formatClock(total)}
          </span>
          <span className="ml-auto text-[11px] text-zinc-600">
            space play/pause · ← → scene · m mute · esc back
          </span>
        </div>
      </div>
    </div>
  )
}
