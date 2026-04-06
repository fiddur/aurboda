/**
 * Icon preview for tags — renders emoji or image URL.
 */
import { isEmoji, isIconPath, isUrl } from '../../utils/emojiLookup'

export const TagIconPreview = ({ icon }: { icon: string }) => {
  if (!icon) return null
  if (isEmoji(icon)) return <span class="tag-meta-icon-preview">{icon}</span>
  if (isUrl(icon) || isIconPath(icon)) {
    return (
      <span class="tag-meta-icon-preview">
        <img src={icon} alt="icon" width="24" height="24" />
      </span>
    )
  }
  return null
}
