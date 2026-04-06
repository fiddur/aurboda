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

  const { data: items, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => searchFoodItemsApi(search || '', 100),
    queryKey: ['foodItems', search],
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
        <span class="fi-count">{items?.length ?? 0} items</span>
      </div>

      {isLoading ? (
        <p class="loading">Loading...</p>
      ) : !items || items.length === 0 ? (
        <p class="no-data">No food items found.</p>
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
              <tr key={item.id}>
                <td class="fi-name">{item.name}</td>
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
