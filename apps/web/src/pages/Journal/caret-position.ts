const COPIED = [
  'fontFamily',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'fontVariant',
  'letterSpacing',
  'lineHeight',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'textTransform',
  'textIndent',
  'tabSize',
  'wordSpacing',
  'wordBreak',
] as const

/**
 * The caret line's top and bottom in viewport coordinates (as getBoundingClientRect), for `index` in
 * the textarea, measured on an off-screen copy of its text laid out the same way.
 */
export const caretLineRect = (
  textarea: HTMLTextAreaElement,
  index: number,
): { top: number; bottom: number } => {
  const style = getComputedStyle(textarea)
  const mirror = document.createElement('div')
  for (const key of COPIED) mirror.style[key] = style[key]
  const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
  Object.assign(mirror.style, {
    border: '0',
    boxSizing: 'content-box',
    left: '-9999px',
    overflowWrap: 'break-word',
    position: 'absolute',
    top: '0',
    visibility: 'hidden',
    whiteSpace: 'pre-wrap',
    width: `${textarea.clientWidth - padding}px`,
  })
  mirror.textContent = textarea.value.slice(0, index)
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(marker)
  document.body.appendChild(mirror)
  const markerTop = marker.offsetTop
  const markerHeight = marker.offsetHeight
  mirror.remove()

  const fontSize = parseFloat(style.fontSize) || 16
  const lineHeight = parseFloat(style.lineHeight) || markerHeight || 1.2 * fontSize
  const top =
    textarea.getBoundingClientRect().top +
    parseFloat(style.borderTopWidth || '0') +
    markerTop -
    textarea.scrollTop
  return { bottom: top + Math.max(lineHeight, markerHeight), top }
}
