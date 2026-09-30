import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { AuditEntry } from '@/lib/types'
import { UserPicker } from '@/components/app/user-picker'
import { Page, Section } from '@/components/app/ui'
import { AuditList } from '@/features/audit/audit-list'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

export const Route = createFileRoute('/_authenticated/audit')({
  component: AuditPage,
})

const CATEGORIES = [
  { value: 'all', label: 'Toutes les actions' },
  { value: 'network', label: 'Réseau' },
  { value: 'ranks', label: 'Rangs' },
  { value: 'panel', label: 'Panel' },
  { value: 'sanctions', label: 'Sanctions' },
  { value: 'automod', label: 'Automod' },
  { value: 'members', label: 'Membres' },
  { value: 'staff_sync', label: 'Rôles du staff' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'permissions', label: 'Permissions Discord' },
  { value: 'logs', label: 'Salons de logs' },
  { value: 'system', label: 'Système' },
]
const PAGE = 50

function AuditPage() {
  const [category, setCategory] = useState('all')
  const [actorId, setActorId] = useState('')
  const actorFilter = /^\d{17,20}$/.test(actorId.trim()) ? actorId.trim() : ''

  const query = useInfiniteQuery({
    queryKey: ['audit', category, actorFilter],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE) })
      if (category !== 'all') params.set('action', category)
      if (actorFilter) params.set('actorId', actorFilter)
      if (pageParam) params.set('before', String(pageParam))
      return api<AuditEntry[]>(`/audit?${params}`)
    },
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)?.id : undefined),
  })
  const entries = query.data?.pages.flat() ?? []

  return (
    <Page title='Journal' description='Tout ce qui a été fait sur le réseau, les rangs et le panel, du plus récent au plus ancien.'>
      <Section
        title={`${entries.length}${query.hasNextPage ? '+' : ''} action${entries.length > 1 ? 's' : ''}`}
        actions={
          <div className='flex flex-wrap gap-2'>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className='w-44' aria-label='Type d’action'><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <UserPicker value={actorFilter} onChange={setActorId} placeholder='Filtrer par auteur' className='w-64' />
          </div>
        }
      >
        <AuditList entries={entries} />
        {query.hasNextPage && (
          <div className='border-t p-3 text-center'>
            <Button variant='outline' size='sm' onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Chargement…' : 'Voir les actions plus anciennes'}
            </Button>
          </div>
        )}
      </Section>
    </Page>
  )
}
