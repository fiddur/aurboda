import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect, useState } from 'preact/hooks'

import { ConfirmButton } from '../../components/ConfirmButton'
import { searchFoodItemsApi } from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

const API_URL = import.meta.env.VITE_API_URL || '/api'

const deleteFoodItemApi = async (id: string): Promise<void> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Delete failed')
}

const createFoodItemApi = async (name: string): Promise<{ id: string }> => {
  const { token } = auth.value
  const res = await fetch(`${API_URL}/food-items`, {
    body: JSON.stringify({ name }),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    method: 'POST',
  })
  if (!res.ok) throw new Error('Failed to create food item')
  const json = (await res.json()) as { data: { id: string } }
  return json.data
}

export function FoodItems() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()
  const { route } = useLocation()
  const [search, setSearch] = useState('')
  const trimmed = search.trim()
  const hasQuery = trimmed.length > 0

  // Debounce so a fast typist doesn't fire one request per keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState(trimmed)
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(trimmed), 200)
    return () => clearTimeout(id)
  }, [trimmed])

  const { data: items, isLoading } = useQuery({
    enabled: !!isLoggedIn && debouncedQuery.length > 0,
    queryFn: () => searchFoodItemsApi(debouncedQuery, 100),
    queryKey: ['foodItems', debouncedQuery],
    staleTime: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFoodItemApi,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foodItems'] }),
  })

  const createMutation = useMutation({
    mutationFn: createFoodItemApi,
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ['foodItems'] })
      // Land on the detail page so the user can rename, set an icon, click
      // "Convert to recipe" — the easiest path to creating a composite item.
      route(`/food-items/${id}`)
    },
  })

  const handleCreate = () => {
    // Seed with the current search text when present so the user doesn't
    // have to retype what they were looking for.
    createMutation.mutate(trimmed || 'New food item')
  }

  if (!isLoggedIn) {
    return (
      <div class="food-items-page">
        <p>Please log in.</p>
      </div>
    )
  }

  return (
    <div class="food-items-page">
      <h1>Food Items</h1>

      <div class="fi-search">
        <input
          type="text"
          placeholder="Search food items..."
          value={search}
          onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        />
        {hasQuery && <span class="fi-count">{items?.length ?? 0} items</span>}
        <button
          type="button"
          class="btn-primary fi-create"
          onClick={handleCreate}
          disabled={createMutation.isPending}
          title={
            trimmed
              ? `Create "${trimmed}" as a new food item`
              : 'Create a new food item — useful as the parent of a composite recipe'
          }
        >
          {createMutation.isPending ? 'Creating…' : '+ New'}
        </button>
      </div>

      {!hasQuery ? (
        <p class="fi-help">Type to search the food library.</p>
      ) : isLoading ? (
        <p class="loading">Loading...</p>
      ) : !items || items.length === 0 ? (
        <p class="no-data">No food items match &ldquo;{trimmed}&rdquo;.</p>
      ) : (
        <table class="fi-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>kcal</th>
              <th>Prot</th>
              <th>Carbs</th>
              <th>Fat</th>
              <th>Fiber</th>
              <th>Source</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} class="fi-row">
                <td class="fi-name">
                  <a href={`/food-items/${item.id}`}>{item.name}</a>
                </td>
                <td class="fi-num">{item.calories ?? '—'}</td>
                <td class="fi-num">{item.protein ?? '—'}</td>
                <td class="fi-num">{item.carbs ?? '—'}</td>
                <td class="fi-num">{item.fat ?? '—'}</td>
                <td class="fi-num">{item.fiber ?? '—'}</td>
                <td class="fi-source">{item.source ?? '—'}</td>
                <td>
                  <ConfirmButton
                    label="Delete"
                    confirmMessage={`Delete ${item.name}?`}
                    onConfirm={() => deleteMutation.mutate(item.id)}
                    isPending={deleteMutation.isPending}
                    buttonClass="btn-danger-small"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
