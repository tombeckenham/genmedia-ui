import { useEffect, useRef, useState } from 'react'
import { Textarea } from '#/components/ui/textarea'
import { cn } from '#/lib/utils'

const SAVE_DEBOUNCE_MS = 600

// Debounced inline editor used for prompts and notes across the story board.
// Same contract as the scene-card notes box: local draft state, adopt external
// edits (Claude rewriting a prompt) only while unfocused, debounce saves while
// typing, flush on blur AND on unmount so trailing keystrokes never vanish.
export function InlineText({
  value,
  onSave,
  placeholder,
  className,
  saveError = false,
  ariaLabel,
}: {
  value: string
  onSave: (next: string) => void
  placeholder?: string
  className?: string
  saveError?: boolean
  ariaLabel?: string
}) {
  const [draft, setDraft] = useState(value)
  const focusedRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!focusedRef.current) setDraft(value)
  }, [value])

  const saveRef = useRef<(next: string) => void>(() => undefined)
  saveRef.current = (next: string) => {
    if (next !== value) onSave(next)
  }

  const flushRef = useRef<(() => void) | null>(null)
  flushRef.current = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
      saveRef.current(draft)
    }
  }
  useEffect(() => {
    return () => {
      flushRef.current?.()
    }
  }, [])

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <Textarea
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className={cn('bg-zinc-900/60', className)}
        onFocus={() => {
          focusedRef.current = true
        }}
        onChange={(event) => {
          const next = event.target.value
          setDraft(next)
          if (timerRef.current !== null) clearTimeout(timerRef.current)
          timerRef.current = setTimeout(() => saveRef.current(next), SAVE_DEBOUNCE_MS)
        }}
        onBlur={() => {
          focusedRef.current = false
          if (timerRef.current !== null) clearTimeout(timerRef.current)
          timerRef.current = null
          saveRef.current(draft)
        }}
      />
      {saveError && (
        <span className="text-[11px] text-red-400">Not saved — edit again to retry.</span>
      )}
    </div>
  )
}
