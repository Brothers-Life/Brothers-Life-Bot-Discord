import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Gamepad2, MessageSquarePlus, Pencil, Plus, Save, Server, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel } from '@/lib/types'
import { ago } from '@/lib/format'
import { cn, copyOf } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ColorPicker } from '@/components/app/color-picker'
import { DuplicateButton } from '@/components/app/duplicate-button'

export const Route = createFileRoute('/_authenticated/fivem')({
  component: FivemPage,
})

type Status = { online: boolean; players: number; max: number; hostname: string | null; list: { id: number; name: string; ping: number | null }[]; checkedAt: number; error: string | null; onlineSince: number | null; peak: number }
type Server = {
  id: number; name: string; address: string; joinCode: string | null; config: { showPlayers: boolean; color: string }
  status: Status | null; messages: { id: number; guildId: string; channelId: string; messageId: string | null }[]
}
type Presence = { enabled: boolean; serverIds: number[]; text: string; offlineText: string }
type Data = { servers: Server[]; presence: Presence; guilds: { id: string; name: string; channels: Channel[] }[] }

function FivemPage() {
  const { can } = useMe()
  const manage = can('fivem.manage')
  const { data } = useQuery({ queryKey: ['fivem'], queryFn: () => api<Data>('/fivem'), refetchInterval: 20_000 })
  const [editing, setEditing] = useState<Partial<Server> | null>(null)
  const qc = useQueryClient()
  return (
    <Page
      title='FiveM'
      description='État en direct des serveurs FiveM, vérifié chaque minute. Le bot peut tenir un message de statut à jour dans des salons, afficher les joueurs dans son statut et répondre à /fivem.'
      actions={manage && <Button onClick={() => setEditing({})}><Plus /> Ajouter un serveur</Button>}
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid gap-6'>
          {data.servers.length > 0 && (
            <StatCards className='lg:grid-cols-3' items={[
              { label: 'Serveurs en ligne', value: `${data.servers.filter((s) => s.status?.online).length}/${data.servers.length}`, icon: Server, tone: data.servers.every((s) => s.status?.online) ? 'success' : 'warning' },
              { label: 'Joueurs connectés', value: data.servers.reduce((n, s) => n + (s.status?.online ? s.status.players : 0), 0), icon: Users, tone: 'accent' },
              { label: 'Places au total', value: data.servers.reduce((n, s) => n + (s.status?.online ? s.status.max : 0), 0), icon: Gamepad2, tone: 'info' },
            ]} />
          )}
          {!data.servers.length
            ? <Section title='Serveurs'><EmptyState title='Aucun serveur FiveM'>Ajoute l’adresse ip:port de ton serveur.</EmptyState></Section>
            : <div className='stagger grid gap-4 lg:grid-cols-2'>{data.servers.map((s) => <ServerCard key={s.id} server={s} data={data} manage={manage} onEdit={() => setEditing(s)} onDuplicate={() => setEditing(copyOf(s, 'name'))} />)}</div>}
          {manage && data.servers.length > 0 && <PresenceSection key={JSON.stringify(data.presence)} data={data} />}
        </div>
      )}
      {editing && <ServerDialog initial={editing} onClose={() => { setEditing(null); qc.invalidateQueries({ queryKey: ['fivem'] }) }} />}
    </Page>
  )
}

function ServerCard({ server: s, data, manage, onEdit, onDuplicate }: { server: Server; data: Data; manage: boolean; onEdit: () => void; onDuplicate: () => void }) {
  const qc = useQueryClient()
  const refresh = () => qc.invalidateQueries({ queryKey: ['fivem'] })
  const [showPlayers, setShowPlayers] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [guildId, setGuildId] = useState(data.guilds[0]?.id ?? '')
  const [channelId, setChannelId] = useState<string | null>(null)
  const st = s.status
  const ratio = st?.online && st.max ? Math.min(100, (st.players / st.max) * 100) : 0
  const add = useMutation({ mutationFn: () => api(`/fivem/${s.id}/messages`, { method: 'POST', body: { guildId, channelId } }), onSuccess: () => { toast.success('Message de statut publié'); setChannelId(null); refresh() } })
  const drop = useMutation({ mutationFn: (id: number) => api(`/fivem/messages/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Message retiré'); refresh() } })
  const remove = useMutation({ mutationFn: () => api(`/fivem/${s.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Serveur supprimé'); setDeleting(false); refresh() } })
  const channelName = (guild: string, id: string) => data.guilds.find((g) => g.id === guild)?.channels.find((c) => c.id === id)?.name ?? id

  return (
    <section className='lift grid content-start gap-4 rounded-xl border bg-card p-5' style={{ borderTopColor: s.config.color, borderTopWidth: 3 }}>
      <div className='flex items-start gap-3'>
        <span className={cn('mt-1.5 size-3 shrink-0 rounded-full', !st ? 'bg-muted-foreground' : st.online ? 'bg-success shadow-[0_0_0_4px] shadow-success/20' : 'bg-destructive')} aria-hidden />
        <div className='min-w-0 flex-1'>
          <h2 className='truncate text-lg font-semibold'>{s.name}</h2>
          <p className='truncate text-xs text-muted-foreground'>{s.address}{s.joinCode ? ` · cfx.re/join/${s.joinCode}` : ''}</p>
        </div>
        {manage && (
          <div className='flex gap-1'>
            <Button size='icon' variant='ghost' aria-label={`Modifier ${s.name}`} onClick={onEdit}><Pencil /></Button>
            <DuplicateButton name={s.name} onClick={onDuplicate} />
            <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${s.name}`} onClick={() => setDeleting(true)}><Trash2 /></Button>
          </div>
        )}
      </div>

      {!st ? <p className='text-sm text-muted-foreground'>Vérification en cours…</p> : st.online ? (
        <div className='grid gap-2'>
          <div className='flex items-baseline gap-2'>
            <span className='text-3xl font-semibold tabular-nums'>{st.players}</span>
            <span className='text-muted-foreground'>/ {st.max} joueurs</span>
            <span className='ms-auto text-xs text-muted-foreground'>pic {st.peak} · en ligne depuis {ago(st.onlineSince)}</span>
          </div>
          <div className='h-2 overflow-hidden rounded-full bg-muted' role='progressbar' aria-valuenow={st.players} aria-valuemax={st.max} aria-label='Remplissage du serveur'>
            <div className={cn('h-full rounded-full transition-[width] duration-700', ratio > 90 ? 'bg-destructive' : ratio > 70 ? 'bg-warning' : 'bg-success')} style={{ width: `${ratio}%` }} />
          </div>
          {st.hostname && <p className='truncate text-xs text-muted-foreground'>{st.hostname}</p>}
          <button type='button' className='flex items-center gap-1 justify-self-start text-sm text-muted-foreground hover:text-foreground' aria-expanded={showPlayers} onClick={() => setShowPlayers(!showPlayers)}>
            <ChevronDown className={cn('size-4 transition-transform', showPlayers && 'rotate-180')} /> Joueurs connectés
          </button>
          {showPlayers && (
            <ul className='grid max-h-60 grid-cols-2 gap-x-4 overflow-y-auto text-sm sm:grid-cols-3'>
              {st.list.map((p) => <li key={p.id} className='truncate'><span className='me-1 text-xs tabular-nums text-muted-foreground'>{p.id}</span>{p.name}</li>)}
              {!st.list.length && <li className='text-muted-foreground'>Personne</li>}
            </ul>
          )}
        </div>
      ) : (
        <div className='flex flex-wrap items-center gap-2'>
          <Pill tone='danger'>Hors ligne</Pill>
          <span className='text-xs text-muted-foreground'>{st.error} · vérifié {ago(st.checkedAt)}</span>
        </div>
      )}

      <div className='grid gap-2 border-t pt-3'>
        <h3 className='text-sm font-medium'>Messages de statut</h3>
        {s.messages.map((m) => (
          <div key={m.id} className='flex items-center gap-2 text-sm'>
            <span className='flex-1 truncate'>{data.guilds.find((g) => g.id === m.guildId)?.name ?? m.guildId} · #{channelName(m.guildId, m.channelId)}</span>
            {manage && <Button size='icon' variant='ghost' aria-label='Retirer ce message' onClick={() => drop.mutate(m.id)}><X /></Button>}
          </div>
        ))}
        {!s.messages.length && <p className='text-xs text-muted-foreground'>Aucun salon.</p>}
        {manage && data.guilds.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            <Select value={guildId} onValueChange={(v) => { setGuildId(v); setChannelId(null) }}>
              <SelectTrigger className='w-40' aria-label='Serveur Discord'><SelectValue /></SelectTrigger>
              <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
            </Select>
            <ChannelSelect channels={data.guilds.find((g) => g.id === guildId)?.channels ?? []} value={channelId} onChange={setChannelId} label='Salon du message de statut' noneLabel='Choisir un salon' />
            <Button size='sm' variant='outline' onClick={() => add.mutate()} disabled={!channelId || add.isPending}><MessageSquarePlus /> Publier</Button>
          </div>
        )}
      </div>
      <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Supprimer ${s.name} ?`} desc='Ses messages de statut sont supprimés de Discord.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
    </section>
  )
}

function ServerDialog({ initial, onClose }: { initial: Partial<Server>; onClose: () => void }) {
  const [name, setName] = useState(initial.name ?? '')
  const [address, setAddress] = useState(initial.address ?? '')
  const [joinCode, setJoinCode] = useState(initial.joinCode ?? '')
  const [showPlayers, setShowPlayers] = useState(initial.config?.showPlayers ?? true)
  const [color, setColor] = useState(initial.config?.color ?? '#d6a249')
  const save = useMutation({
    mutationFn: () => {
      const body = { name, address, joinCode: joinCode || null, config: { showPlayers, color } }
      return initial.id ? api(`/fivem/${initial.id}`, { method: 'PUT', body }) : api('/fivem', { method: 'POST', body })
    },
    onSuccess: () => { toast.success('Serveur enregistré'); onClose() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{initial.id ? `Modifier ${initial.name}` : 'Ajouter un serveur FiveM'}</DialogTitle></DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-1.5'><Label htmlFor='fv-name'>Nom</Label><Input id='fv-name' value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder='Brothers Life RP' /></div>
          <div className='grid gap-1.5'>
            <Label htmlFor='fv-address'>Adresse</Label>
            <Input id='fv-address' value={address} onChange={(e) => setAddress(e.target.value)} placeholder='51.75.12.34:30120' />
            <span className='text-xs text-muted-foreground'>IP et port du serveur, comme dans F8 → connect.</span>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='fv-code'>Code cfx.re (facultatif)</Label>
            <Input id='fv-code' value={joinCode} maxLength={100} onChange={(e) => setJoinCode(e.target.value)} placeholder='abc123 ou https://cfx.re/join/abc123' />
            <span className='text-xs text-muted-foreground'>Ajoute un bouton « Se connecter » aux messages.</span>
          </div>
          <div className='flex flex-wrap items-center gap-6'>
            <label className='flex items-center gap-2 text-sm'><Switch checked={showPlayers} onCheckedChange={setShowPlayers} /> Liste des joueurs dans les messages</label>
            <label className='flex items-center gap-2 text-sm'>Couleur <ColorPicker className='w-36' value={color} onChange={(hex) => setColor(hex)} /></label>
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || !address.trim() || save.isPending}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PresenceSection({ data }: { data: Data }) {
  const qc = useQueryClient()
  const [p, setP] = useState(data.presence)
  const save = useMutation({ mutationFn: () => api('/fivem/presence', { method: 'PUT', body: p }), onSuccess: () => { toast.success('Statut du bot enregistré'); qc.invalidateQueries({ queryKey: ['fivem'] }) } })
  return (
    <Section
      title='Statut du bot'
      description='Texte affiché sous le nom du bot. Avec plusieurs serveurs, il change toutes les 30 secondes. Variables : {players}, {max}, {name}.'
      actions={<Button size='sm' onClick={() => save.mutate()} disabled={save.isPending}><Save /> Enregistrer</Button>}
    >
      <div className='grid gap-4 p-4'>
        <label className='flex items-center gap-2 text-sm'><Switch checked={p.enabled} onCheckedChange={(v) => setP({ ...p, enabled: v })} /> Afficher les joueurs FiveM dans le statut du bot</label>
        <div className='flex flex-wrap gap-2' role='group' aria-label='Serveurs affichés'>
          {data.servers.map((s) => {
            const on = p.serverIds.includes(s.id)
            return (
              <button key={s.id} type='button' aria-pressed={on} onClick={() => setP({ ...p, serverIds: on ? p.serverIds.filter((x) => x !== s.id) : [...p.serverIds, s.id] })}
                className={cn('rounded-full border px-3 py-1 text-sm transition-colors', on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent')}>
                {s.name}
              </button>
            )
          })}
        </div>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='grid gap-1.5'><Label htmlFor='pr-on'>En ligne</Label><Input id='pr-on' value={p.text} maxLength={120} onChange={(e) => setP({ ...p, text: e.target.value })} /></div>
          <div className='grid gap-1.5'><Label htmlFor='pr-off'>Hors ligne</Label><Input id='pr-off' value={p.offlineText} maxLength={120} onChange={(e) => setP({ ...p, offlineText: e.target.value })} /></div>
        </div>
      </div>
    </Section>
  )
}
