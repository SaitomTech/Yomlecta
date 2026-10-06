import { expect, test } from 'bun:test'
import { getSegmentPlaybackRange } from '../src/lib/media/segmentPlayback'

test('reference article playback adds the trim start to both segment boundaries', () => {
  expect(getSegmentPlaybackRange({ startMs: 12_500, endMs: 24_000 }, 90_000)).toEqual({
    startTime: 102.5,
    endTime: 114,
  })
})

test('full videos and prepared article inputs keep their segment times', () => {
  expect(getSegmentPlaybackRange({ startMs: 12_500, endMs: 24_000 }, 0)).toEqual({
    startTime: 12.5,
    endTime: 24,
  })
})
