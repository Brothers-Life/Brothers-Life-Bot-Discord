import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Save, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, AnnouncementTargetsPayload } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DiscordPreview } from '@/features/announcements/discord-preview'
import { EMPTY_EMBED } from '@/features/announcements/embed-editor'
import { ChannelTargets, type ChannelTarget } from '@/features/messages/channel-targets'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { ColorPicker } from '@/components/app/color-picker'

export const Route = createFileRoute('/_authenticated/changelog')({
  component: ChangelogPage,
})

type ItemType = 'added' | 'changed' | 'fixed' | 'removed' | 'security'
type Entry = {
  id: number; version: string | null; title: string; intro: string; items: { type: ItemType; text: string }[]; image: string | null; color: string
  status: 'draft' | 'published'; targets: ChannelTarget[]; messages: (ChannelTarget & { messageId: string })[]; updatedAt: number; publishedAt: number | null
}
const TYPES: Record<ItemType, { label: string; emoji: string; tone: 'success' | 'accent' | 'warning' | 'danger' | 'neutral' }> = {
  added: { label: 'Ajouts', emoji: '✨', tone: 'success' },
  changed: { label: 'Changements', emoji: '🔧', tone: 'accent' },
  fixed: { label: 'Corrections', emoji: '🐛', tone: 'warning' },
  removed: { label: 'Retraits', emoji: '🗑️', tone: 'danger' },
  security: { label: 'Sécurité', emoji: '🔒', tone: 'neutral' },
}

function toEmbed(e: Omit<Entry, 'id' | 'status' | 'messages' | 'updatedAt' | 'publishedAt'>): AnnouncementEmbed {
  const fields = (Object.keys(TYPES) as ItemType[])
    .map((type) => ({ type, lines: e.items.filter((i) => i.type === type && i.text.trim()).map((i) => `• ${i.text}`) }))
    .filter((g) => g.lines.length)
    .map((g) => ({ name: `${TYPES[g.type].emoji} ${TYPES[g.type].label}`, value: g.lines.join('\n'), inline: false }))
  return { ...EMPTY_EMBED, title: `${e.version ? `${e.version} · ` : ''}${e.title}`, description: e.intro, color: e.color, authorName: 'Changelog', imageUrl: e.image, timestamp: true, fields }
}

function ChangelogPage() {
  const { can } = useMe()
  const { data: list } = useQuery({ queryKey: ['changelog'], queryFn: () => api<Entry[]>('/changelog') })
  const guilds = useQuery({ queryKey: ['changelog-targets'], queryFn: () => api<AnnouncementTargetsPayload>('/changelog/targets') })
  const [selected, setSelected] = useState<number | 'new' | null>(null)
  const current = selected === 'new' ? null : list?.find((e) => e.id === selected) ?? null
  return (
    <Page
      title='Changelog'
      description='Les nouveautés de tes serveurs, rangées par type et publiées dans les salons choisis. Une entrée modifiée après publication est mise à jour partout. Les membres la retrouvent avec /changelog.'
      actions={can('changelog.manage') && <Button onClick={() => setSelected('new')}><Plus /> Nouvelle entrée</Button>}
    >
      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]'>
        <Section title='Entrées'>
          {!list ? <Skeleton className='m-4 h-24' /> : !list.length ? <EmptyState title='Aucune entrée'>Écris ta première mise à jour.</EmptyState> : (
            <ul className='divide-y'>
              {list.map((e) => (
                <li key={e.id}>
                  <button type='button' onClick={() => setSelected(e.id)} className={cn('w-full px-4 py-3 text-start transition-colors hover:bg-accent/40', selected === e.id && 'bg-primary/10')}>
                    <div className='flex items-center gap-2 font-medium'>
                      {e.version && <Pill tone='accent'>{e.version}</Pill>}
                      <span className='truncate'>{e.title}</span>
                    </div>
                    <div className='text-xs text-muted-foreground'>{e.status === 'published' ? `Publiée le ${dateTime(e.publishedAt)}` : 'Brouillon'} · {e.items.length} élément{e.items.length > 1 ? 's' : ''}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
        {selected !== null && guilds.data
          ? <EntryEditor key={`${selected}-${current?.updatedAt ?? 0}`} entry={current} guilds={guilds.data} onSaved={setSelected} onDeleted={() => setSelected(null)} />
          : <div className='grid place-items-center rounded-lg border border-dashed p-12 text-sm text-muted-foreground'>Choisis une entrée ou crées-en une.</div>}
      </div>
    </Page>
  )
}

function EntryEditor({ entry, guilds, onSaved, onDeleted }: { entry: Entry | null; guilds: AnnouncementTargetsPayload; onSaved: (id: number) => void; onDeleted: () => void }) {
  const { can } = useMe()
  const manage = can('changelog.manage')
  const qc = useQueryClient()
  const [e, setE] = useState({
    version: entry?.version ?? '', title: entry?.title ?? '', intro: entry?.intro ?? '', items: entry?.items ?? [{ type: 'added' as ItemType, text: '' }],
    image: entry?.image ?? '', color: entry?.color ?? '#d6a249', targets: entry?.targets ?? [],
  })
  const [deleting, setDeleting] = useState(false)
  const body = () => ({ ...e, version: e.version || null, image: e.image || null, items: e.items.filter((i) => i.text.trim()) })
  const refresh = (saved: Entry) => { qc.invalidateQueries({ queryKey: ['changelog'] }); onSaved(saved.id) }
  const save = useMutation({
    mutationFn: () => (entry ? api<Entry>(`/changelog/${entry.id}`, { method: 'PUT', body: body() }) : api<Entry>('/changelog', { method: 'POST', body: body() })),
    onSuccess: (saved) => { toast.success(entry?.status === 'published' ? 'Enregistré et mis à jour partout' : 'Brouillon enregistré'); refresh(saved) },
  })
  const publish = useMutation({
    mutationFn: async () => {
      const saved = entry ? await api<Entry>(`/changelog/${entry.id}`, { method: 'PUT', body: body() }) : await api<Entry>('/changelog', { method: 'POST', body: body() })
      return api<Entry & { results: { ok: boolean }[] }>(`/changelog/${saved.id}/publish`, { method: 'POST' })
    },
    onSuccess: (saved) => {
      const failed = saved.results.filter((r) => !r.ok).length
      if (failed) toast.warning(`Publiée, sauf dans ${failed} salon(s)`)
      else toast.success('Changelog publié')
      refresh(saved)
    },
  })
  const remove = useMutation({
    mutationFn: () => api(`/changelog/${entry!.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Entrée supprimée'); qc.invalidateQueries({ queryKey: ['changelog'] }); onDeleted() },
  })
  const moveItem = (from: number, to: number) => {
    const items = [...e.items]
    const [it] = items.splice(from, 1)
    items.splice(to, 0, it)
    setE({ ...e, items })
  }

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]'>
      <div className='grid content-start gap-6'>
        <Section title={entry ? 'Modifier l’entrée' : 'Nouvelle entrée'} actions={entry && manage && <Button size='sm' variant='danger-ghost' onClick={() => setDeleting(true)}><Trash2 /> Supprimer</Button>}>
          <div className='grid gap-4 p-4'>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[8rem_1fr_6rem]'>
              <div className='grid gap-1.5'><Label htmlFor='cl-v'>Version</Label><Input id='cl-v' value={e.version} maxLength={30} placeholder='v2.4' disabled={!manage} onChange={(ev) => setE({ ...e, version: ev.target.value })} /></div>
              <div className='grid gap-1.5'><Label htmlFor='cl-t'>Titre</Label><Input id='cl-t' value={e.title} maxLength={150} placeholder='Mise à jour d’automne' disabled={!manage} onChange={(ev) => setE({ ...e, title: ev.target.value })} /></div>
              <div className='grid gap-1.5'><Label htmlFor='cl-c'>Couleur</Label><ColorPicker disabled={!manage} id='cl-c' value={e.color} onChange={(hex) => setE({ ...e, color: hex })} /></div>
            </div>
            <div className='grid gap-1.5'><Label htmlFor='cl-i'>Introduction</Label><Textarea id='cl-i' rows={3} maxLength={1500} value={e.intro} disabled={!manage} onChange={(ev) => setE({ ...e, intro: ev.target.value })} /></div>
            <div className='grid gap-1.5'><Label htmlFor='cl-img'>Image (adresse https, facultatif)</Label><Input id='cl-img' value={e.image} placeholder='https://…' disabled={!manage} onChange={(ev) => setE({ ...e, image: ev.target.value })} /></div>
            <fieldset className='grid gap-2'>
              <legend className='mb-1 text-sm font-medium'>Éléments ({e.items.length}/60)</legend>
              {e.items.map((item, i) => (
                <div key={i} className='grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[10rem_1fr_auto]'>
                  <Select value={item.type} disabled={!manage} onValueChange={(v) => setE({ ...e, items: e.items.map((x, j) => (j === i ? { ...x, type: v as ItemType } : x)) })}>
                    <SelectTrigger aria-label='Type'><SelectValue /></SelectTrigger>
                    <SelectContent>{(Object.keys(TYPES) as ItemType[]).map((t) => <SelectItem key={t} value={t}>{TYPES[t].emoji} {TYPES[t].label}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input value={item.text} maxLength={300} placeholder='Ce qui a changé' aria-label={`Élément ${i + 1}`} disabled={!manage}
                    onChange={(ev) => setE({ ...e, items: e.items.map((x, j) => (j === i ? { ...x, text: ev.target.value } : x)) })}
                    onKeyDown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); setE({ ...e, items: [...e.items.slice(0, i + 1), { type: item.type, text: '' }, ...e.items.slice(i + 1)] }) } }}
                  />
                  <div className='flex'>
                    <Button size='icon' variant='ghost' aria-label='Monter' disabled={!manage || i === 0} onClick={() => moveItem(i, i - 1)}><ArrowUp /></Button>
                    <Button size='icon' variant='ghost' aria-label='Descendre' disabled={!manage || i === e.items.length - 1} onClick={() => moveItem(i, i + 1)}><ArrowDown /></Button>
                    <Button size='icon' variant='ghost' aria-label='Supprimer' disabled={!manage} onClick={() => setE({ ...e, items: e.items.filter((_, j) => j !== i) })}><X /></Button>
                  </div>
                </div>
              ))}
              {manage && e.items.length < 60 && <Button size='sm' variant='outline' className='justify-self-start' onClick={() => setE({ ...e, items: [...e.items, { type: 'added', text: '' }] })}><Plus /> Élément</Button>}
              <p className='text-xs text-muted-foreground'>Astuce : Entrée ajoute un élément du même type juste dessous.</p>
            </fieldset>
          </div>
        </Section>
        <Section title='Où publier'>
          <div className='p-4'><ChannelTargets guilds={guilds} value={e.targets} disabled={!manage} onChange={(targets) => setE({ ...e, targets })} /></div>
        </Section>
        {manage && (
          <div className='flex flex-wrap justify-end gap-2'>
            <Button variant='outline' onClick={() => save.mutate()} disabled={!e.title.trim() || save.isPending}><Save /> {entry?.status === 'published' ? 'Enregistrer et mettre à jour' : 'Enregistrer le brouillon'}</Button>
            {entry?.status !== 'published' && <Button onClick={() => publish.mutate()} disabled={!e.title.trim() || !e.targets.length || publish.isPending}><Send /> Publier</Button>}
          </div>
        )}
      </div>
      <div className='xl:sticky xl:top-20 xl:self-start'>
        <h3 className='mb-2 text-sm font-semibold'>Aperçu</h3>
        <DiscordPreview content='' embed={toEmbed({ ...e, version: e.version || null, image: e.image || null })} roles={new Map()} />
      </div>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title='Supprimer cette entrée ?' desc='Elle est aussi supprimée des salons où elle a été publiée.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
    </div>
  )
}
