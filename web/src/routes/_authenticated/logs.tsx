import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, FolderPlus, Search, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, LogRoute, LogsPayload } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export const Route = createFileRoute('/_authenticated/logs')({
  component: LogsPage,
})

const MIRROR = '*'
const NONE = '__none__'
const INHERIT = '__inherit__'
const OFF = '0'

type Category = LogsPayload['categories'][number]

function LogsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['logs'], queryFn: () => api<LogsPayload>('/logs') })
  const [selected, setSelected] = useState<string | null>(null)

  const targets = data
    ? [
        ...data.guilds.map((g) => ({ id: g.id, label: g.name, isMain: g.isMain, routes: g.routes, channelsOf: g.id })),
        ...(data.mainGuildId ? [{ id: MIRROR, label: 'Miroir réseau', isMain: false, routes: data.mirror, channelsOf: data.mainGuildId }] : []),
      ]
    : []
  const current = targets.find((t) => t.id === selected) ?? targets.find((t) => t.isMain) ?? targets[0]

  return (
    <Page
      title='Salons de logs'
      description='Pour chaque serveur, choisis où va chaque catégorie de logs, ou applique un pack prêt à l’emploi. Déplie une catégorie pour envoyer un type précis ailleurs ou le couper. Le miroir réseau recopie les logs de tous les serveurs dans un salon du serveur principal.'
    >
      {isLoading && <Skeleton className='h-64 w-full' />}
      {data && !targets.length && (
        <Section title='Aucun serveur'>
          <EmptyState title='Aucun serveur à configurer'>Ajoute d’abord des serveurs au réseau.</EmptyState>
        </Section>
      )}
      <RetentionSetting />
      {current && data && (
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]'>
          <nav aria-label='Serveurs' className='flex gap-1 overflow-x-auto lg:flex-col'>
            {targets.map((t) => (
              <button
                key={t.id}
                type='button'
                onClick={() => setSelected(t.id)}
                aria-current={t.id === current.id ? 'page' : undefined}
                className='flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium'
              >
                <span className='truncate'>{t.label}</span>
                <span className='text-xs text-muted-foreground tabular-nums'>{t.routes.filter((r) => r.enabled && !r.category.includes(':')).length}/{data.categories.length}</span>
              </button>
            ))}
          </nav>
          <Target
            key={current.id}
            guildId={current.id}
            title={current.id === MIRROR ? 'Miroir réseau (salons du serveur principal)' : current.label}
            channelsOf={current.channelsOf}
            routes={current.routes}
            data={data}
          />
        </div>
      )}
    </Page>
  )
}

function Target({ guildId, title, channelsOf, routes, data }: { guildId: string; title: string; channelsOf: string; routes: LogRoute[]; data: LogsPayload }) {
  const qc = useQueryClient()
  const channels = useQuery({ queryKey: ['channels', channelsOf], queryFn: () => api<Channel[]>(`/network/${channelsOf}/channels`) })
  const [q, setQ] = useState('')
  const [all, setAll] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['logs'] })

  const save = useMutation({
    mutationFn: ({ category, channelId, enabled }: { category: string; channelId: string | null; enabled: boolean }) =>
      api(`/logs/${encodeURIComponent(guildId)}/${encodeURIComponent(category)}`, { method: 'PUT', body: { channelId, enabled } }),
    onSuccess: () => { toast.success('Logs enregistrés'); refresh() },
  })
  const routeAll = useMutation({
    mutationFn: (channelId: string) => api(`/logs/${encodeURIComponent(guildId)}/all`, { method: 'POST', body: { channelId } }),
    onSuccess: () => { toast.success('Toutes les catégories vont dans ce salon'); setAll(null); refresh() },
  })

  const text = q.trim().toLowerCase()
  const visible = data.categories
    .map((c) => ({ ...c, types: c.types.filter((t) => !text || t.label.toLowerCase().includes(text) || c.label.toLowerCase().includes(text)) }))
    .filter((c) => !text || c.label.toLowerCase().includes(text) || c.types.length > 0)
  const routed = routes.filter((r) => r.enabled && !r.category.includes(':')).length

  return (
    <div className='grid gap-6'>
      {guildId !== MIRROR && <Packs guildId={guildId} packs={data.packs} onDone={() => { refresh(); qc.invalidateQueries({ queryKey: ['channels', channelsOf] }) }} />}
      <Section
        title={title}
        description={`${routed} catégorie${routed > 1 ? 's' : ''} sur ${data.categories.length} ont un salon.`}
        actions={
          <div className='flex flex-wrap items-center gap-2'>
            <div className='relative'>
              <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Chercher un log' aria-label='Chercher un log' className='h-9 w-48 ps-8' />
            </div>
            <Select value='' onValueChange={setAll}>
              <SelectTrigger className='h-9 w-52' aria-label='Tout envoyer dans un salon'><Send className='size-4' /><SelectValue placeholder='Tout dans un salon…' /></SelectTrigger>
              <SelectContent>
                {channels.data?.filter((c) => c.canSend).map((c) => <SelectItem key={c.id} value={c.id}>#{c.name}{c.parent ? ` · ${c.parent}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        }
      >
        {!visible.length ? <EmptyState title='Aucun log ne correspond' icon={Search}>Essaie un autre mot : « ban », « vocal », « rôle »…</EmptyState> : (
          <ul className='divide-y'>
            {visible.map((category) => (
              <CategoryRow
                key={category.key}
                category={category}
                routes={routes}
                channels={channels.data ?? []}
                loading={channels.isLoading}
                busy={save.isPending}
                forceOpen={text.length > 0}
                onSave={(v) => save.mutate(v)}
              />
            ))}
          </ul>
        )}
      </Section>
      <ConfirmDialog
        open={all !== null}
        onOpenChange={(o) => !o && setAll(null)}
        title='Tout envoyer dans ce salon ?'
        desc={`Les ${data.categories.length} catégories iront dans #${channels.data?.find((c) => c.id === all)?.name ?? ''}. Les types envoyés à part ou coupés restent comme ils sont.`}
        confirmText='Tout envoyer ici'
        isLoading={routeAll.isPending}
        handleConfirm={() => all && routeAll.mutate(all)}
      />
    </div>
  )
}

function channelLabel(c: Channel) {
  return `#${c.name}${c.parent ? ` · ${c.parent}` : ''}${!c.canSend ? ' (le bot ne peut pas écrire)' : ''}`
}

function CategoryRow({ category, routes, channels, loading, busy, forceOpen, onSave }: {
  category: Category
  routes: LogRoute[]
  channels: Channel[]
  loading: boolean
  busy: boolean
  forceOpen: boolean
  onSave: (v: { category: string; channelId: string | null; enabled: boolean }) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const open = expanded || forceOpen
  const route = routes.find((r) => r.category === category.key)
  const channel = channels.find((c) => c.id === route?.channelId)
  const overrides = routes.filter((r) => r.category.startsWith(`${category.key}:`))
  const off = overrides.filter((r) => r.channelId === OFF).length

  return (
    <li>
      <div className='flex flex-wrap items-center gap-3 px-4 py-3'>
        <button
          type='button'
          onClick={() => setExpanded(!expanded)}
          aria-expanded={open}
          disabled={!category.types.length}
          className='flex min-w-0 flex-1 basis-56 items-start gap-2 text-start disabled:cursor-default'
        >
          <ChevronDown className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', !open && '-rotate-90', !category.types.length && 'invisible')} />
          <span className='min-w-0'>
            <span className='block text-sm font-medium'>{category.label}</span>
            <span className='mt-1 flex flex-wrap gap-1'>
              {category.types.length > 0 && <span className='text-xs text-muted-foreground'>{category.types.length} type{category.types.length > 1 ? 's' : ''}</span>}
              {overrides.length - off > 0 && <Pill tone='info'>{overrides.length - off} à part</Pill>}
              {off > 0 && <Pill tone='neutral'>{off} coupé{off > 1 ? 's' : ''}</Pill>}
              {route && !route.enabled && <Pill tone='warning'>Désactivé</Pill>}
              {route && !loading && !channel && <Pill tone='danger'>Salon introuvable</Pill>}
            </span>
          </span>
        </button>
        <Select
          value={route?.channelId ?? NONE}
          onValueChange={(value) => onSave({ category: category.key, channelId: value === NONE ? null : value, enabled: true })}
          disabled={busy || loading}
        >
          <SelectTrigger className='w-64 max-w-full' aria-label={`Salon pour ${category.label}`}>
            <SelectValue placeholder='Aucun salon' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>Aucun salon</SelectItem>
            {channels.map((c) => <SelectItem key={c.id} value={c.id} disabled={!c.canSend}>{channelLabel(c)}</SelectItem>)}
          </SelectContent>
        </Select>
        <Switch
          checked={Boolean(route?.enabled)}
          disabled={!route || busy}
          aria-label={`Activer les logs ${category.label}`}
          onCheckedChange={(enabled) => route && onSave({ category: category.key, channelId: route.channelId, enabled })}
        />
      </div>
      {open && category.types.length > 0 && (
        <ul className='mx-4 mb-3 grid gap-1 rounded-lg border bg-muted/30 p-2'>
          {category.types.map((type) => {
            const key = `${category.key}:${type.key}`
            const override = routes.find((r) => r.category === key)
            const value = !override ? INHERIT : override.channelId === OFF ? OFF : override.channelId
            return (
              <li key={type.key} className='flex flex-wrap items-center gap-2 rounded-md px-2 py-1.5 hover:bg-accent/40'>
                <span className={cn('min-w-0 flex-1 basis-48 text-sm', value === OFF && 'text-muted-foreground line-through')}>{type.label}</span>
                <Select value={value} onValueChange={(v) => onSave({ category: key, channelId: v === INHERIT ? null : v, enabled: v !== OFF })} disabled={busy || loading}>
                  <SelectTrigger className='h-8 w-60 max-w-full text-xs' aria-label={`Salon pour ${type.label}`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT}>{channel ? `Par défaut · #${channel.name}` : 'Par défaut (catégorie)'}</SelectItem>
                    <SelectItem value={OFF}>Ne pas logger</SelectItem>
                    {channels.map((c) => <SelectItem key={c.id} value={c.id} disabled={!c.canSend}>{channelLabel(c)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </li>
            )
          })}
        </ul>
      )}
    </li>
  )
}

function Packs({ guildId, packs, onDone }: { guildId: string; packs: LogsPayload['packs']; onDone: () => void }) {
  const [pack, setPack] = useState<LogsPayload['packs'][number] | null>(null)
  const [categoryName, setCategoryName] = useState('Logs')
  const apply = useMutation({
    mutationFn: (key: string) => api<{ created: number }>(`/logs/${guildId}/pack`, { method: 'POST', body: { pack: key, categoryName } }),
    onSuccess: (r) => {
      toast.success(r.created ? `Pack appliqué : ${r.created} salon${r.created > 1 ? 's' : ''} créé${r.created > 1 ? 's' : ''}` : 'Pack appliqué avec les salons existants')
      setPack(null)
      onDone()
    },
  })
  return (
    <Section title='Packs prêts à l’emploi' description='Crée une catégorie privée (lecture seule pour les rangs qui voient les logs) avec ses salons, puis y range chaque catégorie. Les salons déjà là sont réutilisés, et tu peux tout ajuster ensuite.'>
      <div className='grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4'>
        {packs.map((p) => (
          <button
            key={p.key}
            type='button'
            onClick={() => setPack(p)}
            className='lift grid content-start gap-1 rounded-lg border bg-card p-3 text-start transition-colors hover:border-primary/60 focus-visible:border-primary focus-visible:outline-none'
          >
            <span className='flex items-center gap-2 font-medium'><FolderPlus className='size-4 text-primary' />{p.label}</span>
            <span className='text-xs text-muted-foreground'>{p.hint}</span>
            <span className='mt-1 flex flex-wrap gap-1'>{p.channels.map((c) => <span key={c} className='rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground'>#{c}</span>)}</span>
          </button>
        ))}
      </div>
      <ConfirmDialog
        open={pack !== null}
        onOpenChange={(o) => !o && setPack(null)}
        title={`Appliquer le pack « ${pack?.label ?? ''} » ?`}
        desc={`Les salons ${pack?.channels.map((c) => `#${c}`).join(', ') ?? ''} seront créés s’ils n’existent pas, et chaque catégorie de logs y sera rangée.`}
        confirmText='Appliquer'
        isLoading={apply.isPending}
        handleConfirm={() => pack && apply.mutate(pack.key)}
      >
        <div className='grid gap-1.5'>
          <Label htmlFor='pack-category'>Nom de la catégorie Discord</Label>
          <Input id='pack-category' value={categoryName} maxLength={100} onChange={(e) => setCategoryName(e.target.value)} />
        </div>
      </ConfirmDialog>
    </Section>
  )
}

function RetentionSetting() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['events-settings'], queryFn: () => api<{ retentionDays: number }>('/events/settings') })
  const [days, setDays] = useState<string>('')
  const save = useMutation({
    mutationFn: (retentionDays: number) => api('/events/settings', { method: 'PUT', body: { retentionDays } }),
    onSuccess: () => {
      toast.success('Durée de conservation enregistrée')
      qc.invalidateQueries({ queryKey: ['events-settings'] })
      setDays('')
    },
  })
  if (!data) return null
  const value = days === '' ? String(data.retentionDays) : days
  return (
    <form
      className='flex flex-wrap items-center gap-2 text-sm'
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(Number(value))
      }}
    >
      <label htmlFor='retention'>Conserver les événements</label>
      <Input id='retention' type='number' min={1} max={365} value={value} onChange={(e) => setDays(e.target.value)} className='h-8 w-20' />
      <span>jours dans la base</span>
      {days !== '' && Number(days) !== data.retentionDays && <Button loading={save.isPending} size='sm' type='submit' disabled={save.isPending}>Enregistrer</Button>}
    </form>
  )
}
