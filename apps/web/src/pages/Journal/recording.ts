/** Preferred first: what the server keeps as recorded (WebM, Ogg, MP4). */
const RECORDING_MIMES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']

/** The first type the browser can record, or '' to let it choose. */
export const pickRecordingMime = (isSupported: (mime: string) => boolean): string =>
  RECORDING_MIMES.find((mime) => isSupported(mime)) ?? ''

const EXTENSIONS: [string, string][] = [
  ['audio/webm', 'webm'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['audio/mpeg', 'mp3'],
  ['audio/wav', 'wav'],
]

export const recordingFileName = (mime: string, at: Date = new Date()): string => {
  const ext = EXTENSIONS.find(([prefix]) => mime.startsWith(prefix))?.[1] ?? 'webm'
  const stamp = at.toISOString().slice(0, 19).replaceAll(':', '-')
  return `recording-${stamp}.${ext}`
}

/** "0:07", "12:34", "1:02:03". */
export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

export const MICROPHONE_UNAVAILABLE = 'This browser cannot record sound here.'
export const MICROPHONE_REFUSED =
  'The microphone is not allowed for Aurboda. Allow it in the browser settings to record.'

/** One plain sentence for why recording could not start. */
export const recordingProblem = (error: unknown): string => {
  const name = typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') return MICROPHONE_REFUSED
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'No microphone was found.'
  return 'Recording could not start.'
}
