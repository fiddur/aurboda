import type { CreateScreentimeCategoryBody, ScreentimeCategory } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'
import {
  createScreentimeCategory,
  deleteScreentimeCategory,
  fetchDefaultScreentimeCategories,
  fetchScreentimeCategories,
  importAwCategories,
  recategorizeScreentime,
  updateScreentimeCategory,
} from '../../state/api'

import './style.css'

// ============================================================================
// Helpers
// ============================================================================

/** Build an indented tree structure from flat categories. */
interface TreeNode {
  category: ScreentimeCategory
  children: TreeNode[]
  depth: number
}

const buildTree = (categories: ScreentimeCategory[]): TreeNode[] => {
  // Sort by sort_order, then by name path length (parents first)
  const sorted = [...categories].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.name.length - b.name.length
  })

  const roots: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  for (const cat of sorted) {
    const key = cat.name.join(' > ')
    const node: TreeNode = { category: cat, children: [], depth: cat.name.length - 1 }
    nodeMap.set(key, node)

    if (cat.name.length === 1) {
      roots.push(node)
    } else {
      const parentKey = cat.name.slice(0, -1).join(' > ')
      const parent = nodeMap.get(parentKey)
      if (parent) {
        parent.children.push(node)
      } else {
        // Orphan — treat as root
        roots.push(node)
      }
    }
  }

  return roots
}

/** Flatten tree back to display order. */
const flattenTree = (nodes: TreeNode[]): TreeNode[] => {
  const result: TreeNode[] = []
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      result.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return result
}

const productivityScoreLabel = (score: number | undefined): string => {
  if (score === undefined) return 'inherit'
  const labels: Record<number, string> = {
    [-2]: 'Very Distracting',
    [-1]: 'Distracting',
    0: 'Neutral',
    1: 'Productive',
    2: 'Very Productive',
  }
  return labels[score] ?? `${score}`
}

// ============================================================================
// CategoryRow
// ============================================================================

function CategoryRow({
  node,
  onDeleted,
  onUpdated,
}: {
  node: TreeNode
  onDeleted: () => void
  onUpdated: () => void
}) {
  const cat = node.category
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(cat.name[cat.name.length - 1])
  const [editRegex, setEditRegex] = useState(cat.rule_regex ?? '')
  const [editColor, setEditColor] = useState(cat.color ?? '')
  const [editScore, setEditScore] = useState<string>(cat.score !== undefined ? String(cat.score) : '')
  const [editIgnoreCase, setEditIgnoreCase] = useState(cat.ignore_case)

  const updateMutation = useMutation({
    mutationFn: () => {
      const newName = [...cat.name.slice(0, -1), editName.trim()]
      return updateScreentimeCategory(cat.id, {
        color: editColor || undefined,
        ignore_case: editIgnoreCase,
        name: newName,
        rule_regex: editRegex || undefined,
        rule_type: editRegex ? 'regex' : 'none',
        score: editScore !== '' ? parseInt(editScore, 10) : undefined,
      })
    },
    onSuccess: () => {
      setIsEditing(false)
      onUpdated()
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteScreentimeCategory(cat.id),
    onSuccess: onDeleted,
  })

  const displayName = cat.name[cat.name.length - 1]
  const indent = node.depth * 24

  if (isEditing) {
    return (
      <div class="sc-row editing" style={{ paddingLeft: `${indent + 8}px` }}>
        <div class="sc-edit-fields">
          <div class="sc-edit-row">
            <input
              type="text"
              value={editName}
              onInput={(e) => setEditName((e.target as HTMLInputElement).value)}
              placeholder="Category name"
              class="sc-input"
            />
            <input
              type="text"
              value={editRegex}
              onInput={(e) => setEditRegex((e.target as HTMLInputElement).value)}
              placeholder="Regex pattern (optional)"
              class="sc-input wide"
            />
          </div>
          <div class="sc-edit-row">
            <label class="sc-color-label">
              Color:
              <input
                type="color"
                value={editColor || '#888888'}
                onInput={(e) => setEditColor((e.target as HTMLInputElement).value)}
                class="sc-color-input"
              />
              {editColor && (
                <button
                  type="button"
                  class="sc-clear-btn"
                  onClick={() => setEditColor('')}
                  title="Clear (inherit from parent)"
                >
                  x
                </button>
              )}
            </label>
            <label class="sc-score-label">
              Score:
              <select
                value={editScore}
                onChange={(e) => setEditScore((e.target as HTMLSelectElement).value)}
                class="sc-select"
              >
                <option value="">Inherit</option>
                <option value="2">2 (Very Productive)</option>
                <option value="1">1 (Productive)</option>
                <option value="0">0 (Neutral)</option>
                <option value="-1">-1 (Distracting)</option>
                <option value="-2">-2 (Very Distracting)</option>
              </select>
            </label>
            <label class="sc-case-label">
              <input
                type="checkbox"
                checked={editIgnoreCase}
                onChange={(e) => setEditIgnoreCase((e.target as HTMLInputElement).checked)}
              />
              Ignore case
            </label>
          </div>
        </div>
        <div class="sc-actions">
          <button
            type="button"
            class="note-action-btn"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending || !editName.trim()}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
          <button type="button" class="note-action-btn" onClick={() => setIsEditing(false)}>
            Cancel
          </button>
        </div>
        {updateMutation.isError && <p class="sc-error">{(updateMutation.error as Error).message}</p>}
      </div>
    )
  }

  return (
    <div class="sc-row" style={{ paddingLeft: `${indent + 8}px` }}>
      <div class="sc-info">
        {cat.color && <span class="sc-color-dot" style={{ background: cat.color }} />}
        <span class="sc-name">{displayName}</span>
        {cat.rule_regex && <code class="sc-regex">{cat.rule_regex}</code>}
        {cat.score !== undefined && <span class="sc-score">{productivityScoreLabel(cat.score)}</span>}
      </div>
      <div class="sc-actions">
        <button type="button" class="note-action-btn" onClick={() => setIsEditing(true)}>
          Edit
        </button>
        <button
          type="button"
          class="note-action-btn danger"
          onClick={() => {
            if (node.children.length > 0) {
              if (!confirm(`Delete "${cat.name.join(' > ')}" and all its ${node.children.length} children?`))
                return
            }
            deleteMutation.mutate()
          }}
          disabled={deleteMutation.isPending}
        >
          {deleteMutation.isPending ? '...' : 'Delete'}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// AddCategoryForm
// ============================================================================

function AddCategoryForm({
  categories,
  onCreated,
}: {
  categories: ScreentimeCategory[]
  onCreated: () => void
}) {
  const [parentPath, setParentPath] = useState('')
  const [name, setName] = useState('')
  const [regex, setRegex] = useState('')
  const [color, setColor] = useState('')
  const [score, setScore] = useState('')

  // Get unique parent paths from existing categories
  const parentOptions = Array.from(new Set(categories.map((c) => c.name.join(' > ')))).sort()

  const createMutation = useMutation({
    mutationFn: () => {
      const namePath = parentPath ? [...parentPath.split(' > '), name.trim()] : [name.trim()]
      const body: CreateScreentimeCategoryBody = {
        name: namePath,
        ...(color ? { color } : {}),
        ...(regex ? { rule_regex: regex, rule_type: 'regex' as const } : {}),
        ...(score !== '' ? { score: parseInt(score, 10) } : {}),
      }
      return createScreentimeCategory(body)
    },
    onSuccess: () => {
      setName('')
      setRegex('')
      setColor('')
      setScore('')
      onCreated()
    },
  })

  return (
    <div class="sc-add-form">
      <h3>Add Category</h3>
      <div class="sc-add-row">
        <select
          value={parentPath}
          onChange={(e) => setParentPath((e.target as HTMLSelectElement).value)}
          class="sc-select"
        >
          <option value="">Top level</option>
          {parentOptions.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={name}
          onInput={(e) => setName((e.target as HTMLInputElement).value)}
          placeholder="Category name"
          class="sc-input"
        />
      </div>
      <div class="sc-add-row">
        <input
          type="text"
          value={regex}
          onInput={(e) => setRegex((e.target as HTMLInputElement).value)}
          placeholder="Regex pattern (optional)"
          class="sc-input wide"
        />
        <select
          value={score}
          onChange={(e) => setScore((e.target as HTMLSelectElement).value)}
          class="sc-select"
        >
          <option value="">Score (inherit)</option>
          <option value="2">2 (Very Productive)</option>
          <option value="1">1 (Productive)</option>
          <option value="0">0 (Neutral)</option>
          <option value="-1">-1 (Distracting)</option>
          <option value="-2">-2 (Very Distracting)</option>
        </select>
        {color ?
          <label class="sc-color-label">
            <input
              type="color"
              value={color}
              onInput={(e) => setColor((e.target as HTMLInputElement).value)}
              class="sc-color-input"
            />
            <button type="button" class="sc-clear-btn" onClick={() => setColor('')}>
              x
            </button>
          </label>
        : <button type="button" class="sc-color-pick-btn" onClick={() => setColor('#888888')}>
            Color
          </button>
        }
      </div>
      {createMutation.isError && <p class="sc-error">{(createMutation.error as Error).message}</p>}
      <button
        type="button"
        class="connect-button"
        onClick={() => createMutation.mutate()}
        disabled={createMutation.isPending || !name.trim()}
      >
        {createMutation.isPending ? 'Adding...' : 'Add Category'}
      </button>
    </div>
  )
}

// ============================================================================
// Main Component
// ============================================================================

export function ScreentimeCategoriesSettings() {
  const queryClient = useQueryClient()
  const queryKey = ['screentime-categories']

  const { data: categories = [] } = useQuery<ScreentimeCategory[]>({
    queryFn: fetchScreentimeCategories,
    queryKey,
    staleTime: 5 * 60 * 1000,
  })

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey })
    // Also invalidate DayView which depends on categories
    queryClient.invalidateQueries({ queryKey: ['dayview-productivity'] })
  }, [queryClient])

  // Import from AW
  const [awUrl, setAwUrl] = useState('http://localhost:5600')
  const [awReplace, setAwReplace] = useState(false)
  const importMutation = useMutation({
    mutationFn: () => importAwCategories({ replace: awReplace, url: awUrl }),
    onSuccess: invalidate,
  })

  // Load defaults
  const loadDefaultsMutation = useMutation({
    mutationFn: async () => {
      const defaults = await fetchDefaultScreentimeCategories()
      // Create each default category
      for (const def of defaults) {
        await createScreentimeCategory(def)
      }
    },
    onSuccess: invalidate,
  })

  // Recategorize
  const [recategorizeResult, setRecategorizeResult] = useState<string | null>(null)
  const recategorizeMutation = useMutation({
    mutationFn: recategorizeScreentime,
    onSuccess: (result) => {
      setRecategorizeResult(`Updated ${result.records_updated} records`)
      invalidate()
    },
  })

  // Build tree
  const tree = buildTree(categories)
  const flatNodes = flattenTree(tree)

  return (
    <section class="settings-section">
      <div class="section-header-row">
        <h2>Screentime Categories</h2>
      </div>
      <p class="section-description">
        Define categories to classify your screen time by app name and window title. Categories are
        hierarchical (e.g. Work &gt; Programming) and use regex rules for matching. Compatible with{' '}
        <a href="https://activitywatch.net" target="_blank" rel="noopener noreferrer">
          ActivityWatch
        </a>{' '}
        categories.
      </p>

      {/* Category tree */}
      {flatNodes.length > 0 && (
        <div class="sc-tree">
          {flatNodes.map((node) => (
            <CategoryRow key={node.category.id} node={node} onDeleted={invalidate} onUpdated={invalidate} />
          ))}
        </div>
      )}

      {flatNodes.length === 0 && (
        <p class="sc-empty">
          No categories defined yet. Add categories manually, load suggested defaults, or import from
          ActivityWatch.
        </p>
      )}

      {/* Add form */}
      <AddCategoryForm categories={categories} onCreated={invalidate} />

      {/* Actions */}
      <div class="sc-actions-bar">
        <div class="sc-action-group">
          <button
            type="button"
            class="connect-button"
            onClick={() => loadDefaultsMutation.mutate()}
            disabled={loadDefaultsMutation.isPending}
          >
            {loadDefaultsMutation.isPending ? 'Loading...' : 'Load Suggested Defaults'}
          </button>
          {loadDefaultsMutation.isError && (
            <span class="sc-error">{(loadDefaultsMutation.error as Error).message}</span>
          )}
        </div>

        <div class="sc-action-group">
          <div class="sc-import-row">
            <input
              type="text"
              value={awUrl}
              onInput={(e) => setAwUrl((e.target as HTMLInputElement).value)}
              placeholder="ActivityWatch URL"
              class="sc-input"
            />
            <label class="sc-case-label">
              <input
                type="checkbox"
                checked={awReplace}
                onChange={(e) => setAwReplace((e.target as HTMLInputElement).checked)}
              />
              Replace existing
            </label>
            <button
              type="button"
              class="connect-button"
              onClick={() => importMutation.mutate()}
              disabled={importMutation.isPending}
            >
              {importMutation.isPending ? 'Importing...' : 'Import from ActivityWatch'}
            </button>
          </div>
          {importMutation.isError && <span class="sc-error">{(importMutation.error as Error).message}</span>}
          {importMutation.isSuccess && (
            <span class="sc-success">Imported {importMutation.data?.length ?? 0} categories</span>
          )}
        </div>

        <div class="sc-action-group">
          <button
            type="button"
            class="connect-button"
            onClick={() => recategorizeMutation.mutate()}
            disabled={recategorizeMutation.isPending}
          >
            {recategorizeMutation.isPending ? 'Recategorizing...' : 'Recategorize All Records'}
          </button>
          {recategorizeResult && <span class="sc-success">{recategorizeResult}</span>}
          {recategorizeMutation.isError && (
            <span class="sc-error">{(recategorizeMutation.error as Error).message}</span>
          )}
          <p class="field-description">
            Re-apply all category rules to existing screentime records. Useful after changing rules.
          </p>
        </div>
      </div>
    </section>
  )
}
