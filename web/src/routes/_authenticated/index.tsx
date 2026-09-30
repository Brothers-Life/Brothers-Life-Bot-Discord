import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Crown, TriangleAlert } from 'lucide-react'
import { api } from '@/lib/api'
import type { Overview } from '@/lib/types'
import { duration, bytes } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, Dot, GuildIcon, EmptyState } from '@/components/app/ui'
import { AuditList } from '@/features/audit/audit-list'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/')({
  component: Dashboard,
})

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <div className='min-w-0 px-4 py-3'>
      <div className='text-xs text-muted-foreground'>{label}</div>
      <div className='mt-1 truncate text-lg font-semibold tabular-nums'>{value}</div>
      {hint && <div className='truncate text-xs text-muted-foreground'>{hint}</div>}
    </div>
  )
}

function Dashboard() {
  const { can } = useMe()
  const { data, isLoading } = useQuery({
    queryKey: ['overview'],
    queryFn: () => api<Overview>('/overview'),
    refetchInterval: 15_000,
  })

  if (isLoading || !data) {
    return (
      <Page title='Vue d’ensemble'>
        <Skeleton className='h-24 w-full' />
        <Skeleton className='h-64 w-full' />
      </Page>
    )
  }

  const { bot, app, network } = data
  const online = bot.ready

  return (
    <Page title='Vue d’ensemble'>
      {/* Status strip: the one thing to check at a glance */}
      <div className='grid grid-cols-2 divide-border overflow-hidden rounded-lg border bg-card sm:grid-cols-4 sm:divide-x'>
        <Stat
          label='Bot'
          value={
            <span className='flex items-center gap-2'>
              <Dot tone={online ? 'success' : 'danger'} />
              {online ? 'En ligne' : 'Hors ligne'}
            </span>
          }
          hint={bot.user ? `${bot.user.username} · ${bot.ping} ms` : undefined}
        />
        <Stat label='Serveurs du réseau' value={network.active} hint={network.pending ? `${network.pending} en attente` : 'aucun en attente'} />
        <Stat label='En ligne depuis' value={duration(bot.uptime)} hint={`Mémoire ${bytes(app.memory)}`} />
        <Stat label='Version' value={app.version} hint={app.supervised ? 'Lanceur actif' : 'Lancé sans lanceur'} />
      </div>

      {!network.main && (
        <div className='flex flex-wrap items-center gap-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3'>
          <TriangleAlert className='size-5 text-warning' />
          <div className='min-w-0 flex-1'>
            <p className='font-medium'>Choisis le serveur principal</p>
            <p className='text-sm text-muted-foreground'>
              Les rangs se lisent sur ses rôles. Tant qu’il n’est pas choisi, seul le chef du réseau a des droits.
            </p>
          </div>
          {can('network.manage') && (
            <Button asChild size='sm'>
              <Link to='/network'>Choisir le serveur</Link>
            </Button>
          )}
        </div>
      )}

      <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]'>
        <Section title='Serveur principal'>
          {network.main ? (
            <div className='flex items-center gap-3 p-4'>
              <GuildIcon src={network.main.icon} name={network.main.name} className='size-12' />
              <div className='min-w-0'>
                <div className='flex items-center gap-2 font-medium'>
                  <Crown className='size-4 text-primary' />
                  <span className='truncate'>{network.main.name}</span>
                </div>
                <div className='text-sm text-muted-foreground'>
                  {network.active} serveur{network.active > 1 ? 's' : ''} synchronisé{network.active > 1 ? 's' : ''} · {data.ranks} rang{data.ranks > 1 ? 's' : ''}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState title='Aucun serveur principal' />
          )}
        </Section>

        <Section
          title='Dernières actions'
          actions={can('audit.view') ? <Button asChild variant='ghost' size='sm'><Link to='/audit'>Tout le journal</Link></Button> : undefined}
        >
          {data.recent ? <AuditList entries={data.recent} compact /> : <EmptyState title='Le journal n’est pas accessible avec ton rang' />}
        </Section>
      </div>
    </Page>
  )
}
