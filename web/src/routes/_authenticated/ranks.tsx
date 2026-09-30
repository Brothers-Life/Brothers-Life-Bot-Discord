import { useMemo, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Rank, RanksPayload } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, RankBadge } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/ranks')({
  component: RanksPage,
})

type Draft = { id?: number; name: string; level: number; color: string; permissions: string[]; roleIds: string[] }

const EMPTY: Draft = { name: '', level: 10, color: '#d6a249', permissions: ['panel.access'], roleIds: [] }

function RanksPage() {
  const { me, can } = useMe()
  const manage = can('ranks.manage')
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['ranks'], queryFn: () => api<RanksPayload>('/ranks') })
  const [draft, setDraft] = useState<Draft | null>(null)
  const [toDelete, setToDelete] = useState<Rank | null>(null)

  const myLevel = me?.isOwner ? Infinity : (me?.level ?? 0)
  const editable = (rank: { level: number }) => manage && rank.level < myLevel

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['ranks'] })
    qc.invalidateQueries({ queryKey: ['members'] })
    qc.invalidateQueries({ queryKey: ['me'] })
  }

  const save = useMutation({
    mutationFn: async (d: Draft) => {
      const body = { name: d.name, level: d.level, color: d.color || null, permissions: d.permissions }
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

  const remove = useMutation({
    mutationFn: (rank: Rank) => api(`/ranks/${rank.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: (_, rank) => {
      toast.success(`Rang ${rank.name} supprimé`)
      setToDelete(null)
      refresh()
    },
  })

  const roleName = (id: string) => data?.roles.find((r) => r.id === id)?.name ?? id

  return (
    <Page
      title='Rangs'
      description='Un rang regroupe des permissions. On l’obtient avec un rôle du serveur principal ou par attribution directe. Tu ne peux gérer que les rangs de niveau inférieur au tien, avec des permissions que tu as toi-même.'
      actions={manage && (
        <Button onClick={() => setDraft({ ...EMPTY, level: Math.min(10, Number.isFinite(myLevel) ? myLevel - 1 : 10) })}>
          <Plus /> Nouveau rang
        </Button>
      )}
    >
      {isLoading && <Skeleton className='h-48 w-full' />}
      {data && (
        <Section title={`${data.ranks.length} rang${data.ranks.length > 1 ? 's' : ''}`}>
          {!data.ranks.length ? (
            <EmptyState title='Aucun rang'>Crée un rang, coche ses permissions et lie-le à un rôle du serveur principal.</EmptyState>
          ) : (
            <ul className='divide-y'>
              {data.ranks.map((rank) => (
                <li key={rank.id} className='flex flex-wrap items-center gap-4 px-4 py-3'>
                  <div className='w-10 text-center text-lg font-semibold tabular-nums text-muted-foreground' title='Niveau'>{rank.level}</div>
                  <div className='min-w-0 flex-1'>
                    <RankBadge name={rank.name} color={rank.color} />
                    <div className='mt-1 text-xs text-muted-foreground'>
                      {rank.permissions.length} permission{rank.permissions.length > 1 ? 's' : ''}
                      {rank.roles.length > 0 && <> · rôles : {rank.roles.map((r) => `@${roleName(r.roleId)}`).join(', ')}</>}
                    </div>
                  </div>
                  {editable(rank) && (
                    <div className='flex gap-2'>
                      <Button
                        size='sm'
                        variant='outline'
                        onClick={() => setDraft({
                          id: rank.id,
                          name: rank.name,
                          level: rank.level,
                          color: rank.color ?? '',
                          permissions: rank.permissions,
                          roleIds: rank.roles.filter((r) => r.guildId === data.mainGuildId).map((r) => r.roleId),
                        })}
                      >
                        Modifier
                      </Button>
                      <Button size='sm' variant='ghost' className='text-destructive' onClick={() => setToDelete(rank)}>Supprimer</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
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
  const byCategory = useMemo(() => {
    const map = new Map<string, typeof payload.permissions>()
    for (const p of payload.permissions) map.set(p.category, [...(map.get(p.category) ?? []), p])
    return [...map]
  }, [payload])

  const toggle = <K extends 'permissions' | 'roleIds'>(key: K, value: string) =>
    setD((prev) => ({ ...prev, [key]: prev[key].includes(value) ? prev[key].filter((v) => v !== value) : [...prev[key], value] }))

  const valid = d.name.trim().length > 0 && d.level >= 0 && d.level <= maxLevel

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='max-h-[90svh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{d.id ? `Modifier ${draft.name}` : 'Nouveau rang'}</DialogTitle>
          <DialogDescription>Le niveau sert à la hiérarchie : on ne gère que les rangs en dessous du sien.</DialogDescription>
        </DialogHeader>

        <form
          id='rank-form'
          className='grid gap-6'
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) onSave(d)
          }}
        >
          <div className='grid gap-4 sm:grid-cols-[1fr_7rem_7rem]'>
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
              <Input id='rank-color' type='color' value={d.color || '#d6a249'} className='h-9 p-1' onChange={(e) => setD({ ...d, color: e.target.value })} />
            </div>
          </div>
          {d.level > maxLevel && <p className='-mt-4 text-sm text-destructive'>Le niveau doit être inférieur au tien (maximum {maxLevel}).</p>}

          <fieldset className='grid gap-4'>
            <legend className='mb-2 text-sm font-medium'>Permissions</legend>
            {byCategory.map(([category, permissions]) => (
              <div key={category}>
                <div className='mb-1.5 text-xs font-medium text-muted-foreground'>{category}</div>
                <div className='grid gap-2 sm:grid-cols-2'>
                  {permissions.map((p) => {
                    const allowed = canGrant(p.key)
                    return (
                      <label key={p.key} className='flex items-start gap-2 text-sm has-disabled:opacity-50'>
                        <Checkbox
                          checked={d.permissions.includes(p.key)}
                          disabled={!allowed}
                          onCheckedChange={() => toggle('permissions', p.key)}
                          className='mt-0.5'
                        />
                        <span>
                          {p.label}
                          {!allowed && <span className='block text-xs text-muted-foreground'>Tu n’as pas cette permission</span>}
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
          </fieldset>

          <fieldset>
            <legend className='mb-2 text-sm font-medium'>Rôles du serveur principal qui donnent ce rang</legend>
            {!payload.mainGuildId ? (
              <p className='text-sm text-muted-foreground'>Choisis d’abord le serveur principal dans « Serveurs ».</p>
            ) : (
              <div className='grid max-h-56 gap-1.5 overflow-y-auto rounded-md border p-2 sm:grid-cols-2'>
                {payload.roles.map((role) => (
                  <label key={role.id} className='flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50'>
                    <Checkbox checked={d.roleIds.includes(role.id)} onCheckedChange={() => toggle('roleIds', role.id)} />
                    <span className='size-2 rounded-full' style={{ background: role.color === '#000000' ? 'var(--muted-foreground)' : role.color }} />
                    <span className='truncate'>{role.name}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
        </form>

        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='rank-form' disabled={!valid || saving}>
            {saving ? 'Enregistrement…' : d.id ? 'Enregistrer' : 'Créer le rang'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
