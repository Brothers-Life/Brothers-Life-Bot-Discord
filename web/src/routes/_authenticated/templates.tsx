import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Camera, Hammer, LayoutTemplate, Loader2, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ago } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, GuildIcon } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { JobCard, type Job, type Report } from '@/features/templates/job-card'

export const Route = createFileRoute('/_authenticated/templates')({
  component: TemplatesPage,
})

type Template = {
  id: number; name: string; description: string | null; sourceGuildId: string; sourceName: string; capturedAt: number
  summary: { roles: number; categories: number; channels: number; ticketTypes: number; logRoutes: number; automod: boolean }
}
type Target = { id: string; name: string; icon: string | null; application: { templateId: number | null; mode: 'reset' | 'repair'; status: 'done' | 'failed'; report: Report; appliedAt: number } | null }
// 1 salon, 2 salons
const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`

type Data = { templates: Template[]; targets: Target[]; job: Job | null; sources: { id: string; name: string }[] }

function TemplatesPage() {
  const { can } = useMe()
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['templates'], queryFn: () => api<Data>('/templates') })
  const running = data?.job?.status === 'running'
  // While a job runs, its progress is polled every 2 s
  const { data: live } = useQuery({
    queryKey: ['templates-job'],
    queryFn: async () => {
      const r = await api<{ job: Job | null }>('/templates/job')
      if (r.job?.status !== 'running') qc.invalidateQueries({ queryKey: ['templates'] })
      return r.job
    },
    enabled: running,
    refetchInterval: running ? 2000 : false,
  })
  const job = running ? live ?? data?.job : data?.job
  const [creating, setCreating] = useState(false)
  const [renaming, setRenaming] = useState<Template | null>(null)
  const [deleting, setDeleting] = useState<Template | null>(null)
  const [applying, setApplying] = useState<{ target: Target; mode: 'reset' | 'repair' } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['templates'] })
  const capture = useMutation({ mutationFn: (t: Template) => api(`/templates/${t.id}/capture`, { method: 'POST' }), onSuccess: () => { toast.success('Photo reprise depuis le Discord modèle'); refresh() } })
  const remove = useMutation({ mutationFn: (t: Template) => api(`/templates/${t.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Modèle supprimé'); setDeleting(null); refresh() } })
  const nameOf = (id: number | null) => data?.templates.find((t) => t.id === id)?.name ?? 'Modèle supprimé'

  return (
    <Page
      title='Modèles de serveur'
      description='Monte un Discord modèle à la main (Entreprise, Gang, Service public…), le bot en prend la photo, puis le recrée sur les autres serveurs du réseau. Jamais sur le serveur principal.'
      actions={can('templates.manage') && <Button onClick={() => setCreating(true)}><Plus /> Nouveau modèle</Button>}
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid gap-6'>
          {job && <JobCard job={job} />}

          {!data.templates.length
            ? <Section title='Modèles'><EmptyState title='Aucun modèle'>Crée un Discord modèle, invite le bot dessus, puis ajoute-le ici.</EmptyState></Section>
            : (
              <div className='stagger grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2 xl:grid-cols-3'>
                {data.templates.map((t) => (
                  <article key={t.id} className='lift grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-3 rounded-xl border bg-card p-5'>
                    <div className='flex items-start gap-3'>
                      <span className='grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary'><LayoutTemplate className='size-5' /></span>
                      <div className='min-w-0 flex-1'>
                        <h2 className='truncate text-lg font-semibold'>{t.name}</h2>
                        <p className='truncate text-xs text-muted-foreground'>Discord modèle : {t.sourceName} · photo {ago(t.capturedAt)}</p>
                      </div>
                      {can('templates.manage') && (
                        <div className='flex'>
                          <Button size='icon' variant='ghost' aria-label={`Renommer ${t.name}`} onClick={() => setRenaming(t)}><Pencil /></Button>
                          <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${t.name}`} onClick={() => setDeleting(t)}><Trash2 /></Button>
                        </div>
                      )}
                    </div>
                    {t.description && <p className='text-sm text-muted-foreground'>{t.description}</p>}
                    <div className='flex flex-wrap gap-1.5'>
                      <Pill>{plural(t.summary.roles, 'rôle')}</Pill>
                      <Pill>{plural(t.summary.categories, 'catégorie')}</Pill>
                      <Pill>{plural(t.summary.channels, 'salon')}</Pill>
                      {t.summary.ticketTypes > 0 && <Pill tone='accent'>{t.summary.ticketTypes > 1 ? `${t.summary.ticketTypes} types de tickets` : '1 type de ticket'}</Pill>}
                      {t.summary.logRoutes > 0 && <Pill tone='accent'>{t.summary.logRoutes > 1 ? `${t.summary.logRoutes} salons de logs` : '1 salon de logs'}</Pill>}
                      {t.summary.automod && <Pill tone='accent'>Automod</Pill>}
                    </div>
                    {can('templates.manage') && (
                      <Button loading={capture.isPending} variant='outline' size='sm' className='justify-self-start' disabled={capture.isPending} onClick={() => capture.mutate(t)}>
                        <Camera /> Reprendre la photo
                      </Button>
                    )}
                  </article>
                ))}
              </div>
            )}

          <Section title='Serveurs du réseau' description='Réparer remet d’aplomb sans rien supprimer. Réinitialiser reconstruit le serveur à l’identique du modèle (les messages des salons sont perdus).'>
            {!data.targets.length ? <EmptyState title='Aucun serveur cible'>Ajoute des serveurs au réseau (hors principal et hors Discord modèles).</EmptyState> : (
              <ul className='divide-y'>
                {data.targets.map((g) => (
                  <li key={g.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                    <GuildIcon src={g.icon} name={g.name} className='size-9' />
                    <div className='min-w-48 flex-1'>
                      <div className='font-medium'>{g.name}</div>
                      <div className='text-xs text-muted-foreground'>
                        {g.application
                          ? <>{nameOf(g.application.templateId)} · {g.application.mode === 'reset' ? 'réinitialisé' : 'réparé'} {ago(g.application.appliedAt)}{g.application.report.warnings.length ? ` · ${g.application.report.warnings.length} avertissement(s)` : ''}</>
                          : 'Aucun modèle appliqué'}
                      </div>
                    </div>
                    {g.application?.status === 'failed' && <Pill tone='danger'>Échec</Pill>}
                    {can('templates.apply') && data.templates.length > 0 && (
                      <div className='flex gap-2'>
                        <Button size='sm' variant='outline' disabled={running} onClick={() => setApplying({ target: g, mode: 'repair' })}><Hammer /> Réparer</Button>
                        <Button size='sm' variant='danger-outline' disabled={running} onClick={() => setApplying({ target: g, mode: 'reset' })}><RotateCcw /> Réinitialiser</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      )}
      {creating && data && <CreateDialog sources={data.sources} onClose={() => { setCreating(false); refresh() }} />}
      {renaming && <RenameDialog template={renaming} onClose={() => { setRenaming(null); refresh() }} />}
      {applying && data && <ApplyDialog {...applying} templates={data.templates} onClose={() => setApplying(null)} onStarted={() => { setApplying(null); refresh() }} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Supprimer le modèle ${deleting?.name} ?`} desc='Les serveurs déjà construits ne changent pas. Le Discord modèle reste intact.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
    </Page>
  )
}

function CreateDialog({ sources, onClose }: { sources: Data['sources']; onClose: () => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [sourceGuildId, setSource] = useState('')
  const create = useMutation({ mutationFn: () => api('/templates', { method: 'POST', body: { name, description, sourceGuildId } }), onSuccess: () => { toast.success('Modèle créé : photo prise'); onClose() } })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nouveau modèle</DialogTitle>
          <DialogDescription>Le bot prend la photo du Discord modèle : rôles, salons, permissions, réglages, et sa configuration du panel (tickets, automod, logs, rôles du staff).</DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-1.5'><Label htmlFor='tp-name'>Nom</Label><Input id='tp-name' value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder='Entreprise' /></div>
          <div className='grid gap-1.5'>
            <Label>Discord modèle</Label>
            <Select value={sourceGuildId} onValueChange={setSource}>
              <SelectTrigger><SelectValue placeholder='Choisir le serveur à photographier' /></SelectTrigger>
              <SelectContent>{sources.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
            <span className='text-xs text-muted-foreground'>Il doit faire partie du réseau, avec le bot dessus. Il ne pourra plus être reconstruit lui-même.</span>
          </div>
          <div className='grid gap-1.5'><Label htmlFor='tp-desc'>Description (facultatif)</Label><Textarea id='tp-desc' rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} placeholder='Pour les entreprises légales : direction, employés, salle de réunion…' /></div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || !sourceGuildId || create.isPending}>{create.isPending ? <Loader2 className='animate-spin' /> : <Camera />} Prendre la photo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RenameDialog({ template, onClose }: { template: Template; onClose: () => void }) {
  const [name, setName] = useState(template.name)
  const [description, setDescription] = useState(template.description ?? '')
  const save = useMutation({ mutationFn: () => api(`/templates/${template.id}`, { method: 'PUT', body: { name, description } }), onSuccess: () => { toast.success('Modèle renommé'); onClose() } })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Renommer le modèle</DialogTitle></DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-1.5'><Label htmlFor='rn-name'>Nom</Label><Input id='rn-name' value={name} maxLength={60} onChange={(e) => setName(e.target.value)} /></div>
          <div className='grid gap-1.5'><Label htmlFor='rn-desc'>Description</Label><Textarea id='rn-desc' rows={2} maxLength={300} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} disabled={!name.trim() || save.isPending}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApplyDialog({ target, mode, templates, onClose, onStarted }: { target: Target; mode: 'reset' | 'repair'; templates: Template[]; onClose: () => void; onStarted: () => void }) {
  const [templateId, setTemplateId] = useState(String(target.application?.templateId && templates.some((t) => t.id === target.application?.templateId) ? target.application.templateId : templates[0].id))
  const [confirmName, setConfirmName] = useState('')
  const reset = mode === 'reset'
  const template = templates.find((t) => String(t.id) === templateId)!
  const apply = useMutation({
    mutationFn: () => api(`/templates/${templateId}/apply`, { method: 'POST', body: { guildId: target.id, mode, confirm: true, confirmName } }),
    onSuccess: () => { toast.success(reset ? 'Réinitialisation lancée' : 'Réparation lancée'); onStarted() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{reset ? 'Réinitialiser' : 'Réparer'} {target.name}</DialogTitle>
          <DialogDescription>
            {reset
              ? 'Le serveur est reconstruit à l’identique du modèle : tous les salons sont recréés (leurs messages sont perdus), les rôles en trop sont supprimés, ceux de même nom sont gardés pour que les membres les conservent. La configuration du panel du serveur est remplacée.'
              : 'Ce qui manque est recréé et ce qui existe est remis comme dans le modèle. Rien n’est supprimé, les messages restent. La configuration du panel est complétée sans rien écraser.'}
          </DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-1.5'>
            <Label>Modèle</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{templates.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}</SelectContent>
            </Select>
            <span className='text-xs text-muted-foreground'>{plural(template.summary.roles, 'rôle')}, {plural(template.summary.categories, 'catégorie')}, {plural(template.summary.channels, 'salon')} · photo {ago(template.capturedAt)}</span>
          </div>
          {reset && (
            <div className='grid gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-3'>
              <Label htmlFor='ap-confirm'>Pour confirmer, tape le nom du serveur : <strong>{target.name}</strong></Label>
              <Input id='ap-confirm' value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete='off' />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button
            variant={reset ? 'destructive' : 'default'}
            onClick={() => apply.mutate()}
            disabled={apply.isPending || (reset && confirmName.trim().toLowerCase() !== target.name.trim().toLowerCase())}
          >
            {reset ? <RotateCcw /> : <Hammer />} {reset ? 'Réinitialiser' : 'Réparer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
