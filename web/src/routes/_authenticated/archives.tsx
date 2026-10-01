import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, Download, Eye, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, UserAvatar } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/archives')({
  component: ArchivesPage,
})

type ArchiveRow = { id: number; guildId: string; guildName: string; channelId: string; channelName: string; messageCount: number; firstAt: number | null; lastAt: number | null; size: number; createdAt: number; author: { name: string | null; avatar: string | null } | null }
type Payload = { archives: ArchiveRow[]; guilds: { id: string; name: string; channels: Channel[] }[] }

const size = (bytes: number) => (bytes > 1_048_576 ? `${(bytes / 1_048_576).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} Ko`)

function ArchivesPage() {
  const { can } = useMe()
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['archives'], queryFn: () => api<Payload>('/archives') })
  const [guildId, setGuildId] = useState<string>('')
  const [channelId, setChannelId] = useState<string | null>(null)
  const [limit, setLimit] = useState(1000)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [deleting, setDeleting] = useState<ArchiveRow | null>(null)
  const currentGuild = guildId || data?.guilds[0]?.id || ''
  const create = useMutation({
    mutationFn: () => api<ArchiveRow>('/archives', { method: 'POST', body: { guildId: currentGuild, channelId, limit, from: from ? new Date(from).getTime() : null, to: to ? new Date(to).getTime() : null } }),
    onSuccess: (a) => { toast.success(`#${a.channelName} archivé (${a.messageCount} messages)`); qc.invalidateQueries({ queryKey: ['archives'] }) },
  })
  const remove = useMutation({ mutationFn: (id: number) => api(`/archives/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Archive supprimée'); setDeleting(null); qc.invalidateQueries({ queryKey: ['archives'] }) } })

  return (
    <Page title='Archives de salons' description='Garde une copie lisible d’un salon (avant de le supprimer, après un événement, pour un dossier) : une page HTML avec les messages, les embeds et les images. Aussi avec /archive sur Discord.'>
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {can('archives.manage') && (
            <Section title='Archiver un salon' description='Les 1 000 derniers messages par défaut (10 000 max). Une période limite aux messages entre ces deux dates.'>
              <form className='grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_8rem_1fr_1fr_auto] lg:items-end' onSubmit={(e) => { e.preventDefault(); if (channelId) create.mutate() }}>
                <div className='grid gap-1.5'>
                  <Label>Serveur</Label>
                  <Select value={currentGuild} onValueChange={(v) => { setGuildId(v); setChannelId(null) }}>
                    <SelectTrigger aria-label='Serveur'><SelectValue /></SelectTrigger>
                    <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className='grid gap-1.5'>
                  <Label>Salon</Label>
                  <ChannelSelect channels={data.guilds.find((g) => g.id === currentGuild)?.channels ?? []} value={channelId} onChange={setChannelId} label='Salon' noneLabel='Choisir un salon' />
                </div>
                <div className='grid gap-1.5'><Label htmlFor='a-limit'>Messages max</Label><Input id='a-limit' type='number' min={1} max={10000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} /></div>
                <div className='grid gap-1.5'><Label htmlFor='a-from'>Depuis (facultatif)</Label><Input id='a-from' type='datetime-local' value={from} onChange={(e) => setFrom(e.target.value)} /></div>
                <div className='grid gap-1.5'><Label htmlFor='a-to'>Jusqu’à (facultatif)</Label><Input id='a-to' type='datetime-local' value={to} onChange={(e) => setTo(e.target.value)} /></div>
                <Button type='submit' loading={create.isPending} disabled={!channelId}><Archive /> Archiver</Button>
              </form>
            </Section>
          )}
          <Section title={`${data.archives.length} archive${data.archives.length > 1 ? 's' : ''}`}>
            {!data.archives.length ? <EmptyState title='Aucune archive' icon={Archive}>Archive un salon ci-dessus ou avec /archive.</EmptyState> : (
              <ul className='divide-y'>
                {data.archives.map((a) => (
                  <li key={a.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                    <div className='min-w-0 flex-1 basis-60'>
                      <div className='font-medium'>#{a.channelName} <span className='text-sm font-normal text-muted-foreground'>· {a.guildName}</span></div>
                      <div className='flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground'>
                        <span>{a.messageCount} messages{a.firstAt && a.lastAt ? ` du ${dateTime(a.firstAt)} au ${dateTime(a.lastAt)}` : ''}</span>
                        <span>· {size(a.size)}</span>
                        <span className='inline-flex items-center gap-1'>· <UserAvatar src={a.author?.avatar} name={a.author?.name ?? '?'} className='size-4' />{a.author?.name} le {dateTime(a.createdAt)}</span>
                      </div>
                    </div>
                    <div className='flex gap-1'>
                      <Button size='sm' variant='outline' asChild><a href={`/api/archives/${a.id}/file`} target='_blank' rel='noreferrer'><Eye /> Voir</a></Button>
                      <Button size='sm' variant='ghost' asChild><a href={`/api/archives/${a.id}/file?download=true`}><Download /> Télécharger</a></Button>
                      {can('archives.manage') && <Button size='icon' variant='danger-ghost' aria-label={`Supprimer l’archive de #${a.channelName}`} onClick={() => setDeleting(a)}><Trash2 /></Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title='Supprimer cette archive ?' desc='Le fichier est effacé du serveur du bot.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting.id)} />
    </Page>
  )
}
