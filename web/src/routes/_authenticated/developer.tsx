import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, ChevronDown, Copy, Download, FileJson, KeyRound, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { ago, dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Notice, Pill, StatCards, UserAvatar, type Tone } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/_authenticated/developer')({
  component: DeveloperPage,
})

type ApiKey = {
  id: number
  name: string
  ownerId: string
  owner: { name: string; avatar: string | null } | null
  prefix: string
  permissions: string[] | null
  createdAt: number
  expiresAt: number | null
  lastUsedAt: number | null
  lastIp: string | null
  uses: number
  expired: boolean
}
type Permission = { key: string; label: string; category: string }
type KeysPayload = { keys: ApiKey[]; permissions: Permission[]; baseUrl: string; rateLimit: number }
type Field = { name: string; type: string; required: boolean }
type RouteDoc = { method: string; url: string; group: string; permission: string | null; confirm: boolean; query: Field[]; body: Field[]; example: unknown }
type Docs = { baseUrl: string; version: string; rateLimit: number; routes: RouteDoc[] }

const METHOD_TONE: Record<string, Tone> = { GET: 'info', POST: 'success', PUT: 'accent', PATCH: 'warning', DELETE: 'danger' }
const EXPIRY = [
  { value: 'never', label: 'Jamais' },
  { value: '7', label: '7 jours' },
  { value: '30', label: '30 jours' },
  { value: '90', label: '90 jours' },
  { value: '365', label: '1 an' },
]

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null)
  return {
    copied,
    copy: (text: string, id = text) => {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(id)
        setTimeout(() => setCopied((c) => (c === id ? null : c)), 1500)
      }, () => toast.error('Copie impossible'))
    },
  }
}

function Code({ children, copyable = true }: { children: string; copyable?: boolean }) {
  const { copied, copy } = useCopy()
  return (
    <div className='relative min-w-0'>
      <pre className='whitespace-pre-wrap break-all rounded-md border bg-muted/40 p-3 pe-11 font-mono text-xs leading-relaxed'>{children}</pre>
      {copyable && (
        <Button type='button' size='icon' variant='ghost' className='absolute end-1.5 top-1.5 size-7' aria-label='Copier' onClick={() => copy(children)}>
          {copied ? <Check className='size-3.5 text-success' /> : <Copy className='size-3.5' />}
        </Button>
      )}
    </div>
  )
}

function DeveloperPage() {
  const { can } = useMe()
  const [all, setAll] = useState(false)
  const keys = useQuery({ queryKey: ['api-keys', all], queryFn: () => api<KeysPayload>(`/api-keys${all ? '?all=true' : ''}`) })
  const docs = useQuery({ queryKey: ['api-docs'], queryFn: () => api<Docs>('/api-docs'), staleTime: 300_000 })
  const [creating, setCreating] = useState(false)
  const baseUrl = keys.data?.baseUrl || docs.data?.baseUrl || window.location.origin

  return (
    <Page
      title='API'
      description={<>Tout ce que fait le panel est aussi accessible par l’API, avec une clé. Une clé agit en ton nom, limitée aux permissions que tu lui donnes : si tu perds un droit, elle le perd aussi.</>}
      actions={can('api.use') && <Button onClick={() => setCreating(true)}><Plus /> Nouvelle clé</Button>}
    >
      <StatCards
        items={[
          { label: 'Clés actives', value: keys.data?.keys.filter((k) => !k.expired).length ?? '—', icon: KeyRound },
          { label: 'Routes disponibles', value: docs.data?.routes.length ?? '—', icon: FileJson },
          { label: 'Limite', value: `${keys.data?.rateLimit ?? docs.data?.rateLimit ?? 240}/min`, hint: 'par clé' },
        ]}
      />

      <Tabs defaultValue='keys' className='grid grid-cols-[minmax(0,1fr)] gap-4'>
        <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
          <TabsTrigger value='keys'>Clés</TabsTrigger>
          <TabsTrigger value='start'>Démarrer · Bruno</TabsTrigger>
          <TabsTrigger value='routes'>Routes</TabsTrigger>
        </TabsList>

        <TabsContent value='keys'>
          <KeyList data={keys.data} loading={keys.isLoading} all={all} setAll={setAll} canManage={can('api.manage')} />
        </TabsContent>
        <TabsContent value='start'>
          <GettingStarted baseUrl={baseUrl} rateLimit={docs.data?.rateLimit ?? 240} />
        </TabsContent>
        <TabsContent value='routes'>
          <RouteExplorer all={docs.data?.routes} />
        </TabsContent>
      </Tabs>

      {creating && keys.data && <CreateKeyDialog payload={keys.data} baseUrl={baseUrl} onClose={() => setCreating(false)} />}
    </Page>
  )
}

function KeyList({ data, loading, all, setAll, canManage }: { data?: KeysPayload; loading: boolean; all: boolean; setAll: (v: boolean) => void; canManage: boolean }) {
  const qc = useQueryClient()
  const [revoking, setRevoking] = useState<ApiKey | null>(null)
  const revoke = useMutation({
    mutationFn: (k: ApiKey) => api(`/api-keys/${k.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Clé révoquée')
      setRevoking(null)
      qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })

  return (
    <Section
      title={all ? 'Toutes les clés' : 'Mes clés'}
      description='La clé complète n’est montrée qu’une fois, à sa création. Révoque toute clé qui a pu fuiter.'
      actions={canManage && (
        <div className='flex items-center gap-2'>
          <Switch id='all-keys' checked={all} onCheckedChange={setAll} />
          <Label htmlFor='all-keys'>Tout le staff</Label>
        </div>
      )}
    >
      {loading ? (
        <p className='px-4 py-6 text-sm text-muted-foreground'>Chargement…</p>
      ) : !data?.keys.length ? (
        <EmptyState title='Aucune clé' icon={KeyRound}>Crée une clé pour brancher un site, un script ou un autre bot sur le panel.</EmptyState>
      ) : (
        <ul className='divide-y'>
          {data.keys.map((k) => (
            <li key={k.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
              {all && <UserAvatar src={k.owner?.avatar} name={k.owner?.name ?? k.ownerId} />}
              <div className='min-w-48 flex-1'>
                <div className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                  {all && <span>{k.owner?.name ?? k.ownerId} ·</span>}
                  <span>{k.name}</span>
                  <code className='rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground'>{k.prefix}…</code>
                  {k.expired ? <Pill tone='danger'>Expirée</Pill> : k.permissions ? <Pill tone='info'>{k.permissions.length - 2} permission{k.permissions.length - 2 > 1 ? 's' : ''}</Pill> : <Pill tone='accent'>Toutes mes permissions</Pill>}
                </div>
                <div className='mt-0.5 text-xs text-muted-foreground'>
                  Créée {ago(k.createdAt)}
                  {' · '}{k.lastUsedAt ? <>utilisée {ago(k.lastUsedAt)} ({k.uses} requête{k.uses > 1 ? 's' : ''}{k.lastIp ? `, ${k.lastIp}` : ''})</> : 'jamais utilisée'}
                  {' · '}{k.expiresAt ? `expire le ${dateTime(k.expiresAt)}` : 'sans expiration'}
                </div>
              </div>
              <Button size='sm' variant='outline' onClick={() => setRevoking(k)}><Trash2 /> Révoquer</Button>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
        title='Révoquer la clé ?'
        desc={`« ${revoking?.name ?? ''} » cessera de fonctionner immédiatement. Ce n’est pas réversible.`}
        confirmText='Révoquer'
        destructive
        isLoading={revoke.isPending}
        handleConfirm={() => revoking && revoke.mutate(revoking)}
      />
    </Section>
  )
}

function CreateKeyDialog({ payload, baseUrl, onClose }: { payload: KeysPayload; baseUrl: string; onClose: () => void }) {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('never')
  const [scoped, setScoped] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const [secret, setSecret] = useState<string | null>(null)

  const byCategory = useMemo(() => {
    const map = new Map<string, Permission[]>()
    for (const p of payload.permissions) if (p.key !== 'panel.access' && p.key !== 'api.use') map.set(p.category, [...(map.get(p.category) ?? []), p])
    return [...map]
  }, [payload])
  const q = search.trim().toLowerCase()
  const visible = byCategory
    .map(([category, list]) => [category, list.filter((p) => !q || p.label.toLowerCase().includes(q) || p.key.includes(q) || category.toLowerCase().includes(q))] as const)
    .filter(([, list]) => list.length)
  const toggle = (keys: string[], on: boolean) => setSelected((s) => {
    const n = new Set(s)
    for (const k of keys) if (on) n.add(k); else n.delete(k)
    return n
  })

  const create = useMutation({
    mutationFn: () => api<ApiKey & { secret: string }>('/api-keys', {
      method: 'POST',
      body: { name: name.trim(), permissions: scoped ? [...selected] : null, expiresInDays: expiry === 'never' ? null : Number(expiry) },
    }),
    onSuccess: (key) => {
      setSecret(key.secret)
      qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const valid = name.trim().length > 0 && (!scoped || selected.size > 0)

  if (secret) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>Clé créée</DialogTitle>
            <DialogDescription>Copie-la maintenant : elle ne sera plus jamais affichée.</DialogDescription>
          </DialogHeader>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
            <Code>{secret}</Code>
            <Notice tone='warning'>Garde-la comme un mot de passe : quiconque l’a peut agir en ton nom sur le panel. Ne la mets jamais dans un dépôt Git ni dans un message Discord.</Notice>
            <div className='grid gap-1.5'>
              <Label>Essai rapide</Label>
              <Code>{`curl -k -H "Authorization: Bearer ${secret}" ${baseUrl}/api/me`}</Code>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={onClose}>J’ai copié la clé</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Nouvelle clé d’API</DialogTitle>
          <DialogDescription>Une clé ne peut jamais avoir plus de droits que toi.</DialogDescription>
        </DialogHeader>
        <form
          id='api-key-form'
          className='grid grid-cols-[minmax(0,1fr)] gap-5'
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) create.mutate()
          }}
        >
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[1fr_11rem]'>
            <div className='grid gap-1.5'>
              <Label htmlFor='key-name'>Nom</Label>
              <Input id='key-name' value={name} maxLength={60} required autoFocus onChange={(e) => setName(e.target.value)} placeholder='Site web, script de stats…' />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='key-expiry'>Expiration</Label>
              <Select value={expiry} onValueChange={setExpiry}>
                <SelectTrigger id='key-expiry'><SelectValue /></SelectTrigger>
                <SelectContent>{EXPIRY.map((e) => <SelectItem key={e.value} value={e.value}>{e.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <label className='flex items-start gap-3 rounded-lg border p-3 text-sm'>
            <Switch checked={scoped} onCheckedChange={setScoped} className='mt-0.5' />
            <span>
              <span className='font-medium'>Limiter les permissions</span>
              <span className='block text-xs text-muted-foreground'>{scoped ? `${selected.size} permission${selected.size > 1 ? 's' : ''} choisie${selected.size > 1 ? 's' : ''}. Conseillé : ne donne que le nécessaire.` : 'Sinon la clé a toutes tes permissions et suit ton rang.'}</span>
            </span>
          </label>

          {scoped && (
            <fieldset className='grid gap-3'>
              <legend className='sr-only'>Permissions de la clé</legend>
              <div className='flex flex-wrap items-center gap-2'>
                <div className='relative min-w-48 flex-1'>
                  <Search className='pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground' />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Chercher une permission' className='ps-8' aria-label='Chercher une permission' />
                </div>
                <Button type='button' size='sm' variant='ghost' onClick={() => toggle(payload.permissions.filter((p) => p.key.endsWith('.view')).map((p) => p.key), true)}>Lecture seule</Button>
                <Button type='button' size='sm' variant='ghost' onClick={() => setSelected(new Set())}>Tout décocher</Button>
              </div>
              <div className='grid gap-2'>
                {visible.map(([category, list]) => {
                  const keys = list.map((p) => p.key)
                  const checked = keys.filter((k) => selected.has(k)).length
                  const open = q.length > 0 || !closed.has(category)
                  return (
                    <div key={category} className='rounded-lg border'>
                      <div className='flex items-center gap-2 px-3 py-2'>
                        <Checkbox
                          checked={checked === keys.length ? true : checked > 0 ? 'indeterminate' : false}
                          aria-label={`Tout cocher : ${category}`}
                          onCheckedChange={() => toggle(keys, checked !== keys.length)}
                        />
                        <button type='button' className='flex flex-1 items-center gap-2 text-start text-sm font-medium' aria-expanded={open} onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(category)) n.delete(category); else n.add(category); return n })}>
                          {category}
                          <span className='text-xs font-normal text-muted-foreground tabular-nums'>{checked}/{list.length}</span>
                          <ChevronDown className={cn('ms-auto size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
                        </button>
                      </div>
                      {open && (
                        <div className='grid grid-cols-[minmax(0,1fr)] gap-1 border-t px-3 py-2 sm:grid-cols-2'>
                          {list.map((p) => (
                            <label key={p.key} className='flex items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/40'>
                              <Checkbox checked={selected.has(p.key)} onCheckedChange={(on) => toggle([p.key], on === true)} className='mt-0.5' />
                              <span>{p.label} <code className='text-xs text-muted-foreground'>{p.key}</code></span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </fieldset>
          )}
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='api-key-form' disabled={!valid || create.isPending}>Créer la clé</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function GettingStarted({ baseUrl, rateLimit }: { baseUrl: string; rateLimit: number }) {
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
      <Section title='Collection Bruno' description='Toutes les routes, prêtes à lancer, rangées par module, avec leur documentation.'>
        <div className='grid gap-4 p-4 text-sm'>
          <ol className='grid list-decimal gap-2 ps-5'>
            <li>Installe <a className='text-brand underline-offset-4 hover:underline' href='https://www.usebruno.com/downloads' target='_blank' rel='noreferrer'>Bruno</a> (gratuit, hors ligne).</li>
            <li>Télécharge la collection ci-dessous et décompresse-la.</li>
            <li>Dans Bruno : <b>Open Collection</b> → choisis le dossier <code>brothers-life-api</code>.</li>
            <li>En haut à droite, environnement <b>Production</b> : colle ta clé dans <code>apiKey</code> (variable secrète, jamais écrite dans les fichiers).</li>
            <li>Panel en HTTPS auto-signé : <i>Preferences → General</i>, décoche <b>SSL/TLS Certificate Verification</b>.</li>
          </ol>
          <div className='flex flex-wrap gap-2'>
            <Button asChild><a href='/api/bruno.zip' download><Download /> Collection Bruno (.zip)</a></Button>
            <Button asChild variant='outline'><a href='/api/openapi.json' download><FileJson /> OpenAPI 3</a></Button>
          </div>
          <p className='text-xs text-muted-foreground'>Le fichier OpenAPI s’importe aussi dans Bruno (<i>Import Collection → OpenAPI V3</i>), Postman ou Insomnia. La collection est générée à partir des routes de cette version du bot : retélécharge-la après une mise à jour.</p>
        </div>
      </Section>

      <Section title='Les règles' description='Ce qu’il faut savoir pour écrire un client.'>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-3 p-4 text-sm'>
          <p>Adresse : <code className='break-all'>{baseUrl}/api</code></p>
          <Code>{`curl -k ${baseUrl}/api/me \\\n  -H "Authorization: Bearer brl_…"`}</Code>
          <ul className='grid list-disc gap-1.5 ps-5 text-muted-foreground'>
            <li>Corps en JSON (<code>Content-Type: application/json</code>), réponses en JSON.</li>
            <li>Les actions sensibles demandent <code>{'"confirm": true'}</code> dans le corps.</li>
            <li>Erreurs : <code>{'{ "error": { "code", "message" } }'}</code> avec un message en français.</li>
            <li>{rateLimit} requêtes par minute et par clé, puis 429 avec <code>Retry-After</code>.</li>
            <li>Les identifiants Discord sont des chaînes (17 à 20 chiffres).</li>
            <li>Chaque action passe dans le journal, avec le nom de la clé.</li>
            <li>Clés, sessions et flux en direct (console, tickets, MP) restent réservés au panel.</li>
          </ul>
          <Code>{`// Node.js 18+
const res = await fetch('${baseUrl}/api/network', {
  headers: { Authorization: \`Bearer \${process.env.BRL_API_KEY}\` },
})
const data = await res.json()`}</Code>
        </div>
      </Section>
    </div>
  )
}

function RouteExplorer({ all }: { all?: RouteDoc[] }) {
  const [search, setSearch] = useState('')
  const [method, setMethod] = useState('all')
  const [open, setOpen] = useState<string | null>(null)
  const q = search.trim().toLowerCase()
  const groups = useMemo(() => {
    const map = new Map<string, RouteDoc[]>()
    for (const r of all ?? []) {
      if (method !== 'all' && r.method !== method) continue
      if (q && !`${r.method} ${r.url} ${r.group} ${r.permission ?? ''}`.toLowerCase().includes(q)) continue
      map.set(r.group, [...(map.get(r.group) ?? []), r])
    }
    return [...map]
  }, [all, q, method])

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
      <div className='flex flex-wrap gap-2'>
        <div className='relative min-w-48 flex-1'>
          <Search className='pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground' />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Chercher une route, un module, une permission' className='ps-8' aria-label='Chercher une route' />
        </div>
        <Select value={method} onValueChange={setMethod}>
          <SelectTrigger className='w-36' aria-label='Méthode'><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>Toutes</SelectItem>
            {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {!groups.length && <EmptyState title='Aucune route' />}
      {groups.map(([group, routes]) => (
        <Section key={group} title={group} description={`${routes.length} route${routes.length > 1 ? 's' : ''}`}>
          <ul className='divide-y'>
            {routes.map((r) => {
              const id = `${r.method} ${r.url}`
              const expanded = open === id
              const details = r.query.length > 0 || r.body.length > 0
              return (
                <li key={id}>
                  <button type='button' className='flex w-full flex-wrap items-center gap-2 px-4 py-2 text-start hover:bg-accent/30 disabled:cursor-default disabled:hover:bg-transparent' aria-expanded={details ? expanded : undefined} disabled={!details} onClick={() => setOpen(expanded ? null : id)}>
                    <Pill tone={METHOD_TONE[r.method] ?? 'neutral'} className='w-16 justify-center font-mono'>{r.method}</Pill>
                    <code className='min-w-0 flex-1 break-all font-mono text-xs sm:text-sm'>{r.url}</code>
                    {r.confirm && <Pill tone='warning'>confirm</Pill>}
                    <span className='font-mono text-xs text-muted-foreground'>{r.permission ?? 'clé valide'}</span>
                    {details && <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />}
                  </button>
                  {expanded && (
                    <div className='grid grid-cols-[minmax(0,1fr)] gap-3 border-t bg-muted/20 px-4 py-3 text-sm'>
                      {r.query.length > 0 && <FieldList title='Paramètres de requête' fields={r.query} />}
                      {r.body.length > 0 && <FieldList title='Corps JSON' fields={r.body} />}
                      {r.example !== null && <Code>{JSON.stringify(r.example, null, 2)}</Code>}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </Section>
      ))}
    </div>
  )
}

function FieldList({ title, fields }: { title: string; fields: Field[] }) {
  return (
    <div>
      <div className='mb-1 text-xs font-medium text-muted-foreground uppercase'>{title}</div>
      <ul className='grid gap-0.5'>
        {fields.map((f) => (
          <li key={f.name} className='flex flex-wrap gap-x-2 font-mono text-xs'>
            <span className='font-semibold'>{f.name}</span>
            <span className='text-muted-foreground'>{f.type}</span>
            {f.required && <span className='text-brand'>obligatoire</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
