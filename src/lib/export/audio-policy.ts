// Pure audio-policy decision, split out from concat.ts so it's unit-testable in
// jsdom without importing mediabunny/WebCodecs.
//
// USER DECISION (locked): the exported mp4 must handle audio. Takes that carry
// audio keep it; silent takes are silence-padded to their video duration so A/V
// stays in sync across the whole concat. Therefore:
//   - if NO clip has an audio track  -> 'none' (video-only output, no audio track)
//   - if ANY clip has an audio track -> 'mux'  (one continuous audio track; clips
//     without audio contribute silence for their duration)
//
// This is orthogonal to the video strategy (transmux vs transcode). See the
// policy matrix in concat.ts: a uniform-video *transmux* still gets an audio
// track when any clip has audio — audio presence must not be dropped just
// because the video could be copied through losslessly.

export type AudioPolicy = 'none' | 'mux'

export function decideAudioPolicy(clips: { hasAudio: boolean }[]): AudioPolicy {
  return clips.some((clip) => clip.hasAudio) ? 'mux' : 'none'
}
