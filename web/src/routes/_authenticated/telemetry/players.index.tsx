import { useDeferredValue, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Page, Pill } from '@/components/app/ui'
import { Input } from '@/components/ui/input'
import { dt, fmt, money } from '@/features/telemetry/format'
import type { PlayerRow } from '@/features/telemetry/types'
import { Mono, PlayerLink, QueryError, TableSection, When } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/players/')({
  component: TelemetryPlayers,
})

function TelemetryPlayers() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const players = useQuery({
    queryKey: ['telemetry', 'players', q],
    queryFn: () => api<{ players: PlayerRow[] }>(`/telemetry/players?q=${encodeURIComponent(q)}`),
    placeholderData: (prev) => prev,
  })
  const list = players.data?.players
  return (
    <Page title='Télémétrie · Joueurs' description='Les personnages vus par le serveur, du plus riche au moins riche. Ouvre une fiche pour son journal, son inventaire, ses véhicules et son argent.'>
      {players.error ? <QueryError error={players.error} /> : (
        <TableSection
          title={list ? `${fmt(list.length)} joueur${list.length > 1 ? 's' : ''}` : 'Joueurs'}
          className={cn(players.isPlaceholderData && 'opacity-70')}
          actions={
            <div className='relative w-full sm:w-72'>
              <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Nom ou citizenid…' aria-label='Chercher un joueur' className='ps-8' autoFocus />
            </div>
          }
          exportName='joueurs'
          rows={list}
          empty='Aucun joueur ne correspond à cette recherche.'
          minWidth='48rem'
          rowKey={(p) => p.citizenid}
          onRowClick={(p) => navigate({ to: '/telemetry/players/$cid', params: { cid: p.citizenid } })}
          columns={[
            { key: 'name', label: 'Joueur', render: (p) => <span className='flex items-center gap-2'><PlayerLink cid={p.citizenid} name={p.name} />{p.online && <Pill tone='success'>en ligne</Pill>}</span>, csv: (p) => p.name },
            { key: 'cid', label: 'Citizenid', render: (p) => <Mono>{p.citizenid}</Mono>, csv: (p) => p.citizenid },
            { key: 'job', label: 'Métier', render: (p) => (p.job ? <Pill>{p.job}</Pill> : '–'), csv: (p) => p.job },
            { key: 'gang', label: 'Gang', render: (p) => (p.gang && p.gang !== 'none' ? <Pill tone='accent'>{p.gang}</Pill> : '–'), csv: (p) => (p.gang === 'none' ? '' : p.gang) },
            { key: 'cash', label: 'Cash', align: 'end', render: (p) => money(p.cash), csv: (p) => p.cash },
            { key: 'bank', label: 'Banque', align: 'end', render: (p) => money(p.bank), csv: (p) => p.bank },
            { key: 'ts', label: 'Vu', render: (p) => <When at={p.ts} />, csv: (p) => dt(p.ts) },
          ]}
        />
      )}
    </Page>
  )
}
