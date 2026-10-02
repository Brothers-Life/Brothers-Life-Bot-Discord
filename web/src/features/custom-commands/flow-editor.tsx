import { ArrowDown, ArrowUp, Ban, Braces, Clock, Copy, Hash, MessageSquare, MessagesSquare, Plus, Send, ShieldAlert, Smile, Square, Tag, Trash2, UserCog, ScrollText, GitBranch, X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { BLOCK_LABELS, PERMISSIONS, newBlock, type Block, type Condition, type EditorContext, type Message } from './model'
import { EmojiField } from '@/components/app/emoji-picker'
import { ColorPicker } from '@/components/app/color-picker'

const ICONS: Record<Block['type'], LucideIcon> = {
  if: GitBranch, reply: MessageSquare, send: Send, dm: MessagesSquare, role: Tag, nickname: UserCog, sanction: ShieldAlert,
  react: Smile, wait: Clock, counter: Hash, log: ScrollText, deleteTrigger: Ban, stop: Square,
}
// Accent of each family of blocks (logic, messages, members, other)
const TONES: Record<Block['type'], string> = {
  if: 'border-s-info', reply: 'border-s-brand', send: 'border-s-brand', dm: 'border-s-brand', role: 'border-s-warning', nickname: 'border-s-warning', sanction: 'border-s-destructive',
  react: 'border-s-success', wait: 'border-s-muted-foreground', counter: 'border-s-success', log: 'border-s-muted-foreground', deleteTrigger: 'border-s-destructive', stop: 'border-s-destructive',
}
const GROUPS: { label: string; types: Block['type'][] }[] = [
  { label: 'Logique', types: ['if', 'wait', 'stop'] },
  { label: 'Messages', types: ['reply', 'send', 'dm', 'react'] },
  { label: 'Membres', types: ['role', 'nickname', 'sanction'] },
  { label: 'Autres', types: ['counter', 'log', 'deleteTrigger'] },
]
const SENSITIVE = new Set<Block['type']>(['role', 'nickname', 'sanction'])

type Item = { id: string; label: string; hint?: string }

// Several ids picked from a list (roles or channels of every server)
export function MultiPicker({ items, value, onChange, label, placeholder = 'Aucun' }: { items: Item[]; value: string[]; onChange: (v: string[]) => void; label: string; placeholder?: string }) {
  const names = value.map((id) => items.find((i) => i.id === id)?.label ?? 'supprimé')
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type='button' variant='outline' className='h-auto min-h-9 w-full justify-start whitespace-normal text-start font-normal' aria-label={label}>
          {names.length ? names.join(', ') : <span className='text-muted-foreground'>{placeholder}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align='start' className='max-h-72 w-80 overflow-y-auto p-1'>
        {items.map((i) => (
          <label key={i.id} className='flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent'>
            <Checkbox checked={value.includes(i.id)} onCheckedChange={() => onChange(value.includes(i.id) ? value.filter((v) => v !== i.id) : [...value, i.id])} />
            <span className='truncate'>{i.label}</span>
            {i.hint && <span className='ms-auto shrink-0 text-xs text-muted-foreground'>{i.hint}</span>}
          </label>
        ))}
        {!items.length && <p className='p-2 text-sm text-muted-foreground'>Rien à choisir.</p>}
      </PopoverContent>
    </Popover>
  )
}

export function roleItems(ctx: Pick<EditorContext, 'guilds'>, onlyEditable = false): Item[] {
  const many = ctx.guilds.length > 1
  return ctx.guilds.flatMap((g) => g.roles.filter((r) => !onlyEditable || r.editable).map((r) => ({ id: r.id, label: `@${r.name}`, hint: many ? g.name : undefined })))
}
export function channelItems(ctx: Pick<EditorContext, 'guilds'>): Item[] {
  const many = ctx.guilds.length > 1
  return ctx.guilds.flatMap((g) => g.channels.map((c) => ({ id: c.id, label: `#${c.name}`, hint: many ? g.name : undefined })))
}

function TargetSelect({ value, onChange, ctx, allowInvoker = true, label }: { value: string; onChange: (v: string) => void; ctx: EditorContext; allowInvoker?: boolean; label: string }) {
  return (
    <Select value={value || 'none'} onValueChange={(v) => onChange(v === 'none' ? '' : v)}>
      <SelectTrigger aria-label={label}><SelectValue placeholder='Choisir…' /></SelectTrigger>
      <SelectContent>
        {allowInvoker ? <SelectItem value='invoker'>La personne qui lance</SelectItem> : <SelectItem value='none'>Choisir une option membre…</SelectItem>}
        {ctx.userOptionNames.map((n) => <SelectItem key={n} value={`option:${n}`}>Option « {n} »</SelectItem>)}
      </SelectContent>
    </Select>
  )
}

function MessageFields({ value, onChange, id }: { value: Message; onChange: (m: Partial<Message>) => void; id: string }) {
  const e = value.embed
  return (
    <div className='grid gap-3'>
      <div className='grid gap-1.5'>
        <Label htmlFor={`${id}-content`}>Texte</Label>
        <Textarea id={`${id}-content`} rows={2} maxLength={2000} value={value.content} onChange={(ev) => onChange({ content: ev.target.value })} placeholder='Salut {user} !' />
      </div>
      <label className='flex items-center gap-2 text-sm'>
        <Switch checked={Boolean(e)} onCheckedChange={(v) => onChange({ embed: v ? { title: '', description: '', color: '#ff9628', imageUrl: null, footer: '' } : null })} /> Embed
      </label>
      {e && (
        <div className='grid gap-3 rounded-md border-s-2 bg-muted/40 p-3' style={{ borderColor: e.color }}>
          <div className='grid gap-3 sm:grid-cols-[1fr_7rem]'>
            <Input value={e.title} maxLength={256} placeholder='Titre' aria-label='Titre de l’embed' onChange={(ev) => onChange({ embed: { ...e, title: ev.target.value } })} />
            <ColorPicker value={e.color} onChange={(hex) => onChange({ embed: { ...e, color: hex } })} label='Couleur' />
          </div>
          <Textarea rows={3} maxLength={4000} value={e.description} placeholder='Description' aria-label='Description de l’embed' onChange={(ev) => onChange({ embed: { ...e, description: ev.target.value } })} />
          <div className='grid gap-3 sm:grid-cols-2'>
            <Input value={e.imageUrl ?? ''} placeholder='Image : https://…' aria-label='Image' onChange={(ev) => onChange({ embed: { ...e, imageUrl: ev.target.value || null } })} />
            <Input value={e.footer} maxLength={200} placeholder='Pied de page' aria-label='Pied de page' onChange={(ev) => onChange({ embed: { ...e, footer: ev.target.value } })} />
          </div>
        </div>
      )}
    </div>
  )
}

function ComponentsPicker({ value, onChange, ctx }: { value: string[]; onChange: (v: string[]) => void; ctx: EditorContext }) {
  if (!ctx.components.length) return null
  return (
    <div className='grid gap-1.5'>
      <Label>Boutons et menus joints</Label>
      <MultiPicker items={ctx.components.map((c) => ({ id: c.id, label: c.kind === 'button' ? `Bouton « ${c.label} »` : `Menu « ${c.placeholder || c.id} »` }))} value={value} onChange={onChange} label='Boutons et menus' placeholder='Aucun' />
    </div>
  )
}

const CONDITIONS: Record<Condition['kind'], string> = {
  hasRole: 'A le rôle', inChannel: 'Dans le salon', hasPermission: 'A la permission Discord', option: 'Valeur d’une option', accountAge: 'Âge du compte',
  memberAge: 'Ancienneté sur le serveur', counter: 'Compteur', chance: 'Hasard', userIs: 'Est la personne (ID)',
}

function newCondition(kind: Condition['kind'], ctx: EditorContext): Condition {
  switch (kind) {
    case 'hasRole': return { kind, roleIds: [], match: 'any', negate: false }
    case 'inChannel': return { kind, channelIds: [], negate: false }
    case 'hasPermission': return { kind, permission: 'ManageMessages', negate: false }
    case 'option': return { kind, name: ctx.optionNames[0] ?? '', op: 'equals', value: '', negate: false }
    case 'accountAge':
    case 'memberAge': return { kind, op: 'gt', days: 7, negate: false }
    case 'counter': return { kind, key: 'points', perUser: true, op: 'gt', value: 0, negate: false }
    case 'chance': return { kind, percent: 50, negate: false }
    case 'userIs': return { kind, userIds: [], negate: false }
  }
}

function ConditionEditor({ value: c, onChange, onRemove, ctx }: { value: Condition; onChange: (c: Condition) => void; onRemove: () => void; ctx: EditorContext }) {
  const set = (patch: Partial<Condition>) => onChange({ ...c, ...patch } as Condition)
  return (
    <div className='flex flex-wrap items-center gap-2 rounded-md border bg-card p-2'>
      <Select value={c.negate ? 'not' : 'is'} onValueChange={(v) => set({ negate: v === 'not' })}>
        <SelectTrigger className='h-8 w-24' aria-label='Sens'><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value='is'>Si</SelectItem><SelectItem value='not'>Si non</SelectItem></SelectContent>
      </Select>
      <Select value={c.kind} onValueChange={(v) => onChange(newCondition(v as Condition['kind'], ctx))}>
        <SelectTrigger className='h-8 w-52' aria-label='Condition'><SelectValue /></SelectTrigger>
        <SelectContent>{(Object.keys(CONDITIONS) as Condition['kind'][]).filter((k) => k !== 'option' || ctx.optionNames.length).map((k) => <SelectItem key={k} value={k}>{CONDITIONS[k]}</SelectItem>)}</SelectContent>
      </Select>
      <div className='min-w-48 flex-1'>
        {c.kind === 'hasRole' && (
          <div className='flex gap-2'>
            <Select value={c.match} onValueChange={(v) => set({ match: v as 'any' | 'all' })}>
              <SelectTrigger className='h-8 w-28' aria-label='Lesquels'><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value='any'>un de</SelectItem><SelectItem value='all'>tous</SelectItem></SelectContent>
            </Select>
            <MultiPicker items={roleItems(ctx)} value={c.roleIds} onChange={(roleIds) => set({ roleIds })} label='Rôles' placeholder='Choisir des rôles' />
          </div>
        )}
        {c.kind === 'inChannel' && <MultiPicker items={channelItems(ctx)} value={c.channelIds} onChange={(channelIds) => set({ channelIds })} label='Salons' placeholder='Choisir des salons' />}
        {c.kind === 'hasPermission' && (
          <Select value={c.permission} onValueChange={(permission) => set({ permission })}>
            <SelectTrigger className='h-8' aria-label='Permission'><SelectValue /></SelectTrigger>
            <SelectContent>{Object.entries(PERMISSIONS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {c.kind === 'option' && (
          <div className='flex flex-wrap gap-2'>
            <Select value={c.name} onValueChange={(name) => set({ name })}>
              <SelectTrigger className='h-8 w-36' aria-label='Option'><SelectValue /></SelectTrigger>
              <SelectContent>{ctx.optionNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
            </Select>
            <Select value={c.op} onValueChange={(op) => set({ op: op as typeof c.op })}>
              <SelectTrigger className='h-8 w-36' aria-label='Comparaison'><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='equals'>est égale à</SelectItem><SelectItem value='contains'>contient</SelectItem><SelectItem value='startsWith'>commence par</SelectItem>
                <SelectItem value='gt'>est plus grande que</SelectItem><SelectItem value='lt'>est plus petite que</SelectItem><SelectItem value='set'>est remplie</SelectItem><SelectItem value='notSet'>est vide</SelectItem>
              </SelectContent>
            </Select>
            {!['set', 'notSet'].includes(c.op) && <Input className='h-8 w-40' value={c.value} maxLength={200} onChange={(e) => set({ value: e.target.value })} aria-label='Valeur' />}
          </div>
        )}
        {(c.kind === 'accountAge' || c.kind === 'memberAge') && (
          <div className='flex items-center gap-2 text-sm'>
            <Select value={c.op} onValueChange={(op) => set({ op: op as 'gt' | 'lt' })}>
              <SelectTrigger className='h-8 w-36' aria-label='Comparaison'><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value='gt'>plus de</SelectItem><SelectItem value='lt'>moins de</SelectItem></SelectContent>
            </Select>
            <Input type='number' min={0} className='h-8 w-24' value={c.days} onChange={(e) => set({ days: Number(e.target.value) || 0 })} aria-label='Jours' /> jours
          </div>
        )}
        {c.kind === 'counter' && (
          <div className='flex flex-wrap items-center gap-2 text-sm'>
            <Input className='h-8 w-32' value={c.key} maxLength={32} onChange={(e) => set({ key: e.target.value })} aria-label='Compteur' />
            <label className='flex items-center gap-1.5'><Checkbox checked={c.perUser} onCheckedChange={(v) => set({ perUser: v === true })} /> par membre</label>
            <Select value={c.op} onValueChange={(op) => set({ op: op as 'equals' | 'gt' | 'lt' })}>
              <SelectTrigger className='h-8 w-24' aria-label='Comparaison'><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value='gt'>&gt;</SelectItem><SelectItem value='lt'>&lt;</SelectItem><SelectItem value='equals'>=</SelectItem></SelectContent>
            </Select>
            <Input type='number' className='h-8 w-24' value={c.value} onChange={(e) => set({ value: Number(e.target.value) || 0 })} aria-label='Valeur' />
          </div>
        )}
        {c.kind === 'chance' && <div className='flex items-center gap-2 text-sm'><Input type='number' min={0} max={100} className='h-8 w-24' value={c.percent} onChange={(e) => set({ percent: Number(e.target.value) || 0 })} aria-label='Pourcentage' /> % de chances</div>}
        {c.kind === 'userIs' && <Input className='h-8' value={c.userIds.join(', ')} placeholder='IDs Discord, séparés par des virgules' onChange={(e) => set({ userIds: e.target.value.split(/[,\s]+/).filter(Boolean) })} aria-label='IDs' />}
      </div>
      <Button type='button' size='icon' variant='danger-ghost' className='size-8' aria-label='Retirer la condition' onClick={onRemove}><X /></Button>
    </div>
  )
}

function BlockBody({ block: b, onChange, ctx, depth, id }: { block: Block; onChange: (b: Block) => void; ctx: EditorContext; depth: number; id: string }) {
  const set = (patch: Partial<Block>) => onChange({ ...b, ...patch } as Block)
  switch (b.type) {
    case 'if':
      return (
        <div className='grid gap-3'>
          <div className='flex items-center gap-2 text-sm'>
            <Select value={b.match} onValueChange={(match) => set({ match: match as 'all' | 'any' })}>
              <SelectTrigger className='h-8 w-60' aria-label='Combinaison'><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value='all'>Toutes les conditions</SelectItem><SelectItem value='any'>Au moins une condition</SelectItem></SelectContent>
            </Select>
          </div>
          {b.conditions.map((c, i) => (
            <ConditionEditor key={i} value={c} ctx={ctx} onChange={(nc) => set({ conditions: b.conditions.map((x, j) => (j === i ? nc : x)) })} onRemove={() => set({ conditions: b.conditions.filter((_, j) => j !== i) })} />
          ))}
          {b.conditions.length < 10 && <Button type='button' size='sm' variant='outline' className='justify-self-start' onClick={() => set({ conditions: [...b.conditions, newCondition('chance', ctx)] })}><Plus /> Condition</Button>}
          <div className='grid gap-2 border-s-2 border-success/50 ps-3'>
            <span className='kicker !text-success'>Alors</span>
            <BlockList blocks={b.then} onChange={(then) => set({ then })} ctx={ctx} depth={depth + 1} />
          </div>
          <div className='grid gap-2 border-s-2 border-destructive/40 ps-3'>
            <span className='kicker !text-destructive'>Sinon</span>
            <BlockList blocks={b.else} onChange={(els) => set({ else: els })} ctx={ctx} depth={depth + 1} />
          </div>
        </div>
      )
    case 'reply':
      return (
        <div className='grid gap-3'>
          <MessageFields id={id} value={b} onChange={set} />
          <label className='flex items-center gap-2 text-sm'><Switch checked={b.ephemeral} onCheckedChange={(ephemeral) => set({ ephemeral })} /> Visible seulement par la personne</label>
          <ComponentsPicker value={b.components} onChange={(components) => set({ components })} ctx={ctx} />
        </div>
      )
    case 'send':
      return (
        <div className='grid gap-3'>
          <div className='grid gap-1.5'>
            <Label>Salon</Label>
            <Select value={b.channelId} onValueChange={(channelId) => set({ channelId })}>
              <SelectTrigger aria-label='Salon'><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='current'>Le salon de la commande</SelectItem>
                {channelItems(ctx).map((c) => <SelectItem key={c.id} value={c.id}>{c.label}{c.hint ? ` · ${c.hint}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <MessageFields id={id} value={b} onChange={set} />
          <ComponentsPicker value={b.components} onChange={(components) => set({ components })} ctx={ctx} />
        </div>
      )
    case 'dm':
      return (
        <div className='grid gap-3'>
          <div className='grid gap-1.5'><Label>À qui</Label><TargetSelect value={b.target} onChange={(target) => set({ target })} ctx={ctx} label='Destinataire' /></div>
          <MessageFields id={id} value={b} onChange={set} />
        </div>
      )
    case 'role':
      return (
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='grid gap-1.5'>
            <Label>Action</Label>
            <Select value={b.mode} onValueChange={(mode) => set({ mode: mode as typeof b.mode })}>
              <SelectTrigger aria-label='Action'><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value='add'>Donner</SelectItem><SelectItem value='remove'>Retirer</SelectItem><SelectItem value='toggle'>Donner ou retirer (bascule)</SelectItem></SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'><Label>À qui</Label><TargetSelect value={b.target} onChange={(target) => set({ target })} ctx={ctx} label='Cible' /></div>
          <div className='grid gap-1.5 sm:col-span-2'><Label>Rôles</Label><MultiPicker items={roleItems(ctx, true)} value={b.roleIds} onChange={(roleIds) => set({ roleIds })} label='Rôles' placeholder='Choisir des rôles' /></div>
          {b.mode !== 'remove' && (
            <div className='grid gap-1.5'>
              <Label htmlFor={`${id}-dur`}>Temporaire (minutes, vide = définitif)</Label>
              <Input id={`${id}-dur`} type='number' min={1} value={b.durationMinutes ?? ''} onChange={(e) => set({ durationMinutes: e.target.value ? Number(e.target.value) : null })} />
            </div>
          )}
        </div>
      )
    case 'nickname':
      return (
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='grid gap-1.5'><Label>À qui</Label><TargetSelect value={b.target} onChange={(target) => set({ target })} ctx={ctx} label='Cible' /></div>
          <div className='grid gap-1.5'><Label htmlFor={`${id}-nick`}>Nouveau pseudo</Label><Input id={`${id}-nick`} maxLength={32} value={b.value} onChange={(e) => set({ value: e.target.value })} placeholder='[RP] {user.name}' /></div>
        </div>
      )
    case 'sanction':
      return (
        <div className='grid gap-3 sm:grid-cols-2'>
          <div className='grid gap-1.5'>
            <Label>Sanction</Label>
            <Select value={b.kind} onValueChange={(kind) => set({ kind: kind as 'warn' | 'timeout', durationMinutes: kind === 'timeout' ? 10 : null })}>
              <SelectTrigger aria-label='Sanction'><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value='warn'>Avertissement</SelectItem><SelectItem value='timeout'>Exclusion temporaire</SelectItem></SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'><Label>Qui</Label><TargetSelect value={b.target} onChange={(target) => set({ target })} ctx={ctx} allowInvoker={false} label='Cible' /></div>
          <div className='grid gap-1.5'><Label htmlFor={`${id}-reason`}>Raison</Label><Input id={`${id}-reason`} maxLength={500} value={b.reason} onChange={(e) => set({ reason: e.target.value })} /></div>
          {b.kind === 'timeout' && <div className='grid gap-1.5'><Label htmlFor={`${id}-to`}>Durée (minutes)</Label><Input id={`${id}-to`} type='number' min={1} value={b.durationMinutes ?? 10} onChange={(e) => set({ durationMinutes: Number(e.target.value) || 1 })} /></div>}
          <p className='text-xs text-muted-foreground sm:col-span-2'>La sanction est donnée avec les droits de la personne qui lance la commande : sans la permission de sanctionner, le bloc échoue.</p>
        </div>
      )
    case 'react': return <div className='grid max-w-xs gap-1.5'><Label htmlFor={`${id}-emoji`}>Émoji</Label><EmojiField id={`${id}-emoji`} value={b.emoji} clearable={false} onChange={(v) => set({ emoji: v })} /></div>
    case 'wait': return <div className='flex items-center gap-2 text-sm'><Input type='number' min={1} max={30} className='w-24' value={b.seconds} onChange={(e) => set({ seconds: Number(e.target.value) || 1 })} aria-label='Secondes' /> secondes (30 au total par commande)</div>
    case 'counter':
      return (
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          <Select value={b.op} onValueChange={(op) => set({ op: op as typeof b.op })}>
            <SelectTrigger className='w-36' aria-label='Opération'><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value='add'>Ajouter</SelectItem><SelectItem value='set'>Mettre à</SelectItem><SelectItem value='reset'>Remettre à 0</SelectItem></SelectContent>
          </Select>
          {b.op !== 'reset' && <Input type='number' className='w-24' value={b.value} onChange={(e) => set({ value: Number(e.target.value) || 0 })} aria-label='Valeur' />}
          <span>au compteur</span>
          <Input className='w-32' value={b.key} maxLength={32} onChange={(e) => set({ key: e.target.value })} aria-label='Nom du compteur' />
          <label className='flex items-center gap-1.5'><Checkbox checked={b.perUser} onCheckedChange={(v) => set({ perUser: v === true })} /> par membre</label>
        </div>
      )
    case 'log': return <Input value={b.content} maxLength={1000} onChange={(e) => set({ content: e.target.value })} aria-label='Texte du log' />
    case 'deleteTrigger': return <p className='text-sm text-muted-foreground'>{ctx.trigger === 'keyword' ? 'Le message qui a déclenché la commande est supprimé.' : ctx.trigger === 'message' ? 'Le message ciblé par le clic droit est supprimé.' : 'Sans effet pour ce déclencheur.'}</p>
    case 'stop': return <p className='text-sm text-muted-foreground'>Les blocs suivants ne sont pas exécutés.</p>
  }
}

function AddBlock({ onAdd, ctx, label = 'Ajouter un bloc' }: { onAdd: (type: Block['type']) => void; ctx: EditorContext; label?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type='button' size='sm' variant='outline' className='justify-self-start border-dashed'><Plus /> {label}</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-60'>
        {GROUPS.map((g, i) => (
          <div key={g.label}>
            {i > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className='kicker'>{g.label}</DropdownMenuLabel>
            {g.types.map((t) => {
              const Icon = ICONS[t]
              const locked = SENSITIVE.has(t) && !ctx.canSensitive
              return (
                <DropdownMenuItem key={t} disabled={locked} onSelect={() => onAdd(t)}>
                  <Icon /> {BLOCK_LABELS[t]}{locked && <span className='ms-auto text-xs text-muted-foreground'>permission</span>}
                </DropdownMenuItem>
              )
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// Ordered blocks, each one editable, movable, duplicable
export function BlockList({ blocks, onChange, ctx, depth = 0 }: { blocks: Block[]; onChange: (b: Block[]) => void; ctx: EditorContext; depth?: number }) {
  const move = (i: number, dir: -1 | 1) => {
    const next = [...blocks]
    const [b] = next.splice(i, 1)
    next.splice(i + dir, 0, b)
    onChange(next)
  }
  return (
    <div className='grid gap-3'>
      {blocks.map((b, i) => {
        const Icon = ICONS[b.type]
        return (
          <section key={i} className={cn('page-enter grid gap-3 rounded-lg border border-s-4 bg-card p-3', TONES[b.type])}>
            <header className='flex items-center gap-2'>
              <Icon className='size-4 text-muted-foreground' aria-hidden />
              <h4 className='flex-1 font-display text-sm font-semibold tracking-wide uppercase'>{BLOCK_LABELS[b.type]}</h4>
              <Button type='button' size='icon' variant='ghost' className='size-7' aria-label='Monter' disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp /></Button>
              <Button type='button' size='icon' variant='ghost' className='size-7' aria-label='Descendre' disabled={i === blocks.length - 1} onClick={() => move(i, 1)}><ArrowDown /></Button>
              <Button type='button' size='icon' variant='ghost' className='size-7' aria-label='Dupliquer' onClick={() => onChange([...blocks.slice(0, i + 1), structuredClone(b), ...blocks.slice(i + 1)])}><Copy /></Button>
              <Button type='button' size='icon' variant='danger-ghost' className='size-7' aria-label='Supprimer le bloc' onClick={() => onChange(blocks.filter((_, j) => j !== i))}><Trash2 /></Button>
            </header>
            <BlockBody block={b} onChange={(nb) => onChange(blocks.map((x, j) => (j === i ? nb : x)))} ctx={ctx} depth={depth} id={`b${depth}-${i}`} />
          </section>
        )
      })}
      {!blocks.length && <p className='text-sm text-muted-foreground'><Braces className='me-1 inline size-4' /> Aucun bloc.</p>}
      <AddBlock ctx={ctx} onAdd={(t) => onChange([...blocks, newBlock(t)])} />
    </div>
  )
}
