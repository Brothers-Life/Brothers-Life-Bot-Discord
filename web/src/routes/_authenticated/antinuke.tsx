import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Radiation, RotateCcw, Save, ShieldAlert, ShieldCheck, Undo2, UserX, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { EmptyState, GuildIcon, Page, Pill, Section, StatCards, UserAvatar } from '@/components/app/ui'
import { UserPicker } from '@/components/app/user-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/_authenticated/antinuke')({
  component: AntinukePage,
})

type ActionRule = { enabled: boolean; limit: number; windowSeconds: number }
type AntinukeConfig = {
  enabled: boolean
  actions: Record<string, ActionRule>
  removeAllRoles: boolean
  timeoutMinutes: number
  kickBots: boolean
  dmOwner: boolean
  whitelistUserIds: string[]
  whitelistRankIds: number[]
}
type Incident = {
  id: number
  userId: string
  guildId: string
  trigger: string
  actions: { type: string; guildId: string; targetId: string | null; targetName: string | null; at: number }[]
  removedRoles: { guildId: string; roles: { id: string; name: string; color: string | null }[] }[]
  failures: { guildId: string; roleId: string | null; name: string | null; reason: string }[]
  timedOut: boolean
  status: 'open' | 'restored' | 'dismissed'
  createdAt: number
  resolvedAt: number | null
  resolvedBy: string | null
}
type Person = { name: string; avatar: string | null } | null
type AntinukePayload = {
  config: AntinukeConfig
  actions: { key: string; label: string; limit: number; windowSeconds: number }[]
  ranks: { id: number; name: string; color: string | null; level: number }[]
  guilds: { id: string; name: string; icon: string | null }[]
  people: Record<string, Person>
  live: { userId: string; actions: Record<string, number> }[]
  incidents: Incident[]
}

const STATUS = {
  open: { label: 'En quarantaine', tone: 'danger' },
  restored: { label: 'Rôles rendus', tone: 'success' },
  dismissed: { label: 'Classé', tone: 'neutral' },
} as const

function AntinukePage() {
  const { can } = useMe()
  const manage = can('antinuke.manage')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['antinuke'], queryFn: () => api<AntinukePayload>('/antinuke'), refetchInterval: 10_000 })
  const [draft, setDraft] = useState<AntinukeConfig | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'restore' | 'dismiss'; incident: Incident } | null>(null)
  // Members just added to the exemptions (not resolved by the server yet)
  const [picked, setPicked] = useState<Record<string, Person>>({})

  const save = useMutation({
    mutationFn: () => api<AntinukeConfig>('/antinuke', { method: 'PUT', body: draft }),
    onSuccess: () => { toast.success('Anti-nuke enregistré'); setDraft(null); qc.invalidateQueries({ queryKey: ['antinuke'] }) },
  })
  const resolve = useMutation({
    mutationFn: ({ kind, incident }: { kind: 'restore' | 'dismiss'; incident: Incident }) =>
      api<Incident & { given?: number; restoreFailures?: unknown[] }>(`/antinuke/incidents/${incident.id}/${kind}`, { method: 'POST', body: kind === 'restore' ? { confirm: true } : {} }),
    onSuccess: (result, { kind }) => {
      if (kind === 'restore') {
        const failed = result.restoreFailures?.length ?? 0
        toast[failed ? 'warning' : 'success'](`${result.given ?? 0} rôle(s) rendu(s)${failed ? ` · ${failed} échec(s)` : ''}`)
      }
      else toast.success('Incident classé')
      setConfirm(null)
      qc.invalidateQueries({ queryKey: ['antinuke'] })
    },
  })

  if (!data) {
    return <Page title='Anti-nuke'><Skeleton className='h-96 w-full' /></Page>
  }

  const config = draft ?? data.config
  const set = (patch: Partial<AntinukeConfig>) => setDraft({ ...config, ...patch })
  const setRule = (key: string, patch: Partial<ActionRule>) => set({ actions: { ...config.actions, [key]: { ...config.actions[key], ...patch } } })
  const person = (id: string | null) => (id ? data.people[id] ?? picked[id] ?? null : null)
  const nameOf = (id: string) => person(id)?.name ?? id
  const guildName = (id: string) => data.guilds.find((g) => g.id === id)?.name ?? id
  const labelOf = (type: string) => data.actions.find((a) => a.key === type)?.label ?? type
  const open = data.incidents.filter((i) => i.status === 'open')

  return (
    <Page
      title='Anti-nuke'
      description='Protège le réseau contre un compte du staff piraté ou malveillant : les actions destructrices (suppressions de salons et de rôles, bans en masse, permissions dangereuses, bots ajoutés…) sont comptées par auteur sur tous les serveurs. Au-delà de la limite, le compte perd ses rôles dangereux partout, en attendant qu’on les lui rende.'
    >
      <div className={cn(
        'flex flex-wrap items-center gap-4 rounded-lg border p-4 transition-colors',
        open.length ? 'border-destructive/50 bg-destructive/10' : config.enabled ? 'border-success/40 bg-success/8' : 'bg-card',
      )}>
        {open.length
          ? <Radiation className='size-10 animate-pulse text-destructive' aria-hidden />
          : config.enabled ? <ShieldCheck className='size-10 text-success' aria-hidden /> : <ShieldAlert className='size-10 text-muted-foreground' aria-hidden />}
        <div className='min-w-56 flex-1'>
          <div className='text-lg font-semibold'>
            {open.length ? `${open.length} compte(s) en quarantaine` : config.enabled ? 'Protection active' : 'Protection désactivée'}
          </div>
          <div className='text-sm text-muted-foreground'>
            Le chef du réseau et le bot ne sont jamais comptés. Une configuration pour tous les serveurs du réseau.
          </div>
        </div>
        <label className='flex items-center gap-2 text-sm font-medium'>
          <Switch checked={config.enabled} disabled={!manage} onCheckedChange={(v) => set({ enabled: v })} aria-label='Activer l’anti-nuke' />
          {config.enabled ? 'Activé' : 'Désactivé'}
        </label>
      </div>

      <StatCards items={[
        { label: 'Quarantaines en cours', value: open.length, tone: open.length ? 'danger' : 'neutral', icon: UserX },
        { label: 'Incidents enregistrés', value: data.incidents.length, icon: Radiation },
        { label: 'Comptes surveillés en ce moment', value: data.live.length, tone: data.live.length ? 'warning' : 'neutral', icon: Activity },
        { label: 'Exemptions', value: config.whitelistUserIds.length + config.whitelistRankIds.length, icon: ShieldCheck, hint: 'membres et rangs' },
      ]} />

      <Section title='Limites par action' description='Quarantaine dès que la limite est atteinte dans la fenêtre, en additionnant tous les serveurs du réseau.'>
        <ul className='divide-y'>
          {data.actions.map((action) => {
            const rule = config.actions[action.key]
            return (
              <li key={action.key} className='grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]'>
                <Switch checked={rule.enabled} disabled={!manage} onCheckedChange={(v) => setRule(action.key, { enabled: v })} aria-label={`Surveiller : ${action.label}`} />
                <span className={cn('text-sm', !rule.enabled && 'text-muted-foreground')}>{action.label}</span>
                <div className='col-span-2 flex flex-wrap items-center gap-2 text-sm sm:col-span-1'>
                  <Input type='number' className='w-20' min={1} max={100} value={rule.limit} disabled={!manage || !rule.enabled} onChange={(e) => setRule(action.key, { limit: Number(e.target.value) })} aria-label={`Limite : ${action.label}`} />
                  <span className='text-muted-foreground'>en</span>
                  <Input type='number' className='w-24' min={5} max={86400} value={rule.windowSeconds} disabled={!manage || !rule.enabled} onChange={(e) => setRule(action.key, { windowSeconds: Number(e.target.value) })} aria-label={`Fenêtre en secondes : ${action.label}`} />
                  <span className='text-muted-foreground'>s</span>
                </div>
              </li>
            )
          })}
        </ul>
      </Section>

      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
        <Section title='Réaction' description='Ce qui arrive au compte qui dépasse une limite.'>
          <div className='grid gap-3 p-4 text-sm'>
            <label className='flex items-start gap-2'>
              <Checkbox className='mt-0.5' checked={config.removeAllRoles} disabled={!manage} onCheckedChange={(v) => set({ removeAllRoles: v === true })} />
              <span>Retirer <strong>tous</strong> ses rôles (sinon seulement ceux qui donnent Administrateur, Gérer le serveur, les rôles, les salons, les webhooks, Bannir ou Expulser)</span>
            </label>
            <label className='flex items-start gap-2'>
              <Checkbox className='mt-0.5' checked={config.kickBots} disabled={!manage} onCheckedChange={(v) => set({ kickBots: v === true })} />
              <span>Expulser tout bot ajouté par une personne non exemptée</span>
            </label>
            <label className='flex items-start gap-2'>
              <Checkbox className='mt-0.5' checked={config.dmOwner} disabled={!manage} onCheckedChange={(v) => set({ dmOwner: v === true })} />
              <span>Prévenir le chef du réseau en message privé</span>
            </label>
            <div className='flex flex-wrap items-center gap-2'>
              <Label htmlFor='an-timeout'>Timeout en plus</Label>
              <Input id='an-timeout' type='number' className='w-24' min={0} max={40320} value={config.timeoutMinutes} disabled={!manage} onChange={(e) => set({ timeoutMinutes: Number(e.target.value) })} />
              <span className='text-muted-foreground'>min (0 : aucun)</span>
            </div>
            <p className='text-xs text-muted-foreground'>
              Les rôles placés au-dessus de celui du bot ne peuvent pas être retirés : ils sont signalés dans l’incident. Les alertes vont dans le salon de logs « Anti-nuke ».
            </p>
          </div>
        </Section>

        <Section title='Exemptions' description='Ces comptes ne sont jamais comptés (le chef du réseau et le bot le sont d’office).'>
          <div className='grid gap-4 p-4'>
            <div className='grid gap-2'>
              <Label>Rangs exemptés</Label>
              {data.ranks.length ? (
                <div className='flex flex-wrap gap-2'>
                  {data.ranks.map((rank) => {
                    const on = config.whitelistRankIds.includes(rank.id)
                    return (
                      <button
                        key={rank.id}
                        type='button'
                        disabled={!manage}
                        aria-pressed={on}
                        onClick={() => set({ whitelistRankIds: on ? config.whitelistRankIds.filter((id) => id !== rank.id) : [...config.whitelistRankIds, rank.id] })}
                        className={cn('inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-60', on ? 'border-primary/50 bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground')}
                      >
                        <span aria-hidden className='size-2 rounded-full' style={{ background: rank.color ?? 'currentColor' }} />
                        {rank.name}
                      </button>
                    )
                  })}
                </div>
              ) : <p className='text-sm text-muted-foreground'>Aucun rang créé.</p>}
            </div>
            <div className='grid gap-2'>
              <Label>Membres exemptés</Label>
              {config.whitelistUserIds.length > 0 && (
                <ul className='flex flex-wrap gap-2'>
                  {config.whitelistUserIds.map((id) => (
                    <li key={id} className='flex items-center gap-1.5 rounded-md border py-0.5 ps-1 pe-1.5 text-sm'>
                      <UserAvatar src={person(id)?.avatar} name={nameOf(id)} className='size-5' />
                      <span className='max-w-40 truncate'>{nameOf(id)}</span>
                      {manage && (
                        <button type='button' onClick={() => set({ whitelistUserIds: config.whitelistUserIds.filter((u) => u !== id) })} aria-label={`Retirer ${nameOf(id)}`} className='rounded p-0.5 text-muted-foreground hover:text-foreground'>
                          <X className='size-3.5' />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {manage && (
                <UserPicker
                  value=''
                  placeholder='Ajouter un membre (pseudo ou ID)'
                  onChange={(id, user) => {
                    if (!id || config.whitelistUserIds.includes(id)) return
                    if (user) setPicked((p) => ({ ...p, [id]: { name: user.globalName ?? user.username, avatar: user.avatar } }))
                    set({ whitelistUserIds: [...config.whitelistUserIds, id] })
                  }}
                />
              )}
            </div>
          </div>
        </Section>
      </div>

      {data.live.length > 0 && (
        <Section title='Actions comptées en ce moment' description='Auteurs avec des actions encore dans leur fenêtre.'>
          <ul className='divide-y'>
            {data.live.map((entry) => (
              <li key={entry.userId} className='flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm'>
                <UserAvatar src={person(entry.userId)?.avatar} name={nameOf(entry.userId)} className='size-7' />
                <span className='font-medium'>{nameOf(entry.userId)}</span>
                <div className='flex flex-wrap gap-1.5'>
                  {Object.entries(entry.actions).map(([type, count]) => (
                    <Pill key={type} tone='warning'>{labelOf(type)} : {count}/{config.actions[type]?.limit ?? '?'}</Pill>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title='Incidents' description='Chaque quarantaine, avec les rôles retirés. « Rendre les rôles » remet tout comme avant si c’était une fausse alerte.'>
        {data.incidents.length === 0 ? (
          <EmptyState title='Aucun incident' icon={ShieldCheck}>Personne n’a encore dépassé une limite.</EmptyState>
        ) : (
          <ul className='divide-y'>
            {data.incidents.map((incident) => {
              const status = STATUS[incident.status]
              const counts = Object.entries(incident.actions.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.type]: (acc[a.type] ?? 0) + 1 }), {}))
              return (
                <li key={incident.id} className='grid gap-3 px-4 py-4'>
                  <div className='flex flex-wrap items-center gap-3'>
                    <UserAvatar src={person(incident.userId)?.avatar} name={nameOf(incident.userId)} className='size-9' />
                    <div className='min-w-48 flex-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <span className='truncate font-medium'>{nameOf(incident.userId)}</span>
                        <Pill tone={status.tone}>{status.label}</Pill>
                        <span className='text-xs text-muted-foreground'>#{incident.id}</span>
                      </div>
                      <div className='text-xs text-muted-foreground'>
                        {dateTime(incident.createdAt)} · limite « {labelOf(incident.trigger)} » sur {guildName(incident.guildId)}
                        {incident.resolvedAt && ` · clos le ${dateTime(incident.resolvedAt)}${incident.resolvedBy ? ` par ${nameOf(incident.resolvedBy)}` : ''}`}
                      </div>
                    </div>
                    {manage && incident.status === 'open' && (
                      <div className='flex flex-wrap gap-2'>
                        <Button size='sm' onClick={() => setConfirm({ kind: 'restore', incident })}><Undo2 /> Rendre les rôles</Button>
                        <Button size='sm' variant='outline' onClick={() => setConfirm({ kind: 'dismiss', incident })}><RotateCcw /> Classer</Button>
                      </div>
                    )}
                  </div>
                  <div className='flex flex-wrap gap-1.5'>
                    {counts.map(([type, count]) => <Pill key={type} tone='warning'>{labelOf(type)} × {count}</Pill>)}
                    {incident.timedOut && <Pill tone='info'>Timeout appliqué</Pill>}
                  </div>
                  {incident.removedRoles.length > 0 && (
                    <div className='grid gap-1.5 text-sm'>
                      {incident.removedRoles.map((group) => {
                        const guild = data.guilds.find((g) => g.id === group.guildId)
                        return (
                          <div key={group.guildId} className='flex flex-wrap items-center gap-1.5'>
                            <GuildIcon src={guild?.icon} name={guildName(group.guildId)} className='size-5' />
                            <span className='text-muted-foreground'>{guildName(group.guildId)} :</span>
                            {group.roles.map((role) => (
                              <Pill key={role.id} style={role.color && role.color !== '#000000' ? { color: role.color } : undefined}>@{role.name}</Pill>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {incident.failures.length > 0 && (
                    <ul className='grid gap-0.5 text-xs text-destructive'>
                      {incident.failures.map((f, index) => (
                        <li key={index}>{guildName(f.guildId)} · {f.name ?? 'membre'} : {f.reason}</li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
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
        title={confirm?.kind === 'dismiss' ? 'Classer l’incident ?' : 'Rendre les rôles ?'}
        desc={confirm?.kind === 'dismiss'
          ? 'L’incident est clos sans rien rendre : les rôles retirés le restent.'
          : `Tous les rôles retirés à ${confirm ? nameOf(confirm.incident.userId) : ''} lui sont rendus sur chaque serveur${confirm?.incident.timedOut ? ', et son timeout est levé' : ''}.`}
        confirmText={confirm?.kind === 'dismiss' ? 'Classer' : 'Rendre les rôles'}
        destructive={false}
        isLoading={resolve.isPending}
        handleConfirm={() => confirm && resolve.mutate(confirm)}
      />
    </Page>
  )
}
