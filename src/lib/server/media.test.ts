import { describe, expect, it } from 'vitest'
import { contentTypeFor, parseRange } from './media-helpers'

describe('contentTypeFor', () => {
  it('maps known media extensions', () => {
    expect(contentTypeFor('/a/b/clip.mp4')).toBe('video/mp4')
    expect(contentTypeFor('clip.webm')).toBe('video/webm')
    expect(contentTypeFor('clip.mov')).toBe('video/quicktime')
    expect(contentTypeFor('shot.png')).toBe('image/png')
    expect(contentTypeFor('shot.jpg')).toBe('image/jpeg')
    expect(contentTypeFor('shot.jpeg')).toBe('image/jpeg')
    expect(contentTypeFor('shot.webp')).toBe('image/webp')
    expect(contentTypeFor('shot.gif')).toBe('image/gif')
    expect(contentTypeFor('track.mp3')).toBe('audio/mpeg')
    expect(contentTypeFor('track.wav')).toBe('audio/wav')
    expect(contentTypeFor('track.m4a')).toBe('audio/mp4')
  })

  it('is case-insensitive on the extension', () => {
    expect(contentTypeFor('SHOT.PNG')).toBe('image/png')
    expect(contentTypeFor('CLIP.Mp4')).toBe('video/mp4')
  })

  it('falls back to octet-stream for unknown or missing extensions', () => {
    expect(contentTypeFor('data.bin')).toBe('application/octet-stream')
    expect(contentTypeFor('README')).toBe('application/octet-stream')
    expect(contentTypeFor('.hidden')).toBe('application/octet-stream')
  })
})

describe('parseRange', () => {
  it('parses a fully specified range', () => {
    expect(parseRange('bytes=0-99', 1000)).toEqual({ type: 'ok', start: 0, end: 99 })
    expect(parseRange('bytes=200-499', 1000)).toEqual({ type: 'ok', start: 200, end: 499 })
  })

  it('parses an open-ended range to the end of the file', () => {
    expect(parseRange('bytes=100-', 1000)).toEqual({ type: 'ok', start: 100, end: 999 })
  })

  it('parses a suffix range as the last N bytes', () => {
    expect(parseRange('bytes=-100', 1000)).toEqual({ type: 'ok', start: 900, end: 999 })
  })

  it('clamps an end that exceeds the file size', () => {
    expect(parseRange('bytes=0-99999', 1000)).toEqual({ type: 'ok', start: 0, end: 999 })
  })

  it('clamps a suffix larger than the file to the whole file', () => {
    expect(parseRange('bytes=-2000', 1000)).toEqual({ type: 'ok', start: 0, end: 999 })
  })

  it('tolerates surrounding whitespace', () => {
    expect(parseRange('  bytes=0-99  ', 1000)).toEqual({ type: 'ok', start: 0, end: 99 })
  })

  it('reports unsatisfiable ranges', () => {
    expect(parseRange('bytes=1000-', 1000)).toEqual({ type: 'unsatisfiable' })
    expect(parseRange('bytes=1500-1600', 1000)).toEqual({ type: 'unsatisfiable' })
    expect(parseRange('bytes=500-400', 1000)).toEqual({ type: 'unsatisfiable' })
    expect(parseRange('bytes=-0', 1000)).toEqual({ type: 'unsatisfiable' })
    expect(parseRange('bytes=0-', 0)).toEqual({ type: 'unsatisfiable' })
  })

  it('ignores malformed or unsupported headers', () => {
    expect(parseRange('bytes=abc', 1000)).toEqual({ type: 'ignore' })
    expect(parseRange('bytes=-', 1000)).toEqual({ type: 'ignore' })
    expect(parseRange('items=0-99', 1000)).toEqual({ type: 'ignore' })
    expect(parseRange('bytes=0-99,200-299', 1000)).toEqual({ type: 'ignore' })
    expect(parseRange('', 1000)).toEqual({ type: 'ignore' })
  })
})
