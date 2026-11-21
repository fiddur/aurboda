import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { isEmbedded } from '../embed'
import {
  addPushSubscription,
  deletePushSubscription,
  fetchPushConfig,
  fetchPushSubscriptions,
  sendTestPush,
} from '../state/api'
import { auth } from '../state/auth'
import { browserPush } from '../state/push-browser'
import { derivePushState, disablePush, enablePush, type PushBrowser, type PushServerApi } from './push'

export const PUSH_KEY = ['push'] as const
export const PUSH_CONFIG_STALE_MS = 10 * 60_000

export const pushServerApi: PushServerApi = {
  add: addPushSubscription,
  list: (endpoint) => fetchPushSubscriptions(endpoint),
  remove: (id) => deletePushSubscription(id),
}

/** This browser's push state, the user's other subscribed browsers, and the actions on them. */
export const usePush = (browser: PushBrowser = browserPush) => {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const embedded = isEmbedded()
  const signedIn = Boolean(auth.value.token)

  const config = useQuery({
    enabled: signedIn && !embedded,
    queryFn: fetchPushConfig,
    queryKey: [...PUSH_KEY, 'config'],
    staleTime: PUSH_CONFIG_STALE_MS,
  })
  const serverEnabled = config.data?.enabled
  const active = serverEnabled === true && browser.supported && !browser.needsHomeScreen

  const endpoint = useQuery({
    enabled: active,
    queryFn: () => browser.endpoint(),
    queryKey: [...PUSH_KEY, 'endpoint'],
  })
  const subscriptions = useQuery({
    enabled: serverEnabled === true && (!active || endpoint.isSuccess),
    queryFn: () => fetchPushSubscriptions(endpoint.data ?? undefined),
    queryKey: [...PUSH_KEY, 'subscriptions', endpoint.data ?? null],
  })

  const subscribed =
    endpoint.data === null
      ? false
      : subscriptions.data === undefined
        ? undefined
        : subscriptions.data.some((subscription) => subscription.current)

  const state = derivePushState({
    embedded,
    needsHomeScreen: browser.needsHomeScreen,
    permission: browser.permission(),
    serverEnabled: config.isError ? false : serverEnabled,
    subscribed: endpoint.isSuccess ? subscribed : undefined,
    supported: browser.supported,
  })

  const refresh = () => queryClient.invalidateQueries({ queryKey: PUSH_KEY })
  const onError = (err: unknown) => setError(err instanceof Error ? err.message : 'Something went wrong')

  const enable = useMutation({
    mutationFn: () => enablePush(browser, pushServerApi, config.data?.public_key ?? ''),
    onError,
    onMutate: () => setError(null),
    onSettled: refresh,
  })
  const disable = useMutation({
    mutationFn: () => disablePush(browser, pushServerApi),
    onError,
    onMutate: () => setError(null),
    onSettled: refresh,
  })
  const remove = useMutation({
    mutationFn: (id: string) => deletePushSubscription(id),
    onError,
    onMutate: () => setError(null),
    onSettled: refresh,
  })
  const test = useMutation({ mutationFn: sendTestPush, onError, onMutate: () => setError(null) })

  return {
    busy: enable.isPending || disable.isPending,
    disable: () => disable.mutate(),
    enable: () => enable.mutate(),
    error,
    others: (subscriptions.data ?? []).filter((subscription) => !subscription.current),
    remove: (id: string) => remove.mutate(id),
    removing: remove.isPending,
    sendTest: () => test.mutate(),
    state,
    test: test.data,
    testing: test.isPending,
  }
}
