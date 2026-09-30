import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, CalendarClock, Copy, Send, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Announcement, AnnouncementEmbed, AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DiscordPreview } from '@/features/announcements/discord-preview'
import { TargetsEditor } from '@/features/announcements/targets-editor'
import { STATUS } from '@/features/announcements/status'
import { EMPTY_EMBED, EmbedFields, cleanEmbed } from '@/features/announcements/embed-editor'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/announcements/$id')({
  component: AnnouncementEditor,
})

type Draft = { name: string; content: string; embed: AnnouncementEmbed; targets: AnnouncementTarget[] }

function AnnouncementEditor() {
  const { id } = Route.useParams()
  const isNew = id === 'new'
  const existing = useQuery({ queryKey: ['announcement', id], queryFn: () => api<Announcement>(`/announcements/${id}`), enabled: !isNew })
  const guilds = useQuery({ queryKey: ['announcement-targets'], queryFn: () => api<AnnouncementTargetsPayload>('/announcements/targets') })

  if ((!isNew && !existing.data) || !guilds.data) {
    return <Page title='Annonce'><Skeleton className='h-96 w-full' /></Page>
  }
  return <Editor key={`${id}-${existing.data?.updatedAt ?? 0}`} announcement={isNew ? null : existing.data!} guilds={guilds.data} />
}

function Editor({ announcement, guilds }: { announcement: Announcement | null; guilds: AnnouncementTargetsPayload }) {
  const { can } = useMe()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const editable = can('announcements.manage') && (!announcement || ['draft', 'scheduled', 'failed'].includes(announcement.status))
  const [draft, setDraft] = useState<Draft>(() => ({
    name: announcement?.name ?? '',
    content: announcement?.payload.content ?? '',
    embed: { ...EMPTY_EMBED, ...announcement?.payload.embed },
    targets: announcement?.targets ?? [],
  }))
  const [previewTarget, setPreviewTarget] = useState(0)
  const [confirmSend, setConfirmSend] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [scheduleAt, setScheduleAt] = useState('')

  const roles = new Map(guilds.flatMap((g) => g.roles.map((r) => [r.id, r.name] as const)))
  const setEmbed = (patch: Partial<AnnouncementEmbed>) => setDraft((d) => ({ ...d, embed: { ...d.embed, ...patch } }))
  const body = () => ({
    name: draft.name,
    payload: { content: draft.content, embed: cleanEmbed(draft.embed) },
    targets: draft.targets,
  })

  const refresh = (a: Announcement) => {
    qc.invalidateQueries({ queryKey: ['announcements'] })
    qc.setQueryData(['announcement', String(a.id)], a)
  }
  // Saves first (creating the announcement if needed), then runs the action
  const saveThen = async (then?: (a: Announcement) => Promise<Announcement>) => {
    const saved = announcement
      ? await api<Announcement>(`/announcements/${announcement.id}`, { method: 'PUT', body: body() })
      : await api<Announcement>('/announcements', { method: 'POST', body: body() })
    return then ? then(saved) : saved
  }

  const save = useMutation({
    mutationFn: () => saveThen(),
    onSuccess: (a) => {
      toast.success('Brouillon enregistré')
      refresh(a)
      if (!announcement) navigate({ to: '/announcements/$id', params: { id: String(a.id) }, replace: true })
    },
  })
  const send = useMutation({
    mutationFn: () => saveThen((a) => api<Announcement>(`/announcements/${a.id}/send`, { method: 'POST', body: { confirm: true } })),
    onSuccess: (a) => {
      setConfirmSend(false)
      if (a.status === 'sent') toast.success('Annonce envoyée')
      else toast.warning('Annonce envoyée en partie : regarde le détail par salon')
      refresh(a)
      navigate({ to: '/announcements/$id', params: { id: String(a.id) }, replace: true })
    },
  })
  const schedule = useMutation({
    mutationFn: () => saveThen((a) => api<Announcement>(`/announcements/${a.id}/schedule`, { method: 'POST', body: { at: new Date(scheduleAt).getTime() } })),
    onSuccess: (a) => {
      toast.success(`Annonce programmée le ${dateTime(a.scheduledAt)}`)
      refresh(a)
      navigate({ to: '/announcements/$id', params: { id: String(a.id) }, replace: true })
    },
  })
  const unschedule = useMutation({
    mutationFn: () => api<Announcement>(`/announcements/${announcement!.id}/unschedule`, { method: 'POST' }),
    onSuccess: (a) => { toast.success('Programmation annulée'); refresh(a) },
  })
  const duplicate = useMutation({
    mutationFn: () => api<Announcement>(`/announcements/${announcement!.id}/duplicate`, { method: 'POST' }),
    onSuccess: (a) => { qc.invalidateQueries({ queryKey: ['announcements'] }); navigate({ to: '/announcements/$id', params: { id: String(a.id) } }) },
  })
  const remove = useMutation({
    mutationFn: () => api<{ announcement: Announcement | null }>(`/announcements/${announcement!.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: (r) => {
      setConfirmDelete(false)
      qc.invalidateQueries({ queryKey: ['announcements'] })
      if (r.announcement) { toast.success('Messages supprimés de Discord'); refresh(r.announcement) }
      else { toast.success('Brouillon supprimé'); navigate({ to: '/announcements' }) }
    },
  })

  const target = draft.targets[previewTarget] ?? draft.targets[0]
  const status = announcement ? STATUS[announcement.status] : null
  const e = draft.embed

  return (
    <Page
      title={announcement ? announcement.name : 'Nouvelle annonce'}
      actions={
        <div className='flex flex-wrap items-center gap-2'>
          <Button asChild variant='ghost'><Link to='/announcements'><ArrowLeft /> Annonces</Link></Button>
          {status && <Pill tone={status.tone}>{status.label}{announcement?.status === 'scheduled' && announcement.scheduledAt ? ` · ${dateTime(announcement.scheduledAt)}` : ''}</Pill>}
          {announcement && can('announcements.manage') && <Button variant='outline' onClick={() => duplicate.mutate()}><Copy /> Dupliquer</Button>}
          {announcement && can('announcements.manage') && announcement.status !== 'deleted' && (
            <Button variant='ghost' className='text-destructive' onClick={() => setConfirmDelete(true)}><Trash2 /> Supprimer</Button>
          )}
        </div>
      }
    >
      <div className='grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]'>
        <div className='grid content-start gap-6'>
          <Section title='Message'>
            <div className='grid gap-4 p-4'>
              <div className='grid gap-1.5'>
                <Label htmlFor='a-name'>Nom interne</Label>
                <Input id='a-name' value={draft.name} maxLength={100} placeholder='Ouverture du serveur RP' disabled={!editable} onChange={(ev) => setDraft({ ...draft, name: ev.target.value })} />
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='a-content'>Texte au-dessus de l’embed <span className='text-muted-foreground'>({draft.content.length}/2000)</span></Label>
                <Textarea id='a-content' rows={3} maxLength={2000} value={draft.content} disabled={!editable} onChange={(ev) => setDraft({ ...draft, content: ev.target.value })} placeholder='Markdown Discord accepté : **gras**, *italique*, liens…' />
              </div>
            </div>
          </Section>

          <Section title='Embed' actions={<Switch checked={e.enabled} onCheckedChange={(v) => setEmbed({ enabled: v })} disabled={!editable} aria-label='Activer l’embed' />}>
            {e.enabled && (
              <div className='p-4'>
                <EmbedFields embed={e} onChange={setEmbed} disabled={!editable} />
              </div>
            )}
          </Section>

          <Section title='Où l’envoyer' description='Un ou plusieurs salons, sur un ou plusieurs serveurs. Le ping se règle salon par salon.'>
            <div className='p-4'>
              <TargetsEditor guilds={guilds} targets={draft.targets} onChange={(targets) => setDraft({ ...draft, targets })} disabled={!editable} />
            </div>
          </Section>

          {announcement?.results && (
            <Section title='Résultat de l’envoi'>
              <ul className='divide-y text-sm'>
                {announcement.results.map((r) => {
                  const guild = guilds.find((g) => g.id === r.guildId)
                  const channel = guild?.channels.find((c) => c.id === r.channelId)
                  return (
                    <li key={r.channelId} className='flex flex-wrap items-center gap-2 px-4 py-2'>
                      <span className='flex-1'>{guild?.name ?? r.guildId} · #{channel?.name ?? r.channelId}</span>
                      {r.deleted ? <Pill>Supprimé</Pill> : r.ok ? <Pill tone='success'>Envoyé</Pill> : <Pill tone='danger'>{r.error}</Pill>}
                    </li>
                  )
                })}
              </ul>
            </Section>
          )}

          {editable && (
            <div className='flex flex-wrap items-center gap-3 rounded-lg border bg-card p-4'>
              <Button variant='outline' onClick={() => save.mutate()} disabled={save.isPending || !draft.name.trim()}>Enregistrer le brouillon</Button>
              <div className='flex flex-wrap items-center gap-2'>
                <Input type='datetime-local' value={scheduleAt} onChange={(ev) => setScheduleAt(ev.target.value)} className='w-56' aria-label='Date d’envoi' />
                <Button variant='outline' onClick={() => schedule.mutate()} disabled={!scheduleAt || !draft.targets.length || !draft.name.trim() || schedule.isPending}>
                  <CalendarClock /> Programmer
                </Button>
                {announcement?.status === 'scheduled' && <Button variant='ghost' onClick={() => unschedule.mutate()}>Annuler la programmation</Button>}
              </div>
              <Button className='ms-auto' onClick={() => setConfirmSend(true)} disabled={!draft.targets.length || !draft.name.trim()}>
                <Send /> Envoyer maintenant
              </Button>
            </div>
          )}
        </div>

        <div className='xl:sticky xl:top-20 xl:self-start'>
          <div className='mb-2 flex items-center justify-between gap-2'>
            <h2 className='text-sm font-semibold'>Aperçu</h2>
            {draft.targets.length > 1 && (
              <Select value={String(previewTarget)} onValueChange={(v) => setPreviewTarget(Number(v))}>
                <SelectTrigger className='h-8 w-56' aria-label='Salon de l’aperçu'><SelectValue /></SelectTrigger>
                <SelectContent>
                  {draft.targets.map((t, i) => {
                    const guild = guilds.find((g) => g.id === t.guildId)
                    return <SelectItem key={t.channelId} value={String(i)}>{guild?.name} · #{guild?.channels.find((c) => c.id === t.channelId)?.name}</SelectItem>
                  })}
                </SelectContent>
              </Select>
            )}
          </div>
          <DiscordPreview content={draft.content} embed={draft.embed} target={target} roles={roles} />
        </div>
      </div>

      <ConfirmDialog
        open={confirmSend}
        onOpenChange={setConfirmSend}
        title='Envoyer l’annonce maintenant ?'
        desc={`Elle part dans ${draft.targets.length} salon${draft.targets.length > 1 ? 's' : ''}${draft.targets.some((t) => t.ping === 'everyone' || t.ping === 'here') ? ', avec un ping @everyone ou @here' : ''}. Une annonce envoyée ne se modifie plus.`}
        confirmText='Envoyer'
        isLoading={send.isPending}
        handleConfirm={() => send.mutate()}
      />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={announcement && ['draft', 'scheduled', 'failed'].includes(announcement.status) ? 'Supprimer ce brouillon ?' : 'Supprimer les messages envoyés ?'}
        desc={announcement && ['draft', 'scheduled', 'failed'].includes(announcement.status) ? 'Le brouillon est supprimé définitivement.' : 'Les messages sont supprimés de chaque salon Discord. L’annonce reste dans l’historique.'}
        confirmText='Supprimer'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => remove.mutate()}
      />
    </Page>
  )
}
