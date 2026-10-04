import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CalendarClock, Headphones, History, LifeBuoy, MessageSquare, Trophy, UserPlus } from 'lucide-react'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Section, EmptyState, Pill, StatCards, UserAvatar } from '@/components/app/ui'
import { Skeleton } from '@/components/ui/skeleton'

type Person = { name: string | null; avatar: string | null } | null
type Insights = {
  accountCreatedAt: number | null
  activity: {
    allTime: { messages: number; voiceHours: number; days: number; first: string | null; last: string | null }
    last30: { messages: number; voiceHours: number; days: number; rank: number } | null
    byGuild: { guildId: string; guildName: string; messages: number; voiceHours: number; last: string }[]
    topChannels: { guildId: string; guildName: string; channelId: string; name: string | null; messages: number; voiceHours: number }[]
  }
  invites: { invitedBy: { guildId: string; guildName: string; inviterId: string; inviter: Person; at: number }[]; invitedPeople: number }
  movements: { joins: number; leaves: number }
  names: { at: number; guildName: string; type: string; details: { before?: string | null; after?: string | null; changes?: { name: string; value: string }[] } | null }[]
  tickets: { total: number; open: number; rating: number | null; last: { id: number; guildName: string; number: number; subject: string | null; status: string; createdAt: number }[] }
  staff: { ticketsHandled: number; ticketsClosed: number; sanctionsGiven: number }
  applications: { id: number; status: string; createdAt: number; position: string | null }[]
  absences: { id: number; startAt: number; endAt: number; status: string; reason: string | null }[]
  dm: { id: number; status: string; lastMessageAt: number; messages: number } | null
  timeline: { id: number; at: number; guildName: string; category: string; type: string; summary: string; actor: Person }[]
}

const APPLICATION: Record<string, string> = { received: 'Reçue', review: 'En étude', interview: 'Entretien', accepted: 'Acceptée', rejected: 'Refusée', withdrawn: 'Retirée' }
const ABSENCE: Record<string, string> = { pending: 'En attente', approved: 'Prévue', active: 'En cours', ended: 'Terminée', rejected: 'Refusée', cancelled: 'Annulée' }
const DAY_LABEL = (day: string | null) => (day ? new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR') : '—')

// When a Discord account (or anything with an ID) was created
export function snowflakeTime(id: string) {
  try {
    return Number((BigInt(id) >> 22n) + 1420070400000n)
  }
  catch {
    return null
  }
}

// Age of something, in words ("3 ans et 2 mois", "12 jours")
export function age(from: number, to: number) {
  const days = Math.max(0, Math.floor((to - from) / 86_400_000))
  if (days < 31) return `${days} jour${days > 1 ? 's' : ''}`
  const months = Math.floor(days / 30.44)
  if (months < 12) return `${months} mois`
  const years = Math.floor(months / 12)
  const rest = months % 12
  return `${years} an${years > 1 ? 's' : ''}${rest ? ` et ${rest} mois` : ''}`
}

export function MemberInsights({ userId }: { userId: string }) {
  const { can } = useMe()
  const { data, dataUpdatedAt } = useQuery({ queryKey: ['person-insights', userId], queryFn: () => api<Insights>(`/people/${userId}/insights`) })
  if (!data) return <Skeleton className='h-64 w-full' />
  const { activity } = data
  const isStaff = data.staff.ticketsHandled + data.staff.sanctionsGiven > 0

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
      <StatCards items={[
        { label: 'Messages (30 j)', value: activity.last30?.messages ?? 0, icon: MessageSquare, tone: 'accent' },
        { label: 'Heures de vocal (30 j)', value: Math.round(activity.last30?.voiceHours ?? 0), icon: Headphones, tone: 'info' },
        { label: 'Jours actifs (30 j)', value: activity.last30?.days ?? 0, icon: CalendarClock, tone: 'success' },
        { label: 'Classement messages', value: activity.last30?.messages ? activity.last30.rank : 0, icon: Trophy, tone: 'warning' },
      ]} />

      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
        <Section title='Activité' description={`Depuis le ${DAY_LABEL(activity.allTime.first)} : ${activity.allTime.messages.toLocaleString('fr-FR')} messages, ${Math.round(activity.allTime.voiceHours * 10) / 10} h de vocal, ${activity.allTime.days} jours actifs. Dernière activité le ${DAY_LABEL(activity.allTime.last)}.`}>
          {!activity.topChannels.length ? <EmptyState title='Aucune activité enregistrée' /> : (
            <div className='grid gap-4 p-4'>
              <div>
                <p className='mb-2 text-xs font-medium text-muted-foreground'>Salons préférés</p>
                <ul className='grid gap-1.5'>
                  {activity.topChannels.map((c) => (
                    <li key={`${c.guildId}-${c.channelId}`} className='flex items-center justify-between gap-3 text-sm'>
                      <span className='min-w-0 truncate'>{c.voiceHours > 0 && !c.messages ? '🔊' : '#'} {c.name ?? c.channelId} <span className='text-xs text-muted-foreground'>· {c.guildName}</span></span>
                      <span className='shrink-0 text-xs text-muted-foreground tabular-nums'>{c.messages ? `${c.messages} msg` : ''}{c.messages && c.voiceHours ? ' · ' : ''}{c.voiceHours ? `${c.voiceHours} h` : ''}</span>
                    </li>
                  ))}
                </ul>
              </div>
              {activity.byGuild.length > 1 && (
                <div>
                  <p className='mb-2 text-xs font-medium text-muted-foreground'>Par serveur</p>
                  <ul className='grid gap-1.5'>
                    {activity.byGuild.map((g) => (
                      <li key={g.guildId} className='flex justify-between gap-3 text-sm'><span className='truncate'>{g.guildName}</span><span className='shrink-0 text-xs text-muted-foreground tabular-nums'>{g.messages} msg · {g.voiceHours} h · vu le {DAY_LABEL(g.last)}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </Section>

        <Section title='Arrivée et invitations' description={`${data.movements.joins} arrivée${data.movements.joins > 1 ? 's' : ''} et ${data.movements.leaves} départ${data.movements.leaves > 1 ? 's' : ''} enregistrés sur le réseau.`}>
          <div className='grid gap-3 p-4 text-sm'>
            {data.accountCreatedAt && <p>Compte Discord créé le {new Date(data.accountCreatedAt).toLocaleDateString('fr-FR')} (il y a {age(data.accountCreatedAt, dataUpdatedAt)}).</p>}
            {data.invites.invitedBy.length ? data.invites.invitedBy.map((i) => (
              <p key={i.guildId} className='flex flex-wrap items-center gap-1.5'>
                <UserPlus className='size-4 text-muted-foreground' /> Invité sur {i.guildName} par
                <Link to='/people' search={{ id: i.inviterId }} className='inline-flex items-center gap-1 font-medium hover:underline'><UserAvatar src={i.inviter?.avatar} name={i.inviter?.name ?? '?'} className='size-4' />{i.inviter?.name ?? i.inviterId}</Link>
                <span className='text-muted-foreground'>le {dateTime(i.at)}</span>
              </p>
            )) : <p className='text-muted-foreground'>Invitation d’origine inconnue.</p>}
            <p>{data.invites.invitedPeople ? <>A fait venir <strong>{data.invites.invitedPeople}</strong> personne{data.invites.invitedPeople > 1 ? 's' : ''} sur le réseau.</> : 'N’a fait venir personne (d’après les invitations suivies).'}</p>
          </div>
        </Section>

        <Section
          title='Tickets'
          description={`${data.tickets.total} ouvert${data.tickets.total > 1 ? 's' : ''} au total${data.tickets.open ? `, ${data.tickets.open} en cours` : ''}${data.tickets.rating ? ` · note moyenne donnée ★${data.tickets.rating}` : ''}.`}
        >
          {!data.tickets.last.length ? <EmptyState title='Aucun ticket' icon={LifeBuoy} /> : (
            <ul className='divide-y'>
              {data.tickets.last.map((t) => (
                <li key={t.id} className='flex items-center gap-3 px-4 py-2 text-sm'>
                  {can('tickets.view') ? <Link to='/ticket/$id' params={{ id: String(t.id) }} className='min-w-0 flex-1 truncate font-medium hover:underline'>#{t.number} {t.subject ?? 'Sans sujet'}</Link> : <span className='min-w-0 flex-1 truncate'>#{t.number} {t.subject ?? 'Sans sujet'}</span>}
                  <span className='shrink-0 text-xs text-muted-foreground'>{t.guildName} · {dateTime(t.createdAt)}</span>
                  <Pill tone={t.status === 'open' ? 'success' : 'neutral'}>{t.status === 'open' ? 'Ouvert' : 'Fermé'}</Pill>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title='Suivi' description='Candidatures, absences, messages privés avec le bot et activité de staff.'>
          <div className='grid gap-3 p-4 text-sm'>
            {data.applications.length > 0 && (
              <div className='grid gap-1'>
                <p className='text-xs font-medium text-muted-foreground'>Candidatures</p>
                {data.applications.map((a) => <p key={a.id}>{a.position ?? 'Poste supprimé'} · {dateTime(a.createdAt)} <Pill tone={a.status === 'accepted' ? 'success' : a.status === 'rejected' ? 'danger' : 'info'}>{APPLICATION[a.status] ?? a.status}</Pill></p>)}
              </div>
            )}
            {data.absences.length > 0 && (
              <div className='grid gap-1'>
                <p className='text-xs font-medium text-muted-foreground'>Absences</p>
                {data.absences.map((a) => <p key={a.id}>Du {new Date(a.startAt).toLocaleDateString('fr-FR')} au {new Date(a.endAt).toLocaleDateString('fr-FR')} <Pill tone={a.status === 'active' ? 'warning' : 'neutral'}>{ABSENCE[a.status] ?? a.status}</Pill>{a.reason ? <span className='text-muted-foreground'> · {a.reason}</span> : null}</p>)}
              </div>
            )}
            {data.dm && (
              <p>Conversation privée avec le bot : {data.dm.messages} message{data.dm.messages > 1 ? 's' : ''}, dernier le {dateTime(data.dm.lastMessageAt)}{can('dm.view') && <> · <Link to='/dms' className='text-primary hover:underline'>ouvrir</Link></>}</p>
            )}
            {isStaff && <p>Staff : {data.staff.ticketsHandled} ticket{data.staff.ticketsHandled > 1 ? 's' : ''} pris en charge, {data.staff.ticketsClosed} fermé{data.staff.ticketsClosed > 1 ? 's' : ''}, {data.staff.sanctionsGiven} sanction{data.staff.sanctionsGiven > 1 ? 's' : ''} données.</p>}
            {!data.applications.length && !data.absences.length && !data.dm && !isStaff && <p className='text-muted-foreground'>Rien de particulier.</p>}
          </div>
        </Section>
      </div>

      {data.names.length > 0 && (
        <Section title='Anciens noms' description='Changements de pseudo Discord et de surnom sur les serveurs.'>
          <ul className='divide-y'>
            {data.names.map((n, i) => (
              <li key={i} className='flex flex-wrap items-center gap-2 px-4 py-2 text-sm'>
                <span className='text-xs text-muted-foreground tabular-nums'>{dateTime(n.at)}</span>
                {n.type === 'member_nickname'
                  ? <span>Surnom sur {n.guildName} : <s className='text-muted-foreground'>{n.details?.before ?? 'aucun'}</s> → <strong>{n.details?.after ?? 'aucun'}</strong></span>
                  : <span>{n.details?.changes?.map((c) => `${c.name} : ${c.value}`).join(' · ')}</span>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title='Derniers événements' description='Ce que le bot a vu le concernant (arrivées, rôles, vocal, messages supprimés…).'>
        {!data.timeline.length ? <EmptyState title='Rien d’enregistré' icon={History} /> : (
          <ol className='divide-y'>
            {data.timeline.map((e) => (
              <li key={e.id} className='flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2 text-sm'>
                <span className='w-32 shrink-0 text-xs text-muted-foreground tabular-nums'>{dateTime(e.at)}</span>
                <span className='min-w-0 flex-1 [overflow-wrap:anywhere]'>{e.summary}</span>
                <span className='text-xs text-muted-foreground'>{e.guildName}{e.actor?.name ? ` · par ${e.actor.name}` : ''}</span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}
