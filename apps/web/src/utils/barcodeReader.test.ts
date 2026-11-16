import { describe, expect, test, vi } from 'vitest'

import {
  type BarcodeDetectorClass,
  cameraErrorMessage,
  createBarcodeReader,
  downscaledSize,
  type Frame,
  toLuminance,
  type ZxingModule,
} from './barcodeReader'

const video = {} as HTMLVideoElement

const fakeDetectorClass = (supported: string[], results: { rawValue: string }[][]) => {
  const constructed: { formats: string[] }[] = []
  let call = 0
  class FakeDetector {
    constructor(options: { formats: string[] }) {
      constructed.push(options)
    }
    static getSupportedFormats = () => Promise.resolve(supported)
    detect = () => Promise.resolve(results[call++] ?? [])
  }
  return { constructed, Detector: FakeDetector as unknown as BarcodeDetectorClass }
}

class FakeNotFound extends Error {}

const fakeZxing = (decode: () => string) => {
  const hints: Map<unknown, unknown>[] = []
  const module = {
    BarcodeFormat: { EAN_13: 'EAN_13', EAN_8: 'EAN_8', QR_CODE: 'QR_CODE', UPC_A: 'UPC_A', UPC_E: 'UPC_E' },
    BinaryBitmap: class {
      constructor(public binarizer: unknown) {}
    },
    DecodeHintType: { POSSIBLE_FORMATS: 'POSSIBLE_FORMATS', TRY_HARDER: 'TRY_HARDER' },
    HybridBinarizer: class {
      constructor(public source: unknown) {}
    },
    MultiFormatReader: class {
      setHints = (h: Map<unknown, unknown>) => hints.push(h)
      decodeWithState = () => ({ getText: decode })
    },
    NotFoundException: FakeNotFound,
    RGBLuminanceSource: class {
      constructor(
        public luminances: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  }
  return { hints, module: module as unknown as ZxingModule }
}

const frame: Frame = { data: new Uint8ClampedArray([255, 255, 255, 255]), height: 1, width: 1 }

describe('createBarcodeReader, native BarcodeDetector', () => {
  test('is used when it supports EAN-13, asking only for the supported product formats', async () => {
    const { constructed, Detector } = fakeDetectorClass(
      ['qr_code', 'ean_13', 'upc_a'],
      [[{ rawValue: '3017624010701' }]],
    )
    const loadZxing = vi.fn()
    const reader = await createBarcodeReader({ BarcodeDetector: Detector, loadZxing })
    expect(constructed).toEqual([{ formats: ['ean_13', 'upc_a'] }])
    expect(await reader.detect(video)).toBe('3017624010701')
    expect(loadZxing).not.toHaveBeenCalled()
  })

  test('is null for a frame without a code, or a code that is not a product barcode', async () => {
    const { Detector } = fakeDetectorClass(['ean_13'], [[], [{ rawValue: 'hello' }], [{ rawValue: '0123' }]])
    const reader = await createBarcodeReader({ BarcodeDetector: Detector, loadZxing: vi.fn() })
    expect(await reader.detect(video)).toBeNull()
    expect(await reader.detect(video)).toBeNull()
    expect(await reader.detect(video)).toBeNull()
  })

  test('passes a UPC-E code on as read', async () => {
    const { Detector } = fakeDetectorClass(['ean_13', 'upc_e'], [[{ rawValue: '01234565' }]])
    const reader = await createBarcodeReader({ BarcodeDetector: Detector, loadZxing: vi.fn() })
    expect(await reader.detect(video)).toBe('01234565')
  })
})

describe('createBarcodeReader, zxing fallback', () => {
  test('is loaded when there is no BarcodeDetector', async () => {
    const { hints, module } = fakeZxing(() => '3017624010701')
    const loadZxing = vi.fn(() => Promise.resolve(module))
    const reader = await createBarcodeReader({
      BarcodeDetector: undefined,
      grabFrame: () => frame,
      loadZxing,
    })
    expect(loadZxing).toHaveBeenCalledOnce()
    expect(await reader.detect(video)).toBe('3017624010701')
    expect(hints).toHaveLength(1)
    expect(hints[0].get('POSSIBLE_FORMATS')).toEqual(['EAN_13', 'EAN_8', 'UPC_A', 'UPC_E'])
    expect(hints[0].get('TRY_HARDER')).toBe(true)
  })

  test('is loaded when the BarcodeDetector cannot read EAN-13', async () => {
    const { Detector } = fakeDetectorClass(['qr_code'], [])
    const { module } = fakeZxing(() => '96385074')
    const loadZxing = vi.fn(() => Promise.resolve(module))
    const reader = await createBarcodeReader({ BarcodeDetector: Detector, grabFrame: () => frame, loadZxing })
    expect(loadZxing).toHaveBeenCalledOnce()
    expect(await reader.detect(video)).toBe('96385074')
  })

  test('is null when zxing finds no code', async () => {
    const { module } = fakeZxing(() => {
      throw new FakeNotFound()
    })
    const reader = await createBarcodeReader({
      BarcodeDetector: undefined,
      grabFrame: () => frame,
      loadZxing: () => Promise.resolve(module),
    })
    expect(await reader.detect(video)).toBeNull()
  })

  test('rethrows any other decoding error', async () => {
    const { module } = fakeZxing(() => {
      throw new Error('boom')
    })
    const reader = await createBarcodeReader({
      BarcodeDetector: undefined,
      grabFrame: () => frame,
      loadZxing: () => Promise.resolve(module),
    })
    await expect(reader.detect(video)).rejects.toThrow('boom')
  })

  test('is null when the video has no frame yet, or the text is not a barcode', async () => {
    const { module } = fakeZxing(() => 'not digits')
    const noFrame = await createBarcodeReader({
      BarcodeDetector: undefined,
      grabFrame: () => null,
      loadZxing: () => Promise.resolve(module),
    })
    expect(await noFrame.detect(video)).toBeNull()
    const notBarcode = await createBarcodeReader({
      BarcodeDetector: undefined,
      grabFrame: () => frame,
      loadZxing: () => Promise.resolve(module),
    })
    expect(await notBarcode.detect(video)).toBeNull()
  })
})

describe('cameraErrorMessage', () => {
  const named = (name: string) => Object.assign(new Error('x'), { name })

  test('says the camera is blocked when permission is denied', () => {
    expect(cameraErrorMessage(named('NotAllowedError'))).toBe(
      "The camera is blocked for this site. Allow it in the browser's site settings, or type the barcode.",
    )
  })

  test('says no camera was found when there is none that fits', () => {
    expect(cameraErrorMessage(named('NotFoundError'))).toBe('No camera was found. Type the barcode instead.')
    expect(cameraErrorMessage(named('OverconstrainedError'))).toBe(
      'No camera was found. Type the barcode instead.',
    )
  })

  test('falls back to a general sentence', () => {
    expect(cameraErrorMessage(named('NotReadableError'))).toBe(
      'The camera could not be started. Type the barcode instead.',
    )
    expect(cameraErrorMessage('weird')).toBe('The camera could not be started. Type the barcode instead.')
  })
})

describe('toLuminance', () => {
  test('turns RGBA pixels into one grey byte each', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255])
    expect(Array.from(toLuminance({ data: rgba, height: 1, width: 3 }))).toEqual([255, 0, 63])
  })
})

describe('downscaledSize', () => {
  test('keeps a frame that fits', () => {
    expect(downscaledSize(640, 480, 1280)).toEqual({ height: 480, width: 640 })
  })

  test('scales the longer side down to the limit', () => {
    expect(downscaledSize(1920, 1080, 1280)).toEqual({ height: 720, width: 1280 })
    expect(downscaledSize(1080, 1920, 1280)).toEqual({ height: 1280, width: 720 })
  })
})
