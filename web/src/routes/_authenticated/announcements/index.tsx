import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Repeat, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Announcement, AnnouncementTemplate } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { STATUS } from '@/features/announcements/status'
import { AnnouncementsCalendar } from '@/features/announcements/calendar'
import { describeRecurrence } from '@/features/announcements/schedule-editor'

export const Route = createFileRoute('/_authenticated/announcements/')({
  component: AnnouncementsPage,
})

function AnnouncementsPage() {
  const { can } = useMe()
  const { data, isLoading } = useQuery({ queryKey: ['announcements'], queryFn: () => api<Announcement[]>('/announcements'), refetchInterval: 30_000 })

  return (
    <Page
      title='Annonces'
      description='Un message et son embed, envoyés sur un ou plusieurs serveurs du réseau, tout de suite, à une date choisie ou de façon récurrente, avec le ping que tu veux dans chaque salon.'
      actions={can('announcements.manage') && (
        <Button asChild>
          <Link to='/announcements/$id' params={{ id: 'new' }}><Plus /> Nouvelle annonce</Link>
        </Button>
      )}
    >
      <Tabs defaultValue='list'>
        <TabsList>
          <TabsTrigger value='list'>Annonces</TabsTrigger>
          <TabsTrigger value='calendar'>Calendrier</TabsTrigger>
          <TabsTrigger value='templates'>Modèles</TabsTrigger>
        </TabsList>
        <TabsContent value='list' className='mt-4'>
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
                        <Link to='/announcements/$id' params={{ id: String(a.id) }} className='flex flex-wrap items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/40'>
                          <span aria-hidden className='h-10 w-1 shrink-0 rounded-full' style={{ background: a.payload.embed.enabled ? a.payload.embed.color : 'var(--border)' }} />
                          <div className='min-w-0 flex-1'>
                            <div className='flex flex-wrap items-center gap-2'>
                              <span className='font-medium'>{a.name}</span>
                              <Pill tone={status.tone}>{status.label}</Pill>
                              {a.recurrence && a.status === 'scheduled' && <Pill tone='accent'><Repeat className='size-3' /> {describeRecurrence(a.recurrence)}</Pill>}
                            </div>
                            <div className='truncate text-xs text-muted-foreground'>
                              {a.targets.length} salon{a.targets.length > 1 ? 's' : ''}
                              {a.status === 'scheduled' && a.scheduledAt && <> · prochain envoi le {dateTime(a.scheduledAt)}</>}
                              {a.sentAt && <> · envoyée {ago(a.sentAt)} ({ok}/{a.results?.length ?? 0}){a.runCount > 1 ? ` · ${a.runCount} envois` : ''}</>}
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
        </TabsContent>
        <TabsContent value='calendar' className='mt-4'>
          <Section title='Envois à venir'><AnnouncementsCalendar /></Section>
        </TabsContent>
        <TabsContent value='templates' className='mt-4'><Templates /></TabsContent>
      </Tabs>
    </Page>
  )
}

function Templates() {
  const { can } = useMe()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['announcement-templates'], queryFn: () => api<AnnouncementTemplate[]>('/announcements/templates') })
  const [deleting, setDeleting] = useState<AnnouncementTemplate | null>(null)
  const remove = useMutation({
    mutationFn: (t: AnnouncementTemplate) => api(`/announcements/templates/${t.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Modèle supprimé'); setDeleting(null); qc.invalidateQueries({ queryKey: ['announcement-templates'] }) },
  })
  if (!data) return <Skeleton className='h-48 w-full' />
  return (
    <Section title='Modèles' description='Enregistre une annonce comme modèle depuis son éditeur, puis choisis-la en créant une nouvelle annonce.'>
      {!data.length ? <EmptyState title='Aucun modèle'>Bouton « Modèle » dans l’éditeur d’une annonce.</EmptyState> : (
        <ul className='divide-y'>
          {data.map((t) => (
            <li key={t.id} className='flex items-center gap-3 px-4 py-3'>
              <span aria-hidden className='h-8 w-1 shrink-0 rounded-full' style={{ background: t.payload.embed.color }} />
              <div className='min-w-0 flex-1'>
                <div className='font-medium'>{t.name}</div>
                <div className='truncate text-xs text-muted-foreground'>{t.payload.embed.title || t.payload.content || 'Sans titre'} · {t.targets.length} salon(s)</div>
              </div>
              {can('announcements.manage') && <Button size='icon' variant='ghost' className='text-destructive' aria-label={`Supprimer ${t.name}`} onClick={() => setDeleting(t)}><Trash2 /></Button>}
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Supprimer le modèle ${deleting?.name} ?`} desc='Les annonces déjà créées avec ne changent pas.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
    </Section>
  )
}
