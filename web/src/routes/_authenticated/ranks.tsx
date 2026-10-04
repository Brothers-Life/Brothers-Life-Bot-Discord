import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ChevronDown, Copy, Download, GitMerge, Network, Pencil, Plus, Search, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Rank, RanksPayload, Role } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, RankBadge } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ColorPicker } from '@/components/app/color-picker'

export const Route = createFileRoute('/_authenticated/ranks')({
  component: RanksPage,
})

type Draft = { id?: number; name: string; level: number; color: string; permissions: string[]; roleIds: string[]; inherit: boolean; syncRoles: boolean }

const EMPTY: Draft = { name: '', level: 10, color: '#ff9628', permissions: ['panel.access'], roleIds: [], inherit: true, syncRoles: true }

// Ready-made sets of permissions (only what the editor may give is applied)
const PRESETS: { label: string; hint: string; match: (key: string) => boolean }[] = [
  { label: 'Lecture seule', hint: 'voir sans rien modifier', match: (k) => k === 'panel.access' || k.endsWith('.view') },
  { label: 'Support', hint: 'tickets, MP, suggestions', match: (k) => k === 'panel.access' || k.endsWith('.view') || /^(tickets|dm|feedback)\./.test(k) },
  { label: 'Modération', hint: 'support + sanctions, automod, commandes', match: (k) => k === 'panel.access' || k.endsWith('.view') || /^(tickets|dm|feedback|sanctions|automod|antiraid|commands|members)\./.test(k) },
  { label: 'Tout', hint: 'tout ce que tu peux donner', match: () => true },
]

function RanksPage() {
  const { me, can } = useMe()
  const manage = can('ranks.manage')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['ranks'], queryFn: () => api<RanksPayload>('/ranks') })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [toDelete, setToDelete] = useState<Rank | null>(null)
  const [importing, setImporting] = useState(false)

  const myLevel = me?.isOwner ? Infinity : (me?.level ?? 0)
  const editable = (rank: { level: number }) => manage && rank.level < myLevel

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ranks'] })
    qc.invalidateQueries({ queryKey: ['members'] })
    qc.invalidateQueries({ queryKey: ['me'] })
  }

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = { name: d.name, level: d.level, color: d.color || null, permissions: d.permissions, inherit: d.inherit, syncRoles: d.syncRoles }
      const rank = d.id
        ? await api<Rank>(`/ranks/${d.id}`, { method: 'PATCH', body })
        : await api<Rank>('/ranks', { method: 'POST', body })
      if (data?.mainGuildId) await api(`/ranks/${rank.id}/roles`, { method: 'PUT', body: { roleIds: d.roleIds } })
      return rank
    },
    onSuccess: (rank, d) => {
      toast.success(d.id ? `Rang ${rank.name} enregistré` : `Rang ${rank.name} créé`)
      setDraft(null)
      refresh()
    },
  })
  const duplicate = useMutation({
    mutationFn: (rank: Rank) => api<Rank>(`/ranks/${rank.id}/duplicate`, { method: 'POST', body: {} }),
    onSuccess: (copy) => { toast.success(`Rang ${copy.name} créé`); refresh() },
  })
  const copyRole = useMutation({
    mutationFn: (rank: Rank) => api<{ results: { name: string; status: string; error?: string }[]; copiedPermissions: boolean }>(`/ranks/${rank.id}/copy-role`, { method: 'POST' }),
    onSuccess: ({ results, copiedPermissions }) => {
      const done = results.filter((r) => r.status === 'created' || r.status === 'linked').length
      const errors = results.filter((r) => r.status === 'error')
      toast.success(`Rôle en place sur ${done} serveur(s)${copiedPermissions ? '' : ' (sans ses permissions Discord, sensibles)'}`)
      for (const e of errors) toast.error(`${e.name} : ${e.error}`)
      refresh()
    },
  })
  // Moving a rank in the hierarchy swaps its level with its neighbour's
  const move = useMutation({
    mutationFn: async ([a, b]: [Rank, Rank]) => {
      await api(`/ranks/${a.id}`, { method: 'PATCH', body: { level: b.level } })
      await api(`/ranks/${b.id}`, { method: 'PATCH', body: { level: a.level } })
    },
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (rank: Rank) => api(`/ranks/${rank.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: (_, rank) => {
      toast.success(`Rang ${rank.name} supprimé`)
      setToDelete(null)
      refresh()
    },
  })

  const roleName = (id: string) => data?.roles.find((r) => r.id === id)?.name ?? id
  const ranks = data?.ranks ?? []
  const toDraft = (rank: Rank): Draft => ({
    id: rank.id, name: rank.name, level: rank.level, color: rank.color ?? '', permissions: rank.permissions,
    roleIds: rank.roles.filter((r) => r.guildId === data?.mainGuildId).map((r) => r.roleId), inherit: rank.inherit, syncRoles: rank.syncRoles,
  })

  return (
    <Page
      title='Rangs'
      description='Un rang regroupe des permissions. On l’obtient avec un rôle du serveur principal ou par attribution directe. Plus un rang est haut, plus il est fort : tu ne gères que les rangs en dessous du tien, avec des permissions que tu as toi-même.'
      actions={manage && (
        <>
          {data?.mainGuildId && (
            <Button variant='outline' onClick={() => setImporting(true)}>
              <Download /> Importer les rôles du serveur principal
            </Button>
          )}
          <Button onClick={() => setDraft({ ...EMPTY, level: Math.min(10, Number.isFinite(myLevel) ? myLevel - 1 : 10) })}>
            <Plus /> Nouveau rang
          </Button>
        </>
      )}
    >
      {isLoading && <Skeleton className='h-48 w-full' />}
      {data && (
        <Section title='Hiérarchie' description='Du plus haut au plus bas. Les flèches échangent la place de deux rangs voisins.'>
          {!ranks.length ? (
            <EmptyState title='Aucun rang'>Crée un rang, choisis ses permissions et lie-le à un rôle du serveur principal.</EmptyState>
          ) : (
            <ol className='stagger relative grid gap-2 p-4'>
              <span aria-hidden className='absolute start-[2.1rem] top-6 bottom-6 w-px bg-gradient-to-b from-brand/60 via-border to-transparent' />
              {ranks.map((rank, i) => {
                const above = ranks[i - 1]
                const below = ranks[i + 1]
                const mainRoles = rank.roles.filter((r) => r.guildId === data.mainGuildId)
                const otherServers = new Set(rank.roles.filter((r) => r.guildId !== data.mainGuildId).map((r) => r.guildId)).size
                return (
                  <li key={rank.id} className='relative flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-brand/40'>
                    <span className='relative z-10 grid size-9 shrink-0 place-items-center rounded-full border-2 bg-background font-display text-sm font-bold tabular-nums' style={{ borderColor: rank.color ?? 'var(--border)' }} title='Niveau'>{rank.level}</span>
                    <div className='min-w-52 flex-1'>
                      <div className='flex flex-wrap items-center gap-2'>
                        <RankBadge name={rank.name} color={rank.color} />
                        {rank.inherit && <Pill tone='info'><GitMerge className='size-3' /> hérite des rangs inférieurs</Pill>}
                        {mainRoles.length > 0 && <Pill tone={rank.syncRoles ? 'success' : 'neutral'}><Network className='size-3' /> {rank.syncRoles ? `rôles synchronisés${otherServers ? ` · ${otherServers} serveur(s)` : ''}` : 'serveur principal seulement'}</Pill>}
                      </div>
                      <div className='mt-1 text-xs text-muted-foreground'>
                        {rank.permissions.length} permission{rank.permissions.length > 1 ? 's' : ''}{rank.inherited.length ? ` + ${rank.inherited.length} héritée${rank.inherited.length > 1 ? 's' : ''}` : ''}
                        {mainRoles.length > 0 && <> · {mainRoles.map((r) => `@${roleName(r.roleId)}`).join(', ')}</>}
                      </div>
                    </div>
                    {editable(rank) && (
                      <div className='flex items-center gap-1'>
                        <Button size='icon' variant='ghost' className='size-8' aria-label={`Monter ${rank.name}`} disabled={!above || !editable(above) || move.isPending} onClick={() => move.mutate([rank, above])}><ArrowUp /></Button>
                        <Button size='icon' variant='ghost' className='size-8' aria-label={`Descendre ${rank.name}`} disabled={!below || move.isPending} onClick={() => move.mutate([rank, below])}><ArrowDown /></Button>
                        <Button size='sm' variant='outline' onClick={() => setDraft(toDraft(rank))}><Pencil /> Modifier</Button>
                        <Button size='icon' variant='ghost' className='size-8' aria-label={`Dupliquer ${rank.name}`} title='Dupliquer' loading={duplicate.isPending && duplicate.variables?.id === rank.id} onClick={() => duplicate.mutate(rank)}><Copy /></Button>
                        {mainRoles.length > 0 && rank.syncRoles && (
                          <Button size='icon' variant='ghost' className='size-8' aria-label={`Copier le rôle de ${rank.name} sur les serveurs`} title='Copier le rôle sur tous les serveurs' loading={copyRole.isPending && copyRole.variables?.id === rank.id} onClick={() => copyRole.mutate(rank)}><Share2 /></Button>
                        )}
                        <Button size='icon' variant='danger-ghost' className='size-8' aria-label={`Supprimer ${rank.name}`} onClick={() => setToDelete(rank)}><Trash2 /></Button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </Section>
      )}

      {draft && data && (
        <RankDialog
          draft={draft}
          payload={data}
          maxLevel={Number.isFinite(myLevel) ? myLevel - 1 : 100}
          canGrant={can}
          saving={save.isPending}
          onClose={() => setDraft(null)}
          onSave={(d) => save.mutate(d)}
        />
      )}

      {importing && <ImportDialog onClose={() => setImporting(false)} onDone={refresh} />}

      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(open) => !open && setToDelete(null)}
        title={`Supprimer le rang ${toDelete?.name} ?`}
        desc='Les membres qui l’avaient perdent immédiatement ses permissions. Les rôles Discord ne sont pas touchés.'
        confirmText='Supprimer le rang'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => toDelete && remove.mutate(toDelete)}
      />
    </Page>
  )
}

function RankDialog({ draft, payload, maxLevel, canGrant, saving, onClose, onSave }: {
  draft: Draft
  payload: RanksPayload
  maxLevel: number
  canGrant: (permission: string) => boolean
  saving: boolean
  onClose: () => void
  onSave: (draft: Draft) => void
}) {
  const [d, setD] = useState(draft)
  const [search, setSearch] = useState('')
  const [closed, setClosed] = useState<Set<string>>(new Set())
  const byCategory = useMemo(() => {
    const map = new Map<string, typeof payload.permissions>()
    for (const p of payload.permissions) map.set(p.category, [...(map.get(p.category) ?? []), p])
    return [...map]
  }, [payload])
  // What the ranks below would give (live, with the level being edited)
  const inherited = useMemo(() => {
    const out = new Map<string, string>()
    if (!d.inherit) return out
    for (const r of [...payload.ranks].sort((a, b) => b.level - a.level)) {
      if (r.id === d.id || r.level >= d.level) continue
      for (const p of r.permissions) if (!out.has(p)) out.set(p, r.name)
    }
    return out
  }, [payload.ranks, d.inherit, d.level, d.id])

  const q = search.trim().toLowerCase()
  const visible = byCategory
    .map(([category, list]) => [category, list.filter((p) => !q || p.label.toLowerCase().includes(q) || p.key.includes(q) || category.toLowerCase().includes(q))] as const)
    .filter(([, list]) => list.length)
  const setPerms = (permissions: string[]) => setD((prev) => ({ ...prev, permissions: [...new Set(permissions)] }))
  const grantable = (keys: string[]) => keys.filter((k) => canGrant(k))
  const toggleRole = (id: string) => setD((prev) => ({ ...prev, roleIds: prev.roleIds.includes(id) ? prev.roleIds.filter((v) => v !== id) : [...prev.roleIds, id] }))

  const valid = d.name.trim().length > 0 && d.level >= 0 && d.level <= maxLevel
  const allKeys = payload.permissions.map((p) => p.key)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-3xl'>
        <DialogHeader>
          <DialogTitle>{d.id ? `Modifier ${draft.name}` : 'Nouveau rang'}</DialogTitle>
          <DialogDescription>Le niveau place le rang dans la hiérarchie : on ne gère que les rangs en dessous du sien.</DialogDescription>
        </DialogHeader>

        <form
          id='rank-form'
          className='grid gap-6'
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) onSave(d)
          }}
        >
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-[1fr_7rem_7rem]'>
            <div className='grid gap-1.5'>
              <Label htmlFor='rank-name'>Nom</Label>
              <Input id='rank-name' value={d.name} maxLength={50} required onChange={(e) => setD({ ...d, name: e.target.value })} placeholder='Modérateur' />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='rank-level'>Niveau</Label>
              <Input id='rank-level' type='number' min={0} max={maxLevel} value={d.level} onChange={(e) => setD({ ...d, level: Number(e.target.value) })} />
            </div>
            <div className='grid gap-1.5'>
              <Label htmlFor='rank-color'>Couleur</Label>
              <ColorPicker id='rank-color' value={d.color || '#ff9628'} onChange={(hex) => setD({ ...d, color: hex })} />
            </div>
          </div>
          {d.level > maxLevel && <p className='-mt-4 text-sm text-destructive'>Le niveau doit être inférieur au tien (maximum {maxLevel}).</p>}

          <label className='flex items-start gap-3 rounded-lg border p-3 text-sm'>
            <Switch checked={d.inherit} onCheckedChange={(inherit) => setD({ ...d, inherit })} className='mt-0.5' />
            <span>
              <span className='font-medium'>Hériter des rangs inférieurs</span>
              <span className='block text-xs text-muted-foreground'>Ce rang a automatiquement toutes les permissions des rangs de niveau plus bas : tu ne coches que ce qu’il a en plus.{d.inherit && inherited.size ? ` (${inherited.size} héritée${inherited.size > 1 ? 's' : ''})` : ''}</span>
            </span>
          </label>

          <fieldset className='grid gap-3'>
            <legend className='mb-1 text-sm font-medium'>Permissions <span className='font-normal text-muted-foreground'>({d.permissions.length} cochée{d.permissions.length > 1 ? 's' : ''})</span></legend>
            <div className='flex flex-wrap items-center gap-2'>
              <div className='relative min-w-48 flex-1'>
                <Search className='pointer-events-none absolute start-2.5 top-2.5 size-4 text-muted-foreground' />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder='Chercher une permission' className='ps-8' aria-label='Chercher une permission' />
              </div>
              <Select value='' onValueChange={(label) => { const preset = PRESETS.find((p) => p.label === label); if (preset) { setPerms(grantable(allKeys.filter(preset.match))); toast.info(`Modèle « ${preset.label} » appliqué`) } }}>
                <SelectTrigger className='w-44' aria-label='Appliquer un modèle'><SelectValue placeholder='Modèle…' /></SelectTrigger>
                <SelectContent>{PRESETS.map((p) => <SelectItem key={p.label} value={p.label}>{p.label} · {p.hint}</SelectItem>)}</SelectContent>
              </Select>
              <Select value='' onValueChange={(id) => { const r = payload.ranks.find((x) => String(x.id) === id); if (r) { setPerms(grantable(r.permissions)); toast.info(`Permissions de ${r.name} copiées`) } }}>
                <SelectTrigger className='w-48' aria-label='Copier les permissions d’un rang'><SelectValue placeholder='Copier depuis un rang…' /></SelectTrigger>
                <SelectContent>{payload.ranks.filter((r) => r.id !== d.id).map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name} ({r.permissions.length})</SelectItem>)}</SelectContent>
              </Select>
              <Button type='button' size='sm' variant='ghost' onClick={() => setPerms(['panel.access'].filter((k) => canGrant(k)))}>Tout décocher</Button>
            </div>

            <div className='grid gap-2'>
              {visible.map(([category, list]) => {
                const keys = grantable(list.map((p) => p.key))
                const checked = list.filter((p) => d.permissions.includes(p.key) || inherited.has(p.key)).length
                const all = keys.length > 0 && keys.every((k) => d.permissions.includes(k) || inherited.has(k))
                const open = q.length > 0 || !closed.has(category)
                return (
                  <div key={category} className='rounded-lg border'>
                    <div className='flex items-center gap-2 px-3 py-2'>
                      <Checkbox
                        checked={all ? true : checked > 0 ? 'indeterminate' : false}
                        disabled={!keys.length}
                        aria-label={`Tout cocher : ${category}`}
                        onCheckedChange={() => setPerms(all ? d.permissions.filter((p) => !keys.includes(p)) : [...d.permissions, ...keys.filter((k) => !inherited.has(k))])}
                      />
                      <button type='button' className='flex flex-1 items-center gap-2 text-start text-sm font-medium' aria-expanded={open} onClick={() => setClosed((s) => { const n = new Set(s); if (n.has(category)) n.delete(category); else n.add(category); return n })}>
                        {category}
                        <span className='text-xs font-normal text-muted-foreground tabular-nums'>{checked}/{list.length}</span>
                        <ChevronDown className={cn('ms-auto size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
                      </button>
                    </div>
                    {open && (
                      <div className='grid grid-cols-[minmax(0,1fr)] gap-1 border-t px-3 py-2 sm:grid-cols-2'>
                        {list.map((p) => {
                          const allowed = canGrant(p.key)
                          const from = inherited.get(p.key)
                          return (
                            <label key={p.key} className={cn('flex items-start gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/40', (!allowed || from) && 'opacity-70')}>
                              <Checkbox
                                checked={Boolean(from) || d.permissions.includes(p.key)}
                                disabled={!allowed || Boolean(from)}
                                onCheckedChange={() => setPerms(d.permissions.includes(p.key) ? d.permissions.filter((x) => x !== p.key) : [...d.permissions, p.key])}
                                className='mt-0.5'
                              />
                              <span>
                                {p.label}
                                {from && <span className='block text-xs text-info'>héritée de {from}</span>}
                                {!allowed && !from && <span className='block text-xs text-muted-foreground'>Tu n’as pas cette permission</span>}
                              </span>
                            </label>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
              {!visible.length && <p className='text-sm text-muted-foreground'>Aucune permission ne correspond.</p>}
            </div>
          </fieldset>

          <fieldset className='grid gap-3'>
            <legend className='mb-1 text-sm font-medium'>Rôles du serveur principal qui donnent ce rang</legend>
            {!payload.mainGuildId ? (
              <p className='text-sm text-muted-foreground'>Choisis d’abord le serveur principal dans « Serveurs ».</p>
            ) : (
              <>
                <div className='grid grid-cols-[minmax(0,1fr)] max-h-56 gap-1.5 overflow-y-auto rounded-md border p-2 sm:grid-cols-2'>
                  {payload.roles.map((role) => (
                    <label key={role.id} className='flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50'>
                      <Checkbox checked={d.roleIds.includes(role.id)} onCheckedChange={() => toggleRole(role.id)} />
                      <span className='size-2 rounded-full' style={{ background: role.color === '#000000' ? 'var(--muted-foreground)' : role.color }} />
                      <span className='truncate'>{role.name}</span>
                    </label>
                  ))}
                </div>
                <label className='flex items-start gap-3 rounded-lg border p-3 text-sm'>
                  <Switch checked={d.syncRoles} onCheckedChange={(syncRoles) => setD({ ...d, syncRoles })} className='mt-0.5' />
                  <span>
                    <span className='font-medium'>Synchroniser les rôles sur les autres serveurs</span>
                    <span className='block text-xs text-muted-foreground'>
                      {d.syncRoles
                        ? 'Les membres de ce rang reçoivent aussi le rôle lié sur chaque serveur du réseau (page « Rôles du staff », ou bouton « Copier le rôle »).'
                        : 'Le rang ne donne des rôles que sur le serveur principal : les autres serveurs ne sont pas touchés.'}
                    </span>
                  </span>
                </label>
              </>
            )}
          </fieldset>
        </form>

        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='rank-form' disabled={!valid} loading={saving}>
            {d.id ? 'Enregistrer' : 'Créer le rang'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type ImportCandidate = Role & { linkedRankId: number | null; sameNameRankId: number | null }
type ImportResult = { roleId: string; name: string; status: 'created' | 'linked' | 'already_linked' | 'error'; error?: string }

function ImportDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { data } = useQuery({ queryKey: ['ranks-import'], queryFn: () => api<{ roles: ImportCandidate[] }>('/ranks/import') })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const available = (data?.roles ?? []).filter((r) => !r.linkedRankId)

  const run = useMutation({
    mutationFn: () => api<ImportResult[]>('/ranks/import', { method: 'POST', body: { roleIds: [...selected] } }),
    onSuccess: (results) => {
      const created = results.filter((r) => r.status === 'created').length
      const linked = results.filter((r) => r.status === 'linked').length
      toast.success(`${created} rang(s) créé(s), ${linked} lié(s) à un rang existant. Coche maintenant leurs permissions.`)
      results.filter((r) => r.status === 'error').forEach((f) => toast.error(`${f.name} : ${f.error}`))
      onDone()
      onClose()
    },
  })

  const toggle = (id: string) => setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })
  const allSelected = available.length > 0 && selected.size === available.length

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Importer les rôles du serveur principal</DialogTitle>
          <DialogDescription>
            Chaque rôle coché devient un rang du même nom, lié à ce rôle. Si un rang du même nom existe déjà, le rôle y est simplement lié.
            Les nouveaux rangs n’ont aucune permission : coche-les ensuite.
          </DialogDescription>
        </DialogHeader>
        {!data ? <Skeleton className='h-40 w-full' /> : !available.length ? (
          <EmptyState title='Rien à importer'>Tous les rôles du serveur principal sont déjà liés à un rang.</EmptyState>
        ) : (
          <div className='grid gap-3'>
            <div className='flex justify-between text-sm'>
              <span className='text-muted-foreground'>{selected.size} rôle(s) sélectionné(s)</span>
              <button type='button' className='text-primary hover:underline' onClick={() => setSelected(allSelected ? new Set() : new Set(available.map((r) => r.id)))}>
                {allSelected ? 'Tout décocher' : 'Tout cocher'}
              </button>
            </div>
            <div className='grid max-h-80 gap-1 overflow-y-auto rounded-md border p-2'>
              {available.map((role) => (
                <label key={role.id} className='flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent/50'>
                  <Checkbox checked={selected.has(role.id)} onCheckedChange={() => toggle(role.id)} />
                  <span aria-hidden className='size-2 rounded-full' style={{ background: role.color === '#000000' ? 'var(--muted-foreground)' : role.color }} />
                  <span className='truncate'>{role.name}</span>
                  {role.sameNameRankId && <span className='ms-auto text-xs text-muted-foreground'>rang existant</span>}
                </label>
              ))}
            </div>
            <p className='text-xs text-muted-foreground'>Le rôle le plus haut du serveur obtient le niveau le plus élevé. Tu pourras ajuster les niveaux ensuite.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button onClick={() => run.mutate()} disabled={!selected.size || run.isPending}>
            {run.isPending ? 'Import…' : 'Importer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
