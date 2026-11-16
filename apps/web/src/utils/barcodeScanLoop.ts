import type { BarcodeReader } from './barcodeReader'

interface ScanLoopOptions {
  reader: BarcodeReader
  video: HTMLVideoElement
  onCode: (barcode: string) => void
  signal: AbortSignal
  intervalMs?: number
  schedule?: (fn: () => void, ms: number) => void
}

const defaultSchedule = (fn: () => void, ms: number) => {
  setTimeout(fn, ms)
}

/** Reads one frame at a time, the next one `intervalMs` after the last finished, until a code or the abort. */
export const runScanLoop = ({
  reader,
  video,
  onCode,
  signal,
  intervalMs = 150,
  schedule = defaultSchedule,
}: ScanLoopOptions): void => {
  const tick = async () => {
    if (signal.aborted) return
    const code = await reader.detect(video).catch(() => null)
    if (signal.aborted) return
    if (code) onCode(code)
    else schedule(() => void tick(), intervalMs)
  }
  schedule(() => void tick(), 0)
}
