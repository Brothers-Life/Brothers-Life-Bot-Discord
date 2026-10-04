import { useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Link2, Plus, RefreshCw, Save, ShoppingCart, Trash2, Undo2, Unlink, Wallet, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { EmptyState, Notice, Page, Pill, Section, StatCards, UserAvatar, type Tone } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { VariableButton, type VariableGroup } from '@/components/app/variable-picker'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/tebex')({
  component: TebexPage,
})

type Mapping = { id?: string; packageId: string; packageName: string | null; guildId: string; roleId: string; days: number | null }
type Config = {
  enabled: boolean; showPrice: boolean; removeOnRefund: boolean; mappings: Mapping[]
  thanks: { enabled: boolean; guildId: string | null; channelId: string | null; template: string }
}
type Guild = { id: string; name: string; isMain: boolean; channels: Channel[]; roles: { id: string; name: string; color: string }[] }
type Data = {
  hasSecret: boolean
  config: Config
  state: { initialized: boolean; lastPollAt: number | null; lastError: string | null; lastId: number | null }
  stats: { payments: number; unlinked: number; revoked: number; revenue: { currency: string | null; total: number; n: number }[] }
  guilds: Guild[]
  variables: VariableGroup[]
}
type Payment = {
  id: number; status: string; kind: 'complete' | 'revoked' | 'pending'; amount: string | null; currency: string | null
  player: { uuid: string | null; name: string | null }; packages: { id: string; name: string }[]
  paidAt: number | null; seenAt: number; baseline: boolean
  discordId: string | null; linkMethod: string | null; appliedAt: number | null; revokedAt: number | null; error: string | null
  grants: { guildId: string; roleId: string; temporary: boolean; removedAt: number | null }[]
  discord: { name: string | null; avatar: string | null } | null
}
type Package = { id: string; name: string; category: string | null; price: string | number | null }
type Filter = 'all' | 'unlinked' | 'revoked' | 'errors' | 'baseline'

const FILTERS: Record<Filter, string> = { all: 'Tous les achats', unlinked: 'Non liés à Discord', revoked: 'Remboursés ou contestés', errors: 'Rôles en erreur', baseline: 'Avant la connexion' }
const LINK_LABEL: Record<string, string> = { fivem: 'compte FiveM', license: 'licence FiveM', name: 'pseudo en jeu', known: 'liaison mémorisée', manual: 'lié à la main' }
const PAGE_SIZE = 50

function TebexPage() {
  const { can } = useMe()
  const manage = can('tebex.manage')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['tebex'], queryFn: () => api<Data>('/tebex'), refetchInterval: 60_000 })
  const [tab, setTab] = useState('purchases')
  const poll = useMutation({
    mutationFn: () => api<{ fetched?: number; fresh?: number; firstRun?: boolean }>('/tebex/poll', { method: 'POST' }),
    onSuccess: (r) => {
      toast.success(r.firstRun ? `${r.fetched ?? 0} achats existants marqués comme vus` : r.fresh ? `${r.fresh} nouvel${r.fresh > 1 ? 's' : ''} achat${r.fresh > 1 ? 's' : ''}` : 'Aucun nouvel achat')
      qc.invalidateQueries({ queryKey: ['tebex'] })
      qc.invalidateQueries({ queryKey: ['tebex-payments'] })
    },
  })

  return (
    <Page
      title='Boutique'
      description='Achats de la boutique Tebex du serveur FiveM, relevés toutes les 2 minutes : l’acheteur est relié à son compte Discord (via la base FiveM ou à la main), reçoit les rôles de ses articles, et un remboursement ou un litige les lui retire.'
      actions={manage && data?.hasSecret && <Button variant='outline' loading={poll.isPending} onClick={() => poll.mutate()}><RefreshCw /> Vérifier maintenant</Button>}
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {!data.hasSecret && (
            <Notice tone='info' title='Boutique non connectée'>
              {manage ? 'Ajoute la clé secrète du serveur de jeu Tebex dans l’onglet Réglages pour commencer le suivi des achats.' : 'Un responsable doit d’abord connecter la boutique Tebex.'}
            </Notice>
          )}
          {data.state.lastError && <Notice tone='warning' title='Dernière vérification en échec'>{data.state.lastError} · {ago(data.state.lastPollAt)}</Notice>}
          <StatCards items={[
            { label: 'Achats suivis', value: data.stats.payments, icon: ShoppingCart, tone: 'accent', hint: data.state.lastPollAt ? `vérifié ${ago(data.state.lastPollAt)}` : 'jamais vérifié' },
            { label: 'Non liés à Discord', value: data.stats.unlinked, icon: Unlink, tone: data.stats.unlinked ? 'warning' : 'success' },
            { label: 'Remboursés ou contestés', value: data.stats.revoked, icon: Undo2, tone: data.stats.revoked ? 'danger' : 'neutral' },
            { label: 'Ventes sur 30 jours', value: data.stats.revenue.length ? data.stats.revenue.map((r) => `${r.total.toLocaleString('fr-FR')} ${r.currency ?? ''}`.trim()).join(' · ') : '0', icon: Wallet, tone: 'info' },
          ]} />
          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className='h-auto max-w-full flex-wrap justify-start [&>button]:h-8 [&>button]:flex-none'>
              <TabsTrigger value='purchases'>Achats</TabsTrigger>
              {manage && <TabsTrigger value='roles'>Rôles des articles</TabsTrigger>}
              {manage && <TabsTrigger value='settings'>Réglages</TabsTrigger>}
            </TabsList>
            <TabsContent value='purchases' className='mt-4'><Purchases data={data} manage={manage} /></TabsContent>
            {manage && <TabsContent value='roles' className='mt-4'><RoleMappings data={data} /></TabsContent>}
            {manage && <TabsContent value='settings' className='mt-4 grid grid-cols-[minmax(0,1fr)] gap-6'><Connection data={data} /><Options key={JSON.stringify(data.config)} data={data} /></TabsContent>}
          </Tabs>
        </div>
      )}
    </Page>
  )
}

function statusPill(p: Payment): { tone: Tone; text: string } {
  if (p.kind === 'revoked') return { tone: 'danger', text: /charge|dispute/i.test(p.status) ? 'Contesté' : 'Remboursé' }
  if (p.kind === 'pending') return { tone: 'neutral', text: p.status }
  return { tone: 'success', text: 'Payé' }
}

function Purchases({ data, manage }: { data: Data; manage: boolean }) {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [before, setBefore] = useState<number[]>([])
  const cursor = before.at(-1) ?? null
  const q = search.trim()
  const list = useQuery({
    queryKey: ['tebex-payments', filter, q, cursor],
    queryFn: () => api<Payment[]>(`/tebex/payments?${new URLSearchParams({ filter, ...(q ? { q } : {}), ...(cursor ? { before: String(cursor) } : {}) })}`),
  })
  const [linking, setLinking] = useState<Payment | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['tebex-payments'] }); qc.invalidateQueries({ queryKey: ['tebex'] }) }
  const reapply = useMutation({
    mutationFn: (id: number) => api<{ given: string[]; errors: string[] }>(`/tebex/payments/${id}/reapply`, { method: 'POST' }),
    onSuccess: (r) => {
      if (r.errors.length) toast.error(`Rôles non donnés : ${r.errors.join(', ')}`)
      else toast.success(r.given.length ? `Rôles redonnés : ${r.given.join(', ')}` : 'Aucun rôle lié à ces articles')
      refresh()
    },
  })
  const roleName = (guildId: string, roleId: string) => data.guilds.find((g) => g.id === guildId)?.roles.find((r) => r.id === roleId)?.name ?? null

  return (
    <Section
      title='Achats'
      description='Du plus récent au plus ancien. Les achats faits avant la connexion de la boutique sont seulement gardés en mémoire.'
      actions={(
        <div className='flex flex-wrap gap-2'>
          <Input type='search' aria-label='Rechercher un achat' placeholder='Pseudo, article, ID Discord, n° de paiement' className='w-64' value={search} onChange={(e) => { setSearch(e.target.value); setBefore([]) }} />
          <Select value={filter} onValueChange={(v) => { setFilter(v as Filter); setBefore([]) }}>
            <SelectTrigger aria-label='Filtrer' className='w-52'><SelectValue /></SelectTrigger>
            <SelectContent>{(Object.keys(FILTERS) as Filter[]).map((f) => <SelectItem key={f} value={f}>{FILTERS[f]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      )}
    >
      {!list.data ? <Skeleton className='h-64 w-full' /> : !list.data.length ? (
        <EmptyState title='Aucun achat' icon={ShoppingCart}>{data.hasSecret ? 'Les nouveaux achats apparaîtront ici après la prochaine vérification.' : 'Connecte d’abord la boutique.'}</EmptyState>
      ) : (
        <ul className='divide-y'>
          {list.data.map((p) => {
            const status = statusPill(p)
            return (
              <li key={p.id} className={cn('flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm', p.baseline && 'opacity-70')}>
                <div className='min-w-0 flex-1 basis-56'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>{p.player.name ?? p.player.uuid ?? 'Acheteur inconnu'}</span>
                    <Pill tone={status.tone}>{status.text}</Pill>
                    {p.baseline && <Pill tone='neutral'>avant connexion</Pill>}
                  </div>
                  <div className='text-muted-foreground'>{p.packages.map((k) => k.name).join(', ') || 'Aucun article'}</div>
                  <div className='text-xs text-muted-foreground'>
                    #{p.id} · {dateTime(p.paidAt ?? p.seenAt)}{p.player.uuid ? ` · FiveM ${p.player.uuid}` : ''}
                  </div>
                </div>
                <div className='w-28 shrink-0 font-semibold tabular-nums sm:text-end'>{p.amount ? `${p.amount} ${p.currency ?? ''}` : '—'}</div>
                <div className='flex w-56 min-w-0 shrink-0 items-center gap-2'>
                  {p.discordId ? (
                    <>
                      <UserAvatar src={p.discord?.avatar} name={p.discord?.name ?? p.discordId} className='size-7' />
                      <div className='min-w-0'>
                        <div className='truncate'>{p.discord?.name ?? p.discordId}</div>
                        <div className='text-xs text-muted-foreground'>{LINK_LABEL[p.linkMethod ?? ''] ?? 'lié'}</div>
                      </div>
                    </>
                  ) : <Pill tone={p.baseline || p.kind !== 'complete' ? 'neutral' : 'warning'}>non lié</Pill>}
                </div>
                <div className='flex basis-full flex-wrap items-center gap-2 lg:w-[24rem] lg:shrink-0 lg:basis-auto lg:justify-end'>
                  {p.grants.map((g) => (
                    <Pill key={`${g.guildId}:${g.roleId}`} tone={g.removedAt ? 'neutral' : 'info'} className={cn(g.removedAt && 'line-through')}>
                      @{roleName(g.guildId, g.roleId) ?? g.roleId}{g.temporary ? ' · temporaire' : ''}
                    </Pill>
                  ))}
                  {p.error && <Pill tone='danger'><AlertTriangle className='size-3' /> {p.error}</Pill>}
                  {manage && (
                    <>
                      <Button size='sm' variant='ghost' onClick={() => setLinking(p)}><Link2 /> {p.discordId ? 'Changer' : 'Lier'}</Button>
                      {p.discordId && p.kind === 'complete' && !p.revokedAt && (
                        <Button size='sm' variant='ghost' loading={reapply.isPending && reapply.variables === p.id} onClick={() => reapply.mutate(p.id)}><Wand2 /> Redonner les rôles</Button>
                      )}
                    </>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {(before.length > 0 || (list.data?.length ?? 0) >= PAGE_SIZE) && (
        <div className='flex justify-between gap-2 border-t px-4 py-3'>
          <Button size='sm' variant='outline' disabled={!before.length} onClick={() => setBefore(before.slice(0, -1))}>Plus récents</Button>
          <Button size='sm' variant='outline' disabled={(list.data?.length ?? 0) < PAGE_SIZE} onClick={() => list.data && setBefore([...before, list.data[list.data.length - 1].id])}>Plus anciens</Button>
        </div>
      )}
      {linking && <LinkDialog payment={linking} onClose={() => { setLinking(null); refresh() }} />}
    </Section>
  )
}

function LinkDialog({ payment, onClose }: { payment: Payment; onClose: () => void }) {
  const [discordId, setDiscordId] = useState(payment.discordId ?? '')
  const [remember, setRemember] = useState(true)
  const valid = /^\d{17,20}$/.test(discordId.trim())
  const save = useMutation({
    mutationFn: (id: string | null) => api(`/tebex/payments/${payment.id}/link`, { method: 'POST', body: { discordId: id, remember } }),
    onSuccess: (_, id) => { toast.success(id ? 'Acheteur relié' : 'Liaison retirée'); onClose() },
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Relier l’achat #{payment.id} à Discord</DialogTitle>
          <DialogDescription>
            {payment.player.name ?? 'Acheteur'} · {payment.packages.map((p) => p.name).join(', ')}. Les rôles des articles sont donnés tout de suite ; s’ils étaient donnés à quelqu’un d’autre, ils lui sont retirés.
          </DialogDescription>
        </DialogHeader>
        <form id='tebex-link' className='grid gap-4' onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate(discordId.trim()) }}>
          <div className='grid gap-1.5'>
            <Label htmlFor='tebex-discord'>ID Discord du membre</Label>
            <Input id='tebex-discord' inputMode='numeric' value={discordId} onChange={(e) => setDiscordId(e.target.value)} placeholder='123456789012345678' className='font-mono' />
          </div>
          {payment.player.uuid && (
            <label className='flex items-center gap-2 text-sm'>
              <Checkbox checked={remember} onCheckedChange={(v) => setRemember(v === true)} />
              Retenir pour ses prochains achats (compte FiveM {payment.player.uuid})
            </label>
          )}
        </form>
        <DialogFooter className='gap-2'>
          {payment.discordId && <Button variant='danger-ghost' loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}><Unlink /> Délier</Button>}
          <Button type='submit' form='tebex-link' disabled={!valid} loading={save.isPending && save.variables !== null}><Link2 /> Relier</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RoleMappings({ data }: { data: Data }) {
  const qc = useQueryClient()
  const packages = useQuery({ queryKey: ['tebex-packages'], queryFn: () => api<{ packages: Package[]; error: string | null }>('/tebex/packages'), enabled: data.hasSecret, retry: false })
  const [draft, setDraft] = useState<Mapping[] | null>(null)
  const mappings = draft ?? data.config.mappings
  const main = data.guilds.find((g) => g.isMain) ?? data.guilds[0]
  const list = packages.data?.packages ?? []
  const save = useMutation({
    mutationFn: () => api<Config>('/tebex/config', { method: 'PUT', body: { ...data.config, mappings } }),
    onSuccess: () => { toast.success('Rôles des articles enregistrés'); setDraft(null); qc.invalidateQueries({ queryKey: ['tebex'] }) },
  })
  const update = (i: number, patch: Partial<Mapping>) => setDraft(mappings.map((m, k) => (k === i ? { ...m, ...patch } : m)))

  return (
    <Section
      title='Article → rôles Discord'
      description='Chaque ligne dit : acheter cet article donne ce rôle sur ce serveur, pour toujours ou pendant un nombre de jours (un nouvel achat ajoute ses jours au temps restant).'
      actions={(
        <div className='flex gap-2'>
          <Button variant='outline' size='sm' disabled={!main} onClick={() => setDraft([...mappings, { packageId: list[0]?.id ?? '', packageName: list[0]?.name ?? null, guildId: main?.id ?? '', roleId: '', days: null }])}><Plus /> Ajouter</Button>
          {draft && <Button size='sm' loading={save.isPending} disabled={mappings.some((m) => !m.packageId || !m.roleId)} onClick={() => save.mutate()}><Save /> Enregistrer</Button>}
        </div>
      )}
    >
      {packages.data?.error && <Notice tone='warning' className='m-4' title='Liste des articles incomplète'>{packages.data.error} Seuls les articles déjà vus dans des achats sont proposés.</Notice>}
      {!mappings.length ? (
        <EmptyState title='Aucun article relié' icon={ShoppingCart}>Ajoute une ligne, par exemple « VIP → @VIP ».</EmptyState>
      ) : (
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[46rem] text-sm'>
            <thead><tr className='border-b text-xs text-muted-foreground'><th className='px-4 py-2 text-start font-medium'>Article Tebex</th><th className='px-2 text-start font-medium'>Serveur</th><th className='px-2 text-start font-medium'>Rôle Discord</th><th className='px-2 text-start font-medium'>Durée (jours)</th><th className='w-12' /></tr></thead>
            <tbody className='divide-y'>
              {mappings.map((m, i) => {
                const guild = data.guilds.find((g) => g.id === m.guildId)
                const known = list.some((p) => p.id === m.packageId)
                return (
                  <tr key={m.id ?? `new-${i}`}>
                    <td className='px-4 py-2'>
                      <Select value={m.packageId || undefined} onValueChange={(v) => update(i, { packageId: v, packageName: list.find((p) => p.id === v)?.name ?? null })}>
                        <SelectTrigger aria-label='Article' className='w-60'><SelectValue placeholder='Choisir un article' /></SelectTrigger>
                        <SelectContent>
                          {!known && m.packageId && <SelectItem value={m.packageId}>{m.packageName ?? `Article ${m.packageId}`}</SelectItem>}
                          {list.map((p) => <SelectItem key={p.id} value={p.id}>{p.name}{p.category ? <span className='text-muted-foreground'> · {p.category}</span> : null}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className='px-2'>
                      <Select value={m.guildId || undefined} onValueChange={(v) => update(i, { guildId: v, roleId: '' })}>
                        <SelectTrigger aria-label='Serveur' className='w-40'><SelectValue placeholder='Serveur' /></SelectTrigger>
                        <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                      </Select>
                    </td>
                    <td className='px-2'>
                      <Select value={m.roleId || undefined} onValueChange={(v) => update(i, { roleId: v })}>
                        <SelectTrigger aria-label='Rôle Discord' className='w-44'><SelectValue placeholder='Rôle' /></SelectTrigger>
                        <SelectContent>
                          {(guild?.roles ?? []).filter((r) => r.id !== guild?.id).map((r) => (
                            <SelectItem key={r.id} value={r.id}><span className='size-2 rounded-full' style={{ background: r.color === '#000000' ? 'var(--muted-foreground)' : r.color }} aria-hidden />@{r.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </td>
                    <td className='px-2'>
                      <Input type='number' min={1} max={365} aria-label='Durée en jours' placeholder='Toujours' className='w-28' value={m.days ?? ''} onChange={(e) => update(i, { days: e.target.value ? Number(e.target.value) : null })} />
                    </td>
                    <td className='pe-3 text-end'><Button variant='ghost' size='icon' aria-label='Retirer la ligne' onClick={() => setDraft(mappings.filter((_, k) => k !== i))}><Trash2 /></Button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

function Connection({ data }: { data: Data }) {
  const qc = useQueryClient()
  const [secret, setSecret] = useState('')
  const [info, setInfo] = useState<{ store: string | null; domain: string | null; currency: string | null; game: string | null; server: string | null } | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['tebex'] })
  const save = useMutation({
    mutationFn: (value: string | null) => api('/tebex/secret', { method: 'PUT', body: { secret: value } }),
    onSuccess: (_, value) => { toast.success(value ? 'Clé enregistrée' : 'Clé retirée'); setSecret(''); setInfo(null); refresh() },
  })
  const test = useMutation({
    mutationFn: () => api<NonNullable<typeof info>>('/tebex/test', { method: 'POST' }),
    onSuccess: (r) => { setInfo(r); toast.success('Connexion à Tebex réussie') },
  })
  return (
    <Section title='Connexion à Tebex' description='Clé secrète du serveur de jeu (Tebex → Game Servers → ton serveur FiveM). Elle reste sur le bot : le panel sait seulement si elle est configurée.'>
      <div className='grid gap-4 p-4'>
        <div className='flex flex-wrap items-center gap-2 text-sm'>
          Clé configurée : <Pill tone={data.hasSecret ? 'success' : 'neutral'}>{data.hasSecret ? 'oui' : 'non'}</Pill>
          {data.state.lastPollAt && <span className='text-muted-foreground'>· dernière vérification {ago(data.state.lastPollAt)}</span>}
        </div>
        <form className='flex flex-wrap items-end gap-2' onSubmit={(e) => { e.preventDefault(); if (secret.trim()) save.mutate(secret.trim()) }}>
          <div className='grid min-w-0 flex-1 basis-64 gap-1.5'>
            <Label htmlFor='tebex-secret'>Clé secrète</Label>
            <Input id='tebex-secret' type='password' autoComplete='new-password' className='font-mono' value={secret} onChange={(e) => setSecret(e.target.value)} placeholder={data.hasSecret ? '•••••••• (inchangée)' : ''} />
          </div>
          <Button type='submit' disabled={!secret.trim()} loading={save.isPending && save.variables !== null}><Save /> Enregistrer</Button>
          {data.hasSecret && <Button type='button' variant='outline' loading={test.isPending} onClick={() => test.mutate()}>Tester</Button>}
          {data.hasSecret && <Button type='button' variant='danger-ghost' loading={save.isPending && save.variables === null} onClick={() => save.mutate(null)}><Trash2 /> Retirer</Button>}
        </form>
        {info && (
          <Notice tone='success' title={info.store ?? 'Boutique Tebex'}>
            {[info.domain, info.game, info.server && `serveur ${info.server}`, info.currency].filter(Boolean).join(' · ')}
          </Notice>
        )}
        {!data.state.initialized && data.hasSecret && <p className='text-xs text-muted-foreground'>Première vérification : les achats déjà faits sont seulement marqués comme vus, sans rôles ni messages.</p>}
      </div>
    </Section>
  )
}

function Options({ data }: { data: Data }) {
  const qc = useQueryClient()
  const box = useRef<HTMLDivElement>(null)
  const [cfg, setCfg] = useState<Config>(data.config)
  const guild = data.guilds.find((g) => g.id === cfg.thanks.guildId) ?? null
  const save = useMutation({
    mutationFn: () => api<Config>('/tebex/config', { method: 'PUT', body: cfg }),
    onSuccess: () => { toast.success('Réglages enregistrés'); qc.invalidateQueries({ queryKey: ['tebex'] }) },
  })
  const setThanks = (patch: Partial<Config['thanks']>) => setCfg({ ...cfg, thanks: { ...cfg.thanks, ...patch } })
  const toggle = (id: string, label: string, hint: string, checked: boolean, onChange: (v: boolean) => void) => (
    <div className='flex items-start justify-between gap-4'>
      <div><Label htmlFor={id}>{label}</Label><p className='text-xs text-muted-foreground'>{hint}</p></div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  )
  return (
    <Section
      title='Options'
      description='Les achats sont aussi envoyés dans les logs, catégorie « Boutique » (à router vers un salon dans la page Logs).'
      actions={<Button size='sm' loading={save.isPending} disabled={cfg.thanks.enabled && !cfg.thanks.channelId} onClick={() => save.mutate()}><Save /> Enregistrer</Button>}
    >
      <div className='grid gap-5 p-4'>
        {toggle('tebex-enabled', 'Suivre les achats', 'En pause, la boutique n’est plus interrogée.', cfg.enabled, (v) => setCfg({ ...cfg, enabled: v }))}
        {toggle('tebex-price', 'Montant dans les logs Discord', 'Le montant est toujours visible ici, pour qui a la permission de voir les achats.', cfg.showPrice, (v) => setCfg({ ...cfg, showPrice: v }))}
        {toggle('tebex-refund', 'Retirer les rôles en cas de remboursement ou de litige', 'Un rôle encore donné par un autre achat valide est gardé.', cfg.removeOnRefund, (v) => setCfg({ ...cfg, removeOnRefund: v }))}
        <div ref={box} className='grid gap-3 border-t pt-4'>
          {toggle('tebex-thanks', 'Message de remerciement public', 'Posté dans un salon à chaque nouvel achat.', cfg.thanks.enabled, (v) => setThanks({ enabled: v, guildId: cfg.thanks.guildId ?? data.guilds.find((g) => g.isMain)?.id ?? null }))}
          {cfg.thanks.enabled && (
            <>
              <div className='grid gap-3 sm:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label>Serveur</Label>
                  <Select value={cfg.thanks.guildId ?? undefined} onValueChange={(v) => setThanks({ guildId: v, channelId: null })}>
                    <SelectTrigger aria-label='Serveur' className='w-full'><SelectValue placeholder='Serveur' /></SelectTrigger>
                    <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className='grid gap-1.5 [&_button]:w-full'>
                  <Label>Salon</Label>
                  <ChannelSelect label='Salon du remerciement' channels={guild?.channels ?? []} value={cfg.thanks.channelId} onChange={(v) => setThanks({ channelId: v })} noneLabel='Choisir un salon' />
                </div>
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='tebex-template'>Message</Label>
                <Textarea id='tebex-template' rows={3} maxLength={1800} value={cfg.thanks.template} onChange={(e) => setThanks({ template: e.target.value })} />
                <div className='flex flex-wrap items-center gap-2'>
                  <VariableButton container={box} extra={data.variables} />
                  <span className='text-xs text-muted-foreground'>Variables du membre si l’acheteur est relié à Discord, sinon {'{user}'} donne son pseudo en jeu.</span>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </Section>
  )
}
