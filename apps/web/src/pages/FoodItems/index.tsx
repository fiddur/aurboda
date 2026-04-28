import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

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

export function FoodItems() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const trimmed = search.trim()
  const hasQuery = trimmed.length > 0

  const { data: items, isLoading } = useQuery({
    enabled: !!isLoggedIn && hasQuery,
    queryFn: () => searchFoodItemsApi(trimmed, 100),
    queryKey: ['foodItems', trimmed],
    staleTime: 30_000,
  })

  const deleteMutation = useMutation({
    mutationFn: deleteFoodItemApi,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['foodItems'] }),
  })

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
