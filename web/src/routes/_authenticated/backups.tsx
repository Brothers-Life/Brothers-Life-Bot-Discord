import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveRestore, Camera, DatabaseBackup, Download, Hammer, Moon, RotateCcw, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ago, bytes, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards, GuildIcon, Notice } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { JobCard, type Job } from '@/features/templates/job-card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/_authenticated/backups')({
  component: BackupsPage,
})

type Backup = { id: number; guildId: string; guildName: string; name: string; kind: 'auto' | 'manual'; roles: number; channels: number; members: number; size: number; createdAt: number }
type Config = { enabled: boolean; guildIds: string[]; hour: number; keep: number }
type Guild = { id: string; name: string; icon: string | null; isMain: boolean }
type Data = { backups: Backup[]; config: Config; job: Job | null; guilds: Guild[] }

function BackupsPage() {
  const { can } = useMe()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['backups'], queryFn: () => api<Data>('/backups') })
  const running = data?.job?.status === 'running'
  const { data: live } = useQuery({
    queryKey: ['backups-job'],
    queryFn: async () => {
      const r = await api<{ job: Job | null }>('/backups/job')
      if (r.job?.status !== 'running') qc.invalidateQueries({ queryKey: ['backups'] })
      return r.job
    },
    enabled: running,
    refetchInterval: running ? 2000 : false,
  })
  const job = running ? live ?? data?.job : data?.job
  const [guildFilter, setGuildFilter] = useState('all')
  const [restoring, setRestoring] = useState<Backup | null>(null)
  const [deleting, setDeleting] = useState<Backup | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['backups'] })
  const create = useMutation({ mutationFn: (guildId: string) => api<Backup>('/backups', { method: 'POST', body: { guildId } }), onSuccess: (b) => { toast.success(`Sauvegarde faite : ${b.channels} salons, ${b.roles} rôles, ${b.members} membres`); refresh() } })
  const remove = useMutation({ mutationFn: (b: Backup) => api(`/backups/${b.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Sauvegarde supprimée'); setDeleting(null); refresh() } })

  const list = data?.backups.filter((b) => guildFilter === 'all' || b.guildId === guildFilter) ?? []
  const lastByGuild = (id: string) => data?.backups.find((b) => b.guildId === id)

  return (
    <Page
      title='Sauvegardes'
      description='Chaque nuit, le bot prend une photo de chaque serveur : salons, rôles, permissions, réglages, configuration du panel et rôles des membres. Après un raid ou une fausse manipulation, tu remets tout en place en un clic.'
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid gap-6'>
          {job && <JobCard job={job} />}
          <StatCards items={[
            { label: 'Sauvegardes', value: data.backups.length, icon: DatabaseBackup, tone: 'accent' },
            { label: 'Serveurs couverts', value: new Set(data.backups.map((b) => b.guildId)).size, icon: ArchiveRestore, tone: 'success' },
            { label: 'Dernière', value: data.backups[0] ? ago(data.backups[0].createdAt) : '—', icon: Moon, tone: 'info' },
            { label: 'Espace utilisé', value: bytes(data.backups.reduce((n, b) => n + b.size, 0)), icon: Save, tone: 'neutral' },
          ]} />

          <Section title='Serveurs' description='Une sauvegarde manuelle est gardée jusqu’à ce que tu la supprimes.'>
            <ul className='divide-y'>
              {data.guilds.map((g) => {
                const last = lastByGuild(g.id)
                return (
                  <li key={g.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                    <GuildIcon src={g.icon} name={g.name} className='size-9' />
                    <div className='min-w-48 flex-1'>
                      <div className='flex items-center gap-2 font-medium'>{g.name}{g.isMain && <Pill tone='accent'>Principal</Pill>}</div>
                      <div className='text-xs text-muted-foreground'>{last ? `Dernière sauvegarde ${ago(last.createdAt)}` : 'Jamais sauvegardé'}</div>
                    </div>
                    {can('backups.manage') && <Button size='sm' variant='outline' loading={create.isPending && create.variables === g.id} disabled={create.isPending} onClick={() => create.mutate(g.id)}><Camera /> Sauvegarder maintenant</Button>}
                  </li>
                )
              })}
            </ul>
          </Section>

          <Section
            title='Historique'
            actions={
              <Select value={guildFilter} onValueChange={setGuildFilter}>
                <SelectTrigger className='w-52'><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='all'>Tous les serveurs</SelectItem>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
              </Select>
            }
          >
            {!list.length ? <EmptyState title='Aucune sauvegarde' icon={DatabaseBackup}>La première sauvegarde automatique a lieu cette nuit, ou fais-en une maintenant.</EmptyState> : (
              <ul className='divide-y'>
                {list.map((b) => (
                  <li key={b.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                    <div className='min-w-52 flex-1'>
                      <div className='flex flex-wrap items-center gap-2 font-medium'>{b.name}<Pill tone={b.kind === 'auto' ? 'info' : 'accent'}>{b.kind === 'auto' ? 'Automatique' : 'Manuelle'}</Pill></div>
                      <div className='text-xs text-muted-foreground'>{b.guildName} · {dateTime(b.createdAt)} · {b.channels} salons · {b.roles} rôles · {b.members} membres · {bytes(b.size)}</div>
                    </div>
                    <div className='flex gap-2'>
                      {can('backups.restore') && <Button size='sm' variant='warning-outline' disabled={running} onClick={() => setRestoring(b)}><ArchiveRestore /> Restaurer</Button>}
                      {can('backups.manage') && <Button size='icon' variant='ghost' asChild aria-label='Télécharger'><a href={`/api/backups/${b.id}/download`}><Download /></a></Button>}
                      {can('backups.manage') && <Button size='icon' variant='danger-ghost' aria-label='Supprimer' onClick={() => setDeleting(b)}><Trash2 /></Button>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {can('backups.manage') && <Settings key={JSON.stringify(data.config)} data={data} />}
        </div>
      )}
      {restoring && data && <RestoreDialog backup={restoring} guild={data.guilds.find((g) => g.id === restoring.guildId)} onClose={() => setRestoring(null)} onStarted={() => { setRestoring(null); refresh() }} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title='Supprimer cette sauvegarde ?' desc={deleting ? `${deleting.name} (${deleting.guildName}) sera perdue définitivement.` : ''} confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
    </Page>
  )
}

function RestoreDialog({ backup, guild, onClose, onStarted }: { backup: Backup; guild?: Guild; onClose: () => void; onStarted: () => void }) {
  const [mode, setMode] = useState<'repair' | 'restore'>('repair')
  const [panel, setPanel] = useState(true)
  const [memberRoles, setMemberRoles] = useState(true)
  const [confirmName, setConfirmName] = useState('')
  const full = mode === 'restore'
  const name = guild?.name ?? backup.guildName
  const start = useMutation({
    mutationFn: () => api(`/backups/${backup.id}/restore`, { method: 'POST', body: { mode, panel, memberRoles, confirm: true, confirmName } }),
    onSuccess: () => { toast.success('Restauration lancée'); onStarted() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Restaurer {name}</DialogTitle>
          <DialogDescription>{backup.name} · {dateTime(backup.createdAt)}</DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2' role='radiogroup' aria-label='Type de restauration'>
            {([['repair', Hammer, 'Réparer', 'Remet ce qui manque et corrige ce qui a changé. Rien n’est supprimé.'], ['restore', RotateCcw, 'Restauration complète', 'Comme réparer, et supprime aussi les salons et rôles qui n’étaient pas dans la sauvegarde (après un raid).']] as const).map(([value, Icon, title, text]) => (
              <button key={value} type='button' role='radio' aria-checked={mode === value} onClick={() => setMode(value)} className={`lift grid gap-1 rounded-lg border p-3 text-start ${mode === value ? 'border-brand bg-brand/10' : ''}`}>
                <Icon className='size-5 text-primary' />
                <span className='text-sm font-medium'>{title}</span>
                <span className='text-xs text-muted-foreground'>{text}</span>
              </button>
            ))}
          </div>
          <label className='flex items-center gap-2 text-sm'><Checkbox checked={memberRoles} onCheckedChange={(v) => setMemberRoles(v === true)} /> Rendre leurs rôles aux membres ({backup.members})</label>
          <label className='flex items-center gap-2 text-sm'><Checkbox checked={panel} onCheckedChange={(v) => setPanel(v === true)} /> Remettre la configuration du panel (tickets, automod, logs, rôles du staff)</label>
          <Notice tone='info'>Les messages supprimés ne reviennent pas : Discord ne permet pas de les recréer.</Notice>
          {full && (
            <div className='grid gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
              <Label htmlFor='bk-confirm'>Pour confirmer, tape le nom du serveur : <strong>{name}</strong></Label>
              <Input id='bk-confirm' value={confirmName} autoComplete='off' onChange={(e) => setConfirmName(e.target.value)} />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button variant={full ? 'destructive' : 'warning'} loading={start.isPending} onClick={() => start.mutate()} disabled={full && confirmName.trim().toLowerCase() !== name.trim().toLowerCase()}>
            <ArchiveRestore /> {full ? 'Restaurer complètement' : 'Réparer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Settings({ data }: { data: Data }) {
  const qc = useQueryClient()
  const [c, setC] = useState(data.config)
  // "Some servers" stays chosen even when every box is unchecked (saved as "all", said explicitly below)
  const [some, setSome] = useState(data.config.guildIds.length > 0)
  const save = useMutation({ mutationFn: () => api('/backups/config', { method: 'PUT', body: c }), onSuccess: () => { toast.success('Réglages enregistrés'); qc.invalidateQueries({ queryKey: ['backups'] }) } })
  return (
    <Section title='Sauvegardes automatiques' actions={<Button size='sm' loading={save.isPending} onClick={() => save.mutate()}><Save /> Enregistrer</Button>}>
      <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4 sm:grid-cols-3'>
        <label className='flex items-center gap-2 text-sm sm:col-span-3'><Switch checked={c.enabled} onCheckedChange={(enabled) => setC({ ...c, enabled })} /> Une sauvegarde de chaque serveur, chaque nuit</label>
        <div className='grid gap-1.5'>
          <Label htmlFor='bk-hour'>Heure (heure de Paris)</Label>
          <Select value={String(c.hour)} onValueChange={(v) => setC({ ...c, hour: Number(v) })}>
            <SelectTrigger id='bk-hour'><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 24 }, (_, h) => <SelectItem key={h} value={String(h)}>{String(h).padStart(2, '0')} h</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className='grid gap-1.5'>
          <Label htmlFor='bk-keep'>Automatiques gardées par serveur</Label>
          <Input id='bk-keep' type='number' min={1} max={60} value={c.keep} onChange={(e) => setC({ ...c, keep: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} />
        </div>
        <div className='grid gap-1.5'>
          <Label>Serveurs</Label>
          <Select value={some ? 'some' : 'all'} onValueChange={(v) => { setSome(v === 'some'); setC({ ...c, guildIds: v === 'all' ? [] : data.guilds.map((g) => g.id) }) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value='all'>Tous les serveurs du réseau</SelectItem><SelectItem value='some'>Certains serveurs</SelectItem></SelectContent>
          </Select>
        </div>
        {some && (
          <div className='flex flex-wrap gap-3 sm:col-span-3'>
            {!c.guildIds.length && <Notice tone='warning' className='w-full'>Aucun serveur coché : la sauvegarde automatique se fera sur <strong>tous les serveurs</strong> du réseau. Coche au moins un serveur pour limiter.</Notice>}
            {data.guilds.map((g) => (
              <label key={g.id} className='flex items-center gap-2 text-sm'>
                <Checkbox checked={c.guildIds.includes(g.id)} onCheckedChange={(v) => setC({ ...c, guildIds: v === true ? [...c.guildIds, g.id] : c.guildIds.filter((x) => x !== g.id) })} /> {g.name}
              </label>
            ))}
          </div>
        )}
      </div>
    </Section>
  )
}
