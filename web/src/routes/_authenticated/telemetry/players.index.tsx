import { useDeferredValue, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Notice, Page, Pill } from '@/components/app/ui'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { dt, fmt, money } from '@/features/telemetry/format'
import type { PlayerList } from '@/features/telemetry/types'
import { Mono, PlayerLink, QueryError, TableSection, When } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/players/')({
  component: TelemetryPlayers,
})

function TelemetryPlayers() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  // Characters deleted in the game are hidden unless asked for
  const [state, setState] = useState<'active' | 'deleted' | 'all'>('active')
  const players = useQuery({
    queryKey: ['telemetry', 'players', q, state],
    queryFn: () => api<PlayerList>(`/telemetry/players?q=${encodeURIComponent(q)}&state=${state}`),
    placeholderData: (prev) => prev,
  })
  const list = players.data?.players
  const counts = players.data?.counts
  const checked = players.data?.checked ?? true
  return (
    <Page title='Télémétrie · Joueurs' description='Les personnages vus par le serveur, du plus riche au moins riche. Ceux qui ont été supprimés du jeu sont rangés à part. Ouvre une fiche pour son journal, son inventaire, ses véhicules et son argent.'>
      {!checked && players.data && (
        <Notice tone='warning' title='Personnages supprimés non repérables'>
          La copie de la table des personnages du jeu n’est pas encore arrivée : la liste montre tous les personnages vus un jour, y compris ceux qui n’existent plus.
        </Notice>
      )}
      {players.error ? <QueryError error={players.error} /> : (
        <TableSection
          title={list ? `${fmt(list.length)} personnage${list.length > 1 ? 's' : ''}${counts && checked && state === 'active' && counts.deleted ? ` · ${fmt(counts.deleted)} supprimé${counts.deleted > 1 ? 's' : ''} masqué${counts.deleted > 1 ? 's' : ''}` : ''}` : 'Personnages'}
          className={cn(players.isPlaceholderData && 'opacity-70')}
          actions={
            <div className='flex w-full flex-wrap gap-2 sm:w-auto'>
              {checked && (
                <Select value={state} onValueChange={(v) => setState(v as typeof state)}>
                  <SelectTrigger className='w-full sm:w-60' aria-label='Personnages affichés'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='active'>En jeu{counts ? ` (${fmt(counts.active)})` : ''}</SelectItem>
                    <SelectItem value='deleted'>Supprimés du jeu{counts ? ` (${fmt(counts.deleted)})` : ''}</SelectItem>
                    <SelectItem value='all'>Tous{counts ? ` (${fmt(counts.total)})` : ''}</SelectItem>
                  </SelectContent>
                </Select>
              )}
              <div className='relative w-full sm:w-72'>
                <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Nom ou citizenid…' aria-label='Chercher un joueur' className='ps-8' autoFocus />
              </div>
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
            { key: 'state', label: 'État', render: (p) => (p.deleted ? <Pill tone='danger'>supprimé</Pill> : p.dead ? <Pill tone='warning'>à terre</Pill> : p.deleted === false ? <Pill>en jeu</Pill> : '–'), csv: (p) => (p.deleted ? 'supprimé' : p.dead ? 'à terre' : p.deleted === false ? 'en jeu' : '') },
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
