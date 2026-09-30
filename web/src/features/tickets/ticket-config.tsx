import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Pencil, Plus, Send, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { TicketCategory, TicketCategoryConfig, TicketConfig, TicketPanel, TicketStatus } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Section, EmptyState, Pill, RankBadge } from '@/components/app/ui'
import { CategorySelect, ChannelSelect, RolesPicker } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FormBuilder } from '@/features/forms/form-builder'
import { EMPTY_EMBED, EmbedFields, cleanEmbed } from '@/features/announcements/embed-editor'
import { DiscordPreview } from '@/features/announcements/discord-preview'
import { DAYS, DEFAULT_CATEGORY_CONFIG } from './defaults'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

const BUTTON_STYLES = [
  { value: 'secondary', label: 'Gris' },
  { value: 'primary', label: 'Bleu' },
  { value: 'success', label: 'Vert' },
  { value: 'danger', label: 'Rouge' },
] as const

export function TicketConfigPanel({ guildId }: { guildId: string }) {
  const { can } = useMe()
  const manage = can('tickets.manage')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['ticket-config', guildId], queryFn: () => api<TicketConfig>(`/tickets/config/${guildId}`) })
  const [editing, setEditing] = useState<Partial<TicketCategory> | null>(null)
  const [deleting, setDeleting] = useState<TicketCategory | null>(null)
  const [editingPanel, setEditingPanel] = useState<Partial<TicketPanel> | null>(null)
  const [deletingPanel, setDeletingPanel] = useState<TicketPanel | null>(null)

  const refresh = () => qc.invalidateQueries({ queryKey: ['ticket-config', guildId] })
  const saveSettings = useMutation({
    mutationFn: (body: { maxOpen?: number; statusPrefix?: boolean }) => api(`/tickets/config/${guildId}/settings`, { method: 'PUT', body }),
    onSuccess: () => { toast.success('Réglages enregistrés'); refresh() },
  })
  const publish = useMutation({
    mutationFn: (panel: TicketPanel) => api(`/tickets/config/${guildId}/panels/${panel.id}/publish`, { method: 'POST' }),
    onSuccess: () => { toast.success('Panneau publié'); refresh() },
  })
  const remove = useMutation({
    mutationFn: (c: TicketCategory) => api(`/tickets/config/${guildId}/categories/${c.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Type de ticket supprimé'); setDeleting(null); refresh() },
  })
  const removePanel = useMutation({
    mutationFn: (p: TicketPanel) => api(`/tickets/config/${guildId}/panels/${p.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Panneau supprimé'); setDeletingPanel(null); refresh() },
  })

  if (!data) return <Skeleton className='h-64 w-full' />

  return (
    <div className='grid gap-6'>
      <Section title='Réglages du serveur'>
        <div className='flex flex-wrap items-end gap-6 p-4'>
          <div className='grid gap-1.5'>
            <Label htmlFor='max-open'>Tickets ouverts par personne (tous types)</Label>
            <Input
              id='max-open' type='number' min={1} max={20} className='w-32' defaultValue={data.settings.maxOpen} disabled={!manage}
              onBlur={(e) => Number(e.target.value) !== data.settings.maxOpen && saveSettings.mutate({ maxOpen: Number(e.target.value) })}
            />
          </div>
          <label className='flex items-center gap-2 text-sm'>
            <Switch checked={data.settings.statusPrefix} disabled={!manage} onCheckedChange={(v) => saveSettings.mutate({ statusPrefix: v })} />
            Émoji du statut devant le nom du salon (🟢┃ticket-0001)
          </label>
        </div>
      </Section>

      <Section
        title='Types de tickets'
        description='Chaque type a son formulaire, son staff, ses règles d’accès et sa façon de se fermer.'
        actions={manage && <Button size='sm' onClick={() => setEditing({ name: '', rankIds: [], roleIds: [], config: DEFAULT_CATEGORY_CONFIG })}><Plus /> Type de ticket</Button>}
      >
        {!data.categories.length ? <EmptyState title='Aucun type de ticket'>Crée par exemple « Support », « Signalement » et « Partenariat ».</EmptyState> : (
          <ul className='divide-y'>
            {data.categories.map((c) => {
              const questions = c.config.form.steps.reduce((n, s) => n + s.questions.length, 0)
              return (
                <li key={c.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                  <span className='w-6 text-center text-lg'>{c.emoji}</span>
                  <div className='min-w-48 flex-1'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <span className='font-medium'>{c.name}</span>
                      <Pill>{c.config.form.steps.length ? `${questions} question${questions > 1 ? 's' : ''} · ${c.config.form.steps.length} étape${c.config.form.steps.length > 1 ? 's' : ''}` : 'Sans formulaire'}</Pill>
                      {c.config.close.mode === 'archive' && <Pill>Archivage</Pill>}
                      {c.config.access.hours.enabled && <Pill>Horaires</Pill>}
                      {c.config.rating.enabled && <Pill>Note</Pill>}
                    </div>
                    <div className='text-xs text-muted-foreground'>{c.description ?? 'Sans description'}</div>
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
              )
            })}
          </ul>
        )}
      </Section>

      <Section
        title='Panneaux'
        description='Les messages avec lesquels les membres ouvrent un ticket. Un panneau peut proposer tous les types, ou seulement certains.'
        actions={manage && (
          <Button size='sm' onClick={() => setEditingPanel({ name: '', style: 'buttons', categoryIds: [], payload: { content: '', embed: { ...EMPTY_EMBED, title: 'Besoin d’aide ?', description: 'Choisis le type de demande : un salon privé s’ouvre avec l’équipe.' } } })}>
            <Plus /> Panneau
          </Button>
        )}
      >
        {!data.panels.length ? <EmptyState title='Aucun panneau'>Crée un panneau, choisis son salon puis publie-le.</EmptyState> : (
          <ul className='divide-y'>
            {data.panels.map((p) => (
              <li key={p.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                <div className='min-w-48 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>{p.name}</span>
                    <Pill>{p.style === 'select' ? 'Menu' : 'Boutons'}</Pill>
                    {p.messageId ? <Pill tone='success'>Publié</Pill> : <Pill tone='warning'>Pas encore publié</Pill>}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {p.channelId ? `#${data.channels.find((c) => c.id === p.channelId)?.name ?? 'salon supprimé'}` : 'Pas de salon'}
                    {' · '}{p.categoryIds.length ? p.categoryIds.map((id) => data.categories.find((c) => c.id === id)?.name).filter(Boolean).join(', ') : 'tous les types'}
                  </div>
                </div>
                {manage && (
                  <div className='flex gap-2'>
                    <Button size='sm' variant='outline' onClick={() => publish.mutate(p)} disabled={publish.isPending || !p.channelId}>
                      <Send /> {p.messageId ? 'Mettre à jour' : 'Publier'}
                    </Button>
                    <Button size='sm' variant='outline' onClick={() => setEditingPanel(p)}><Pencil /> Modifier</Button>
                    <Button size='sm' variant='ghost' className='text-destructive' onClick={() => setDeletingPanel(p)}>Supprimer</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <StatusesEditor key={JSON.stringify(data.statuses)} guildId={guildId} config={data} disabled={!manage} />

      {editing && <CategoryDialog guildId={guildId} config={data} initial={editing} onClose={() => setEditing(null)} />}
      {editingPanel && <PanelDialog guildId={guildId} config={data} initial={editingPanel} onClose={() => setEditingPanel(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Supprimer le type ${deleting?.name} ?`}
        desc='Il disparaîtra des panneaux à leur prochaine mise à jour. Les tickets déjà ouverts ne sont pas touchés.'
        confirmText='Supprimer'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => deleting && remove.mutate(deleting)}
      />
      <ConfirmDialog
        open={Boolean(deletingPanel)}
        onOpenChange={(o) => !o && setDeletingPanel(null)}
        title={`Supprimer le panneau ${deletingPanel?.name} ?`}
        desc='Son message est aussi supprimé du salon Discord.'
        confirmText='Supprimer'
        destructive
        isLoading={removePanel.isPending}
        handleConfirm={() => deletingPanel && removePanel.mutate(deletingPanel)}
      />
    </div>
  )
}

function StatusesEditor({ guildId, config, disabled }: { guildId: string; config: TicketConfig; disabled: boolean }) {
  const qc = useQueryClient()
  const [statuses, setStatuses] = useState<TicketStatus[]>(config.statuses)
  const dirty = JSON.stringify(statuses) !== JSON.stringify(config.statuses)
  const patch = (i: number, value: Partial<TicketStatus>) => setStatuses(statuses.map((s, j) => (j === i ? { ...s, ...value } : s)))
  const move = (from: number, to: number) => {
    const next = [...statuses]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    setStatuses(next)
  }
  const save = useMutation({
    mutationFn: () => api(`/tickets/config/${guildId}/statuses`, { method: 'PUT', body: statuses }),
    onSuccess: () => { toast.success('Statuts enregistrés'); qc.invalidateQueries({ queryKey: ['ticket-config', guildId] }) },
  })
  const addStatus = () => {
    let n = statuses.length + 1
    while (statuses.some((s) => s.key === `statut_${n}`)) n++
    setStatuses([...statuses, { key: `statut_${n}`, label: 'Nouveau statut', emoji: '🔵', color: '#5b9cf6', parentChannelId: null, position: statuses.length, builtin: false }])
  }

  return (
    <Section
      title='Statuts'
      description='Le staff change le statut d’un ticket depuis Discord ou le panel. Chaque statut peut déplacer le salon dans une catégorie Discord. Ouvert, Pris en charge et Fermé existent toujours.'
      actions={!disabled && (
        <div className='flex gap-2'>
          <Button size='sm' variant='outline' onClick={addStatus} disabled={statuses.length >= 20}><Plus /> Statut</Button>
          {dirty && <Button size='sm' onClick={() => save.mutate()} disabled={save.isPending}>Enregistrer</Button>}
        </div>
      )}
    >
      <ul className='divide-y'>
        {statuses.map((s, i) => (
          <li key={i} className='grid gap-2 px-4 py-3 md:grid-cols-[4rem_1fr_7rem_14rem_auto] md:items-center'>
            <Input value={s.emoji ?? ''} maxLength={64} aria-label={`Émoji du statut ${s.label}`} disabled={disabled} onChange={(e) => patch(i, { emoji: e.target.value })} />
            <div className='flex items-center gap-2'>
              <Input value={s.label} maxLength={50} aria-label='Nom du statut' disabled={disabled} onChange={(e) => patch(i, { label: e.target.value })} />
              {s.builtin && <Pill>intégré</Pill>}
            </div>
            <Input type='color' value={s.color} className='h-9 p-1' aria-label={`Couleur du statut ${s.label}`} disabled={disabled} onChange={(e) => patch(i, { color: e.target.value })} />
            <CategorySelect
              categories={config.categoryChannels}
              value={s.parentChannelId}
              onChange={(v) => patch(i, { parentChannelId: v })}
              disabled={disabled}
              noneLabel={s.key === 'closed' ? 'Ne pas déplacer' : 'Catégorie du type'}
              label={`Catégorie Discord du statut ${s.label}`}
            />
            <div className='flex gap-1'>
              <Button type='button' size='icon' variant='ghost' aria-label='Monter' disabled={disabled || i === 0} onClick={() => move(i, i - 1)}><ArrowUp /></Button>
              <Button type='button' size='icon' variant='ghost' aria-label='Descendre' disabled={disabled || i === statuses.length - 1} onClick={() => move(i, i + 1)}><ArrowDown /></Button>
              <Button type='button' size='icon' variant='ghost' className='text-destructive' aria-label={`Supprimer le statut ${s.label}`} disabled={disabled || s.builtin} onClick={() => setStatuses(statuses.filter((_, j) => j !== i))}><Trash2 /></Button>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

function NumberField({ id, label, value, onChange, min = 0, max, suffix, hint }: {
  id: string; label: string; value: number; onChange: (n: number) => void; min?: number; max: number; suffix?: string; hint?: string
}) {
  return (
    <div className='grid gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <div className='flex items-center gap-2'>
        <Input id={id} type='number' min={min} max={max} value={value} className='w-28' onChange={(e) => onChange(Math.min(max, Math.max(min, Number(e.target.value) || 0)))} />
        {suffix && <span className='text-sm text-muted-foreground'>{suffix}</span>}
      </div>
      {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
    </div>
  )
}

function Toggle({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className='flex items-start gap-2 text-sm'>
      <Checkbox className='mt-0.5' checked={checked} onCheckedChange={(v) => onChange(v === true)} />
      <span>{children}</span>
    </label>
  )
}

function CategoryDialog({ guildId, config, initial, onClose }: { guildId: string; config: TicketConfig; initial: Partial<TicketCategory>; onClose: () => void }) {
  const qc = useQueryClient()
  const [c, setC] = useState(initial)
  const [cfg, setCfg] = useState<TicketCategoryConfig>(initial.config ?? DEFAULT_CATEGORY_CONFIG)
  const patch = <K extends keyof TicketCategoryConfig>(key: K, value: Partial<TicketCategoryConfig[K]>) =>
    setCfg((prev) => ({ ...prev, [key]: typeof prev[key] === 'object' && !Array.isArray(prev[key]) ? { ...(prev[key] as object), ...(value as object) } : value }))
  const toggleRank = (id: number) => setC((prev) => ({ ...prev, rankIds: (prev.rankIds ?? []).includes(id) ? prev.rankIds!.filter((r) => r !== id) : [...(prev.rankIds ?? []), id] }))

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
        config: cfg,
      },
    }),
    onSuccess: () => {
      toast.success('Type de ticket enregistré. Mets à jour les panneaux pour afficher les changements de nom ou d’émoji.')
      qc.invalidateQueries({ queryKey: ['ticket-config', guildId] })
      onClose()
    },
  })

  const hours = cfg.access.hours
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader><DialogTitle>{c.id ? `Modifier ${initial.name}` : 'Nouveau type de ticket'}</DialogTitle></DialogHeader>
        <form id='category-form' className='grid gap-4' onSubmit={(e) => { e.preventDefault(); if (c.name?.trim()) save.mutate() }}>
          <Tabs defaultValue='general'>
            <TabsList className='flex h-auto flex-wrap'>
              <TabsTrigger value='general'>Général</TabsTrigger>
              <TabsTrigger value='form'>Formulaire</TabsTrigger>
              <TabsTrigger value='access'>Accès</TabsTrigger>
              <TabsTrigger value='messages'>Messages</TabsTrigger>
              <TabsTrigger value='handling'>Traitement</TabsTrigger>
              <TabsTrigger value='statuses'>Statuts</TabsTrigger>
            </TabsList>

            <TabsContent value='general' className='mt-4 grid gap-4'>
              <div className='grid gap-4 sm:grid-cols-[5rem_1fr_9rem]'>
                <div className='grid gap-1.5'>
                  <Label htmlFor='cat-emoji'>Émoji</Label>
                  <Input id='cat-emoji' value={c.emoji ?? ''} onChange={(e) => setC({ ...c, emoji: e.target.value })} placeholder='🛟' />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='cat-name'>Nom</Label>
                  <Input id='cat-name' value={c.name ?? ''} maxLength={50} required onChange={(e) => setC({ ...c, name: e.target.value })} placeholder='Support' />
                </div>
                <div className='grid gap-1.5'>
                  <Label>Couleur du bouton</Label>
                  <Select value={cfg.buttonStyle} onValueChange={(v) => setCfg({ ...cfg, buttonStyle: v as TicketCategoryConfig['buttonStyle'] })}>
                    <SelectTrigger aria-label='Couleur du bouton'><SelectValue /></SelectTrigger>
                    <SelectContent>{BUTTON_STYLES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='cat-desc'>Description (affichée dans le menu du panneau)</Label>
                <Input id='cat-desc' value={c.description ?? ''} maxLength={100} onChange={(e) => setC({ ...c, description: e.target.value })} placeholder='Une question, un problème' />
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='cat-template'>Nom des salons</Label>
                <Input id='cat-template' value={cfg.nameTemplate} maxLength={90} onChange={(e) => setCfg({ ...cfg, nameTemplate: e.target.value })} />
                <p className='text-xs text-muted-foreground'>Variables : {'{number}'} {'{user}'} {'{type}'} {'{status}'}. Exemple : support-{'{number}'}-{'{user}'}</p>
              </div>
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label>Catégorie Discord des tickets ouverts</Label>
                  <CategorySelect categories={config.categoryChannels} value={c.parentChannelId ?? null} onChange={(v) => setC({ ...c, parentChannelId: v })} noneLabel='Aucune (en haut du serveur)' label='Catégorie Discord des tickets ouverts' />
                </div>
                <div className='grid gap-1.5'>
                  <Label>Salon des transcripts</Label>
                  <ChannelSelect channels={config.channels} value={c.transcriptChannelId ?? null} onChange={(v) => setC({ ...c, transcriptChannelId: v })} noneLabel='Seulement le salon de logs « Tickets »' label='Salon des transcripts' />
                </div>
              </div>
              <fieldset>
                <legend className='mb-2 text-sm font-medium'>Rangs du staff qui traitent ces tickets</legend>
                <div className='flex flex-wrap gap-3'>
                  {config.ranks.map((r) => (
                    <label key={r.id} className='flex items-center gap-2 text-sm'>
                      <Checkbox checked={(c.rankIds ?? []).includes(r.id)} onCheckedChange={() => toggleRank(r.id)} />
                      <RankBadge name={r.name} color={r.color} />
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className='grid gap-1.5'>
                <Label>Rôles Discord en plus</Label>
                <RolesPicker roles={config.roles} value={c.roleIds ?? []} onChange={(roleIds) => setC({ ...c, roleIds })} label='Rôles Discord du staff en plus' />
              </div>
            </TabsContent>

            <TabsContent value='form' className='mt-4 grid gap-3'>
              <p className='text-sm text-muted-foreground'>
                Chaque étape est une fenêtre Discord de 5 questions maximum. Entre deux étapes, le membre clique sur « Continuer ». Les réponses s’affichent dans le ticket et dans le panel.
              </p>
              <FormBuilder value={cfg.form} onChange={(form) => setCfg({ ...cfg, form })} />
            </TabsContent>

            <TabsContent value='access' className='mt-4 grid gap-4'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label>Rôles requis pour ouvrir</Label>
                  <RolesPicker roles={config.roles} value={cfg.access.requiredRoleIds} onChange={(ids) => patch('access', { requiredRoleIds: ids })} placeholder='Tout le monde' label='Rôles requis' />
                  {cfg.access.requiredRoleIds.length > 1 && (
                    <Select value={cfg.access.requiredMode} onValueChange={(v) => patch('access', { requiredMode: v as 'any' | 'all' })}>
                      <SelectTrigger aria-label='Mode des rôles requis'><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value='any'>Au moins un de ces rôles</SelectItem>
                        <SelectItem value='all'>Tous ces rôles</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                <div className='grid content-start gap-1.5'>
                  <Label>Rôles interdits</Label>
                  <RolesPicker roles={config.roles} value={cfg.access.blockedRoleIds} onChange={(ids) => patch('access', { blockedRoleIds: ids })} placeholder='Aucun' label='Rôles interdits' />
                </div>
              </div>
              <div className='flex flex-wrap gap-6'>
                <NumberField id='acc-max' label='Tickets de ce type ouverts par personne' value={cfg.access.maxOpen} max={10} onChange={(n) => patch('access', { maxOpen: n })} hint='0 = seulement la limite du serveur' />
                <NumberField id='acc-cool' label='Délai entre deux tickets' value={cfg.access.cooldownMinutes} max={10080} suffix='minutes' onChange={(n) => patch('access', { cooldownMinutes: n })} />
                <NumberField id='acc-age' label='Âge minimum du compte Discord' value={cfg.access.minAccountAgeDays} max={3650} suffix='jours' onChange={(n) => patch('access', { minAccountAgeDays: n })} />
              </div>
              <fieldset className='grid gap-3 rounded-lg border p-3'>
                <legend className='px-1 text-sm font-semibold'>Horaires d’ouverture</legend>
                <Toggle checked={hours.enabled} onChange={(v) => patch('access', { hours: { ...hours, enabled: v } })}>Limiter l’ouverture à certains horaires</Toggle>
                {hours.enabled && (
                  <>
                    <div className='grid gap-2'>
                      {DAYS.map((day, i) => (
                        <div key={day} className='flex flex-wrap items-center gap-3 text-sm'>
                          <label className='flex w-28 items-center gap-2'>
                            <Checkbox checked={hours.days[i].open} onCheckedChange={(v) => patch('access', { hours: { ...hours, days: hours.days.map((d, j) => (j === i ? { ...d, open: v === true } : d)) } })} />
                            {day}
                          </label>
                          <Input type='time' className='w-32' value={hours.days[i].from} disabled={!hours.days[i].open} aria-label={`${day} : ouverture`} onChange={(e) => patch('access', { hours: { ...hours, days: hours.days.map((d, j) => (j === i ? { ...d, from: e.target.value } : d)) } })} />
                          <span className='text-muted-foreground'>à</span>
                          <Input type='time' className='w-32' value={hours.days[i].to} disabled={!hours.days[i].open} aria-label={`${day} : fermeture`} onChange={(e) => patch('access', { hours: { ...hours, days: hours.days.map((d, j) => (j === i ? { ...d, to: e.target.value } : d)) } })} />
                        </div>
                      ))}
                    </div>
                    <p className='text-xs text-muted-foreground'>Heure de Paris. Une plage 22:00 → 02:00 passe minuit.</p>
                    <div className='grid gap-1.5'>
                      <Label htmlFor='hours-msg'>Message hors horaires</Label>
                      <Input id='hours-msg' value={hours.closedMessage} maxLength={500} onChange={(e) => patch('access', { hours: { ...hours, closedMessage: e.target.value } })} />
                    </div>
                  </>
                )}
              </fieldset>
            </TabsContent>

            <TabsContent value='messages' className='mt-4 grid gap-4'>
              <div className='grid gap-4 sm:grid-cols-[1fr_8rem]'>
                <div className='grid gap-1.5'>
                  <Label htmlFor='w-title'>Titre du message d’accueil</Label>
                  <Input id='w-title' value={cfg.welcome.title} maxLength={256} onChange={(e) => patch('welcome', { title: e.target.value })} />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='w-color'>Couleur</Label>
                  <Input id='w-color' type='color' value={cfg.welcome.color} className='h-9 p-1' onChange={(e) => patch('welcome', { color: e.target.value })} />
                </div>
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='w-msg'>Texte</Label>
                <Textarea id='w-msg' rows={5} maxLength={4000} value={cfg.welcome.message} onChange={(e) => patch('welcome', { message: e.target.value })} />
                <p className='text-xs text-muted-foreground'>Variables : {'{user}'} (mention), {'{user.name}'}, {'{number}'}, {'{type}'}</p>
              </div>
              <Toggle checked={cfg.welcome.showAnswers} onChange={(v) => patch('welcome', { showAnswers: v })}>Afficher les réponses du formulaire dans le message</Toggle>
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label>Ping à l’ouverture</Label>
                  <Select value={cfg.ping} onValueChange={(v) => setCfg({ ...cfg, ping: v as TicketCategoryConfig['ping'] })}>
                    <SelectTrigger aria-label='Ping à l’ouverture'><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value='staff'>Le staff du type</SelectItem>
                      <SelectItem value='roles'>Des rôles choisis</SelectItem>
                      <SelectItem value='none'>Personne</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                {cfg.ping === 'roles' && (
                  <div className='grid gap-1.5'>
                    <Label>Rôles à mentionner</Label>
                    <RolesPicker roles={config.roles} value={cfg.pingRoleIds} onChange={(ids) => setCfg({ ...cfg, pingRoleIds: ids })} label='Rôles à mentionner' />
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value='handling' className='mt-4 grid gap-4'>
              <fieldset className='grid gap-2 rounded-lg border p-3'>
                <legend className='px-1 text-sm font-semibold'>Prise en charge</legend>
                <Toggle checked={cfg.claim.exclusiveWrite} onChange={(v) => patch('claim', { exclusiveWrite: v })}>
                  Une fois pris en charge, seul le membre du staff qui l’a pris peut écrire (les autres lisent)
                </Toggle>
              </fieldset>
              <fieldset className='grid gap-3 rounded-lg border p-3'>
                <legend className='px-1 text-sm font-semibold'>Fermeture</legend>
                <Toggle checked={cfg.close.openerCanClose} onChange={(v) => patch('close', { openerCanClose: v })}>Le membre peut fermer son ticket</Toggle>
                <Toggle checked={cfg.close.requireReason} onChange={(v) => patch('close', { requireReason: v })}>Raison obligatoire</Toggle>
                <Toggle checked={cfg.close.confirm} onChange={(v) => patch('close', { confirm: v })}>Demander confirmation</Toggle>
                <div className='flex flex-wrap items-end gap-4'>
                  <div className='grid gap-1.5'>
                    <Label>Après la fermeture</Label>
                    <Select value={cfg.close.mode} onValueChange={(v) => patch('close', { mode: v as 'delete' | 'archive' })}>
                      <SelectTrigger className='w-72' aria-label='Après la fermeture'><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value='delete'>Supprimer le salon</SelectItem>
                        <SelectItem value='archive'>Archiver (le staff peut rouvrir)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {cfg.close.mode === 'delete' && (
                    <NumberField id='close-delay' label='Délai avant suppression' value={cfg.close.deleteDelaySeconds} max={86400} suffix='secondes' onChange={(n) => patch('close', { deleteDelaySeconds: n })} />
                  )}
                </div>
                {cfg.close.mode === 'archive' && <p className='text-xs text-muted-foreground'>La catégorie d’archive se règle dans l’onglet Statuts, sur « Fermé ».</p>}
                <Toggle checked={cfg.transcriptDm} onChange={(v) => setCfg({ ...cfg, transcriptDm: v })}>Envoyer le transcript au membre en message privé</Toggle>
                <Toggle checked={cfg.rating.enabled} onChange={(v) => patch('rating', { enabled: v })}>Demander une note de 1 à 5 au membre après la fermeture</Toggle>
              </fieldset>
              <fieldset className='grid gap-3 rounded-lg border p-3'>
                <legend className='px-1 text-sm font-semibold'>Inactivité</legend>
                <div className='flex flex-wrap gap-6'>
                  <NumberField id='inact-rem' label='Rappel au membre après' value={cfg.inactivity.reminderHours} max={720} suffix='heures sans message' onChange={(n) => patch('inactivity', { reminderHours: n })} hint='0 = pas de rappel' />
                  <NumberField id='inact-close' label='Fermeture automatique après' value={cfg.inactivity.closeHours} max={2160} suffix='heures sans message' onChange={(n) => patch('inactivity', { closeHours: n })} hint='0 = jamais' />
                </div>
              </fieldset>
            </TabsContent>

            <TabsContent value='statuses' className='mt-4 grid gap-3'>
              <p className='text-sm text-muted-foreground'>Pour ce type seulement, tu peux envoyer les tickets d’un statut dans une autre catégorie Discord que celle réglée pour le statut.</p>
              <ul className='divide-y rounded-lg border'>
                {config.statuses.map((s) => (
                  <li key={s.key} className='grid gap-2 px-3 py-2 sm:grid-cols-[1fr_16rem] sm:items-center'>
                    <span className='text-sm'>{s.emoji} {s.label}</span>
                    <div className='flex items-center gap-1'>
                      <CategorySelect
                        categories={config.categoryChannels}
                        value={cfg.statusParents[s.key] ?? null}
                        onChange={(v) => {
                          const next = { ...cfg.statusParents }
                          if (v) next[s.key] = v
                          else delete next[s.key]
                          setCfg({ ...cfg, statusParents: next })
                        }}
                        noneLabel='Réglage du statut'
                        label={`Catégorie Discord pour ${s.label}`}
                      />
                      {cfg.statusParents[s.key] && <X aria-hidden className='size-4 text-muted-foreground' />}
                    </div>
                  </li>
                ))}
              </ul>
            </TabsContent>
          </Tabs>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='category-form' disabled={!c.name?.trim() || save.isPending}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PanelDialog({ guildId, config, initial, onClose }: { guildId: string; config: TicketConfig; initial: Partial<TicketPanel>; onClose: () => void }) {
  const qc = useQueryClient()
  const [p, setP] = useState(initial)
  const payload = p.payload ?? { content: '', embed: EMPTY_EMBED }
  const save = useMutation({
    mutationFn: () => api<TicketPanel>(`/tickets/config/${guildId}/panels`, {
      method: 'PUT',
      body: {
        ...(p.id ? { id: p.id } : {}),
        name: p.name ?? '',
        channelId: p.channelId ?? null,
        style: p.style ?? 'buttons',
        placeholder: p.placeholder || null,
        categoryIds: p.categoryIds ?? [],
        payload: { content: payload.content, embed: cleanEmbed(payload.embed) },
      },
    }),
    onSuccess: () => {
      toast.success('Panneau enregistré. Publie-le pour mettre à jour Discord.')
      qc.invalidateQueries({ queryKey: ['ticket-config', guildId] })
      onClose()
    },
  })
  const selected = p.categoryIds ?? []
  const shown = selected.length ? config.categories.filter((c) => selected.includes(c.id)) : config.categories

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-5xl'>
        <DialogHeader><DialogTitle>{p.id ? `Modifier ${initial.name}` : 'Nouveau panneau'}</DialogTitle></DialogHeader>
        <form id='panel-form' className='grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]' onSubmit={(e) => { e.preventDefault(); if (p.name?.trim()) save.mutate() }}>
          <div className='grid content-start gap-4'>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label htmlFor='panel-name'>Nom interne</Label>
                <Input id='panel-name' value={p.name ?? ''} maxLength={50} required onChange={(e) => setP({ ...p, name: e.target.value })} placeholder='Support général' />
              </div>
              <div className='grid gap-1.5'>
                <Label>Salon</Label>
                <ChannelSelect channels={config.channels} value={p.channelId ?? null} onChange={(v) => setP({ ...p, channelId: v })} label='Salon du panneau' />
              </div>
              <div className='grid gap-1.5'>
                <Label>Affichage</Label>
                <Select value={p.style ?? 'buttons'} onValueChange={(v) => setP({ ...p, style: v as 'buttons' | 'select' })}>
                  <SelectTrigger aria-label='Affichage'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='buttons'>Un bouton par type</SelectItem>
                    <SelectItem value='select'>Un menu déroulant</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {p.style === 'select' && (
                <div className='grid gap-1.5'>
                  <Label htmlFor='panel-ph'>Texte du menu</Label>
                  <Input id='panel-ph' value={p.placeholder ?? ''} maxLength={150} placeholder='Choisis le type de demande' onChange={(e) => setP({ ...p, placeholder: e.target.value })} />
                </div>
              )}
            </div>
            <fieldset>
              <legend className='mb-2 text-sm font-medium'>Types proposés <span className='font-normal text-muted-foreground'>(aucun coché = tous)</span></legend>
              <div className='flex flex-wrap gap-3'>
                {config.categories.map((c) => (
                  <label key={c.id} className='flex items-center gap-2 text-sm'>
                    <Checkbox checked={selected.includes(c.id)} onCheckedChange={() => setP({ ...p, categoryIds: selected.includes(c.id) ? selected.filter((id) => id !== c.id) : [...selected, c.id] })} />
                    {c.emoji} {c.name}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className='grid gap-1.5'>
              <Label htmlFor='panel-content'>Texte au-dessus de l’embed</Label>
              <Textarea id='panel-content' rows={2} maxLength={2000} value={payload.content} onChange={(e) => setP({ ...p, payload: { ...payload, content: e.target.value } })} />
            </div>
            <div className='grid gap-3 rounded-lg border p-3'>
              <label className='flex items-center gap-2 text-sm font-medium'>
                <Switch checked={payload.embed.enabled} onCheckedChange={(v) => setP({ ...p, payload: { ...payload, embed: { ...payload.embed, enabled: v } } })} /> Embed
              </label>
              {payload.embed.enabled && (
                <EmbedFields idPrefix='panel' embed={payload.embed} onChange={(patch) => setP({ ...p, payload: { ...payload, embed: { ...payload.embed, ...patch } } })} />
              )}
            </div>
          </div>
          <div className='lg:sticky lg:top-0 lg:self-start'>
            <h3 className='mb-2 text-sm font-semibold'>Aperçu</h3>
            <DiscordPreview content={payload.content} embed={payload.embed} roles={new Map()} />
            <div className='mt-2 flex flex-wrap gap-2 rounded-md bg-[#313338] p-3'>
              {p.style === 'select' ? (
                <div className='w-full rounded bg-[#1e1f22] px-3 py-2 text-sm text-[#949ba4]'>{p.placeholder || 'Choisis le type de demande'}</div>
              ) : shown.map((c) => (
                <span key={c.id} className={{
                  primary: 'bg-[#5865f2]', secondary: 'bg-[#4e5058]', success: 'bg-[#248046]', danger: 'bg-[#da373c]',
                }[c.config.buttonStyle] + ' rounded px-3 py-1.5 text-sm font-medium text-white'}>
                  {c.emoji} {c.name}
                </span>
              ))}
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='panel-form' disabled={!p.name?.trim() || save.isPending}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
