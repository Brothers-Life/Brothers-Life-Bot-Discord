import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { Notice, Page, Pill, Section } from '@/components/app/ui'
import { SaveBar, useConfirm } from '@/components/app/confirm'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import type { TelemetryConfig } from '@/features/telemetry/types'
import { Mono, QueryError } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/settings')({
  component: TelemetrySettings,
})

// Tables purged by age (keys of RETENTION_DEFAULTS on the server)
const RETENTION: [string, string][] = [
  ['events', 'Événements du jeu'],
  ['server_logs', 'Console du serveur'],
  ['perf_metrics', 'Mesures du serveur (tick, joueurs en ligne)'],
  ['player_snapshots', 'Relevés des joueurs (argent, métier)'],
  ['economy_snapshots', 'Relevés de l’économie'],
  ['vehicles_owned', 'Véhicules'],
  ['alerts', 'Alertes'],
  ['db_table_stats', 'Taille des tables'],
  ['commands', 'Annonces en jeu'],
  ['perf_windows', 'FPS des joueurs'],
  ['perf_buckets', 'FPS par zone, intérieur et joueur'],
  ['profiler_runs', 'Coût des ressources (profiler)'],
]

type Draft = { fivemBase: string; timezone: string; errors5min: string; moneyJump: string; anticheatChannel: string; retention: Record<string, string> }

const draftOf = (c: TelemetryConfig): Draft => ({
  fivemBase: c.fivemBase ?? '',
  timezone: c.timezone,
  errors5min: String(c.alerts.errors5min),
  moneyJump: String(c.alerts.moneyJump),
  anticheatChannel: c.alerts.anticheatChannel,
  retention: Object.fromEntries(RETENTION.map(([k]) => [k, String(c.retention[k] ?? '')])),
})

function TelemetrySettings() {
  const q = useQuery({ queryKey: ['telemetry', 'config'], queryFn: () => api<TelemetryConfig>('/telemetry/config') })
  // Kept here: the form is rebuilt when the config changes (a new token changes it)
  const [token, setToken] = useState<string | null>(null)
  return (
    <Page title='Télémétrie · Réglages' description='Ce qui relie le bot au serveur FiveM : jeton de la ressource bl_telemetry, adresse du serveur, seuils des alertes et durée de conservation des données.'>
      {q.error ? <QueryError error={q.error} /> : !q.data ? <Skeleton className='h-96 w-full' /> : <SettingsForm key={JSON.stringify(q.data)} config={q.data} onToken={setToken} />}
      <TokenDialog token={token} onClose={() => setToken(null)} />
    </Page>
  )
}

function SettingsForm({ config, onToken }: { config: TelemetryConfig; onToken: (token: string) => void }) {
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const initial = draftOf(config)
  const [draft, setDraft] = useState<Draft>(initial)
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  const done = (data: TelemetryConfig) => qc.setQueryData(['telemetry', 'config'], data)

  const save = useMutation({
    mutationFn: () => api<TelemetryConfig>('/telemetry/config', {
      method: 'PUT',
      body: {
        fivemBase: draft.fivemBase.trim() || null,
        timezone: draft.timezone.trim(),
        alerts: { errors5min: Number(draft.errors5min), moneyJump: Number(draft.moneyJump), anticheatChannel: draft.anticheatChannel.trim() },
        retention: Object.fromEntries(Object.entries(draft.retention).map(([k, v]) => [k, Number(v)])),
      },
    }),
    onSuccess: (data) => {
      toast.success('Réglages enregistrés.')
      done(data)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const generate = useMutation({
    mutationFn: () => api<{ token: string }>('/telemetry/config/token', { method: 'POST' }),
    onSuccess: (data) => {
      onToken(data.token)
      qc.invalidateQueries({ queryKey: ['telemetry', 'config'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })
  const remove = useMutation({
    mutationFn: () => api<TelemetryConfig>('/telemetry/config', { method: 'PUT', body: { ingestToken: null } }),
    onSuccess: (data) => {
      toast.success('Jeton retiré : le serveur FiveM ne peut plus rien envoyer.')
      done(data)
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  const askGenerate = async () => {
    const ok = await confirm({
      title: config.hasIngestToken ? 'Remplacer le jeton d’ingestion ?' : 'Créer un jeton d’ingestion ?',
      desc: config.hasIngestToken
        ? 'L’ancien jeton ne marchera plus : le serveur FiveM n’enverra plus rien tant que tu n’auras pas mis le nouveau dans son server.cfg.'
        : 'Le jeton ne s’affiche qu’une fois : copie-le tout de suite dans le server.cfg du serveur FiveM.',
      confirmText: <><RefreshCw /> {config.hasIngestToken ? 'Remplacer le jeton' : 'Créer le jeton'}</>,
      destructive: config.hasIngestToken,
    })
    if (ok) generate.mutate()
  }
  const askRemove = async () => {
    const ok = await confirm({
      title: 'Retirer le jeton d’ingestion ?',
      desc: 'Le serveur FiveM ne pourra plus envoyer de données au bot. Les données déjà reçues restent.',
      confirmText: <><Trash2 /> Retirer le jeton</>,
      destructive: true,
    })
    if (ok) remove.mutate()
  }

  const num = (key: 'errors5min' | 'moneyJump', label: string, hint: string) => (
    <div className='grid gap-1.5'>
      <Label htmlFor={`tel-${key}`}>{label}</Label>
      <Input id={`tel-${key}`} type='number' min={1} value={draft[key]} onChange={(e) => set({ [key]: e.target.value })} />
      <p className='text-xs text-muted-foreground'>{hint}</p>
    </div>
  )

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      {dialog}
      <Section title='Jeton d’ingestion' description='La ressource bl_telemetry l’envoie avec chaque lot de données (POST /v1/batch). À mettre dans le server.cfg : set telemetry_token "…".'>
        <div className='flex flex-wrap items-center gap-3 p-4'>
          {config.hasIngestToken
            ? <Pill tone='success'><KeyRound className='size-3' /> Jeton actif, finit par <Mono>{config.ingestTokenEnd}</Mono></Pill>
            : <Pill tone='warning'>Aucun jeton : le serveur ne peut rien envoyer</Pill>}
          <div className='ms-auto flex flex-wrap gap-2'>
            <Button variant='outline' onClick={askGenerate} disabled={generate.isPending}><RefreshCw /> {config.hasIngestToken ? 'Nouveau jeton' : 'Créer un jeton'}</Button>
            {config.hasIngestToken && <Button variant='ghost' onClick={askRemove} disabled={remove.isPending}><Trash2 /> Retirer</Button>}
          </div>
        </div>
      </Section>

      <Section title='Serveur FiveM' description='Le bot lit /perf/ et /dynamic.json de cette adresse toutes les 15 s : joueurs en ligne, temps par tick, disponibilité.'>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4 md:grid-cols-2'>
          <div className='grid gap-1.5'>
            <Label htmlFor='tel-base'>Adresse du serveur</Label>
            <Input id='tel-base' value={draft.fivemBase} onChange={(e) => set({ fivemBase: e.target.value })} placeholder='http://1.2.3.4:30120' />
            <p className='text-xs text-muted-foreground'>Vide : pas de relevé (la page Performances perd les threads et la disponibilité).</p>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='tel-tz'>Fuseau horaire</Label>
            <Input id='tel-tz' value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} placeholder='Europe/Paris' />
            <p className='text-xs text-muted-foreground'>Pour l’affluence par heure et l’inflation jour par jour.</p>
          </div>
        </div>
      </Section>

      <Section title='Alertes' description='Chaque alerte part dans la catégorie de logs « FiveM — alertes » et en notification du panel.'>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4 p-4 md:grid-cols-3'>
          {num('errors5min', 'Erreurs console en 5 min', 'Au-delà : alerte « rafale d’erreurs » (15 min d’écart).')}
          {num('moneyJump', 'Saut d’argent ($)', 'Gain entre deux relevés d’un joueur qui déclenche une alerte.')}
          <div className='grid gap-1.5'>
            <Label htmlFor='tel-ac'>Canal de l’anticheat</Label>
            <Input id='tel-ac' value={draft.anticheatChannel} onChange={(e) => set({ anticheatChannel: e.target.value })} maxLength={60} />
            <p className='text-xs text-muted-foreground'>Les avertissements et erreurs de ce canal de la console deviennent des alertes.</p>
          </div>
        </div>
      </Section>

      <Section title='Conservation' description='Nombre de jours gardés pour chaque type de données (1 à 3650). Le ménage se fait une fois par jour.'>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-3 p-4 sm:grid-cols-2 lg:grid-cols-3'>
          {RETENTION.map(([key, label]) => (
            <div key={key} className='grid gap-1.5'>
              <Label htmlFor={`ret-${key}`}>{label}</Label>
              <div className='flex items-center gap-2'>
                <Input id={`ret-${key}`} type='number' min={1} max={3650} value={draft.retention[key]} onChange={(e) => set({ retention: { ...draft.retention, [key]: e.target.value } })} className='w-28' />
                <span className='text-sm text-muted-foreground'>jours</span>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Notice tone='info'>Les joueurs ne sont jamais identifiables par leur IP, licence ou jetons dans le panel : le bot les retire avant d’enregistrer et avant d’afficher.</Notice>

      <SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onCancel={() => setDraft(initial)} />
    </div>
  )
}

function TokenDialog({ token, onClose }: { token: string | null; onClose: () => void }) {
  const copy = () => {
    navigator.clipboard?.writeText(token ?? '').then(() => toast.success('Jeton copié.'), () => toast.error('Copie impossible : sélectionne le texte à la main.'))
  }
  return (
    <Dialog open={token !== null} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau jeton d’ingestion</DialogTitle>
          <DialogDescription>Il ne s’affichera plus : copie-le maintenant dans le server.cfg du serveur FiveM, puis redémarre bl_telemetry.</DialogDescription>
        </DialogHeader>
        <pre className='overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap'>set telemetry_token "{token}"</pre>
        <DialogFooter>
          <Button onClick={copy}><Copy /> Copier le jeton</Button>
          <Button variant='outline' onClick={onClose}>J’ai copié le jeton</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
