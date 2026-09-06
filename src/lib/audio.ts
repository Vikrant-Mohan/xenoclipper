/**
 * Audio extraction for Phase 2.
 *
 * Decodes the selected file's audio track with the browser's native decoders
 * (AAC, MP3, Opus, Vorbis, PCM — whatever the browser supports) and resamples
 * to 16 kHz mono float32 — the input format Whisper expects.
 *
 * Note: files whose audio codec the browser can't decode (e.g. AC-3 in some
 * MKVs) will fail here; the UI surfaces a clear message.
 */

export interface DecodedAudio {
  /** 16 kHz mono interleaved samples. */
  samples: Float32Array
  durationSec: number
}

export class AudioDecodeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AudioDecodeError'
  }
}

export async function decodeToWhisperInput(file: File): Promise<DecodedAudio> {
  const arrayBuffer = await file.arrayBuffer()

  // 1) Decode the file at its native sample rate (any channel count).
  //    Using an OfflineAudioContext keeps this entirely off the audio output.
  let decoded: AudioBuffer
  try {
    // OfflineAudioContext only exists to expose decodeAudioData here; the
    // decoded buffer is rendered at its native rate and released by GC.
    const decodeCtx = new OfflineAudioContext(1, 1, 44100)
    decoded = await decodeCtx.decodeAudioData(arrayBuffer)
  } catch (err) {
    throw new AudioDecodeError(
      `Your browser couldn't decode the audio track of this file ` +
        `(${err instanceof Error ? err.message : 'decode error'}). ` +
        'Common audio codecs (AAC, MP3, Opus, Vorbis, PCM) work; unusual ' +
        'containers may need re-encoding before transcription.',
    )
  }

  // 2) Resample + downmix to mono 16 kHz in a second offline render. This
  //    uses the browser's resampler rather than naive linear interpolation.
  const targetRate = 16000
  const length = Math.max(1, Math.ceil(decoded.duration * targetRate))
  const mixCtx = new OfflineAudioContext(1, length, targetRate)
  const source = mixCtx.createBufferSource()
  source.buffer = decoded
  source.connect(mixCtx.destination)
  source.start(0)

  let rendered: AudioBuffer
  try {
    rendered = await mixCtx.startRendering()
  } catch (err) {
    throw new AudioDecodeError(
      `Resampling audio failed: ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  return { samples: rendered.getChannelData(0), durationSec: decoded.duration }
}
