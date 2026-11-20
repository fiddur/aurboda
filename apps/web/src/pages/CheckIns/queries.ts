import { useQueryClient } from '@tanstack/react-query'

export const CHECK_INS_KEY = ['checkIns'] as const

export const checkInKeys = {
  adherence: (id: string) => [...CHECK_INS_KEY, 'adherence', id] as const,
  byActivity: (id: string) => [...CHECK_INS_KEY, 'by-activity', id] as const,
  deletedCheckIns: [...CHECK_INS_KEY, 'deleted-check-ins'] as const,
  deletedForms: [...CHECK_INS_KEY, 'deleted-forms'] as const,
  due: [...CHECK_INS_KEY, 'due'] as const,
  form: (id: string) => [...CHECK_INS_KEY, 'form', id] as const,
  forms: [...CHECK_INS_KEY, 'forms'] as const,
  history: (id: string) => [...CHECK_INS_KEY, 'history', id] as const,
  recent: [...CHECK_INS_KEY, 'recent'] as const,
  templates: [...CHECK_INS_KEY, 'templates'] as const,
}

/** Refetches everything check-in related: forms, history, due slots and the deleted lists. */
export const useRefreshCheckIns = (): (() => Promise<void>) => {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: CHECK_INS_KEY })
}
