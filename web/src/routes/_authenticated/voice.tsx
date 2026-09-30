import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Headphones, Lock, Plus, Settings2, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Guild, Role } from '@/lib/types'
import { ago } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, UserAvatar, GuildIcon } from '@/components/app/ui'
import { CategorySelect, RolesPicker } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/_authenticated/voice')({
  component: VoicePage,
})

type HubConfig = {
  nameTemplate: string; categoryId: string | null; userLimit: number; bitrate: number | null; maxPerUser: number
  allowedRoleIds: string[]; deleteAfterSeconds: number; rememberSettings: boolean; options: Record<string, boolean>
}
type Hub = { id: number; guildId: string; channelId: string; config: HubConfig }
type Room = {
  channelId: string; ownerId: string; createdAt: number; members: number; owner: { name: string | null; avatar: string | null }
  state: { name: string | null; userLimit: number; locked: boolean; hidden: boolean; permitted: string[]; rejected: string[] }
}
type VoicePayload = { hubs: Hub[]; rooms: Room[]; voiceChannels: { id: string; name: string; parent: string | null }[]; categories: { id: string; name: string }[]; roles: Role[]; options: string[] }

const OPTION_LABELS: Record<string, string> = {
  rename: 'Renommer', limit: 'Changer la limite', lock: 'Verrouiller', hide: 'Cacher', permit: 'Autoriser des membres', reject: 'Bloquer des membres',
  kick: 'Expulser', transfer: 'Transférer', claim: 'Réclamer', bitrate: 'Qualité audio', region: 'Région',
}

function VoicePage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState<string | null>(null)
  const current = guildId ?? active.find((g) => g.isMain)?.id ?? active[0]?.id
  const currentGuild = active.find((g) => g.id === current)
  return (
    <Page
      title='Vocaux personnels'
      description='Un salon « créer un vocal » : chaque membre qui le rejoint reçoit son propre salon, qu’il règle lui-même (nom, limite, verrouillage, membres autorisés…). Supprimé quand il est vide.'
      actions={current && (
        <div className='flex items-center gap-2'>
          <Label htmlFor='v-guild' className='text-muted-foreground'>Serveur</Label>
          <Select value={current} onValueChange={setGuildId}>
            <SelectTrigger id='v-guild' className='w-60'>
              <span className='flex items-center gap-2 truncate'>{currentGuild && <GuildIcon src={currentGuild.icon} name={currentGuild.name} className='size-5' />}<SelectValue /></span>
            </SelectTrigger>
            <SelectContent>{active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    >
      {current && <VoiceEditor key={current} guildId={current} />}
    </Page>
  )
}

function VoiceEditor({ guildId }: { guildId: string }) {
  const { can } = useMe()
  const manage = can('voice.manage')
  const qc = useQueryClient()
  const key = ['voice', guildId]
  const { data } = useQuery({ queryKey: key, queryFn: () => api<VoicePayload>(`/voice/${guildId}`), refetchInterval: 15_000 })
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Hub | null>(null)
  const [deleting, setDeleting] = useState<Hub | null>(null)
  const [closing, setClosing] = useState<Room | null>(null)
  const [newHub, setNewHub] = useState({ name: '➕ Créer un salon', categoryId: null as string | null })

  const refresh = () => qc.invalidateQueries({ queryKey: key })
  const create = useMutation({
    mutationFn: () => api(`/voice/${guildId}/hubs`, { method: 'POST', body: newHub }),
    onSuccess: () => { toast.success('Salon « créer un vocal » ajouté'); setCreating(false); refresh() },
  })
  const removeHub = useMutation({
    mutationFn: (h: Hub) => api(`/voice/hubs/${h.id}`, { method: 'DELETE', body: { confirm: true, deleteChannel: true } }),
    onSuccess: () => { toast.success('Supprimé'); setDeleting(null); refresh() },
  })
  const closeRoom = useMutation({
    mutationFn: (r: Room) => api(`/voice/rooms/${r.channelId}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Salon fermé'); setClosing(null); refresh() },
  })

  if (!data) return <Skeleton className='h-80 w-full' />
  const channelName = (id: string) => data.voiceChannels.find((c) => c.id === id)?.name ?? 'salon supprimé'

  return (
    <div className='grid gap-6'>
      <Section
        title='Salons « créer un vocal »'
        actions={manage && <Button size='sm' onClick={() => setCreating(true)} disabled={data.hubs.length >= 5}><Plus /> Ajouter</Button>}
      >
        {!data.hubs.length ? <EmptyState title='Aucun salon « créer un vocal »'>Ajoute-en un : le bot crée le salon, les membres n’ont plus qu’à le rejoindre.</EmptyState> : (
          <ul className='divide-y'>
            {data.hubs.map((h) => (
              <li key={h.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                <span className='grid size-9 place-items-center rounded-lg bg-primary/15 text-primary'><Headphones className='size-4' /></span>
                <div className='min-w-48 flex-1'>
                  <div className='font-medium'>{channelName(h.channelId)}</div>
                  <div className='text-xs text-muted-foreground'>
                    Nom des salons : « {h.config.nameTemplate} » · {h.config.userLimit ? `${h.config.userLimit} places` : 'sans limite'}
                    {h.config.allowedRoleIds.length > 0 && ' · réservé à certains rôles'}
                  </div>
                </div>
                {manage && (
                  <div className='flex gap-2'>
                    <Button size='sm' variant='outline' onClick={() => setEditing(h)}><Settings2 /> Réglages</Button>
                    <Button size='sm' variant='ghost' className='text-destructive' onClick={() => setDeleting(h)}><Trash2 /> Supprimer</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Vocaux ouverts (${data.rooms.length})`} description='Mis à jour toutes les 15 secondes.'>
        {!data.rooms.length ? <EmptyState title='Aucun vocal personnel en ce moment' /> : (
          <ul className='divide-y'>
            {data.rooms.map((r) => (
              <li key={r.channelId} className='flex animate-in flex-wrap items-center gap-3 px-4 py-3 fade-in-0'>
                <UserAvatar src={r.owner.avatar} name={r.owner.name ?? r.ownerId} />
                <div className='min-w-48 flex-1'>
                  <div className='flex flex-wrap items-center gap-2 font-medium'>
                    {r.state.name ?? channelName(r.channelId)}
                    {r.state.locked && <Pill tone='warning'><Lock className='size-3' /> Verrouillé</Pill>}
                    {r.state.hidden && <Pill>Caché</Pill>}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    À {r.owner.name ?? r.ownerId} · créé {ago(r.createdAt)} · <Users className='inline size-3' /> {r.members}{r.state.userLimit ? `/${r.state.userLimit}` : ''}
                  </div>
                </div>
                {manage && <Button size='sm' variant='ghost' className='text-destructive' onClick={() => setClosing(r)}><X /> Fermer</Button>}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className='sm:max-w-md'>
          <DialogHeader><DialogTitle>Nouveau salon « créer un vocal »</DialogTitle></DialogHeader>
          <div className='grid gap-4'>
            <div className='grid gap-1.5'>
              <Label htmlFor='hub-name'>Nom du salon</Label>
              <Input id='hub-name' value={newHub.name} maxLength={100} onChange={(e) => setNewHub({ ...newHub, name: e.target.value })} />
            </div>
            <div className='grid gap-1.5'>
              <Label>Catégorie (les vocaux y sont créés)</Label>
              <CategorySelect categories={data.categories} value={newHub.categoryId} onChange={(v) => setNewHub({ ...newHub, categoryId: v })} label='Catégorie' noneLabel='En haut du serveur' />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setCreating(false)}>Annuler</Button>
            <Button onClick={() => create.mutate()} disabled={create.isPending || !newHub.name.trim()}>Créer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {editing && <HubDialog hub={editing} data={data} onClose={() => { setEditing(null); refresh() }} />}
      <ConfirmDialog
        open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}
        title='Supprimer ce salon « créer un vocal » ?' desc='Le salon est supprimé de Discord. Les vocaux déjà ouverts restent jusqu’à ce qu’ils se vident.'
        confirmText='Supprimer' destructive isLoading={removeHub.isPending} handleConfirm={() => deleting && removeHub.mutate(deleting)}
      />
      <ConfirmDialog
        open={Boolean(closing)} onOpenChange={(o) => !o && setClosing(null)}
        title='Fermer ce vocal ?' desc='Le salon est supprimé et les membres dedans sont déconnectés.'
        confirmText='Fermer' destructive isLoading={closeRoom.isPending} handleConfirm={() => closing && closeRoom.mutate(closing)}
      />
    </div>
  )
}

function HubDialog({ hub, data, onClose }: { hub: Hub; data: VoicePayload; onClose: () => void }) {
  const [c, setC] = useState(hub.config)
  const save = useMutation({
    mutationFn: () => api(`/voice/hubs/${hub.id}`, { method: 'PUT', body: c }),
    onSuccess: () => { toast.success('Réglages enregistrés'); onClose() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader><DialogTitle>Réglages des vocaux</DialogTitle></DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='h-name'>Nom des salons créés</Label>
              <Input id='h-name' value={c.nameTemplate} maxLength={90} onChange={(e) => setC({ ...c, nameTemplate: e.target.value })} />
              <p className='text-xs text-muted-foreground'>{'{user}'} = pseudo du créateur</p>
            </div>
            <div className='grid gap-1.5'>
              <Label>Catégorie</Label>
              <CategorySelect categories={data.categories} value={c.categoryId} onChange={(v) => setC({ ...c, categoryId: v })} label='Catégorie' noneLabel='Celle du salon « créer »' />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='h-limit'>Limite par défaut (0 = aucune)</Label>
              <Input id='h-limit' type='number' min={0} max={99} value={c.userLimit} onChange={(e) => setC({ ...c, userLimit: Number(e.target.value) || 0 })} />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='h-max'>Vocaux par personne</Label>
              <Input id='h-max' type='number' min={1} max={5} value={c.maxPerUser} onChange={(e) => setC({ ...c, maxPerUser: Number(e.target.value) || 1 })} />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='h-delay'>Suppression une fois vide après (secondes)</Label>
              <Input id='h-delay' type='number' min={0} max={3600} value={c.deleteAfterSeconds} onChange={(e) => setC({ ...c, deleteAfterSeconds: Number(e.target.value) || 0 })} />
            </div>
            <div className='grid gap-1.5'>
              <Label>Réservé à ces rôles</Label>
              <RolesPicker roles={data.roles} value={c.allowedRoleIds} onChange={(ids) => setC({ ...c, allowedRoleIds: ids })} placeholder='Tout le monde' label='Rôles autorisés' />
            </div>
          </div>
          <label className='flex items-center gap-2 text-sm'><Switch checked={c.rememberSettings} onCheckedChange={(v) => setC({ ...c, rememberSettings: v })} /> Garder les réglages de chaque créateur pour son prochain salon</label>
          <fieldset>
            <legend className='mb-2 text-sm font-medium'>Ce que le créateur peut faire</legend>
            <div className='grid gap-2 sm:grid-cols-3'>
              {data.options.map((o) => (
                <label key={o} className='flex items-center gap-2 text-sm'>
                  <Checkbox checked={c.options[o] !== false} onCheckedChange={(v) => setC({ ...c, options: { ...c.options, [o]: v === true } })} />
                  {OPTION_LABELS[o] ?? o}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
