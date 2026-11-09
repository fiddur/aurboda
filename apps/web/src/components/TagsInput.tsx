import { invalidTagTokens } from './hashtags'

/** A small `#tag #tag` text field with the invalid words called out. */
export const TagsInput = ({
  value,
  onInput,
  note,
  id,
  legend = 'Tags',
}: {
  value: string
  onInput: (value: string) => void
  note?: string
  id?: string
  legend?: string
}) => {
  const invalid = invalidTagTokens(value)
  return (
    <fieldset class="share-dialog-group">
      <legend>{legend}</legend>
      <p class="share-dialog-note">
        {note ?? 'Hashtags, separated by spaces. #tags typed in the text are added too.'}
      </p>
      <input
        id={id}
        type="text"
        class="share-dialog-tags"
        value={value}
        placeholder="e.g. #aurboda #morningworkout"
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
      {invalid.length > 0 && (
        <p class="share-dialog-note">Not a tag (letters, digits and _ only), left out: {invalid.join(' ')}</p>
      )}
    </fieldset>
  )
}
