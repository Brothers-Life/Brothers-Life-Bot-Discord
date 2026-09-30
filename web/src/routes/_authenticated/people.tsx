import { useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { PersonProfile, Role } from '@/lib/types'
import { dateTime, userName } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, RankBadge, UserAvatar } from '@/components/app/ui'
import { TempRoles } from '@/features/people/temp-roles'
import { SanctionDialog } from '@/features/sanctions/sanction-dialog'
import { UserPicker } from '@/components/app/user-picker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/people')({
  validateSearch: (search: Record<string, unknown>) => ({
    id: typeof search.id === 'string' ? search.id : undefined,
  }),
  component: PeoplePage,
})

function PeoplePage() {
  const { id } = Route.useSearch()
  const navigate = useNavigate({ from: '/people' })

  return (
    <Page title='Membres du réseau' description='Retrouve quelqu’un sur tous les serveurs du réseau : ses rôles, ses rangs et ses sanctions.'>
      <UserPicker
        className='max-w-xl'
        value={id ?? ''}
        autoFocus={!id}
        placeholder='Pseudo, surnom ou ID Discord'
        onChange={(userId) => navigate({ search: { id: userId || undefined } })}
      />
      {id ? <Profile userId={id} /> : (
        <EmptyState title='Tape le début d’un pseudo'>La recherche porte sur les membres de tous les serveurs du réseau. Un ID Discord marche aussi.</EmptyState>
      )}
    </Page>
  )
}

function Profile({ userId }: { userId: string }) {
  const { can } = useMe()
  const [sanctioning, setSanctioning] = useState(false)
  const { data, isLoading, error } = useQuery({ queryKey: ['person', userId], queryFn: () => api<PersonProfile>(`/people/${userId}`) })

  if (isLoading) return <Skeleton className='h-64 w-full' />
  if (error) return <p className='text-sm text-destructive'>{errorMessage(error)}</p>
  if (!data) return null

  const name = data.user ? userName(data.user) : userId
  const presentOn = data.guilds.filter((g) => g.member)

  return (
    <div className='grid gap-6'>
      <div className='flex flex-wrap items-center gap-4 rounded-lg border bg-card p-4'>
        <UserAvatar src={data.user?.avatar} name={name} className='size-14' />
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-2 text-lg font-semibold'>
            {name}
            {data.isOwner && <Pill tone='accent'><Crown className='size-3' />Chef du réseau</Pill>}
            {data.sanctions.banned && <Pill tone='danger'>Banni du réseau</Pill>}
          </div>
          <div className='text-sm text-muted-foreground'>{userId} · présent sur {presentOn.length}/{data.guilds.length} serveur{data.guilds.length > 1 ? 's' : ''}</div>
          {data.ranks.length > 0 && <div className='mt-2 flex flex-wrap gap-1.5'>{data.ranks.map((r) => <RankBadge key={r.id} name={r.name} color={r.color} />)}</div>}
        </div>
        <div className='flex flex-wrap gap-2'>
          {can('sanctions.view') && (
            <Button variant='outline' asChild>
              <Link to='/sanctions' search={{ user: userId }}>
                {data.sanctions.total} sanction{data.sanctions.total > 1 ? 's' : ''}{data.sanctions.warns ? ` · ${data.sanctions.warns} warn${data.sanctions.warns > 1 ? 's' : ''}` : ''}
              </Link>
            </Button>
          )}
          {['warn', 'restrict', 'timeout', 'kick', 'ban'].some((t) => can(`sanctions.${t}`)) && !data.isOwner && (
            <Button variant='destructive' onClick={() => setSanctioning(true)}>Sanctionner</Button>
          )}
        </div>
      </div>

      {data.guilds.map((guild) => <GuildMembership key={guild.id} userId={userId} guild={guild} />)}
      {sanctioning && <SanctionDialog userId={userId} onClose={() => setSanctioning(false)} />}
    </div>
  )
}

function isFuture(at: number | null) {
  return Boolean(at && at > Date.now())
}

function GuildMembership({ userId, guild }: { userId: string; guild: PersonProfile['guilds'][number] }) {
  const { can } = useMe()
  const manage = can('members.manage')
  const qc = useQueryClient()
  const [nickname, setNickname] = useState<string | null>(null)

  const roles = useQuery({
    queryKey: ['guild-roles', guild.id],
    queryFn: () => api<{ guilds: { id: string; roles: Role[]; links: Record<string, string[]> }[] }>('/staff-roles').then((d) => d.guilds.find((g) => g.id === guild.id)),
    enabled: (manage || can('commands.roles')) && Boolean(guild.member),
  })
  const linked = new Set(Object.values(roles.data?.links ?? {}).flat())

  const refresh = () => qc.invalidateQueries({ queryKey: ['person', userId] })
  const changeRole = useMutation({
    mutationFn: ({ roleId, add }: { roleId: string; add: boolean }) => api(`/people/${userId}/guilds/${guild.id}/roles`, { method: 'POST', body: { roleId, add } }),
    onSuccess: (_, { add }) => {
      toast.success(add ? 'Rôle ajouté' : 'Rôle retiré')
      refresh()
    },
  })
  const saveNickname = useMutation({
    mutationFn: (value: string) => api(`/people/${userId}/guilds/${guild.id}/nickname`, { method: 'PUT', body: { nickname: value.trim() || null } }),
    onSuccess: () => {
      toast.success('Pseudo modifié')
      setNickname(null)
      refresh()
    },
  })

  const member = guild.member
  const addable = (roles.data?.roles ?? []).filter((r) => r.editable && !r.dangerous && !linked.has(r.id) && !member?.roles.some((m) => m.id === r.id))

  return (
    <Section
      title={guild.name}
      description={member ? `Arrivé le ${dateTime(member.joinedAt)}${isFuture(member.timeoutUntil) ? ` · en timeout jusqu’au ${dateTime(member.timeoutUntil)}` : ''}` : 'N’est pas membre de ce serveur.'}
      actions={guild.isMain ? <Pill tone='accent'><Crown className='size-3' />Principal</Pill> : undefined}
    >
      {member && (
        <div className='grid gap-4 p-4'>
          <form
            className='flex flex-wrap items-center gap-2 text-sm'
            onSubmit={(e) => {
              e.preventDefault()
              if (nickname !== null) saveNickname.mutate(nickname)
            }}
          >
            <label htmlFor={`nick-${guild.id}`} className='text-muted-foreground'>Pseudo</label>
            <Input id={`nick-${guild.id}`} value={nickname ?? member.nickname ?? ''} placeholder='aucun' onChange={(e) => setNickname(e.target.value)} disabled={!manage} maxLength={32} className='h-8 w-56' />
            {nickname !== null && nickname !== (member.nickname ?? '') && <Button size='sm' type='submit' disabled={saveNickname.isPending}>Enregistrer</Button>}
          </form>
          <div className='flex flex-wrap items-center gap-1.5'>
            {!member.roles.length && <span className='text-sm text-muted-foreground'>Aucun rôle</span>}
            {member.roles.map((role) => (
              <span key={role.id} className='inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs'>
                <span aria-hidden className='size-2 rounded-full' style={{ background: role.color === '#000000' ? 'var(--muted-foreground)' : role.color }} />
                {role.name}
                {role.linkedToRank && <span className='text-muted-foreground'>(rang)</span>}
                {manage && role.editable && !role.linkedToRank && (
                  <button type='button' aria-label={`Retirer ${role.name}`} className='ms-0.5 rounded hover:text-destructive' onClick={() => changeRole.mutate({ roleId: role.id, add: false })}>
                    <X className='size-3' />
                  </button>
                )}
              </span>
            ))}
            {manage && addable.length > 0 && (
              <Popover>
                <PopoverTrigger asChild>
                  <Button size='sm' variant='outline' className='h-6 px-2 text-xs'><Plus className='size-3' /> Rôle</Button>
                </PopoverTrigger>
                <PopoverContent className='max-h-72 w-60 overflow-y-auto p-1'>
                  {addable.map((role) => (
                    <button
                      key={role.id}
                      type='button'
                      className='flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-sm hover:bg-accent'
                      onClick={() => changeRole.mutate({ roleId: role.id, add: true })}
                    >
                      <span aria-hidden className='size-2 rounded-full' style={{ background: role.color === '#000000' ? 'var(--muted-foreground)' : role.color }} />
                      {role.name}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
          <TempRoles userId={userId} guildId={guild.id} roles={roles.data?.roles ?? []} />
          {manage && <p className='text-xs text-muted-foreground'>Les rôles liés à un rang se gèrent par les rangs. Les rôles de modération ou d’administration ne peuvent être donnés que par le chef du réseau.</p>}
        </div>
      )}
    </Section>
  )
}
