import type { DashboardConfig, DashboardSection, DashboardWidget } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchDashboard, listSharedDashboards, saveDashboard, updateSharedDashboard } from '../state/api'
import { newSectionId } from '../utils/widget-id'
import './AddToDashboardModal.css'
import './DashboardEditor/style.css'

/** Per-field toggle to mask breakdown values (shown as A, B, C…) on public boards. */
export function BreakdownMaskPicker({
  fields,
  masked,
  onToggle,
}: {
  fields: string[]
  masked: string[]
  onToggle: (field: string) => void
}) {
  if (fields.length === 0) return null
  return (
    <div class="form-group">
      <label>Mask on public boards</label>
      <div class="mask-fields">
        {fields.map((field) => (
          <label key={field} class="mask-field-checkbox">
            <input type="checkbox" checked={masked.includes(field)} onChange={() => onToggle(field)} />
            {field}
          </label>
        ))}
      </div>
      <p class="mask-hint">Masked field values are shown as A, B, C… to public viewers.</p>
    </div>
  )
}

export interface AddToDashboardModalProps {
  /** Builds the widget to add; `title` is what the user typed (may be ''), `masked` the masked breakdown fields. */
  widget: (title: string, masked: string[]) => DashboardWidget
  breakdownFields: string[]
  onClose: () => void
}

export function AddToDashboardModal({ widget, breakdownFields, onClose }: AddToDashboardModalProps) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [targetId, setTargetId] = useState('home') // 'home' or a shared dashboard id
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [masked, setMasked] = useState<string[]>([])
  const [saved, setSaved] = useState(false)

  const toggleMasked = (field: string) =>
    setMasked((prev) => (prev.includes(field) ? prev.filter((f) => f !== field) : [...prev, field]))

  const dashboardQuery = useQuery({
    queryFn: fetchDashboard,
    queryKey: ['dashboard'],
    staleTime: 5 * 60 * 1000,
  })

  const sharedQuery = useQuery({
    queryFn: listSharedDashboards,
    queryKey: ['sharedDashboards'],
    staleTime: 60 * 1000,
  })

  const saveMutation = useMutation({
    mutationFn: async (next: { targetId: string; config: DashboardConfig }) => {
      if (next.targetId === 'home') {
        await saveDashboard(next.config)
      } else {
        await updateSharedDashboard(next.targetId, { config: next.config })
      }
    },
    onError: () => alert('Failed to add the widget. Please try again.'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      void queryClient.invalidateQueries({ queryKey: ['sharedDashboards'] })
      setSaved(true)
    },
  })

  const sharedDashboards = sharedQuery.data ?? []
  // The config of the currently selected target (home or a shared dashboard).
  const targetConfig: DashboardConfig | undefined =
    targetId === 'home' ? dashboardQuery.data : sharedDashboards.find((d) => d.id === targetId)?.config
  const chartsSections = targetConfig?.sections.filter((s) => s.type === 'charts') ?? []
  const placeholder = widget('', []).config
  const titlePlaceholder = ('pattern' in placeholder && placeholder.pattern) || 'Chart title'

  // Reset the section choice when the target dashboard changes.
  const handleTargetChange = (id: string) => {
    setTargetId(id)
    setSelectedSectionId('')
    setNewSectionTitle('')
  }

  const handleSave = () => {
    if (!targetConfig) return

    const added = widget(title, masked)

    let newConfig: DashboardConfig
    if (selectedSectionId === '__new__') {
      const sectionTitle = newSectionTitle.trim() || 'Charts'
      const newSection: DashboardSection = {
        id: newSectionId(),
        title: sectionTitle,
        type: 'charts',
        widgets: [added],
      }
      newConfig = { ...targetConfig, sections: [...targetConfig.sections, newSection] }
    } else {
      newConfig = {
        ...targetConfig,
        sections: targetConfig.sections.map((section) =>
          section.id === selectedSectionId ? { ...section, widgets: [...section.widgets, added] } : section,
        ),
      }
    }

    saveMutation.mutate({ config: newConfig, targetId })
  }

  const canSave =
    !saveMutation.isPending &&
    !!targetConfig &&
    (selectedSectionId === '__new__' ? newSectionTitle.trim().length > 0 : selectedSectionId.length > 0)

  return (
    <div class="dashboard-editor-overlay" onClick={onClose}>
      <div class="dashboard-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Add to Dashboard</h3>
          <button class="close-btn" onClick={onClose}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="modal-content">
          {saved ? (
            <div class="add-to-dash-success">Widget added to dashboard!</div>
          ) : (
            <div class="config-form">
              <div class="form-group">
                <label>Title (optional)</label>
                <input
                  type="text"
                  value={title}
                  onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                  placeholder={titlePlaceholder}
                />
              </div>

              <div class="form-group">
                <label>Dashboard</label>
                <select
                  value={targetId}
                  onChange={(e) => handleTargetChange((e.target as HTMLSelectElement).value)}
                >
                  <option value="home">My dashboard (home)</option>
                  {sharedDashboards.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} (shared)
                    </option>
                  ))}
                </select>
              </div>

              <div class="form-group">
                <label>Dashboard Section</label>
                <select
                  value={selectedSectionId}
                  onChange={(e) => setSelectedSectionId((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Select a section...</option>
                  {chartsSections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.title}
                    </option>
                  ))}
                  <option value="__new__">+ Create new section</option>
                </select>
              </div>

              {selectedSectionId === '__new__' && (
                <div class="form-group">
                  <label>New Section Title</label>
                  <input
                    type="text"
                    value={newSectionTitle}
                    onInput={(e) => setNewSectionTitle((e.target as HTMLInputElement).value)}
                    placeholder="e.g., My Charts"
                  />
                </div>
              )}

              <BreakdownMaskPicker fields={breakdownFields} masked={masked} onToggle={toggleMasked} />
            </div>
          )}
        </div>

        <div class="modal-footer">
          {saved ? (
            <button class="btn-primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button class="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button class="btn-primary" onClick={handleSave} disabled={!canSave}>
                {saveMutation.isPending ? 'Saving...' : 'Add Widget'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
