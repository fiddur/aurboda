type ClickLike = Pick<
  MouseEvent,
  'altKey' | 'button' | 'ctrlKey' | 'defaultPrevented' | 'metaKey' | 'shiftKey'
>

/** A plain left click opens the viewer; a modified or middle click keeps the link's own behaviour (new tab, window, download). */
export const opensImageViewer = (e: ClickLike): boolean =>
  e.button === 0 && !e.defaultPrevented && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
