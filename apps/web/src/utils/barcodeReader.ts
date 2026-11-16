import type * as Zxing from '@zxing/library'

import { barcodeFromText } from './barcode'

export interface BarcodeReader {
  detect: (video: HTMLVideoElement) => Promise<string | null>
}

interface NativeDetector {
  detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]>
}

export interface BarcodeDetectorClass {
  new (options: { formats: string[] }): NativeDetector
  getSupportedFormats: () => Promise<string[]>
}

export type ZxingModule = Pick<
  typeof Zxing,
  | 'BarcodeFormat'
  | 'BinaryBitmap'
  | 'DecodeHintType'
  | 'HybridBinarizer'
  | 'MultiFormatReader'
  | 'NotFoundException'
  | 'RGBLuminanceSource'
>

export interface Frame {
  data: Uint8ClampedArray
  width: number
  height: number
}

interface ReaderDeps {
  BarcodeDetector?: BarcodeDetectorClass
  loadZxing?: () => Promise<ZxingModule>
  grabFrame?: (video: HTMLVideoElement) => Frame | null
}

const PRODUCT_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']
const MAX_FRAME_SIDE = 1280

export const canScanBarcodes = (): boolean =>
  typeof window !== 'undefined' && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia

export const cameraErrorMessage = (err: unknown): string => {
  const name = err instanceof Error || err instanceof DOMException ? err.name : ''
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return "The camera is blocked for this site. Allow it in the browser's site settings, or type the barcode."
  }
  const noCamera = name === 'NotFoundError' || name === 'OverconstrainedError'
  if (noCamera) return 'No camera was found. Type the barcode instead.'
  return 'The camera could not be started. Type the barcode instead.'
}

export const downscaledSize = (width: number, height: number, maxSide: number) => {
  const scale = Math.min(1, maxSide / Math.max(width, height))
  return { height: Math.round(height * scale), width: Math.round(width * scale) }
}

export const toLuminance = ({ data, width, height }: Frame): Uint8ClampedArray => {
  const luminance = new Uint8ClampedArray(width * height)
  for (let i = 0; i < luminance.length; i++) {
    const o = i * 4
    luminance[i] = (data[o] + 2 * data[o + 1] + data[o + 2]) >> 2
  }
  return luminance
}

const grabCanvasFrame = (): ((video: HTMLVideoElement) => Frame | null) => {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return (video) => {
    if (!context || video.videoWidth === 0 || video.videoHeight === 0) return null
    const { width, height } = downscaledSize(video.videoWidth, video.videoHeight, MAX_FRAME_SIDE)
    canvas.width = width
    canvas.height = height
    context.drawImage(video, 0, 0, width, height)
    return context.getImageData(0, 0, width, height)
  }
}

const nativeReader = async (Detector: BarcodeDetectorClass): Promise<BarcodeReader | null> => {
  const supported = await Detector.getSupportedFormats().catch(() => [] as string[])
  if (!supported.includes('ean_13')) return null
  const detector = new Detector({ formats: PRODUCT_FORMATS.filter((f) => supported.includes(f)) })
  return {
    detect: async (video) => {
      const found = await detector.detect(video)
      for (const { rawValue } of found) {
        const barcode = barcodeFromText(rawValue)
        if (barcode) return barcode
      }
      return null
    },
  }
}

const zxingReader = (
  zxing: ZxingModule,
  grabFrame: (video: HTMLVideoElement) => Frame | null,
): BarcodeReader => {
  const { BarcodeFormat, DecodeHintType } = zxing
  const hints = new Map<Zxing.DecodeHintType, unknown>([
    [
      DecodeHintType.POSSIBLE_FORMATS,
      [BarcodeFormat.EAN_13, BarcodeFormat.EAN_8, BarcodeFormat.UPC_A, BarcodeFormat.UPC_E],
    ],
    [DecodeHintType.TRY_HARDER, true],
  ])
  const reader = new zxing.MultiFormatReader()
  reader.setHints(hints)
  return {
    detect: async (video) => {
      const frame = grabFrame(video)
      if (!frame) return null
      const source = new zxing.RGBLuminanceSource(toLuminance(frame), frame.width, frame.height)
      const bitmap = new zxing.BinaryBitmap(new zxing.HybridBinarizer(source))
      try {
        return barcodeFromText(reader.decodeWithState(bitmap).getText())
      } catch (err) {
        if (err instanceof zxing.NotFoundException) return null
        throw err
      }
    },
  }
}

const globalDetector = (): BarcodeDetectorClass | undefined =>
  (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector

export const createBarcodeReader = async ({
  BarcodeDetector = globalDetector(),
  loadZxing = () => import('@zxing/library'),
  grabFrame,
}: ReaderDeps = {}): Promise<BarcodeReader> => {
  const native = BarcodeDetector ? await nativeReader(BarcodeDetector) : null
  if (native) return native
  return zxingReader(await loadZxing(), grabFrame ?? grabCanvasFrame())
}
