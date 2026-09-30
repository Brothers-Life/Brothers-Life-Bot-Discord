import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { TicketCategory, TicketConfig } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Section, EmptyState, RankBadge } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'

const NONE = '__none__'

export function TicketConfigPanel({ guildId }: { guildId: string }) {
  const { can } = useMe()
  const manage = can('tickets.manage')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['ticket-config', guildId], queryFn: () => api<TicketConfig>(`/tickets/config/${guildId}`) })
  const [editing, setEditing] = useState<Partial<TicketCategory> | null>(null)
  const [deleting, setDeleting] = useState<TicketCategory | null>(null)
  const [draft, setDraft] = useState<{ panelChannelId?: string | null; panelTitle?: string; panelText?: string; maxOpen?: number }>({})

  const refresh = () => qc.invalidateQueries({ queryKey: ['ticket-config', guildId] })
  const saveSettings = useMutation({
    mutationFn: () => api(`/tickets/config/${guildId}/settings`, { method: 'PUT', body: draft }),
    onSuccess: () => { toast.success('Réglages enregistrés'); setDraft({}); refresh() },
  })
  const publish = useMutation({
    mutationFn: () => api(`/tickets/config/${guildId}/publish`, { method: 'POST' }),
    onSuccess: () => { toast.success('Panneau publié'); refresh() },
  })
  const remove = useMutation({
    mutationFn: (c: TicketCategory) => api(`/tickets/config/${guildId}/categories/${c.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Catégorie supprimée'); setDeleting(null); refresh() },
  })

  if (!data) return <Skeleton className='h-64 w-full' />
  const settings = { ...data.settings, ...draft }
  const dirty = Object.keys(draft).length > 0

  return (
    <div className='grid gap-6'>
      <Section
        title='Panneau d’ouverture'
        description='Le message avec un bouton par catégorie, posté dans un salon du serveur.'
        actions={manage && (
          <Button size='sm' variant='outline' onClick={() => publish.mutate()} disabled={publish.isPending || dirty}>
            <Send /> {data.settings.panelMessageId ? 'Mettre à jour le panneau' : 'Publier le panneau'}
          </Button>
        )}
      >
        <form
          className='grid gap-4 p-4'
          onSubmit={(e) => {
            e.preventDefault()
            saveSettings.mutate()
          }}
        >
          <div className='grid gap-4 sm:grid-cols-[1fr_10rem]'>
            <div className='grid gap-1.5'>
              <Label>Salon du panneau</Label>
              <Select value={settings.panelChannelId ?? NONE} onValueChange={(v) => setDraft((d) => ({ ...d, panelChannelId: v === NONE ? null : v }))} disabled={!manage}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Aucun</SelectItem>
                  {data.channels.map((c) => <SelectItem key={c.id} value={c.id} disabled={!c.canSend}>#{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='max-open'>Tickets ouverts max</Label>
              <Input id='max-open' type='number' min={1} max={10} value={settings.maxOpen} onChange={(e) => setDraft((d) => ({ ...d, maxOpen: Number(e.target.value) }))} disabled={!manage} />
            </div>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='panel-title'>Titre</Label>
            <Input id='panel-title' value={settings.panelTitle} maxLength={100} onChange={(e) => setDraft((d) => ({ ...d, panelTitle: e.target.value }))} disabled={!manage} />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='panel-text'>Texte</Label>
            <Textarea id='panel-text' value={settings.panelText} maxLength={1000} rows={3} onChange={(e) => setDraft((d) => ({ ...d, panelText: e.target.value }))} disabled={!manage} />
          </div>
          {manage && dirty && <div><Button type='submit' disabled={saveSettings.isPending}>Enregistrer les réglages</Button></div>}
        </form>
      </Section>

      <Section
        title='Catégories'
        description='Chaque catégorie devient un bouton. Le staff qui voit les tickets : les rôles liés aux rangs choisis sur ce serveur, plus les rôles ajoutés.'
        actions={manage && <Button size='sm' onClick={() => setEditing({ name: '', rankIds: [], roleIds: [] })}><Plus /> Catégorie</Button>}
      >
        {!data.categories.length ? <EmptyState title='Aucune catégorie'>Crée par exemple « Support », « Signalement » et « Partenariat ».</EmptyState> : (
          <ul className='divide-y'>
            {data.categories.map((c) => (
              <li key={c.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                <span className='w-6 text-center text-lg'>{c.emoji}</span>
                <div className='min-w-48 flex-1'>
                  <div className='font-medium'>{c.name}</div>
                  <div className='text-xs text-muted-foreground'>
                    {c.description ?? 'Sans description'}
                    {' · '}transcripts : {c.transcriptChannelId ? `#${data.channels.find((ch) => ch.id === c.transcriptChannelId)?.name ?? 'salon supprimé'}` : 'salon de logs « Tickets »'}
                  </div>
                  <div className='mt-1 flex flex-wrap gap-1'>
                    {c.rankIds.map((id) => { const r = data.ranks.find((x) => x.id === id); return r ? <RankBadge key={id} name={r.name} color={r.color} /> : null })}
                    {c.roleIds.map((id) => <span key={id} className='rounded-md border px-2 py-0.5 text-xs'>@{data.roles.find((r) => r.id === id)?.name ?? id}</span>)}
                  </div>
                </div>
                {manage && (
                  <div className='flex gap-2'>
                    <Button size='sm' variant='outline' onClick={() => setEditing(c)}><Pencil /> Modifier</Button>
                    <Button size='sm' variant='ghost' className='text-destructive' onClick={() => setDeleting(c)}>Supprimer</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {editing && <CategoryDialog guildId={guildId} config={data} initial={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Supprimer la catégorie ${deleting?.name} ?`}
        desc='Le bouton disparaîtra à la prochaine mise à jour du panneau. Les tickets déjà ouverts ne sont pas touchés.'
        confirmText='Supprimer'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => deleting && remove.mutate(deleting)}
      />
    </div>
  )
}

function CategoryDialog({ guildId, config, initial, onClose }: { guildId: string; config: TicketConfig; initial: Partial<TicketCategory>; onClose: () => void }) {
  const qc = useQueryClient()
  const [c, setC] = useState(initial)
  const toggle = <K extends 'rankIds' | 'roleIds'>(key: K, value: TicketCategory[K][number]) =>
    setC((prev) => {
      const list = (prev[key] ?? []) as (typeof value)[]
      return { ...prev, [key]: list.includes(value) ? list.filter((v) => v !== value) : [...list, value] }
    })

  const save = useMutation({
    mutationFn: () => api(`/tickets/config/${guildId}/categories`, {
      method: 'PUT',
      body: {
        ...(c.id ? { id: c.id } : {}),
        name: c.name ?? '',
        emoji: c.emoji || null,
        description: c.description || null,
        parentChannelId: c.parentChannelId || null,
        transcriptChannelId: c.transcriptChannelId || null,
        rankIds: c.rankIds ?? [],
        roleIds: c.roleIds ?? [],
        position: c.position ?? 0,
      },
    }),
    onSuccess: () => {
      toast.success('Catégorie enregistrée. Mets à jour le panneau pour afficher les changements.')
      qc.invalidateQueries({ queryKey: ['ticket-config', guildId] })
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader><DialogTitle>{c.id ? `Modifier ${initial.name}` : 'Nouvelle catégorie'}</DialogTitle></DialogHeader>
        <form id='category-form' className='grid gap-4' onSubmit={(e) => { e.preventDefault(); if (c.name?.trim()) save.mutate() }}>
          <div className='grid gap-4 sm:grid-cols-[5rem_1fr]'>
            <div className='grid gap-1.5'>
              <Label htmlFor='cat-emoji'>Émoji</Label>
              <Input id='cat-emoji' value={c.emoji ?? ''} onChange={(e) => setC({ ...c, emoji: e.target.value })} placeholder='🛟' />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='cat-name'>Nom</Label>
              <Input id='cat-name' value={c.name ?? ''} maxLength={50} required onChange={(e) => setC({ ...c, name: e.target.value })} placeholder='Support' />
            </div>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='cat-desc'>Description</Label>
            <Input id='cat-desc' value={c.description ?? ''} maxLength={100} onChange={(e) => setC({ ...c, description: e.target.value })} placeholder='Une question, un problème' />
          </div>
          <div className='grid gap-1.5'>
            <Label>Catégorie Discord où créer les salons</Label>
            <Select value={c.parentChannelId ?? NONE} onValueChange={(v) => setC({ ...c, parentChannelId: v === NONE ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Aucune (en haut du serveur)</SelectItem>
                {config.categoryChannels.map((ch) => <SelectItem key={ch.id} value={ch.id}>{ch.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <Label>Salon des transcripts</Label>
            <Select value={c.transcriptChannelId ?? NONE} onValueChange={(v) => setC({ ...c, transcriptChannelId: v === NONE ? null : v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>Aucun (seulement le salon de logs « Tickets »)</SelectItem>
                {config.channels.map((ch) => (
                  <SelectItem key={ch.id} value={ch.id} disabled={!ch.canSend}>#{ch.name}{ch.parent ? ` · ${ch.parent}` : ''}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className='text-xs text-muted-foreground'>À la fermeture, la conversation y est envoyée en fichier texte.</p>
          </div>
          <fieldset>
            <legend className='mb-2 text-sm font-medium'>Rangs du staff qui voient ces tickets</legend>
            <div className='flex flex-wrap gap-3'>
              {config.ranks.map((r) => (
                <label key={r.id} className='flex items-center gap-2 text-sm'>
                  <Checkbox checked={(c.rankIds ?? []).includes(r.id)} onCheckedChange={() => toggle('rankIds', r.id)} />
                  <RankBadge name={r.name} color={r.color} />
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className='mb-2 text-sm font-medium'>Rôles en plus</legend>
            <div className='grid max-h-48 gap-1 overflow-y-auto rounded-md border p-2'>
              {config.roles.map((r) => (
                <label key={r.id} className='flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50'>
                  <Checkbox checked={(c.roleIds ?? []).includes(r.id)} onCheckedChange={() => toggle('roleIds', r.id)} />
                  {r.name}
                </label>
              ))}
            </div>
          </fieldset>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='category-form' disabled={!c.name?.trim() || save.isPending}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
