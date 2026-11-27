import type { JournalContext } from '@aurboda/api-spec'

import { contextToken } from './context-line'

/** The line's tokens, a space apart; the line wraps between tokens, never inside one. */
export const ContextTokens = ({ context }: { context: JournalContext }) => (
  <>
    {context.items.map((item, index) => (
      <span key={item.id}>
        {index > 0 && ' '}
        <span class="journal-context-token" title={item.name}>
          {contextToken(item)}
        </span>
      </span>
    ))}
  </>
)
