import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { StaffRolesPayload } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, RankBadge } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/staff-roles')({
  component: StaffRolesPage,
})

function StaffRolesPage() {
  const { me, can } = useMe()
  const manage = can('ranks.manage')
  const myLevel = me?.isOwner ? Infinity : (me?.level ?? 0)
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({ queryKey: ['staff-roles'], queryFn: () => api<StaffRolesPayload>('/staff-roles') })

  const save = useMutation({
    mutationFn: ({ rankId, guildId, roleIds }: { rankId: number; guildId: string; roleIds: string[] }) =>
      api(`/staff-roles/${rankId}/${guildId}`, { method: 'PUT', body: { roleIds } }),
    onSuccess: () => {
      toast.success('Liaison enregistrée. Les rôles seront synchronisés dans quelques secondes.')
      qc.invalidateQueries({ queryKey: ['staff-roles'] })
      qc.invalidateQueries({ queryKey: ['ranks'] })
    },
  })
  const sync = useMutation({
    mutationFn: () => api<{ changed: number }>('/staff-roles/sync', { method: 'POST' }),
    onSuccess: (r) => toast.success(r.changed ? `${r.changed} membre(s) mis à jour` : 'Tout est déjà à jour'),
  })

  return (
    <Page
      title='Rôles du staff'
      description='Pour chaque rang, choisis le rôle qui le représente sur chaque serveur. Sur le serveur principal, ce rôle donne le rang ; sur les autres, le bot donne ou retire automatiquement le rôle selon le rang de chacun.'
      actions={manage && <Button variant='outline' onClick={() => sync.mutate()} disabled={sync.isPending}><RefreshCw className={sync.isPending ? 'animate-spin' : undefined} /> Tout resynchroniser</Button>}
    >
      {isLoading && <Skeleton className='h-64 w-full' />}
      {data && !data.ranks.length && <Section title='Aucun rang'><EmptyState title='Crée d’abord des rangs'>Page « Rangs ».</EmptyState></Section>}
      {data && data.ranks.length > 0 && (
        <Section title={`${data.ranks.length} rang${data.ranks.length > 1 ? 's' : ''} × ${data.guilds.length} serveur${data.guilds.length > 1 ? 's' : ''}`}>
          <div className='overflow-x-auto'>
            <table className='w-full min-w-[40rem] text-sm'>
              <thead>
                <tr className='border-b text-start'>
                  <th scope='col' className='px-4 py-2 text-start font-medium'>Rang</th>
                  {data.guilds.map((g) => (
                    <th key={g.id} scope='col' className='px-4 py-2 text-start font-medium'>
                      <span className='inline-flex items-center gap-1'>{g.isMain && <Crown className='size-3.5 text-primary' />}{g.name}</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className='divide-y'>
                {data.ranks.map((rank) => {
                  const editable = manage && rank.level < myLevel
                  return (
                    <tr key={rank.id}>
                      <th scope='row' className='px-4 py-2 text-start font-normal'><RankBadge name={rank.name} color={rank.color} /></th>
                      {data.guilds.map((guild) => {
                        const selected = guild.links[rank.id] ?? []
                        const names = selected.map((id) => guild.roles.find((r) => r.id === id)?.name ?? '?')
                        return (
                          <td key={guild.id} className='px-4 py-2'>
                            <Popover>
                              <PopoverTrigger asChild disabled={!editable}>
                                <Button variant='ghost' size='sm' className='h-auto max-w-56 justify-start px-2 py-1 text-start whitespace-normal'>
                                  {names.length ? names.map((n) => `@${n}`).join(', ') : <span className='text-muted-foreground'>{editable ? 'Choisir…' : '—'}</span>}
                                </Button>
                              </PopoverTrigger>
                              <PopoverContent className='max-h-72 w-64 overflow-y-auto p-1'>
                                {guild.roles.map((role) => {
                                  const checked = selected.includes(role.id)
                                  return (
                                    <label key={role.id} className='flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent has-disabled:opacity-50'>
                                      <Checkbox
                                        checked={checked}
                                        disabled={!role.editable || save.isPending}
                                        onCheckedChange={() => save.mutate({
                                          rankId: rank.id,
                                          guildId: guild.id,
                                          roleIds: checked ? selected.filter((id) => id !== role.id) : [...selected, role.id],
                                        })}
                                      />
                                      <span aria-hidden className='size-2 rounded-full' style={{ background: role.color === '#000000' ? 'var(--muted-foreground)' : role.color }} />
                                      <span className='truncate'>{role.name}</span>
                                      {!role.editable && <span className='ms-auto text-xs text-muted-foreground'>trop haut</span>}
                                    </label>
                                  )
                                })}
                              </PopoverContent>
                            </Popover>
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </Page>
  )
}
