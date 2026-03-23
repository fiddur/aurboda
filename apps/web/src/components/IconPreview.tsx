/**
 * Shared icon preview — renders emoji text or image URL.
 * Replaces duplicated IconPreview/TagIconPreview components across pages.
 */
import { isEmoji, isIconPath, isUrl } from '../utils/emojiLookup'

export const IconPreview = ({ icon, size = 24 }: { icon: string; size?: number }) => {
  if (!icon) return null
  if (isEmoji(icon)) return <span class="icon-preview icon-preview-emoji">{icon}</span>
  if (isUrl(icon) || isIconPath(icon)) {
    return (
      <span class="icon-preview">
        <img src={icon} alt="icon" width={size} height={size} />
      </span>
    )
  }
  return null
}
