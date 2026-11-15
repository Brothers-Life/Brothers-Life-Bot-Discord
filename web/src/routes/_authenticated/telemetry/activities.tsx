import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { EmptyState, Page, Section } from '@/components/app/ui'
import { SeeAlso } from '@/components/app/confirm'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Snapshot, type SnapshotData } from '@/features/telemetry/snapshot-card'
import type { DbView } from '@/features/telemetry/types'
import { Mono, QueryError } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/activities')({
  component: TelemetryActivities,
})

// A card belongs to a theme when its name equals or starts with one of the matchers ("x_" = prefix, otherwise exact)
const THEMES: { key: string; label: string; match: string[] }[] = [
  { key: 'business', label: 'Entreprises', match: ['biz_', 'vehicleshop_7d', 'mdt_invoices_30d'] },
  { key: 'fishing', label: 'Pêche', match: ['fishing_'] },
  { key: 'hunting', label: 'Chasse', match: ['hunting_'] },
  { key: 'heists', label: 'Braquages', match: ['heists_'] },
  { key: 'gangs', label: 'Gangs', match: ['gangs_'] },
  { key: 'jobcenter', label: 'Pôle emploi', match: ['jobcenter_'] },
  { key: 'buyback', label: 'Rachats', match: ['buyback_'] },
  { key: 'wealth', label: 'Fortunes', match: ['wealth_'] },
  { key: 'premium', label: 'Boutique premium', match: ['premium_', 'vip_ranks'] },
  { key: 'phone', label: 'Téléphone', match: ['phone_'] },
  { key: 'life', label: 'Vie du serveur', match: ['nightclub_', 'rental_', 'pets_', 'leaderboard_', 'doors_', 'news_', 'census', 'playtime_'] },
]

const inTheme = (name: string, match: string[]) => match.some((m) => (m.endsWith('_') ? name.startsWith(m) : name === m))

function TelemetryActivities() {
  const q = useQuery({ queryKey: ['telemetry', 'db'], queryFn: () => api<DbView>('/telemetry/db'), refetchInterval: 120_000 })
  const [tab, setTab] = useState<string | null>(null)
  const snapshots: SnapshotData[] = q.data?.snapshots ?? []
  const groups = THEMES
    .map((t) => ({ ...t, cards: snapshots.filter((s) => typeof s.name === 'string' && inTheme(s.name, t.match)) }))
    .filter((g) => g.cards.length > 0)
  const current = groups.find((g) => g.key === tab) ?? groups[0]
  return (
    <Page title='Télémétrie · Activités' description='Chiffres des activités du serveur (entreprises, pêche, chasse, braquages, gangs, téléphone…), calculés par le jeu toutes les 15 minutes.'>
      {q.error ? <QueryError error={q.error} /> : !q.data ? <Skeleton className='h-96 w-full' /> : !current ? (
        <Section title='Activités'>
          <EmptyState title='Rien pour le moment'>Ces chiffres sont envoyés par <Mono>bl_telemetry</Mono> 1.6, toutes les 15 minutes. Ils apparaîtront ici après la mise à jour de la ressource sur le serveur.</EmptyState>
        </Section>
      ) : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <Tabs value={current.key} onValueChange={setTab} className='gap-4'>
            <TabsList className='h-auto max-w-full flex-wrap justify-start [&>button]:h-8 [&>button]:flex-none'>
              {groups.map((g) => <TabsTrigger key={g.key} value={g.key}>{g.label}</TabsTrigger>)}
            </TabsList>
            {groups.map((g) => (
              <TabsContent key={g.key} value={g.key}>
                <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
                  {g.cards.map((s) => <Snapshot key={s.name} s={s} />)}
                </div>
              </TabsContent>
            ))}
          </Tabs>
          <SeeAlso links={[{ to: '/telemetry/db', label: 'Base de données' }]}>Les autres lectures préparées par le jeu se trouvent sur la page Base de données.</SeeAlso>
        </div>
      )}
    </Page>
  )
}
