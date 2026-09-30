import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { api } from '@/lib/api'
import type { Announcement } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { STATUS } from '@/features/announcements/status'

export const Route = createFileRoute('/_authenticated/announcements/')({
  component: AnnouncementsPage,
})

function AnnouncementsPage() {
  const { can } = useMe()
  const { data, isLoading } = useQuery({ queryKey: ['announcements'], queryFn: () => api<Announcement[]>('/announcements'), refetchInterval: 30_000 })

  return (
    <Page
      title='Annonces'
      description='Un message et son embed, envoyés sur un ou plusieurs serveurs du réseau, tout de suite ou à une date choisie, avec le ping que tu veux dans chaque salon.'
      actions={can('announcements.manage') && (
        <Button asChild>
          <Link to='/announcements/$id' params={{ id: 'new' }}><Plus /> Nouvelle annonce</Link>
        </Button>
      )}
    >
      {isLoading && <Skeleton className='h-48 w-full' />}
      {data && (
        <Section title={`${data.length} annonce${data.length > 1 ? 's' : ''}`}>
          {!data.length ? <EmptyState title='Aucune annonce'>Crée ta première annonce : l’aperçu montre exactement ce que les membres verront.</EmptyState> : (
            <ul className='divide-y'>
              {data.map((a) => {
                const status = STATUS[a.status]
                const ok = a.results?.filter((r) => r.ok).length ?? 0
                return (
                  <li key={a.id}>
                    <Link to='/announcements/$id' params={{ id: String(a.id) }} className='flex flex-wrap items-center gap-3 px-4 py-3 hover:bg-accent/40'>
                      <span aria-hidden className='h-10 w-1 shrink-0 rounded-full' style={{ background: a.payload.embed.enabled ? a.payload.embed.color : 'var(--border)' }} />
                      <div className='min-w-0 flex-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='font-medium'>{a.name}</span>
                          <Pill tone={status.tone}>{status.label}</Pill>
                        </div>
                        <div className='truncate text-xs text-muted-foreground'>
                          {a.targets.length} salon{a.targets.length > 1 ? 's' : ''}
                          {a.status === 'scheduled' && a.scheduledAt && <> · le {dateTime(a.scheduledAt)}</>}
                          {a.sentAt && <> · envoyée {ago(a.sentAt)} ({ok}/{a.results?.length ?? 0})</>}
                          {!a.sentAt && a.status !== 'scheduled' && <> · modifiée {ago(a.updatedAt)}</>}
                          {a.author?.name && <> · par {a.author.name}</>}
                        </div>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      )}
    </Page>
  )
}
