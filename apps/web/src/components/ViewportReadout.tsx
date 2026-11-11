import { useEffect, useRef, useState } from 'preact/hooks'

import { formatViewportReadout } from './viewport-readout'

export function ViewportReadout() {
  const probe = useRef<HTMLSpanElement>(null)
  const [readout, setReadout] = useState('')

  useEffect(() => {
    const measure = () => {
      if (!probe.current) return
      setReadout(
        formatViewportReadout({
          html: document.documentElement.getBoundingClientRect().height,
          inner_height: window.innerHeight,
          vh: probe.current.getBoundingClientRect().height,
        }),
      )
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])

  return (
    <p style={{ color: 'var(--color-text-muted)', fontSize: '0.75rem' }}>
      {/* Fixed, not absolute: a 100vh-tall absolute box would add a viewport of scroll to the page. */}
      <span
        ref={probe}
        aria-hidden="true"
        style={{ height: '100vh', left: 0, position: 'fixed', top: 0, visibility: 'hidden', width: 0 }}
      />
      {readout}
    </p>
  )
}
