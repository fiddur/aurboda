import type { ScreentimeCategory } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import {
  createScreentimeCategory,
  deleteScreentimeCategory,
  fetchDefaultScreentimeCategories,
  fetchScreentimeCategories,
  importAwCategories,
  recategorizeScreentime,
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
        roots.push(node)
      }
    }
  }

  return roots
}

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

// ============================================================================
// Category row (nav-only: click to edit, trash to delete)
// ============================================================================

function CategoryRow({ node, onDeleted }: { node: TreeNode; onDeleted: () => void }) {
  const cat = node.category
  const indent = node.depth * 24

  const deleteMutation = useMutation({
    mutationFn: () => deleteScreentimeCategory(cat.id),
    onSuccess: onDeleted,
  })

  const displayName = cat.name[cat.name.length - 1]

  return (
    <div class="sc-row" style={{ paddingLeft: `${indent + 8}px` }}>
      <a href={`/screentime-categories/${cat.id}`} class="sc-info sc-row-link">
        {cat.color && <span class="sc-color-dot" style={{ background: cat.color }} />}
        <span class="sc-name">{displayName}</span>
        {cat.rule_regex && <code class="sc-regex">{cat.rule_regex}</code>}
        {cat.exclude_from_screentime && <span class="sc-excluded-badge">excluded</span>}
      </a>
      <div class="sc-actions">
        <button
          type="button"
          class="sc-trash-btn"
          onClick={(e) => {
            e.stopPropagation()
            if (node.children.length > 0) {
              if (
                !confirm(`Delete "${cat.name.join(' > ')}" and all its ${node.children.length} children?`)
              ) {
                return
              }
            } else if (!confirm(`Delete "${cat.name.join(' > ')}"?`)) {
              return
            }
            deleteMutation.mutate()
          }}
          disabled={deleteMutation.isPending}
          title="Delete category"
        >
          {deleteMutation.isPending ? '...' : '🗑'}
        </button>
      </div>
    </div>
  )
}

// ============================================================================
// Import / Defaults actions
// ============================================================================

function CategoryActions({ onUpdated }: { onUpdated: () => void }) {
  const [awUrl, setAwUrl] = useState('http://localhost:5600')
  const [showImport, setShowImport] = useState(false)

  const importMutation = useMutation({
    mutationFn: (options: { url: string; replace: boolean }) => importAwCategories(options),
    onSuccess: onUpdated,
  })

  const loadDefaultsMutation = useMutation({
    mutationFn: async () => {
      const defaults = await fetchDefaultScreentimeCategories()
      for (const cat of defaults) {
        await createScreentimeCategory(cat)
      }
      await recategorizeScreentime()
    },
    onSuccess: onUpdated,
  })

  return (
    <div class="sc-actions-section">
      <div class="sc-action-buttons">
        <button
          type="button"
          class="note-action-btn"
          onClick={() => loadDefaultsMutation.mutate()}
          disabled={loadDefaultsMutation.isPending}
        >
          {loadDefaultsMutation.isPending ? 'Loading...' : 'Load Suggested Defaults'}
        </button>
        <button type="button" class="note-action-btn" onClick={() => setShowImport(!showImport)}>
          Import from ActivityWatch
        </button>
      </div>
      {showImport && (
        <div class="sc-import-form">
          <input
            type="text"
            value={awUrl}
            onInput={(e) => setAwUrl((e.target as HTMLInputElement).value)}
            placeholder="ActivityWatch server URL"
            class="sc-input wide"
          />
          <button
            type="button"
            class="note-action-btn"
            onClick={() => importMutation.mutate({ replace: false, url: awUrl })}
            disabled={importMutation.isPending}
          >
            {importMutation.isPending ? 'Importing...' : 'Import (merge)'}
          </button>
          <button
            type="button"
            class="note-action-btn danger"
            onClick={() => {
              if (confirm('Replace ALL existing categories with imported ones?')) {
                importMutation.mutate({ replace: true, url: awUrl })
              }
            }}
            disabled={importMutation.isPending}
          >
            Replace All
          </button>
          {importMutation.isError && <p class="sc-error">{(importMutation.error as Error).message}</p>}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// Main component
// ============================================================================

export function ScreentimeCategoriesSettings() {
  const queryClient = useQueryClient()

  const { data: categories = [], isLoading } = useQuery({
    queryFn: fetchScreentimeCategories,
    queryKey: ['screentime-categories'],
    staleTime: 5 * 60 * 1000,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['screentime-categories'] })

  if (isLoading) return <p class="loading">Loading categories...</p>

  const tree = buildTree(categories)
  const flat = flattenTree(tree)

  const handleAddCategory = () => {
    const id = crypto.randomUUID()
    location.href = `/screentime-categories/${id}`
  }

  return (
    <div class="sc-container">
      <div class="sc-header">
        <button type="button" class="note-action-btn" onClick={handleAddCategory}>
          Add category
        </button>
      </div>

      {flat.length === 0 && (
        <p class="sc-empty">No categories yet. Add one or load the suggested defaults to get started.</p>
      )}

      <div class="sc-list">
        {flat.map((node) => (
          <CategoryRow key={node.category.id} node={node} onDeleted={invalidate} />
        ))}
      </div>

      <CategoryActions onUpdated={invalidate} />
    </div>
  )
}
