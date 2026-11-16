import type { RefObject } from 'preact'

import { createPortal } from 'preact/compat'
import { useEffect, useRef, useState } from 'preact/hooks'

import { cameraErrorMessage, canScanBarcodes, createBarcodeReader } from '../utils/barcodeReader'
import { runScanLoop } from '../utils/barcodeScanLoop'
import './BarcodeScanner.css'

type ScannerStatus = { kind: 'starting' } | { kind: 'scanning' } | { kind: 'error'; message: string }

const statusText = (status: ScannerStatus): string => {
  if (status.kind === 'starting') return 'Starting the camera…'
  if (status.kind === 'scanning') return 'Hold the barcode inside the frame.'
  return status.message
}

const stopStream = (stream: MediaStream | null) => stream?.getTracks().forEach((track) => track.stop())

const startScanning = async (
  video: HTMLVideoElement,
  signal: AbortSignal,
  onStream: (stream: MediaStream) => void,
  onScanning: () => void,
  onCode: (barcode: string) => void,
) => {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: false,
    video: { facingMode: { ideal: 'environment' } },
  })
  onStream(stream)
  if (signal.aborted) return
  video.srcObject = stream
  await video.play().catch(() => undefined)
  const reader = await createBarcodeReader()
  if (signal.aborted) return
  onScanning()
  runScanLoop({ onCode, reader, signal, video })
}

interface BarcodeScannerProps {
  onCode: (barcode: string) => void
  onClose: () => void
  returnFocusRef?: RefObject<HTMLElement>
}

export function BarcodeScanner({ onCode, onClose, returnFocusRef }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const [status, setStatus] = useState<ScannerStatus>({ kind: 'starting' })
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const onCodeRef = useRef(onCode)
  onCodeRef.current = onCode

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCloseRef.current()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        closeRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    closeRef.current?.focus()
    const video = videoRef.current
    const controller = new AbortController()
    let stream: MediaStream | null = null
    const keepStream = (s: MediaStream) => {
      stream = s
      if (controller.signal.aborted) stopStream(s)
    }
    const handleCode = (barcode: string) => {
      stopStream(stream)
      onCodeRef.current(barcode)
      onCloseRef.current()
    }
    if (video) {
      startScanning(
        video,
        controller.signal,
        keepStream,
        () => setStatus({ kind: 'scanning' }),
        handleCode,
      ).catch((err: unknown) => {
        stopStream(stream)
        if (!controller.signal.aborted) setStatus({ kind: 'error', message: cameraErrorMessage(err) })
      })
    }
    const returnTo = returnFocusRef?.current
    return () => {
      controller.abort()
      stopStream(stream)
      if (video) video.srcObject = null
      returnTo?.focus()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return createPortal(
    <div class="barcode-scanner-backdrop">
      <div class="barcode-scanner" role="dialog" aria-modal="true" aria-labelledby="barcode-scanner-title">
        <h2 id="barcode-scanner-title">Scan a barcode</h2>
        <div class={`barcode-scanner-view ${status.kind === 'error' ? 'is-hidden' : ''}`}>
          <video ref={videoRef} autoplay muted playsInline />
          {status.kind !== 'error' && <div class="barcode-scanner-guide" aria-hidden="true" />}
        </div>
        <p class={`barcode-scanner-status ${status.kind === 'error' ? 'is-error' : ''}`} role="status">
          {statusText(status)}
        </p>
        <button ref={closeRef} type="button" class="btn-secondary barcode-scanner-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  )
}

const BarcodeIcon = () => (
  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
    <path
      fill="currentColor"
      d="M3 5h2v14H3zm3 0h1v14H6zm2 0h2v14H8zm3 0h1v14h-1zm2 0h3v14h-3zm4 0h1v14h-1zm2 0h2v14h-2z"
    />
  </svg>
)

interface ScanBarcodeButtonProps {
  onCode: (barcode: string) => void
  variant: 'text' | 'icon'
  class?: string
}

/** A Scan button that opens the camera scanner; renders nothing where the camera cannot be used. */
export function ScanBarcodeButton({ onCode, variant, ...rest }: ScanBarcodeButtonProps) {
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  if (!canScanBarcodes()) return null

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        class={rest.class}
        aria-label={variant === 'icon' ? 'Scan a barcode' : undefined}
        title="Scan a barcode with the camera"
        onClick={() => setOpen(true)}
      >
        {variant === 'icon' ? <BarcodeIcon /> : 'Scan'}
      </button>
      {open && <BarcodeScanner onCode={onCode} onClose={() => setOpen(false)} returnFocusRef={buttonRef} />}
    </>
  )
}
