import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { PermissionRow, PermissionsPayload } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, RankBadge } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/permissions')({
  component: PermissionsPage,
})

function PermissionsPage() {
  const { me, can } = useMe()
  const manage = can('permsync.manage')
  const myLevel = me?.isOwner ? Infinity : (me?.level ?? 0)
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['permissions'], queryFn: () => api<PermissionsPayload>('/permissions') })
  const preview = useQuery({ queryKey: ['permissions-preview'], queryFn: () => api<PermissionRow[]>('/permissions/preview') })
  const [selected, setSelected] = useState<number | null>(null)
  const [applying, setApplying] = useState<number | 'all' | null>(null)

  const rank = data?.ranks.find((r) => r.id === selected) ?? data?.ranks[0]
  const labels = useMemo(() => new Map(data?.catalogue.map((p) => [p.key, p.label])), [data])

  const apply = useMutation({
    mutationFn: (target: number | 'all') => api<{ applied: number; failed: number }>('/permissions/apply', { method: 'POST', body: { confirm: true, ...(target === 'all' ? {} : { rankId: target }) } }),
    onSuccess: (r) => {
      if (r.failed) toast.warning(`${r.applied} rôle(s) mis à jour, ${r.failed} en échec (rôle au-dessus du bot ou permission que le bot n’a pas)`)
      else toast.success(r.applied ? `${r.applied} rôle(s) mis à jour` : 'Tout était déjà conforme')
      setApplying(null)
      qc.invalidateQueries({ queryKey: ['permissions-preview'] })
    },
  })

  const drift = (preview.data ?? []).filter((r) => r.missing.length || r.extra.length || r.error)

  return (
    <Page
      title='Permissions Discord'
      description='Pour chaque rang, choisis les permissions Discord que ses rôles doivent avoir. Le bot applique le profil sur tous les serveurs et signale toutes les 6 heures les rôles qui ne le respectent plus. Les permissions des salons ne sont pas touchées.'
      actions={manage && drift.length > 0 && <Button onClick={() => setApplying('all')}>Tout appliquer ({drift.length})</Button>}
    >
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && !data.ranks.length && <Section title='Aucun rang'><EmptyState title='Crée d’abord des rangs' /></Section>}
      {data && rank && (
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]'>
          <nav aria-label='Rangs' className='flex gap-1 overflow-x-auto lg:flex-col'>
            {data.ranks.map((r) => (
              <button
                key={r.id}
                type='button'
                onClick={() => setSelected(r.id)}
                aria-current={r.id === rank.id ? 'page' : undefined}
                className='flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-accent aria-[current=page]:bg-accent'
              >
                <RankBadge name={r.name} color={r.color} />
                {data.profiles[r.id] ? <Pill tone='accent'>profil</Pill> : <span className='text-xs text-muted-foreground'>aucun</span>}
              </button>
            ))}
          </nav>
          <div className='grid gap-6'>
            <ProfileEditor
              key={`${rank.id}-${JSON.stringify(data.profiles[rank.id] ?? null)}`}
              rankId={rank.id}
              rankName={rank.name}
              linkedRoles={rank.linkedRoles}
              catalogue={data.catalogue}
              initial={data.profiles[rank.id]?.permissions ?? null}
              editable={manage && rank.level < myLevel}
              isOwner={Boolean(me?.isOwner)}
            />
            <Section
              title='État sur les serveurs'
              description='Ce qui manque (+) ou est en trop (−) sur chaque rôle lié à ce rang.'
              actions={manage && rank.level < myLevel && drift.some((r) => r.rankId === rank.id) && <Button size='sm' onClick={() => setApplying(rank.id)}>Appliquer ce profil</Button>}
            >
              <RowsTable rows={(preview.data ?? []).filter((r) => r.rankId === rank.id)} labels={labels} hasProfile={Boolean(data.profiles[rank.id])} />
            </Section>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={applying !== null}
        onOpenChange={(o) => !o && setApplying(null)}
        title={applying === 'all' ? 'Appliquer tous les profils ?' : 'Appliquer ce profil ?'}
        desc='Les permissions des rôles concernés seront remplacées sur chaque serveur par celles du profil.'
        confirmText='Appliquer'
        isLoading={apply.isPending}
        handleConfirm={() => applying !== null && apply.mutate(applying)}
      />
    </Page>
  )
}

function RowsTable({ rows, labels, hasProfile }: { rows: PermissionRow[]; labels: Map<string, string>; hasProfile: boolean }) {
  if (!hasProfile) return <EmptyState title='Pas de profil pour ce rang'>Coche des permissions ci-dessus puis enregistre.</EmptyState>
  if (!rows.length) return <EmptyState title='Aucun rôle lié'>Lie ce rang à des rôles dans « Rôles du staff ».</EmptyState>
  return (
    <ul className='divide-y'>
      {rows.map((r) => {
        const ok = !r.missing.length && !r.extra.length && !r.error
        return (
          <li key={`${r.guildId}-${r.roleId}`} className='flex flex-wrap items-start gap-3 px-4 py-3 text-sm'>
            <div className='min-w-48 flex-1'>
              <div className='font-medium'>{r.guildName} · @{r.roleName ?? r.roleId}</div>
              {r.error && <div className='text-destructive'>{r.error}</div>}
              {!r.editable && !r.error && <div className='text-xs text-warning'>Rôle au-dessus du bot : impossible à modifier.</div>}
              {(r.missing.length > 0 || r.extra.length > 0) && (
                <div className='mt-1 flex flex-wrap gap-1'>
                  {r.missing.map((p) => <Pill key={p} tone='success'>+ {labels.get(p) ?? p}</Pill>)}
                  {r.extra.map((p) => <Pill key={p} tone='danger'>− {labels.get(p) ?? p}</Pill>)}
                </div>
              )}
            </div>
            {ok && <Pill tone='success'>Conforme</Pill>}
          </li>
        )
      })}
    </ul>
  )
}

function ProfileEditor({ rankId, rankName, linkedRoles, catalogue, initial, editable, isOwner }: {
  rankId: number
  rankName: string
  linkedRoles: number
  catalogue: PermissionsPayload['catalogue']
  initial: string[] | null
  editable: boolean
  isOwner: boolean
}) {
  const qc = useQueryClient()
  const [selected, setSelected] = useState<Set<string>>(new Set(initial ?? []))
  const groups = useMemo(() => {
    const map = new Map<string, typeof catalogue>()
    for (const p of catalogue) map.set(p.group, [...(map.get(p.group) ?? []), p])
    return [...map]
  }, [catalogue])
  const dirty = JSON.stringify([...selected].sort()) !== JSON.stringify([...(initial ?? [])].sort()) || initial === null

  const save = useMutation({
    mutationFn: (permissions: string[] | null) => api(`/permissions/${rankId}`, { method: 'PUT', body: { permissions } }),
    onSuccess: (_, permissions) => {
      toast.success(permissions ? 'Profil enregistré. Applique-le pour mettre les rôles à jour.' : 'Profil supprimé')
      qc.invalidateQueries({ queryKey: ['permissions'] })
      qc.invalidateQueries({ queryKey: ['permissions-preview'] })
    },
  })

  return (
    <Section
      title={`Profil de ${rankName}`}
      description={`${linkedRoles} rôle${linkedRoles > 1 ? 's' : ''} lié${linkedRoles > 1 ? 's' : ''} à ce rang.`}
      actions={editable && (
        <div className='flex gap-2'>
          {initial && <Button size='sm' variant='ghost' onClick={() => save.mutate(null)}>Supprimer le profil</Button>}
          <Button size='sm' onClick={() => save.mutate([...selected])} disabled={!dirty || save.isPending}>Enregistrer</Button>
        </div>
      )}
    >
      <div className='grid gap-5 p-4 md:grid-cols-2'>
        {groups.map(([group, permissions]) => {
          const togglable = permissions.filter((p) => editable && !(p.ownerOnly && !isOwner)).map((p) => p.key)
          const count = permissions.filter((p) => selected.has(p.key)).length
          const all = count === permissions.length
          return (
          <fieldset key={group} className='rounded-lg border p-3'>
            <legend className='px-1'>
              <label className='flex items-center gap-2 text-xs font-medium text-muted-foreground has-disabled:opacity-60'>
                <Checkbox
                  checked={all ? true : count > 0 ? 'indeterminate' : false}
                  disabled={!togglable.length}
                  aria-label={`Tout cocher : ${group}`}
                  onCheckedChange={() => setSelected((prev) => {
                    const next = new Set(prev)
                    // Everything the editor may change in the group on, or off if it is already all on
                    const on = !togglable.every((k) => next.has(k))
                    for (const k of togglable) {
                      if (on) next.add(k)
                      else next.delete(k)
                    }
                    return next
                  })}
                />
                {group}
                <span className='tabular-nums'>{count}/{permissions.length}</span>
              </label>
            </legend>
            <div className='grid gap-1.5'>
              {permissions.map((p) => {
                const locked = !editable || (p.ownerOnly && !isOwner)
                return (
                  <label key={p.key} className='flex items-center gap-2 text-sm has-disabled:opacity-60'>
                    <Checkbox
                      checked={selected.has(p.key)}
                      disabled={locked}
                      onCheckedChange={() => setSelected((prev) => {
                        const next = new Set(prev)
                        if (next.has(p.key)) next.delete(p.key)
                        else next.add(p.key)
                        return next
                      })}
                    />
                    {p.label}
                    {p.ownerOnly && !isOwner && <span className='text-xs text-muted-foreground'>(chef du réseau)</span>}
                  </label>
                )
              })}
            </div>
          </fieldset>
          )
        })}
      </div>
    </Section>
  )
}
