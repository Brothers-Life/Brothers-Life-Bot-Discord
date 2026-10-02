import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Hash, History, MousePointerClick, Pencil, Plus, Save, SquareSlash, Trash2, Wand2, X, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards, UserAvatar } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { BlockList, MultiPicker, channelItems, roleItems } from '@/features/custom-commands/flow-editor'
import { EMPTY_COMMAND, PERMISSIONS, TRIGGERS, VARIABLES, type Component, type CustomCommand, type Data, type EditorContext, type Option } from '@/features/custom-commands/model'
import { EmojiField } from '@/components/app/emoji-picker'

export const Route = createFileRoute('/_authenticated/custom-commands')({
  component: CustomCommandsPage,
})

const TRIGGER_ICONS = { slash: SquareSlash, user: MousePointerClick, message: MousePointerClick, keyword: Zap }

function displayName(c: CustomCommand) {
  if (c.trigger.type === 'slash') return `/${c.name}`
  if (c.trigger.type === 'keyword') return c.trigger.keyword?.patterns.join(' · ') || c.name
  return c.name
}

function CustomCommandsPage() {
  const { can } = useMe()
  const manage = can('customcommands.manage')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['custom-commands'], queryFn: () => api<Data>('/custom-commands') })
  const [editing, setEditing] = useState<CustomCommand | null>(null)
  const [deleting, setDeleting] = useState<CustomCommand | null>(null)
  const [history, setHistory] = useState<CustomCommand | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['custom-commands'] })
  const toggle = useMutation({ mutationFn: (c: CustomCommand) => api(`/custom-commands/${c.id}/enabled`, { method: 'POST', body: { enabled: !c.enabled } }), onSuccess: refresh })
  const remove = useMutation({ mutationFn: (c: CustomCommand) => api(`/custom-commands/${c.id}`, { method: 'DELETE', body: { confirm: true } }), onSuccess: () => { toast.success('Commande supprimée'); setDeleting(null); refresh() } })

  return (
    <Page
      title='Commandes perso'
      description='Crée tes propres commandes sans coder : un déclencheur (slash, clic droit ou mot-clé), des options, des conditions et des actions. Elles apparaissent sur Discord en quelques secondes.'
      actions={manage && <Button onClick={() => setEditing(structuredClone(EMPTY_COMMAND))}><Plus /> Nouvelle commande</Button>}
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid gap-6'>
          <StatCards items={[
            { label: 'Commandes', value: data.commands.length, icon: Wand2, tone: 'accent' },
            { label: 'Actives', value: data.commands.filter((c) => c.enabled).length, icon: Zap, tone: 'success' },
            { label: 'Utilisations', value: data.commands.reduce((n, c) => n + (c.uses ?? 0), 0), icon: History, tone: 'info' },
            { label: 'Compteurs', value: new Set(data.counters.map((c) => c.key)).size, icon: Hash, tone: 'neutral' },
          ]} />
          <Section title='Tes commandes'>
            {!data.commands.length ? <EmptyState title='Aucune commande' icon={Wand2}>Par exemple : /regles qui répond le règlement, un clic droit « Profil RP » sur un membre, ou « !discord » qui donne le lien d’invitation.</EmptyState> : (
              <ul className='divide-y'>
                {data.commands.map((c) => {
                  const Icon = TRIGGER_ICONS[c.trigger.type]
                  return (
                    <li key={c.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                      <span className='grid size-10 shrink-0 place-items-center rounded-lg bg-primary/12 text-primary'><Icon className='size-5' /></span>
                      <div className='min-w-52 flex-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <span className='font-medium'>{displayName(c)}</span>
                          <Pill tone='accent'>{TRIGGERS[c.trigger.type].label}</Pill>
                          {!c.enabled && <Pill tone='warning'>Désactivée</Pill>}
                          {c.scope.mode === 'guilds' && <Pill>{c.scope.guildIds.length} serveur(s)</Pill>}
                        </div>
                        <div className='truncate text-xs text-muted-foreground'>{c.description || `${c.flow.length} bloc(s)`} · {c.uses ?? 0} utilisation(s){c.updatedAt ? ` · modifiée ${ago(c.updatedAt)}` : ''}</div>
                      </div>
                      <div className='flex items-center gap-2'>
                        {manage && <Switch checked={Boolean(c.enabled)} onCheckedChange={() => toggle.mutate(c)} aria-label={`Activer ${c.name}`} />}
                        <Button size='icon' variant='ghost' aria-label={`Historique de ${c.name}`} onClick={() => setHistory(c)}><History /></Button>
                        {manage && <Button size='icon' variant='ghost' aria-label={`Modifier ${c.name}`} onClick={() => setEditing(structuredClone(c))}><Pencil /></Button>}
                        {manage && <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${c.name}`} onClick={() => setDeleting(c)}><Trash2 /></Button>}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
        </div>
      )}
      {editing && data && <Editor initial={editing} data={data} onClose={() => { setEditing(null); refresh() }} />}
      {history && <HistoryDialog command={history} onClose={() => setHistory(null)} />}
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)} title={`Supprimer ${deleting ? displayName(deleting) : ''} ?`} desc='Elle disparaît de Discord, avec son historique. Les boutons déjà publiés ne répondront plus.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => deleting && remove.mutate(deleting)} />
    </Page>
  )
}

function HistoryDialog({ command, onClose }: { command: CustomCommand; onClose: () => void }) {
  type Run = { id: number; user: { name: string | null; avatar: string | null } | null; userId: string; guildName: string | null; trigger: string; ok: boolean; detail: string | null; at: number }
  const { data } = useQuery({ queryKey: ['custom-command-runs', command.id], queryFn: () => api<Run[]>(`/custom-commands/${command.id}/runs`) })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[85svh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader><DialogTitle>Historique de {displayName(command)}</DialogTitle></DialogHeader>
        {!data ? <Skeleton className='h-40' /> : !data.length ? <EmptyState title='Jamais utilisée' /> : (
          <ul className='divide-y text-sm'>
            {data.map((r) => (
              <li key={r.id} className='flex items-center gap-3 py-2'>
                <UserAvatar src={r.user?.avatar} name={r.user?.name ?? r.userId} className='size-7' />
                <div className='min-w-0 flex-1'>
                  <div className='truncate'>{r.user?.name ?? r.userId}{r.guildName ? <span className='text-muted-foreground'> · {r.guildName}</span> : null}</div>
                  {r.detail && <div className='truncate text-xs text-muted-foreground'>{r.detail}</div>}
                </div>
                <Pill tone={r.ok ? 'success' : r.detail?.startsWith('Refusé') ? 'neutral' : 'warning'}>{r.ok ? 'OK' : r.detail?.startsWith('Refusé') ? 'Refusé' : 'Erreurs'}</Pill>
                <span className='text-xs text-muted-foreground'>{dateTime(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Editor({ initial, data, onClose }: { initial: CustomCommand; data: Data; onClose: () => void }) {
  const { can } = useMe()
  const [c, setC] = useState<CustomCommand>(initial)
  const set = (patch: Partial<CustomCommand>) => setC({ ...c, ...patch })
  const t = c.trigger.type
  const optionNames = t === 'slash' ? c.options.map((o) => o.name) : t === 'user' ? ['cible'] : t === 'message' ? ['auteur', 'contenu'] : t === 'keyword' ? ['message'] : []
  const userOptionNames = t === 'slash' ? c.options.filter((o) => o.type === 'user').map((o) => o.name) : t === 'user' ? ['cible'] : t === 'message' ? ['auteur'] : []
  const ctx: EditorContext = { guilds: data.guilds, optionNames, userOptionNames, components: c.components, canSensitive: can('customcommands.sensitive'), trigger: t }
  const save = useMutation({
    mutationFn: () => (c.id ? api(`/custom-commands/${c.id}`, { method: 'PUT', body: c }) : api('/custom-commands', { method: 'POST', body: c })),
    onSuccess: () => { toast.success('Commande enregistrée : elle arrive sur Discord'); onClose() },
  })
  const kw = c.trigger.keyword ?? { mode: 'contains' as const, patterns: [], caseSensitive: false, channelIds: [] }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[94svh] overflow-y-auto sm:max-w-4xl'>
        <DialogHeader><DialogTitle>{c.id ? `Modifier ${displayName(initial)}` : 'Nouvelle commande'}</DialogTitle></DialogHeader>
        <Tabs defaultValue='general'>
          <TabsList className='h-auto flex-wrap'>
            <TabsTrigger value='general'>Déclencheur</TabsTrigger>
            {t === 'slash' && <TabsTrigger value='options'>Options ({c.options.length})</TabsTrigger>}
            <TabsTrigger value='access'>Accès</TabsTrigger>
            <TabsTrigger value='flow'>Déroulé</TabsTrigger>
            <TabsTrigger value='components'>Boutons et menus ({c.components.length})</TabsTrigger>
          </TabsList>

          <TabsContent value='general' className='mt-4 grid gap-4'>
            <div className='grid gap-2 sm:grid-cols-4' role='radiogroup' aria-label='Déclencheur'>
              {(Object.keys(TRIGGERS) as (keyof typeof TRIGGERS)[]).map((k) => {
                const Icon = TRIGGER_ICONS[k]
                return (
                  <button key={k} type='button' role='radio' aria-checked={t === k} onClick={() => set({ trigger: k === 'keyword' ? { type: k, keyword: kw } : { type: k } })}
                    className={`lift grid gap-1 rounded-lg border p-3 text-start ${t === k ? 'border-brand bg-brand/10' : 'bg-card'}`}>
                    <Icon className='size-5 text-primary' />
                    <span className='text-sm font-medium'>{TRIGGERS[k].label}</span>
                    <span className='text-xs text-muted-foreground'>{TRIGGERS[k].hint}</span>
                  </button>
                )
              })}
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label htmlFor='cc-name'>{t === 'slash' ? 'Nom (après le /)' : t === 'keyword' ? 'Nom interne' : 'Nom affiché dans le menu'}</Label>
                <Input id='cc-name' value={c.name} maxLength={32} onChange={(e) => set({ name: t === 'slash' ? e.target.value.toLowerCase().replace(/\s+/g, '-') : e.target.value })} placeholder={t === 'slash' ? 'regles' : 'Profil RP'} />
              </div>
              {t === 'slash' && <div className='grid gap-1.5'><Label htmlFor='cc-desc'>Description</Label><Input id='cc-desc' value={c.description} maxLength={100} onChange={(e) => set({ description: e.target.value })} placeholder='Affiche le règlement' /></div>}
            </div>
            {t === 'keyword' && (
              <div className='grid gap-4 rounded-lg border p-4'>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <div className='grid gap-1.5'>
                    <Label>Le message…</Label>
                    <Select value={kw.mode} onValueChange={(mode) => set({ trigger: { type: 'keyword', keyword: { ...kw, mode: mode as typeof kw.mode } } })}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent><SelectItem value='contains'>contient</SelectItem><SelectItem value='startsWith'>commence par</SelectItem><SelectItem value='exact'>est exactement</SelectItem><SelectItem value='regex'>correspond à l’expression régulière</SelectItem></SelectContent>
                    </Select>
                  </div>
                  <div className='grid gap-1.5'>
                    <Label htmlFor='cc-kw'>Mots ou phrases (séparés par des virgules)</Label>
                    <Input id='cc-kw' value={kw.patterns.join(', ')} onChange={(e) => set({ trigger: { type: 'keyword', keyword: { ...kw, patterns: e.target.value.split(',').map((p) => p.trimStart()) } } })} placeholder='!regles, !règles' />
                  </div>
                </div>
                <div className='grid gap-4 sm:grid-cols-2'>
                  <label className='flex items-center gap-2 text-sm'><Checkbox checked={kw.caseSensitive} onCheckedChange={(v) => set({ trigger: { type: 'keyword', keyword: { ...kw, caseSensitive: v === true } } })} /> Respecter les majuscules</label>
                  <div className='grid gap-1.5'><Label>Seulement dans ces salons</Label><MultiPicker items={channelItems(ctx)} value={kw.channelIds} onChange={(channelIds) => set({ trigger: { type: 'keyword', keyword: { ...kw, channelIds } } })} label='Salons' placeholder='Partout' /></div>
                </div>
              </div>
            )}
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label>Serveurs</Label>
                <Select value={c.scope.mode} onValueChange={(mode) => set({ scope: { mode: mode as 'network' | 'guilds', guildIds: c.scope.guildIds } })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value='network'>Tout le réseau</SelectItem><SelectItem value='guilds'>Certains serveurs</SelectItem></SelectContent>
                </Select>
              </div>
              {c.scope.mode === 'guilds' && (
                <div className='grid gap-1.5'><Label>Lesquels</Label><MultiPicker items={data.guilds.map((g) => ({ id: g.id, label: g.name }))} value={c.scope.guildIds} onChange={(guildIds) => set({ scope: { mode: 'guilds', guildIds } })} label='Serveurs' placeholder='Choisir' /></div>
              )}
            </div>
          </TabsContent>

          {t === 'slash' && (
            <TabsContent value='options' className='mt-4 grid gap-3'>
              {c.options.map((o, i) => <OptionRow key={i} value={o} onChange={(no) => set({ options: c.options.map((x, j) => (j === i ? no : x)) })} onRemove={() => set({ options: c.options.filter((_, j) => j !== i) })} />)}
              {c.options.length < 10 && <Button type='button' variant='outline' size='sm' className='justify-self-start border-dashed' onClick={() => set({ options: [...c.options, { name: `option${c.options.length + 1}`, description: '', type: 'string', required: false }] })}><Plus /> Option</Button>}
              <p className='text-xs text-muted-foreground'>Dans les textes : {'{option.nom}'}. Une option « membre » peut servir de cible aux actions (MP, rôle, sanction).</p>
            </TabsContent>
          )}

          <TabsContent value='access' className='mt-4 grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'><Label>Rangs du panel autorisés</Label><MultiPicker items={data.ranks.map((r) => ({ id: String(r.id), label: r.name }))} value={c.access.rankIds.map(String)} onChange={(ids) => set({ access: { ...c.access, rankIds: ids.map(Number) } })} label='Rangs' placeholder='Tout le monde' /></div>
            <div className='grid gap-1.5'><Label>…ou rôles Discord autorisés</Label><MultiPicker items={roleItems(ctx)} value={c.access.roleIds} onChange={(roleIds) => set({ access: { ...c.access, roleIds } })} label='Rôles autorisés' placeholder='Tout le monde' /></div>
            <div className='grid gap-1.5'><Label>Rôles refusés</Label><MultiPicker items={roleItems(ctx)} value={c.access.denyRoleIds} onChange={(denyRoleIds) => set({ access: { ...c.access, denyRoleIds } })} label='Rôles refusés' placeholder='Aucun' /></div>
            <div className='grid gap-1.5'>
              <Label>Permission Discord requise</Label>
              <Select value={c.access.permission ?? 'none'} onValueChange={(v) => set({ access: { ...c.access, permission: v === 'none' ? null : v } })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='none'>Aucune</SelectItem>{Object.entries(PERMISSIONS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className='grid gap-1.5'><Label>Salons autorisés</Label><MultiPicker items={channelItems(ctx)} value={c.access.channelIds} onChange={(channelIds) => set({ access: { ...c.access, channelIds } })} label='Salons autorisés' placeholder='Partout' /></div>
            <div className='grid gap-1.5'><Label htmlFor='cc-denied'>Message de refus</Label><Input id='cc-denied' maxLength={200} value={c.access.deniedMessage} onChange={(e) => set({ access: { ...c.access, deniedMessage: e.target.value } })} placeholder='Cette commande est réservée.' /></div>
            <div className='grid gap-1.5'>
              <Label htmlFor='cc-cd'>Délai entre deux utilisations (secondes)</Label>
              <div className='flex gap-2'>
                <Input id='cc-cd' type='number' min={0} value={c.cooldown.seconds} onChange={(e) => set({ cooldown: { ...c.cooldown, seconds: Number(e.target.value) || 0 } })} />
                <Select value={c.cooldown.scope} onValueChange={(scope) => set({ cooldown: { ...c.cooldown, scope: scope as 'user' | 'guild' } })}>
                  <SelectTrigger className='w-44'><SelectValue /></SelectTrigger>
                  <SelectContent><SelectItem value='user'>par membre</SelectItem><SelectItem value='guild'>pour tout le serveur</SelectItem></SelectContent>
                </Select>
              </div>
            </div>
            <p className='text-xs text-muted-foreground sm:col-span-2'>Le chef du réseau passe toujours. Rangs et rôles autorisés : il suffit d’en avoir un.</p>
          </TabsContent>

          <TabsContent value='flow' className='mt-4 grid gap-3'>
            <div className='flex flex-wrap gap-1.5 text-xs'>
              <span className='text-muted-foreground'>Variables :</span>
              {[...VARIABLES, ...optionNames.map((n) => `{option.${n}}`)].map((v) => <code key={v} className='rounded bg-muted px-1.5 py-0.5'>{v}</code>)}
            </div>
            <BlockList blocks={c.flow} onChange={(flow) => set({ flow })} ctx={ctx} />
          </TabsContent>

          <TabsContent value='components' className='mt-4 grid gap-4'>
            <p className='text-sm text-muted-foreground'>Un bouton ou un menu a son propre déroulé, lancé quand quelqu’un clique. Joins-le à un bloc « Répondre » ou « Envoyer ». Dans un menu, {'{option.choix}'} contient la valeur choisie.</p>
            {c.components.map((comp, i) => (
              <ComponentEditor key={comp.id} value={comp} ctx={{ ...ctx, optionNames: [...optionNames, 'choix'] }}
                onChange={(nc) => set({ components: c.components.map((x, j) => (j === i ? nc : x)) })}
                onRemove={() => set({ components: c.components.filter((_, j) => j !== i) })} />
            ))}
            {c.components.length < 10 && (
              <div className='flex gap-2'>
                <Button type='button' variant='outline' size='sm' className='border-dashed' onClick={() => set({ components: [...c.components, { id: `b${Date.now().toString(36).slice(-6)}`, kind: 'button', label: 'Cliquer', style: 'primary', emoji: null, flow: [] }] })}><Plus /> Bouton</Button>
                <Button type='button' variant='outline' size='sm' className='border-dashed' onClick={() => set({ components: [...c.components, { id: `m${Date.now().toString(36).slice(-6)}`, kind: 'select', placeholder: 'Choisis…', options: [{ label: 'Choix 1', value: 'choix1', description: '' }], flow: [] }] })}><Plus /> Menu</Button>
              </div>
            )}
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!c.name.trim()}><Save /> Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function OptionRow({ value: o, onChange, onRemove }: { value: Option; onChange: (o: Option) => void; onRemove: () => void }) {
  const set = (patch: Partial<Option>) => onChange({ ...o, ...patch })
  const hasChoices = ['string', 'integer', 'number'].includes(o.type)
  return (
    <div className='grid gap-3 rounded-lg border bg-card p-3'>
      <div className='grid gap-2 sm:grid-cols-[1fr_1.5fr_10rem_auto_auto] sm:items-center'>
        <Input value={o.name} maxLength={32} aria-label='Nom de l’option' onChange={(e) => set({ name: e.target.value.toLowerCase().replace(/\s+/g, '-') })} />
        <Input value={o.description} maxLength={100} aria-label='Description' placeholder='Description' onChange={(e) => set({ description: e.target.value })} />
        <Select value={o.type} onValueChange={(type) => set({ type: type as Option['type'], choices: [] })}>
          <SelectTrigger aria-label='Type'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='string'>Texte</SelectItem><SelectItem value='integer'>Nombre entier</SelectItem><SelectItem value='number'>Nombre</SelectItem>
            <SelectItem value='boolean'>Oui / non</SelectItem><SelectItem value='user'>Membre</SelectItem><SelectItem value='role'>Rôle</SelectItem><SelectItem value='channel'>Salon</SelectItem>
          </SelectContent>
        </Select>
        <label className='flex items-center gap-1.5 text-sm'><Checkbox checked={o.required} onCheckedChange={(v) => set({ required: v === true })} /> Obligatoire</label>
        <Button type='button' size='icon' variant='danger-ghost' aria-label='Supprimer l’option' onClick={onRemove}><Trash2 /></Button>
      </div>
      {hasChoices && (
        <div className='grid gap-1.5'>
          <Label className='text-xs text-muted-foreground'>Choix proposés (facultatif, séparés par des virgules)</Label>
          <Input value={(o.choices ?? []).map((ch) => ch.name).join(', ')} onChange={(e) => set({ choices: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).map((name) => ({ name, value: name })) })} placeholder='Police, EMS, Mécano' aria-label='Choix' />
        </div>
      )}
    </div>
  )
}

function ComponentEditor({ value: comp, onChange, onRemove, ctx }: { value: Component; onChange: (c: Component) => void; onRemove: () => void; ctx: EditorContext }) {
  const set = (patch: Partial<Component>) => onChange({ ...comp, ...patch })
  return (
    <section className='grid gap-3 rounded-lg border border-s-4 border-s-info bg-muted/20 p-4'>
      <div className='flex flex-wrap items-center gap-2'>
        <span className='kicker'>{comp.kind === 'button' ? 'Bouton' : 'Menu'}</span>
        {comp.kind === 'button' ? (
          <>
            <Input className='w-48' value={comp.label ?? ''} maxLength={80} aria-label='Texte du bouton' onChange={(e) => set({ label: e.target.value })} />
            <EmojiField value={comp.emoji} label='Émoji du bouton' onChange={(v) => set({ emoji: v || null })} />
            <Select value={comp.style} onValueChange={(style) => set({ style: style as Component['style'] })}>
              <SelectTrigger className='w-36' aria-label='Couleur'><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value='primary'>Bleu</SelectItem><SelectItem value='secondary'>Gris</SelectItem><SelectItem value='success'>Vert</SelectItem><SelectItem value='danger'>Rouge</SelectItem></SelectContent>
            </Select>
          </>
        ) : (
          <>
            <Input className='w-56' value={comp.placeholder ?? ''} maxLength={150} aria-label='Texte du menu' onChange={(e) => set({ placeholder: e.target.value })} />
            <Input className='min-w-56 flex-1' value={(comp.options ?? []).map((o) => o.label).join(', ')} aria-label='Choix du menu' placeholder='Choix, séparés par des virgules'
              onChange={(e) => set({ options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 25).map((label) => ({ label, value: label.toLowerCase().replace(/\s+/g, '-').slice(0, 100), description: '' })) })} />
          </>
        )}
        <Button type='button' size='icon' variant='danger-ghost' className='ms-auto' aria-label='Supprimer' onClick={onRemove}><X /></Button>
      </div>
      <BlockList blocks={comp.flow} onChange={(flow) => set({ flow })} ctx={ctx} depth={1} />
    </section>
  )
}
