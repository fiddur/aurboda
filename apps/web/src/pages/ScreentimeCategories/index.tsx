/**
 * Standalone screentime categories page.
 * Extracted from data source settings so categories are a first-class navigable concept.
 */
import { ScreentimeCategoriesSettings } from '../../components/ScreentimeCategoriesSettings'
import { auth } from '../../state/auth'

export function ScreentimeCategories() {
  const isLoggedIn = auth.value.token
  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to manage screentime categories.</p>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Screentime Categories</h1>
        <p class="page-subtitle">
          Organize your screen time data by assigning apps and websites to categories. Categories are shared
          across all screen time sources (RescueTime, ActivityWatch Desktop, ActivityWatch Android).
        </p>
      </div>

      <ScreentimeCategoriesSettings />
    </div>
  )
}
