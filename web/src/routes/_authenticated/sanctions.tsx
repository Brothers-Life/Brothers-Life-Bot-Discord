import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { Sanction } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section } from '@/components/app/ui'
import { SanctionDialog } from '@/features/sanctions/sanction-dialog'
import { SanctionList } from '@/features/sanctions/sanction-list'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/_authenticated/sanctions')({
  validateSearch: (search: Record<string, unknown>) => ({
    user: typeof search.user === 'string' ? search.user : undefined,
  }),
  component: SanctionsPage,
})

const PAGE = 50

function SanctionsPage() {
  const { can } = useMe()
  const search = Route.useSearch()
  const [type, setType] = useState('all')
  const [active, setActive] = useState(false)
  const [userId, setUserId] = useState(search.user ?? '')
  const [creating, setCreating] = useState(false)
  const userFilter = /^\d{17,20}$/.test(userId.trim()) ? userId.trim() : ''
  const canCreate = ['warn', 'timeout', 'kick', 'ban'].some((t) => can(`sanctions.${t}`))

  const query = useInfiniteQuery({
    queryKey: ['sanctions', type, active, userFilter],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE) })
      if (type !== 'all') params.set('type', type)
      if (active) params.set('active', 'true')
      if (userFilter) params.set('userId', userFilter)
      if (pageParam) params.set('before', String(pageParam))
      return api<Sanction[]>(`/sanctions?${params}`)
    },
    getNextPageParam: (last) => (last.length === PAGE ? last.at(-1)?.id : undefined),
    refetchInterval: 30_000,
  })
  const sanctions = query.data?.pages.flat() ?? []

  return (
    <Page
      title='Sanctions'
      description='Toutes les sanctions du réseau : données par commande, depuis ce panel ou directement dans Discord. Un ban réseau s’applique aussi aux serveurs ajoutés plus tard.'
      actions={canCreate && <Button onClick={() => setCreating(true)}><Plus /> Nouvelle sanction</Button>}
    >
      <Section
        title={userFilter ? `Sanctions de ${userFilter}` : 'Historique'}
        actions={
          <div className='flex flex-wrap items-center gap-3'>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className='w-36' aria-label='Type'><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>Tous les types</SelectItem>
                <SelectItem value='ban'>Bans</SelectItem>
                <SelectItem value='timeout'>Timeouts</SelectItem>
                <SelectItem value='kick'>Kicks</SelectItem>
                <SelectItem value='warn'>Warns</SelectItem>
              </SelectContent>
            </Select>
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} placeholder='ID Discord du membre' aria-label='Filtrer par membre' className='w-52' inputMode='numeric' />
            <div className='flex items-center gap-2'>
              <Switch id='only-active' checked={active} onCheckedChange={setActive} />
              <Label htmlFor='only-active'>En cours</Label>
            </div>
          </div>
        }
      >
        <SanctionList sanctions={sanctions} />
        {query.hasNextPage && (
          <div className='border-t p-3 text-center'>
            <Button variant='outline' size='sm' onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              Voir les sanctions plus anciennes
            </Button>
          </div>
        )}
      </Section>
      {creating && <SanctionDialog userId={userFilter} onClose={() => setCreating(false)} />}
    </Page>
  )
}
