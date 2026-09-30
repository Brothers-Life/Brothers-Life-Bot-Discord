import { useQuery, queryOptions } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { Me } from '@/lib/types'

export const meQuery = queryOptions({
  queryKey: ['me'],
  queryFn: () => api<Me>('/me'),
  staleTime: 30_000,
  refetchInterval: 60_000,
})

// Current user and a `can(permission)` helper. The server stays the only authority:
// this only hides what the user can't use.
export function useMe() {
  const { data } = useQuery(meQuery)
  const permissions = new Set(data?.permissions ?? [])
  return {
    me: data,
    can: (permission: string) => Boolean(data?.isOwner || permissions.has(permission)),
  }
}
