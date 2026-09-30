import { useDeferredValue, useEffect, useRef, useState } from 'react'
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Bot, Crown, Gem, Headphones, Plus, Search, Sparkles, Timer, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import type { PersonProfile, Role } from '@/lib/types'
import { dateTime, userName } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, RankBadge, UserAvatar } from '@/components/app/ui'
import { TempRoles } from '@/features/people/temp-roles'
import { MemberInsights, age, snowflakeTime } from '@/features/people/insights'
import { SanctionDialog } from '@/features/sanctions/sanction-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'

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
    <Page
      title='Membres du réseau'
      description='Tous les membres des serveurs du réseau. Clique sur quelqu’un pour voir ses rôles, ses rangs et ses sanctions.'
      actions={id && <Button variant='outline' onClick={() => navigate({ search: { id: undefined } })}><ArrowLeft /> Tous les membres</Button>}
    >
      {id ? <Profile userId={id} /> : <Directory onOpen={(userId) => navigate({ search: { id: userId } })} />}
    </Page>
  )
}

type DirectoryMember = {
  id: string; username: string; globalName: string | null; nickname: string | null; avatar: string | null; bot: boolean; joinedAt: number | null; guilds: { id: string; name: string }[]
  accountCreatedAt: number | null; boosting?: boolean; inVoice?: boolean; timedOut?: boolean; topRole?: { name: string; color: string | null } | null
}
type DirectoryPage = { guilds: { id: string; name: string }[]; items: DirectoryMember[]; total: number; nextOffset: number | null }

function Directory({ onOpen }: { onOpen: (userId: string) => void }) {
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const [guildId, setGuildId] = useState('all')
  const [bots, setBots] = useState(false)
  const [filter, setFilter] = useState('all')
  const query = useInfiniteQuery({
    queryKey: ['people-directory', q, guildId, bots, filter],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ offset: String(pageParam), limit: '50' })
      if (q) params.set('q', q)
      if (guildId !== 'all') params.set('guildId', guildId)
      if (bots) params.set('bots', 'true')
      if (filter !== 'all') params.set('filter', filter)
      return api<DirectoryPage>(`/people?${params}`)
    },
    getNextPageParam: (last) => last.nextOffset ?? undefined,
    placeholderData: keepPreviousData,
  })
  const pages = query.data?.pages ?? []
  const now = query.dataUpdatedAt
  const members = pages.flatMap((p) => p.items)
  const total = pages[0]?.total ?? 0
  const guilds = pages[0]?.guilds ?? []

  // Next page as soon as the end of the list comes into view
  const sentinel = useRef<HTMLLIElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    const node = sentinel.current
    if (!node || !hasNextPage) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !isFetchingNextPage) fetchNextPage()
    }, { rootMargin: '400px' })
    observer.observe(node)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, members.length])

  return (
    <Section
      title={query.isLoading ? 'Chargement des membres…' : `${total.toLocaleString('fr-FR')} membre${total > 1 ? 's' : ''}`}
      actions={
        <div className='flex flex-wrap items-center gap-2'>
          <div className='relative'>
            <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
            <Input value={text} onChange={(e) => setText(e.target.value)} placeholder='Pseudo, surnom ou ID' aria-label='Filtrer les membres' className='w-56 ps-8' autoFocus />
          </div>
          {guilds.length > 1 && (
            <Select value={guildId} onValueChange={setGuildId}>
              <SelectTrigger className='w-44' aria-label='Serveur'><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value='all'>Tous les serveurs</SelectItem>
                {guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className='w-44' aria-label='Filtre'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='all'>Tout le monde</SelectItem>
              <SelectItem value='voice'>En vocal maintenant</SelectItem>
              <SelectItem value='boosters'>Boosters</SelectItem>
              <SelectItem value='new'>Comptes de moins de 30 j</SelectItem>
              <SelectItem value='timedout'>Exclus (timeout)</SelectItem>
            </SelectContent>
          </Select>
          <label className='flex items-center gap-2 text-sm'><Switch checked={bots} onCheckedChange={setBots} /> Bots</label>
        </div>
      }
    >
      {query.isLoading ? (
        <div className='grid gap-2 p-4'>{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className='h-12 w-full' />)}</div>
      ) : query.error ? (
        <p className='p-4 text-sm text-destructive'>{errorMessage(query.error)}</p>
      ) : !members.length ? (
        <EmptyState title='Personne ne correspond' icon={Users}>Essaie une autre partie du pseudo, ou un autre serveur.</EmptyState>
      ) : (
        <ul className={cn('divide-y transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          {members.map((m) => {
            const name = m.nickname || m.globalName || m.username
            return (
              <li key={m.id}>
                <button type='button' onClick={() => onOpen(m.id)} className='flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none'>
                  <UserAvatar src={m.avatar} name={name} className='size-9' />
                  <div className='min-w-0 flex-1'>
                    <div className='flex items-center gap-1.5 truncate font-medium'>
                      <span className='truncate' style={m.topRole?.color ? { color: m.topRole.color } : undefined}>{name}</span>
                      {m.bot && <Pill tone='info'><Bot className='size-3' />Bot</Pill>}
                      {m.boosting && <Gem className='size-3.5 shrink-0 text-[#f47fff]' aria-label='Booste le serveur' />}
                      {m.inVoice && <Headphones className='size-3.5 shrink-0 text-success' aria-label='En vocal' />}
                      {m.timedOut && <Timer className='size-3.5 shrink-0 text-warning' aria-label='En timeout' />}
                      {m.accountCreatedAt && now - m.accountCreatedAt < 30 * 86_400_000 && <Pill tone='warning'><Sparkles className='size-3' />compte récent</Pill>}
                    </div>
                    <div className='truncate text-xs text-muted-foreground'>@{m.username}{m.topRole ? ` · ${m.topRole.name}` : ''}{m.joinedAt ? ` · arrivé le ${new Date(m.joinedAt).toLocaleDateString('fr-FR')}` : ''}{m.accountCreatedAt ? ` · compte de ${age(m.accountCreatedAt, now)}` : ''}</div>
                  </div>
                  {guilds.length > 1 && (
                    <div className='hidden max-w-[40%] flex-wrap justify-end gap-1 sm:flex'>
                      {m.guilds.map((g) => <Pill key={g.id} tone='neutral'>{g.name}</Pill>)}
                    </div>
                  )}
                </button>
              </li>
            )
          })}
          {hasNextPage && (
            <li ref={sentinel} className='grid gap-2 p-4' aria-live='polite'>
              <Skeleton className='h-12 w-full' /><span className='sr-only'>Chargement de la suite…</span>
            </li>
          )}
        </ul>
      )}
    </Section>
  )
}

function Profile({ userId }: { userId: string }) {
  const { can } = useMe()
  const [sanctioning, setSanctioning] = useState(false)
  const { data, isLoading, error, dataUpdatedAt } = useQuery({ queryKey: ['person', userId], queryFn: () => api<PersonProfile>(`/people/${userId}`) })

  if (isLoading) return <Skeleton className='h-64 w-full' />
  if (error) return <p className='text-sm text-destructive'>{errorMessage(error)}</p>
  if (!data) return null

  const name = data.user ? userName(data.user) : userId
  const presentOn = data.guilds.filter((g) => g.member)
  const created = snowflakeTime(userId)
  const boosting = presentOn.filter((g) => g.member?.boostingSince)
  const inVoice = presentOn.find((g) => g.member?.voice)

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <div className='overflow-hidden rounded-lg border bg-card'>
        <div className='h-24 bg-gradient-to-r from-primary/30 via-primary/10 to-transparent sm:h-32' style={data.user?.banner ? { backgroundImage: `url(${data.user.banner})`, backgroundSize: 'cover', backgroundPosition: 'center' } : data.user?.accentColor ? { background: data.user.accentColor } : undefined} aria-hidden />
      <div className='flex flex-wrap items-end gap-4 px-4 pb-4'>
        <UserAvatar src={data.user?.avatar} name={name} className='-mt-10 size-20 border-4 border-card' />
        <div className='min-w-0 flex-1 pt-2'>
          <div className='flex flex-wrap items-center gap-2 text-lg font-semibold'>
            {name}
            {data.user?.bot && <Pill tone='info'><Bot className='size-3' />Bot</Pill>}
            {data.isOwner && <Pill tone='accent'><Crown className='size-3' />Chef du réseau</Pill>}
            {data.sanctions.banned && <Pill tone='danger'>Banni du réseau</Pill>}
            {data.sanctions.active.length > 0 && <Pill tone='warning'>{data.sanctions.active.length} sanction{data.sanctions.active.length > 1 ? 's' : ''} en cours</Pill>}
            {boosting.length > 0 && <Pill tone='accent'><Gem className='size-3' />booste {boosting.map((g) => g.name).join(', ')}</Pill>}
            {inVoice?.member?.voice && <Pill tone='success'><Headphones className='size-3' />en vocal : {inVoice.member.voice.channelName ?? 'salon'} ({inVoice.name})</Pill>}
          </div>
          <div className='text-sm text-muted-foreground'>
            @{data.user?.username ?? '?'} · {userId} · présent sur {presentOn.length}/{data.guilds.length} serveur{data.guilds.length > 1 ? 's' : ''}
            {created && <> · compte créé le {new Date(created).toLocaleDateString('fr-FR')} (il y a {age(created, dataUpdatedAt)})</>}
          </div>
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
      </div>


      {data.guilds.map((guild) => <GuildMembership key={guild.id} userId={userId} guild={guild} />)}
      <MemberInsights userId={userId} />
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
      description={member ? [
        `Arrivé le ${dateTime(member.joinedAt)}`,
        isFuture(member.timeoutUntil) ? `en timeout jusqu’au ${dateTime(member.timeoutUntil)}` : null,
        member.boostingSince ? `booste depuis le ${new Date(member.boostingSince).toLocaleDateString('fr-FR')}` : null,
        member.voice ? `en vocal dans ${member.voice.channelName ?? 'un salon'}${member.voice.streaming ? ' (partage d’écran)' : ''}${member.voice.muted ? ' · micro coupé' : ''}` : null,
        member.pending ? 'n’a pas encore validé les règles du serveur' : null,
      ].filter(Boolean).join(' · ') : 'N’est pas membre de ce serveur.'}
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
            {nickname !== null && nickname !== (member.nickname ?? '') && <Button loading={saveNickname.isPending} size='sm' type='submit' disabled={saveNickname.isPending}>Enregistrer</Button>}
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
