/*
 * Client-side video concatenation for the sequence export.
 *
 * Lifted from the mediabunny concat spike (transmux fast-path + transcode
 * fallback, both proven end-to-end in Chrome) and extended with an audio track.
 *
 * Video strategy (auto):
 *   - TRANSMUX (fast, lossless): every clip shares codec + decoder config +
 *     dimensions -> encoded packets are copied through with only timestamps
 *     offset. No decode/re-encode.
 *   - TRANSCODE (fallback): mixed clips -> every frame decoded and re-encoded to
 *     a uniform avc track, letterboxed into a common canvas.
 *
 * Audio policy (see audio-policy.ts and the matrix below): silent takes are
 * silence-padded to their video duration so the concatenated audio stays in
 * sync. Audio is orthogonal to the video strategy.
 *
 *   video uniform? | any clip has audio? | video path | audio track
 *   -------------- | ------------------- | ---------- | ------------------------
 *   yes            | no                  | transmux   | none
 *   yes            | yes                 | transmux   | mux (transcode + silence)
 *   no             | no                  | transcode  | none
 *   no             | yes                 | transcode  | mux (transcode + silence)
 *
 * The key point: a uniform-video transmux would otherwise DROP audio (the
 * transmux path only copies the video track). When any clip has audio we still
 * add a continuous audio track built from each clip's decoded audio (or silence
 * for silent clips), trimmed/padded to the clip's video duration.
 */

import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  EncodedPacketSink,
  EncodedVideoPacketSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  VideoSampleSink,
  VideoSampleSource,
  type AudioCodec,
  type EncodedPacket,
  type Quality,
  type Source,
  type VideoCodec,
} from 'mediabunny'
import { decideAudioPolicy } from './audio-policy'

export type ConcatStrategy = 'transmux' | 'transcode'

// One continuous audio track for the output. `buffers[i]` is the audio for clip
// i, already resampled and trimmed/padded to clip i's video duration (silence
// buffers for silent clips). Length must equal the clip count.
export interface AudioTrackInput {
  buffers: AudioBuffer[]
  codec?: AudioCodec
  bitrate?: number | Quality
}

export interface ConcatOptions {
  /** Force a strategy. Default: auto-detect (transmux when clips are uniform). */
  strategy?: ConcatStrategy
  /** Re-encode target codec (transcode path only). Default 'avc' (H.264). */
  codec?: VideoCodec
  /** Re-encode bitrate/quality (transcode path only). Default QUALITY_HIGH. */
  quality?: number | Quality
  /** Re-encode output dimensions (transcode path only). Default: first clip's. */
  width?: number
  height?: number
  /** Optional continuous audio track (see the audio policy above). */
  audioTrack?: AudioTrackInput
  /** Progress callback (0..1) over the video pass, fired per clip. */
  onProgress?: (fraction: number, clipIndex: number) => void
}

export interface ConcatResult {
  buffer: Uint8Array<ArrayBuffer>
  strategy: ConcatStrategy
  /** Total duration of the concatenated output, in seconds. */
  duration: number
  mimeType: string
}

interface ClipInfo {
  input: Input
  codec: VideoCodec
  duration: number
  width: number
  height: number
  /** JSON fingerprint of the decoder config, used for the uniformity check. */
  configKey: string
}

async function describeClip(input: Input): Promise<ClipInfo> {
  const track = await input.getPrimaryVideoTrack()
  if (track === null) throw new Error('Input has no video track')

  const codec = track.codec
  if (codec === null) throw new Error('Input video track has an unknown codec')

  const [duration, width, height, config] = await Promise.all([
    track.computeDuration(),
    track.getDisplayWidth(),
    track.getDisplayHeight(),
    track.getDecoderConfig(),
  ])

  const description =
    config?.description === undefined ? '' : bytesToHex(toUint8(config.description))
  const configKey = JSON.stringify({
    codec,
    codedWidth: config?.codedWidth ?? width,
    codedHeight: config?.codedHeight ?? height,
    description,
  })

  return { input, codec, duration, width, height, configKey }
}

function toUint8(data: AllowSharedBufferSource): Uint8Array {
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return new Uint8Array(data)
}

function bytesToHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

function createTranscodeSource(options: ConcatOptions, first: ClipInfo): VideoSampleSource {
  const hasExplicitTarget = options.width !== undefined || options.height !== undefined

  // mediabunny's per-sample size guard runs on the RAW input frame, so
  // mixed-resolution inputs need sizeChangeBehavior != 'deny'. Without an
  // explicit target we 'contain'-letterbox into clip 0's box; with one we
  // 'passThrough' the guard and scale every frame into the fixed target box.
  if (hasExplicitTarget) {
    return new VideoSampleSource({
      codec: options.codec ?? 'avc',
      bitrate: options.quality ?? QUALITY_HIGH,
      sizeChangeBehavior: 'passThrough',
      transform: {
        width: options.width ?? first.width,
        height: options.height ?? first.height,
        fit: 'contain',
      },
    })
  }
  return new VideoSampleSource({
    codec: options.codec ?? 'avc',
    bitrate: options.quality ?? QUALITY_HIGH,
    sizeChangeBehavior: 'contain',
  })
}

function setupAudioTrack(
  output: Output,
  audioTrack: AudioTrackInput | undefined,
  clipCount: number,
): AudioBufferSource | null {
  if (audioTrack === undefined || audioTrack.buffers.length !== clipCount) return null
  const source = new AudioBufferSource({
    codec: audioTrack.codec ?? 'aac',
    bitrate: audioTrack.bitrate ?? QUALITY_HIGH,
  })
  output.addAudioTrack(source)
  return source
}

async function feedAudioTrack(
  source: AudioBufferSource | null,
  audioTrack: AudioTrackInput | undefined,
): Promise<void> {
  if (source === null || audioTrack === undefined) return
  // AudioBufferSource auto-timestamps: each buffer starts where the previous
  // ended, so silence-padded per-clip buffers concatenate seamlessly.
  for (const buffer of audioTrack.buffers) {
    await source.add(buffer)
  }
}

/**
 * Core concatenation. Accepts mediabunny {@link Input}s so it is agnostic to how
 * the bytes were sourced (BlobSource in the browser, FilePathSource in Node).
 */
export async function concatVideos(
  inputs: Input[],
  options: ConcatOptions = {},
): Promise<ConcatResult> {
  if (inputs.length === 0) throw new Error('concatVideos: no inputs')

  const clips = await Promise.all(inputs.map(describeClip))
  const first = clips[0]
  if (first === undefined) throw new Error('concatVideos: no clips')

  const uniform = clips.every((clip) => clip.configKey === first.configKey)
  const strategy: ConcatStrategy = options.strategy ?? (uniform ? 'transmux' : 'transcode')

  const output = new Output({
    // 'in-memory' fastStart puts the moov atom at the front so the Blob is
    // seekable/streamable immediately (matters for <video> playback + download).
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget(),
  })

  let totalDuration: number
  if (strategy === 'transmux') {
    const videoSource = new EncodedVideoPacketSource(first.codec)
    output.addVideoTrack(videoSource)
    const audioSource = setupAudioTrack(output, options.audioTrack, clips.length)
    await output.start()
    totalDuration = await feedTransmux(videoSource, clips, options)
    await feedAudioTrack(audioSource, options.audioTrack)
  } else {
    const videoSource = createTranscodeSource(options, first)
    output.addVideoTrack(videoSource)
    const audioSource = setupAudioTrack(output, options.audioTrack, clips.length)
    await output.start()
    totalDuration = await feedTranscode(videoSource, clips, options)
    await feedAudioTrack(audioSource, options.audioTrack)
  }

  await output.finalize()

  const buffer = output.target.buffer
  if (buffer === null) throw new Error('Output produced no buffer')

  return {
    buffer: new Uint8Array(buffer),
    strategy,
    duration: totalDuration,
    mimeType: output.format.mimeType,
  }
}

async function feedTransmux(
  source: EncodedVideoPacketSource,
  clips: ClipInfo[],
  options: ConcatOptions,
): Promise<number> {
  let offset = 0
  let sequence = 0
  let firstPacketAdded = false

  for (const [index, clip] of clips.entries()) {
    const track = await clip.input.getPrimaryVideoTrack()
    if (track === null) throw new Error('Input has no video track')
    const sink = new EncodedPacketSink(track)

    // First packet of the whole output must carry the decoder config as meta.
    let meta: EncodedVideoChunkMetadata | undefined
    if (!firstPacketAdded) {
      const config = await track.getDecoderConfig()
      meta = config === null ? undefined : { decoderConfig: config }
    }

    for await (const packet of sink.packets()) {
      const shifted: EncodedPacket = packet.clone({
        timestamp: packet.timestamp + offset,
        sequenceNumber: sequence++,
      })
      await source.add(shifted, firstPacketAdded ? undefined : meta)
      firstPacketAdded = true
    }

    offset += clip.duration
    options.onProgress?.((index + 1) / clips.length, index)
  }

  return offset
}

async function feedTranscode(
  source: VideoSampleSource,
  clips: ClipInfo[],
  options: ConcatOptions,
): Promise<number> {
  let offset = 0

  for (const [index, clip] of clips.entries()) {
    const track = await clip.input.getPrimaryVideoTrack()
    if (track === null) throw new Error('Input has no video track')
    if (!(await track.canDecode()))
      throw new Error(`Clip ${index} cannot be decoded in this environment`)

    const sink = new VideoSampleSink(track)
    for await (const sample of sink.samples()) {
      sample.setTimestamp(sample.timestamp + offset)
      await source.add(sample)
      sample.close()
    }

    offset += clip.duration
    options.onProgress?.((index + 1) / clips.length, index)
  }

  return offset
}

// ---------------------------------------------------------------------------
// Browser convenience wrappers (the export UI calls concatTakes).
// ---------------------------------------------------------------------------

const AUDIO_RATE = 48_000
const AUDIO_CHANNELS = 2

interface TakeClip {
  blob: Blob
  input: Input
  hasAudio: boolean
  duration: number
}

async function probeTake(blob: Blob): Promise<TakeClip> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS })
  const [audioTrack, videoTrack] = await Promise.all([
    input.getPrimaryAudioTrack(),
    input.getPrimaryVideoTrack(),
  ])
  const duration = videoTrack === null ? 0 : await videoTrack.computeDuration()
  return { blob, input, hasAudio: audioTrack !== null, duration }
}

// Decode each clip's audio (resampled to a canonical rate/channel layout by the
// OfflineAudioContext), trimmed/padded to the clip's VIDEO duration so audio and
// video stay locked. Silent clips get a silence buffer of the same length.
async function buildAudioBuffers(clips: TakeClip[]): Promise<AudioBuffer[]> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: AUDIO_CHANNELS,
    length: 1,
    sampleRate: AUDIO_RATE,
  })
  const buffers: AudioBuffer[] = []

  for (const clip of clips) {
    const frames = Math.max(1, Math.round(clip.duration * AUDIO_RATE))
    const slot = ctx.createBuffer(AUDIO_CHANNELS, frames, AUDIO_RATE)

    if (clip.hasAudio) {
      try {
        const decoded = await ctx.decodeAudioData(await clip.blob.arrayBuffer())
        for (let channel = 0; channel < AUDIO_CHANNELS; channel++) {
          const sourceChannel = Math.min(channel, decoded.numberOfChannels - 1)
          const src = decoded.getChannelData(sourceChannel)
          const dst = slot.getChannelData(channel)
          dst.set(src.subarray(0, Math.min(dst.length, src.length)))
        }
      } catch {
        // Undecodable audio -> leave this clip silent rather than fail the export.
      }
    }

    buffers.push(slot)
  }

  return buffers
}

/** Concatenate a list of Blobs (fetched take mp4s) into one mp4 Blob. */
export async function concatTakes(blobs: Blob[], options: ConcatOptions = {}): Promise<Blob> {
  if (blobs.length === 0) throw new Error('concatTakes: no takes')

  const clips = await Promise.all(blobs.map(probeTake))
  const policy = decideAudioPolicy(clips)

  const audioTrack: AudioTrackInput | undefined =
    policy === 'mux' ? { buffers: await buildAudioBuffers(clips) } : undefined

  const result = await concatVideos(
    clips.map((clip) => clip.input),
    { ...options, audioTrack },
  )
  return new Blob([result.buffer], { type: result.mimeType })
}

/** Build an Input from any mediabunny Source (used by non-browser callers). */
export function inputFromSource(source: Source): Input {
  return new Input({ source, formats: ALL_FORMATS })
}
