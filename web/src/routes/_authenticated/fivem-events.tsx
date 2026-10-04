import { useRef, useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Clock, Copy, FlaskConical, Pencil, Radio, Save, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Notice, Pill, StatCards, type Tone } from '@/components/app/ui'
import { VariableButton, type VariableGroup } from '@/components/app/variable-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { DiscordPreview } from '@/features/announcements/discord-preview'
import { EMPTY_EMBED, EmbedFields, cleanEmbed } from '@/features/announcements/embed-editor'
import { TargetsEditor } from '@/features/announcements/targets-editor'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/fivem-events')({
  component: FivemEventsPage,
})

type Payload = { content: string; embed: AnnouncementEmbed }
type PublicEvent = { enabled: boolean; targets: AnnouncementTarget[]; payload: Payload; thresholds?: number[] }
type StaffEvent = { enabled: boolean }
type Config = {
  events: Record<string, PublicEvent | StaffEvent>
  maintenance: { targets: AnnouncementTarget[]; start: Payload; end: Payload; statusMessages: boolean; mutePublic: boolean }
}
type EventType = { key: string; label: string; kind: 'public' | 'staff' }
type ReceivedEvent = { id: number; type: string; label: string; server: string | null; data: Record<string, unknown>; status: string; detail: string | null; test: boolean; receivedAt: number }
type Data = {
  config: Config
  types: EventType[]
  restartWarnings: number[]
  variables: { txadmin: { key: string; label: string }[]; maintenance: { key: string; label: string }[] }
  maintenance: { active: boolean; reason: string | null; since: number | null }
  nextRestart: { at: number } | null
  maintenanceBy: string | null
  events: ReceivedEvent[]
  guilds: AnnouncementTargetsPayload
  baseUrl: string
}

const STATUS: Record<string, { label: string; tone: Tone }> = {
  posted: { label: 'Publié', tone: 'success' },
  logged: { label: 'Envoyé en log', tone: 'info' },
  disabled: { label: 'Désactivé', tone: 'neutral' },
  ignored: { label: 'Ignoré', tone: 'neutral' },
  duplicate: { label: 'Doublon', tone: 'neutral' },
  muted: { label: 'Maintenance', tone: 'warning' },
  failed: { label: 'Échec', tone: 'danger' },
}

const isPublic = (e: PublicEvent | StaffEvent): e is PublicEvent => 'targets' in e

// Payload from the API with every embed field present (the editor expects them)
const full = (p: Payload): Payload => ({ content: p.content ?? '', embed: { ...EMPTY_EMBED, ...p.embed } })
const clean = (p: Payload): Payload => ({ ...p, embed: cleanEmbed(p.embed) })

function cleanConfig(c: Config): Config {
  const events = Object.fromEntries(Object.entries(c.events).map(([k, e]) => [k, isPublic(e) ? { ...e, payload: clean(e.payload) } : e]))
  return { events, maintenance: { ...c.maintenance, start: clean(c.maintenance.start), end: clean(c.maintenance.end) } }
}

function FivemEventsPage() {
  const { can } = useMe()
  const manage = can('fivemevents.manage')
  const { data } = useQuery({ queryKey: ['fivem-events'], queryFn: () => api<Data>('/fivem-events'), refetchInterval: 15_000 })
  return (
    <Page
      title='Annonces FiveM'
      description='Le pont txAdmin (ressource brl-bridge sur le serveur FiveM) envoie au bot les redémarrages, annonces, arrêts et sanctions du jeu. Choisis ce qui est annoncé sur Discord, où, avec quel message, et gère la maintenance.'
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards className='lg:grid-cols-3' items={[
            { label: 'Maintenance', value: data.maintenance.active ? 'En cours' : 'Non', icon: Wrench, tone: data.maintenance.active ? 'warning' : 'success', hint: data.maintenance.active ? `depuis ${ago(data.maintenance.since)}` : undefined },
            { label: 'Prochain redémarrage', value: data.nextRestart ? dateTime(data.nextRestart.at).slice(11) : '—', icon: Clock, tone: 'info', hint: data.nextRestart ? ago(data.nextRestart.at) : 'Connu au premier rappel de txAdmin' },
            { label: 'Dernier événement reçu', value: data.events.find((e) => !e.test) ? ago(data.events.find((e) => !e.test)!.receivedAt) : 'Aucun', icon: Activity, tone: 'accent' },
          ]} />
          <MaintenanceSection data={data} />
          <EventsSection data={data} manage={manage} />
          {manage && <BridgeSection data={data} />}
          <ReceivedSection events={data.events} />
        </div>
      )}
    </Page>
  )
}

function useSaveConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Config) => api<Config>('/fivem-events/config', { method: 'PUT', body: cleanConfig(config) }),
    onSuccess: () => { toast.success('Réglages enregistrés'); qc.invalidateQueries({ queryKey: ['fivem-events'] }) },
  })
}

function MaintenanceSection({ data }: { data: Data }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const allowed = can('fivemevents.maintenance')
  const manage = can('fivemevents.manage')
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [editing, setEditing] = useState(false)
  const m = data.maintenance
  const toggle = useMutation({
    mutationFn: () => api<{ announced: number; targets: number }>('/fivem-events/maintenance', { method: 'POST', body: { active: !m.active, reason: m.active ? null : reason.trim() || null } }),
    onSuccess: (r) => {
      toast.success(`${m.active ? 'Maintenance terminée' : 'Maintenance lancée'}${r.targets ? ` · annonce dans ${r.announced}/${r.targets} salon(s)` : ''}`)
      setConfirming(false); setReason('')
      qc.invalidateQueries({ queryKey: ['fivem-events'] })
    },
  })
  const c = data.config.maintenance
  return (
    <Section
      title='Maintenance'
      description='Annonce le début et la fin d’une maintenance, et affiche « Maintenance » dans les messages de statut FiveM. Aussi avec /fivem maintenance.'
      actions={manage && <Button size='sm' variant='outline' onClick={() => setEditing(true)}><Pencil /> Messages et salons</Button>}
    >
      <div className='grid gap-4 p-4'>
        <div className='flex flex-wrap items-center gap-3'>
          {m.active ? <Pill tone='warning'><Wrench className='size-3.5' /> Maintenance en cours</Pill> : <Pill tone='success'>Serveur ouvert</Pill>}
          {m.active && <span className='text-sm text-muted-foreground'>depuis le {dateTime(m.since)} ({ago(m.since)}){m.reason ? ` · ${m.reason}` : ''}</span>}
          <span className='text-xs text-muted-foreground'>{c.targets.length ? `Annonce dans ${c.targets.length} salon(s)` : 'Aucun salon d’annonce choisi'}</span>
        </div>
        {allowed && (
          <div className='flex flex-wrap items-end gap-2'>
            {!m.active && (
              <div className='grid min-w-0 flex-1 gap-1.5 sm:max-w-md'>
                <Label htmlFor='mt-reason'>Raison (facultatif)</Label>
                <Input id='mt-reason' value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder='Mise à jour du serveur' />
              </div>
            )}
            <Button variant={m.active ? 'default' : 'outline'} onClick={() => setConfirming(true)}><Wrench /> {m.active ? 'Terminer la maintenance' : 'Lancer la maintenance'}</Button>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={confirming} onOpenChange={setConfirming}
        title={m.active ? 'Terminer la maintenance ?' : 'Lancer la maintenance ?'}
        desc={c.targets.length ? 'Le message réglé est publié dans les salons choisis, avec leurs pings.' : 'Aucun salon d’annonce n’est réglé : rien ne sera publié.'}
        confirmText={m.active ? 'Terminer' : 'Lancer'} isLoading={toggle.isPending} handleConfirm={() => toggle.mutate()}
      />
      {editing && <MaintenanceDialog data={data} onClose={() => setEditing(false)} />}
    </Section>
  )
}

function MaintenanceDialog({ data, onClose }: { data: Data; onClose: () => void }) {
  const save = useSaveConfig()
  const c = data.config.maintenance
  const [targets, setTargets] = useState(c.targets)
  const [start, setStart] = useState(full(c.start))
  const [end, setEnd] = useState(full(c.end))
  const [statusMessages, setStatusMessages] = useState(c.statusMessages)
  const [mutePublic, setMutePublic] = useState(c.mutePublic)
  const extra: VariableGroup[] = [{ title: 'Maintenance', items: data.variables.maintenance }]
  const submit = () => save.mutate({ ...data.config, maintenance: { targets, start, end, statusMessages, mutePublic } }, { onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader><DialogTitle>Maintenance : messages et salons</DialogTitle></DialogHeader>
        <Tabs defaultValue='targets'>
          <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
            <TabsTrigger value='targets'>Salons ({targets.length})</TabsTrigger>
            <TabsTrigger value='start'>Message de début</TabsTrigger>
            <TabsTrigger value='end'>Message de fin</TabsTrigger>
          </TabsList>
          <TabsContent value='targets' className='mt-4 grid gap-4'>
            <TargetsEditor guilds={data.guilds} targets={targets} onChange={setTargets} disabled={false} />
            <label className='flex items-center gap-2 text-sm'><Switch checked={statusMessages} onCheckedChange={setStatusMessages} /> Afficher « Maintenance » dans les messages de statut FiveM</label>
            <label className='flex items-center gap-2 text-sm'><Switch checked={mutePublic} onCheckedChange={setMutePublic} /> Pendant la maintenance, ne pas annoncer les démarrages, redémarrages et arrêts</label>
          </TabsContent>
          <TabsContent value='start' className='mt-4'><PayloadEditor idPrefix='mt-start' value={start} onChange={setStart} guilds={data.guilds} target={targets[0]} extra={extra} /></TabsContent>
          <TabsContent value='end' className='mt-4'><PayloadEditor idPrefix='mt-end' value={end} onChange={setEnd} guilds={data.guilds} target={targets[0]} extra={extra} /></TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={save.isPending}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EventsSection({ data, manage }: { data: Data; manage: boolean }) {
  const save = useSaveConfig()
  const qc = useQueryClient()
  const [editing, setEditing] = useState<{ type: EventType; enable: boolean } | null>(null)
  const test = useMutation({
    mutationFn: (type: string) => api<{ status: string; detail: string | null }>('/fivem-events/test', { method: 'POST', body: { type } }),
    onSuccess: (r) => {
      const s = STATUS[r.status]?.label ?? r.status
      if (r.status === 'posted' || r.status === 'logged') toast.success(`Essai : ${s}${r.detail ? ` (${r.detail})` : ''}`)
      else toast.warning(`Essai : ${s}${r.detail ? ` (${r.detail})` : ''}`)
      qc.invalidateQueries({ queryKey: ['fivem-events'] })
    },
  })
  const toggle = (type: EventType, enabled: boolean) => {
    const e = data.config.events[type.key]
    if (enabled && isPublic(e) && !e.targets.length) return setEditing({ type, enable: true })
    save.mutate({ ...data.config, events: { ...data.config.events, [type.key]: { ...e, enabled } } })
  }
  const groups: { kind: EventType['kind']; title: string; hint: string }[] = [
    { kind: 'public', title: 'Annoncés sur Discord', hint: 'Publiés dans les salons choisis, avec le message et les pings réglés.' },
    { kind: 'staff', title: 'Logs du staff', hint: 'Envoyés dans la catégorie de logs « Événements FiveM » (page Logs), jamais en public.' },
  ]
  return (
    <Section title='Événements txAdmin' description='Les événements reçus du serveur FiveM et ce que le bot en fait.'>
      <div className='grid gap-4 p-4'>
        {groups.map((g) => (
          <div key={g.kind} className='grid gap-2'>
            <div>
              <h3 className='text-sm font-medium'>{g.title}</h3>
              <p className='text-xs text-muted-foreground'>{g.hint}</p>
            </div>
            <ul className='divide-y rounded-md border'>
              {data.types.filter((t) => t.kind === g.kind).map((t) => {
                const e = data.config.events[t.key]
                return (
                  <li key={t.key} className='flex flex-wrap items-center gap-3 px-3 py-2'>
                    <Switch checked={e.enabled} disabled={!manage || save.isPending} onCheckedChange={(v) => toggle(t, v)} aria-label={`Activer : ${t.label}`} />
                    <div className='min-w-0 flex-1'>
                      <p className='truncate text-sm font-medium'>{t.label}</p>
                      <p className='truncate text-xs text-muted-foreground'>
                        <code>{t.key}</code>
                        {isPublic(e) && ` · ${e.targets.length ? `${e.targets.length} salon(s)` : 'aucun salon'}`}
                        {t.key === 'scheduledRestart' && isPublic(e) && e.thresholds && ` · rappels à ${e.thresholds.join(', ')} min`}
                      </p>
                    </div>
                    {manage && (
                      <div className='flex gap-1'>
                        <Button size='sm' variant='ghost' onClick={() => test.mutate(t.key)} disabled={test.isPending}><FlaskConical /> Tester</Button>
                        {isPublic(e) && <Button size='icon' variant='ghost' aria-label={`Modifier : ${t.label}`} onClick={() => setEditing({ type: t, enable: false })}><Pencil /></Button>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
      {editing && <EventDialog type={editing.type} enable={editing.enable} data={data} onClose={() => setEditing(null)} />}
    </Section>
  )
}

function EventDialog({ type, enable, data, onClose }: { type: EventType; enable: boolean; data: Data; onClose: () => void }) {
  const save = useSaveConfig()
  const current = data.config.events[type.key] as PublicEvent
  const [targets, setTargets] = useState(current.targets)
  const [payload, setPayload] = useState(full(current.payload))
  const [thresholds, setThresholds] = useState(current.thresholds ?? [])
  const [enabled, setEnabled] = useState(current.enabled || enable)
  const restart = type.key === 'scheduledRestart'
  const extra: VariableGroup[] = [{ title: 'txAdmin', hint: 'Remplies avec les données envoyées par le serveur FiveM.', items: data.variables.txadmin }]
  const submit = () => save.mutate({
    ...data.config,
    events: { ...data.config.events, [type.key]: { enabled: enabled && targets.length > 0, targets, payload, ...(restart ? { thresholds } : {}) } },
  }, { onSuccess: onClose })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader><DialogTitle>{type.label}</DialogTitle></DialogHeader>
        <Tabs defaultValue='targets'>
          <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
            <TabsTrigger value='targets'>Salons ({targets.length})</TabsTrigger>
            <TabsTrigger value='message'>Message</TabsTrigger>
          </TabsList>
          <TabsContent value='targets' className='mt-4 grid gap-4'>
            <label className='flex items-center gap-2 text-sm'><Switch checked={enabled} onCheckedChange={setEnabled} /> Annoncer cet événement</label>
            {restart && (
              <div className='grid gap-2'>
                <Label>Rappels publiés (minutes avant le redémarrage)</Label>
                <div className='flex flex-wrap gap-2' role='group' aria-label='Rappels publiés'>
                  {data.restartWarnings.map((m) => {
                    const on = thresholds.includes(m)
                    return (
                      <button key={m} type='button' aria-pressed={on} onClick={() => setThresholds(on ? thresholds.filter((x) => x !== m) : [...thresholds, m])}
                        className={`rounded-full border px-3 py-1 text-sm transition-colors ${on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
                        {m} min
                      </button>
                    )
                  })}
                </div>
                <span className='text-xs text-muted-foreground'>txAdmin prévient 30, 15, 10, 5, 4, 3, 2 et 1 minutes avant : seuls les rappels choisis sont publiés, une fois chacun.</span>
              </div>
            )}
            <TargetsEditor guilds={data.guilds} targets={targets} onChange={setTargets} disabled={false} />
            {!targets.length && <Notice tone='info'>Sans salon, l’événement reste désactivé.</Notice>}
          </TabsContent>
          <TabsContent value='message' className='mt-4'>
            <PayloadEditor idPrefix={`ev-${type.key}`} value={payload} onChange={setPayload} guilds={data.guilds} target={targets[0]} extra={extra} />
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={submit} disabled={save.isPending || (restart && !thresholds.length)}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

const SAMPLE: Record<string, string> = {
  '{txadmin.server}': 'Brothers Life', '{txadmin.author}': 'Admin', '{txadmin.message}': 'Event braquage ce soir à 21 h !', '{txadmin.minutes}': '15',
  '{txadmin.restart.at}': '18:00', '{txadmin.restart.relative}': 'dans 15 minutes', '{txadmin.shutdown.relative}': 'dans 5 secondes', '{txadmin.player}': 'Léa Martin',
  '{txadmin.reason}': 'aucune', '{txadmin.duration}': '1 jour', '{maintenance.reason}': 'Mise à jour du serveur', '{maintenance.since}': 'aujourd’hui à 17:00',
  '{maintenance.duration}': '1 h 30', '{maintenance.by}': '@Admin',
}
const sample = (t: string) => Object.entries(SAMPLE).reduce((s, [k, v]) => s.replaceAll(k, v), t)

function PayloadEditor({ value, onChange, idPrefix, guilds, target, extra }: { value: Payload; onChange: (p: Payload) => void; idPrefix: string; guilds: AnnouncementTargetsPayload; target?: AnnouncementTarget; extra: VariableGroup[] }) {
  const box = useRef<HTMLDivElement>(null)
  const roles = new Map(guilds.flatMap((g) => g.roles.map((r) => [r.id, r.name] as const)))
  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]'>
      <div ref={box} className='grid content-start gap-4'>
        <div className='grid gap-1.5'>
          <Label htmlFor={`${idPrefix}-content`}>Texte</Label>
          <Textarea id={`${idPrefix}-content`} rows={2} maxLength={2000} value={value.content} onChange={(e) => onChange({ ...value, content: e.target.value })} />
          <div className='flex flex-wrap items-center gap-2'>
            <VariableButton scope='server' container={box} extra={extra} />
            <span className='text-xs text-muted-foreground'>Insérée dans le dernier champ cliqué (texte, titre, champs de l’embed…).</span>
          </div>
        </div>
        <EmbedFields embed={value.embed} onChange={(patch) => onChange({ ...value, embed: { ...value.embed, ...patch } })} idPrefix={idPrefix} />
      </div>
      <div className='lg:sticky lg:top-0 lg:self-start'>
        <DiscordPreview
          content={sample(value.content)}
          embed={{ ...value.embed, title: sample(value.embed.title), description: sample(value.embed.description), footerText: sample(value.embed.footerText) }}
          target={target} roles={roles}
        />
      </div>
    </div>
  )
}

function BridgeSection({ data }: { data: Data }) {
  const url = `${data.baseUrl}/api/fivem/events`
  const copy = () => navigator.clipboard?.writeText(url).then(() => toast.success('Adresse copiée'), () => toast.error('Copie impossible'))
  return (
    <Section title='Clé d’API à utiliser' description='Le pont txAdmin s’authentifie avec une clé d’API personnelle.'>
      <div className='grid gap-3 p-4 text-sm'>
        <ol className='grid list-decimal gap-1.5 ps-5'>
          <li>Page <Link to='/developer' className='text-primary hover:underline'>API</Link> : crée une clé « Pont txAdmin » limitée à la seule permission <code className='rounded bg-muted px-1'>fivem.events</code> (ton rang doit l’avoir).</li>
          <li>Installe la ressource <code className='rounded bg-muted px-1'>fivem/brl-bridge</code> du dépôt sur le serveur FiveM (voir son README).</li>
          <li>Dans <code className='rounded bg-muted px-1'>server.cfg</code> : <code className='rounded bg-muted px-1'>set brl_bridge_url</code> et <code className='rounded bg-muted px-1'>set brl_bridge_key</code>, puis <code className='rounded bg-muted px-1'>ensure brl-bridge</code>.</li>
        </ol>
        <div className='flex min-w-0 flex-wrap items-center gap-2'>
          <span className='text-muted-foreground'>Adresse :</span>
          <code className='min-w-0 truncate rounded bg-muted px-2 py-1'>{url}</code>
          <Button size='sm' variant='outline' onClick={copy}><Copy /> Copier</Button>
        </div>
        {data.baseUrl.startsWith('https') && (
          <Notice tone='warning' title='Certificat auto-signé'>
            Le serveur FiveM (PerformHttpRequest) peut refuser le certificat HTTPS auto-signé du panel. Le README du pont détaille les solutions (certificat valide, proxy, réseau privé).
          </Notice>
        )}
      </div>
    </Section>
  )
}

function ReceivedSection({ events }: { events: ReceivedEvent[] }) {
  return (
    <Section title='Derniers événements reçus' description='Les 50 derniers, avec ce que le bot en a fait.'>
      {!events.length ? <div className='p-4'><EmptyState title='Rien reçu pour l’instant' icon={Radio}>Les événements apparaissent ici dès que le pont txAdmin est installé.</EmptyState></div> : (
        <ul className='divide-y'>
          {events.map((e) => {
            const s = STATUS[e.status] ?? { label: e.status, tone: 'neutral' as Tone }
            return (
              <li key={e.id} className='flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm'>
                <span className='w-32 shrink-0 text-xs text-muted-foreground tabular-nums'>{dateTime(e.receivedAt)}</span>
                <span className='min-w-0 flex-1 truncate font-medium'>{e.label}{e.server ? <span className='font-normal text-muted-foreground'> · {e.server}</span> : null}</span>
                {e.test && <Pill tone='accent'>Essai</Pill>}
                <Pill tone={s.tone}>{s.label}</Pill>
                {e.detail && <span className='w-full truncate text-xs text-muted-foreground sm:w-auto sm:max-w-xs'>{e.detail}</span>}
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
