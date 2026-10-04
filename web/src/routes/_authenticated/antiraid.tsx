import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Lock, LockOpen, Save, ShieldAlert, ShieldCheck, Siren } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Guild, Role } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, GuildIcon } from '@/components/app/ui'
import { RolesPicker } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/_authenticated/antiraid')({
  component: AntiraidPage,
})

type AntiraidConfig = {
  enabled: boolean
  joinThreshold: number
  joinWindowSeconds: number
  raidMinutes: number
  actionOnJoin: 'none' | 'kick' | 'ban' | 'network_ban'
  includeWindow: boolean
  disableInvites: boolean
  raiseVerification: boolean
  alertRoleIds: string[]
  newAccount: { enabled: boolean; minAgeDays: number; action: 'none' | 'kick' | 'role'; roleId: string | null }
}
type AntiraidPayload = {
  config: AntiraidConfig
  state: { raid: { startedAt: number; until: number; by: string; actioned: number } | null; recentJoins: number; lastMinute: number }
  lockedDown: boolean
  roles: Role[]
}

function AntiraidPage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState<string | null>(null)
  const current = guildId ?? active.find((g) => g.isMain)?.id ?? active[0]?.id
  const currentGuild = active.find((g) => g.id === current)

  return (
    <Page
      title='Anti-raid'
      description='Détecte les arrivées en masse et passe le serveur en mode raid : invitations suspendues, vérification maximale, nouveaux arrivants expulsés ou bannis. Filtre aussi les comptes trop récents.'
      actions={current && (
        <div className='flex items-center gap-2'>
          <Label htmlFor='ar-guild' className='text-muted-foreground'>Serveur</Label>
          <Select value={current} onValueChange={setGuildId}>
            <SelectTrigger id='ar-guild' className='w-60'>
              <span className='flex items-center gap-2 truncate'>
                {currentGuild && <GuildIcon src={currentGuild.icon} name={currentGuild.name} className='size-5' />}
                <SelectValue />
              </span>
            </SelectTrigger>
            <SelectContent>{active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    >
      {current && <AntiraidEditor key={current} guildId={current} />}
    </Page>
  )
}

function AntiraidEditor({ guildId }: { guildId: string }) {
  const { can } = useMe()
  const manage = can('antiraid.manage')
  const qc = useQueryClient()
  const key = ['antiraid', guildId]
  const { data } = useQuery({ queryKey: key, queryFn: () => api<AntiraidPayload>(`/antiraid/${guildId}`), refetchInterval: 5000 })
  const [draft, setDraft] = useState<AntiraidConfig | null>(null)
  const [confirm, setConfirm] = useState<'raid-on' | 'raid-off' | 'lock-on' | 'lock-off' | null>(null)

  const save = useMutation({
    mutationFn: () => api<AntiraidConfig>(`/antiraid/${guildId}`, { method: 'PUT', body: draft }),
    onSuccess: () => { toast.success('Anti-raid enregistré'); setDraft(null); qc.invalidateQueries({ queryKey: key }) },
  })
  const raid = useMutation({
    mutationFn: (on: boolean) => api(`/antiraid/${guildId}/raid`, { method: 'POST', body: { on, confirm: true } }),
    onSuccess: (_, on) => { toast[on ? 'warning' : 'success'](on ? 'Mode raid activé' : 'Mode raid arrêté'); setConfirm(null); qc.invalidateQueries({ queryKey: key }) },
  })
  const lockdown = useMutation({
    mutationFn: (on: boolean) => api<{ channels: number }>(`/antiraid/${guildId}/lockdown`, { method: 'POST', body: { on, confirm: true } }),
    onSuccess: (r, on) => { toast.success(on ? `${r.channels} salon(s) verrouillé(s)` : `${r.channels} salon(s) rouvert(s)`); setConfirm(null); qc.invalidateQueries({ queryKey: key }) },
  })

  if (!data) return <Skeleton className='h-96 w-full' />
  const config = draft ?? data.config
  const set = (patch: Partial<AntiraidConfig>) => setDraft({ ...config, ...patch })
  const setFresh = (patch: Partial<AntiraidConfig['newAccount']>) => set({ newAccount: { ...config.newAccount, ...patch } })
  const inRaid = Boolean(data.state.raid)

  return (
    <div className='grid gap-6'>
      <div className={cn(
        'flex flex-wrap items-center gap-4 rounded-lg border p-4 transition-colors',
        inRaid ? 'border-destructive/50 bg-destructive/10' : config.enabled ? 'border-success/40 bg-success/8' : 'bg-card',
      )}>
        {inRaid
          ? <Siren className='size-10 animate-pulse text-destructive' aria-hidden />
          : config.enabled ? <ShieldCheck className='size-10 text-success' aria-hidden /> : <ShieldAlert className='size-10 text-muted-foreground' aria-hidden />}
        <div className='min-w-56 flex-1'>
          <div className='text-lg font-semibold'>
            {inRaid ? 'Raid en cours' : config.enabled ? 'Protection active' : 'Protection désactivée'}
          </div>
          <div className='text-sm text-muted-foreground'>
            {inRaid
              ? `Depuis ${dateTime(data.state.raid!.startedAt)} · jusqu’à ${dateTime(data.state.raid!.until)} · ${data.state.raid!.actioned} compte(s) traité(s)`
              : `${data.state.lastMinute} arrivée(s) dans la dernière minute · seuil : ${config.joinThreshold} en ${config.joinWindowSeconds} s`}
          </div>
        </div>
        {manage && (
          <div className='flex flex-wrap gap-2'>
            {inRaid
              ? <Button variant='outline' onClick={() => setConfirm('raid-off')}>Arrêter le mode raid</Button>
              : <Button variant='destructive' onClick={() => setConfirm('raid-on')}><Siren /> Mode raid</Button>}
          </div>
        )}
        {can('commands.lockdown') && (
          data.lockedDown
            ? <Button variant='outline' onClick={() => setConfirm('lock-off')}><LockOpen /> Rouvrir les salons</Button>
            : <Button variant='outline' onClick={() => setConfirm('lock-on')}><Lock /> Verrouiller tous les salons</Button>
        )}
      </div>

      <Section
        title='Détection des raids'
        actions={<Switch checked={config.enabled} disabled={!manage} onCheckedChange={(v) => set({ enabled: v })} aria-label='Activer l’anti-raid' />}
      >
        <div className='grid gap-5 p-4'>
          <div className='flex flex-wrap items-end gap-3 text-sm'>
            <span>Raid si</span>
            <Input type='number' className='w-20' min={3} max={200} value={config.joinThreshold} disabled={!manage} onChange={(e) => set({ joinThreshold: Number(e.target.value) })} aria-label='Nombre d’arrivées' />
            <span>arrivées ou plus en</span>
            <Input type='number' className='w-20' min={5} max={600} value={config.joinWindowSeconds} disabled={!manage} onChange={(e) => set({ joinWindowSeconds: Number(e.target.value) })} aria-label='Fenêtre en secondes' />
            <span>secondes. Le mode raid dure</span>
            <Input type='number' className='w-20' min={1} max={1440} value={config.raidMinutes} disabled={!manage} onChange={(e) => set({ raidMinutes: Number(e.target.value) })} aria-label='Durée du raid en minutes' />
            <span>minutes (prolongé tant que les arrivées continuent).</span>
          </div>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label>Pendant un raid, chaque nouvel arrivant est</Label>
              <Select value={config.actionOnJoin} disabled={!manage} onValueChange={(v) => set({ actionOnJoin: v as AntiraidConfig['actionOnJoin'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>laissé (alerte seulement)</SelectItem>
                  <SelectItem value='kick'>expulsé</SelectItem>
                  <SelectItem value='ban'>banni de ce serveur</SelectItem>
                  <SelectItem value='network_ban'>banni de tout le réseau</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className='grid gap-1.5'>
              <Label>Rôles à mentionner dans l’alerte</Label>
              <RolesPicker roles={data.roles} value={config.alertRoleIds} disabled={!manage} onChange={(ids) => set({ alertRoleIds: ids })} label='Rôles à mentionner' />
            </div>
          </div>
          <div className='grid gap-2 text-sm'>
            <label className='flex items-center gap-2'><Checkbox checked={config.includeWindow} disabled={!manage} onCheckedChange={(v) => set({ includeWindow: v === true })} /> Traiter aussi les comptes arrivés juste avant la détection</label>
            <label className='flex items-center gap-2'><Checkbox checked={config.disableInvites} disabled={!manage} onCheckedChange={(v) => set({ disableInvites: v === true })} /> Suspendre les invitations pendant le raid</label>
            <label className='flex items-center gap-2'><Checkbox checked={config.raiseVerification} disabled={!manage} onCheckedChange={(v) => set({ raiseVerification: v === true })} /> Passer la vérification au maximum pendant le raid</label>
          </div>
          <p className='text-xs text-muted-foreground'>Les alertes vont dans le salon de logs « Anti-raid » (page Salons de logs). Les réglages sont remis comme avant à la fin du raid.</p>
        </div>
      </Section>

      <Section
        title='Comptes récents'
        description='En permanence, même sans raid : les comptes Discord trop jeunes sont souvent des comptes jetables.'
        actions={<Switch checked={config.newAccount.enabled} disabled={!manage} onCheckedChange={(v) => setFresh({ enabled: v })} aria-label='Activer le filtre des comptes récents' />}
      >
        {config.newAccount.enabled && (
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:grid-cols-3'>
            <div className='grid gap-1.5'>
              <Label htmlFor='fresh-days'>Âge minimum (jours)</Label>
              <Input id='fresh-days' type='number' min={1} max={365} value={config.newAccount.minAgeDays} disabled={!manage} onChange={(e) => setFresh({ minAgeDays: Number(e.target.value) })} />
            </div>
            <div className='grid gap-1.5'>
              <Label>Action</Label>
              <Select value={config.newAccount.action} disabled={!manage} onValueChange={(v) => setFresh({ action: v as AntiraidConfig['newAccount']['action'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>Alerte seulement</SelectItem>
                  <SelectItem value='kick'>Expulser</SelectItem>
                  <SelectItem value='role'>Rôle de quarantaine</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {config.newAccount.action === 'role' && (
              <div className='grid gap-1.5'>
                <Label>Rôle de quarantaine</Label>
                <Select value={config.newAccount.roleId ?? ''} disabled={!manage} onValueChange={(v) => setFresh({ roleId: v })}>
                  <SelectTrigger><SelectValue placeholder='Choisir' /></SelectTrigger>
                  <SelectContent>{data.roles.filter((r) => r.editable).map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}
      </Section>

      {manage && draft && (
        <div className='sticky bottom-4 z-10 flex animate-in items-center gap-3 rounded-lg border border-primary/40 bg-card/95 p-3 shadow-lg backdrop-blur fade-in-0 slide-in-from-bottom-2'>
          <span className='text-sm'>Des changements ne sont pas enregistrés.</span>
          <Button variant='ghost' className='ms-auto' onClick={() => setDraft(null)}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={save.isPending}><Save /> Enregistrer</Button>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={{ 'raid-on': 'Activer le mode raid ?', 'raid-off': 'Arrêter le mode raid ?', 'lock-on': 'Verrouiller tous les salons ?', 'lock-off': 'Rouvrir les salons ?' }[confirm ?? 'raid-on']}
        desc={{
          'raid-on': `Invitations et vérification selon les réglages, et chaque nouvel arrivant sera traité pendant ${config.raidMinutes} min.`,
          'raid-off': 'Les invitations et la vérification sont remises comme avant.',
          'lock-on': 'Plus personne ne peut écrire dans les salons où @everyone écrit d’habitude. Seuls ces salons seront rouverts ensuite.',
          'lock-off': 'Les salons verrouillés par le lockdown sont rouverts.',
        }[confirm ?? 'raid-on']}
        confirmText={confirm === 'raid-on' || confirm === 'lock-on' ? 'Confirmer' : 'Rouvrir'}
        destructive={confirm === 'raid-on' || confirm === 'lock-on'}
        isLoading={raid.isPending || lockdown.isPending}
        handleConfirm={() => {
          if (confirm === 'raid-on' || confirm === 'raid-off') raid.mutate(confirm === 'raid-on')
          if (confirm === 'lock-on' || confirm === 'lock-off') lockdown.mutate(confirm === 'lock-on')
        }}
      />
    </div>
  )
}
