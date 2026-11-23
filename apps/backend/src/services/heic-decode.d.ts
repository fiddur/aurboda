declare module 'heic-decode' {
  interface DecodedHeicImage {
    width: number
    height: number
    data: Uint8ClampedArray
  }

  interface HeicImage {
    width: number
    height: number
    decode: () => Promise<DecodedHeicImage>
  }

  type HeicImages = HeicImage[] & { dispose: () => void }

  interface HeicDecode {
    (input: { buffer: Uint8Array }): Promise<DecodedHeicImage>
    all: (input: { buffer: Uint8Array }) => Promise<HeicImages>
  }

  const decode: HeicDecode
  export default decode
  export type { DecodedHeicImage, HeicImage, HeicImages }
}
