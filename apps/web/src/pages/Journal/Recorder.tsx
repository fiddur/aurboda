import { useEffect, useRef, useState } from 'preact/hooks'

import {
  formatElapsed,
  MICROPHONE_UNAVAILABLE,
  pickRecordingMime,
  recordingFileName,
  recordingProblem,
} from './recording'

const canRecord = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.MediaRecorder !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function'

/** "Record", then elapsed time and "Stop"; the finished recording is handed to `onRecorded`. */
export const Recorder = ({
  onRecorded,
  disabled,
}: {
  onRecorded: (blob: Blob, fileName: string) => void
  disabled?: boolean
}) => {
  const [recording, setRecording] = useState(false)
  const [startedAt, setStartedAt] = useState(0)
  const [now, setNow] = useState(0)
  const [problem, setProblem] = useState<string | undefined>(undefined)
  const recorder = useRef<MediaRecorder | null>(null)
  const stream = useRef<MediaStream | null>(null)

  const release = () => {
    stream.current?.getTracks().forEach((track) => track.stop())
    stream.current = null
  }

  useEffect(() => {
    if (!recording) return
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [recording])

  useEffect(
    () => () => {
      if (recorder.current?.state === 'recording') recorder.current.stop()
      release()
    },
    [],
  )

  const start = async () => {
    setProblem(undefined)
    if (!canRecord()) return setProblem(MICROPHONE_UNAVAILABLE)
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = media
      const mime = pickRecordingMime((type) => MediaRecorder.isTypeSupported(type))
      const rec = mime ? new MediaRecorder(media, { mimeType: mime }) : new MediaRecorder(media)
      const chunks: Blob[] = []
      rec.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      rec.onstop = () => {
        release()
        setRecording(false)
        const type = rec.mimeType || mime || 'audio/webm'
        const blob = new Blob(chunks, { type })
        if (blob.size > 0) onRecorded(blob, recordingFileName(type))
      }
      recorder.current = rec
      rec.start(1000)
      const at = Date.now()
      setStartedAt(at)
      setNow(at)
      setRecording(true)
    } catch (error) {
      release()
      setProblem(recordingProblem(error))
    }
  }

  const stop = () => {
    if (recorder.current?.state === 'recording') recorder.current.stop()
  }

  return (
    <div class="journal-recorder">
      {recording ? (
        <>
          <span class="journal-recording-dot" aria-hidden="true" />
          <span class="journal-recording-time" aria-live="polite">
            Recording {formatElapsed(now - startedAt)}
          </span>
          <button type="button" class="btn-secondary" onClick={stop}>
            Stop
          </button>
        </>
      ) : (
        <button type="button" class="btn-secondary" onClick={() => void start()} disabled={disabled}>
          🎙 Record
        </button>
      )}
      {problem && (
        <p class="journal-muted" role="status">
          {problem}
        </p>
      )}
    </div>
  )
}
