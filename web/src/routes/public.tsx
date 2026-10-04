import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { CalendarDays, ExternalLink, MapPin, ShoppingBag, Users, Wrench, RotateCw } from 'lucide-react'
import { api, ApiError } from '@/lib/api'
import { duration } from '@/lib/format'
import { BrandMark } from '@/components/app/brand-mark'
import { RichText } from '@/features/public-page/rich-text'
import type { PublicServer, PublicView } from '@/features/public-page/types'

export const Route = createFileRoute('/public')({
  component: PublicPage,
})

const BACKGROUND = '/brand/sunset-road.webp'

function useNow(every = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every)
    return () => clearInterval(id)
  }, [every])
  return now
}

function DiscordIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg viewBox='0 0 24 24' aria-hidden className={`${className} fill-current`}>
      <path d='M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.3 18.3 0 0 0-5.6 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.8-9.7-3.6-13.7ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z' />
    </svg>
  )
}

function PublicPage() {
  const { data, error, isLoading } = useQuery({
    queryKey: ['public-page'],
    queryFn: () => api<PublicView>('/public-page'),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    if (data?.title) document.title = data.title
  }, [data?.title])

  return (
    <div className='dark min-h-svh bg-[#0a0705] font-sans text-[#fff3e6]'>
      {isLoading && <div className='grid min-h-svh place-items-center'><BrandMark className='size-20' /></div>}
      {error && <Unavailable missing={error instanceof ApiError && error.status === 404} />}
      {data && <PublicContent view={data} />}
    </div>
  )
}

function Unavailable({ missing }: { missing: boolean }) {
  return (
    <main className='grid min-h-svh place-items-center px-6 text-center'>
      <div className='grid justify-items-center gap-4'>
        <BrandMark className='size-16' />
        <h1 className='font-display text-2xl font-semibold tracking-wide'>{missing ? 'Cette page n’est pas disponible' : 'Impossible de charger la page'}</h1>
        <p className='max-w-sm text-[rgba(255,243,230,0.6)]'>{missing ? 'Elle n’est pas ouverte au public pour le moment.' : 'Le serveur ne répond pas. Réessaie dans un instant.'}</p>
      </div>
    </main>
  )
}

function PublicContent({ view }: { view: PublicView }) {
  const servers = view.status ?? []
  const maintenance = view.maintenance
  const links = view.links
  return (
    <>
      {/* Hero: the sunset of the loading screen, the server name, the live state of the city */}
      <header className='relative isolate overflow-hidden'>
        <img src={BACKGROUND} alt='' aria-hidden className='ken-burns absolute inset-0 -z-20 size-full object-cover' />
        <div aria-hidden className='absolute inset-0 -z-10 bg-[linear-gradient(to_bottom,rgba(10,7,5,0.55)_0%,rgba(10,7,5,0.35)_40%,#0a0705_100%)]' />
        <div className='mx-auto grid max-w-6xl gap-10 px-4 pt-10 pb-14 sm:px-6 md:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] md:items-end md:pt-24 md:pb-20'>
          <div className='page-enter grid gap-5'>
            <BrandMark className='size-16 sm:size-20' />
            <h1 className='font-display text-5xl leading-[0.9] font-bold tracking-[0.04em] uppercase sm:text-7xl'>{view.title}</h1>
            {view.tagline && <p className='max-w-xl text-lg text-[rgba(255,243,230,0.8)]'>{view.tagline}</p>}
            {links && (links.discordInvite || links.shop) && (
              <div className='flex flex-wrap gap-3 pt-2'>
                {links.discordInvite && (
                  <a href={links.discordInvite} target='_blank' rel='noopener noreferrer' className='inline-flex h-11 items-center gap-2 rounded-md bg-[#5865f2] px-5 font-medium text-white shadow-[0_8px_24px_-8px_#5865f2] transition-colors hover:bg-[#4752c4] focus-visible:ring-2 focus-visible:ring-[#ffb968] focus-visible:outline-none'>
                    <DiscordIcon /> Rejoindre le Discord
                  </a>
                )}
                {links.shop && (
                  <a href={links.shop} target='_blank' rel='noopener noreferrer' className='inline-flex h-11 items-center gap-2 rounded-md border border-[rgba(255,150,40,0.45)] bg-[rgba(14,10,6,0.6)] px-5 font-medium backdrop-blur transition-colors hover:border-[#ff9628] focus-visible:ring-2 focus-visible:ring-[#ffb968] focus-visible:outline-none'>
                    <ShoppingBag className='size-4 text-[#ff9628]' /> Boutique
                  </a>
                )}
              </div>
            )}
          </div>
          {(servers.length > 0 || maintenance) && (
            <div className='grid gap-3'>
              {maintenance && <MaintenancePlate state={maintenance} />}
              {servers.map((s) => <ServerPlate key={s.name} server={s} />)}
            </div>
          )}
        </div>
      </header>

      <main className='mx-auto grid max-w-6xl gap-16 px-4 pb-16 sm:px-6 [&>*]:min-w-0'>
        {view.discord && view.discord.guilds.length > 0 && <DiscordBlock discord={view.discord} />}
        {view.events && view.events.length > 0 && <EventsBlock events={view.events} />}
        {view.staff && view.staff.length > 0 && <StaffBlock staff={view.staff} />}
        {view.recruitment && view.recruitment.length > 0 && <RecruitmentBlock positions={view.recruitment} />}
        {view.rules && view.rules.length > 0 && (
          <Block title='Règlement'>
            <div className='brackets rounded-lg border border-[rgba(255,150,40,0.16)] bg-[#120d08] p-5 sm:p-8'>
              <RichText blocks={view.rules} />
            </div>
          </Block>
        )}
      </main>

      <footer className='border-t border-[rgba(255,150,40,0.14)]'>
        <div className='mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-6 text-sm text-[rgba(255,243,230,0.55)] sm:px-6'>
          <span className='flex items-center gap-2'><BrandMark still className='size-6' /> {view.title}</span>
          {links && links.items.length > 0 && (
            <nav aria-label='Liens' className='flex flex-wrap gap-x-5 gap-y-2'>
              {links.items.map((l) => (
                <a key={l.url} href={l.url} target='_blank' rel='noopener noreferrer' className='inline-flex items-center gap-1 hover:text-[#ffb968]'>
                  {l.label}<ExternalLink className='size-3' aria-hidden />
                </a>
              ))}
            </nav>
          )}
        </div>
      </footer>
    </>
  )
}

function Block({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className='grid gap-6'>
      <div className='flex flex-wrap items-end justify-between gap-3'>
        <h2 className='flex items-center gap-3 font-display text-2xl font-semibold tracking-[0.05em] uppercase sm:text-3xl'>
          <span aria-hidden className='h-6 w-[3px] rounded-full bg-[#ff9628] shadow-[0_0_10px_#ff9628]' />
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

// The memorable piece: the city's occupancy as a gauge of seats
function ServerPlate({ server }: { server: PublicServer }) {
  const now = useNow(60_000)
  const ratio = server.max ? Math.min(server.players / server.max, 1) : 0
  return (
    <div className='brackets rounded-xl border border-[rgba(255,150,40,0.22)] bg-[rgba(14,10,6,0.72)] p-5 shadow-[0_18px_40px_rgba(0,0,0,0.5)] backdrop-blur-md'>
      <div className='flex items-center justify-between gap-3'>
        <span className='truncate font-display text-lg font-semibold tracking-wide'>{server.name}</span>
        <span className={`inline-flex shrink-0 items-center gap-2 text-sm ${server.online ? 'text-[#7ee2a1]' : 'text-[#ff8a8f]'}`}>
          <span aria-hidden className={server.online ? 'live-dot !bg-[#5fd38a] !shadow-[0_0_8px_2px_rgba(95,211,138,0.5)]' : 'inline-block size-2 rounded-full bg-[#f0545a]'} />
          {server.online ? 'En ligne' : 'Hors ligne'}
        </span>
      </div>
      <div className='mt-4 flex items-baseline gap-2 font-display'>
        <span className='text-6xl leading-none font-bold tabular-nums'>{server.players}</span>
        <span className='text-2xl text-[rgba(255,243,230,0.5)] tabular-nums'>/ {server.max || '—'}</span>
        <span className='ml-1 text-sm text-[rgba(255,243,230,0.6)]'>joueurs</span>
      </div>
      <div
        role='meter' aria-label='Places occupées' aria-valuemin={0} aria-valuemax={server.max || 0} aria-valuenow={server.players}
        className='mt-3 h-2 overflow-hidden rounded-full bg-[rgba(255,243,230,0.08)]'
      >
        <div className='h-full rounded-full bg-gradient-to-r from-[#ff9628] to-[#ffb968] shadow-[0_0_12px_#ff9628] transition-[width] duration-700' style={{ width: `${ratio * 100}%` }} />
      </div>
      <div className='mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-[rgba(255,243,230,0.6)]'>
        <span>{server.online && server.onlineSince ? `En ligne depuis ${duration(now - server.onlineSince)}` : server.online ? 'En ligne' : 'Le serveur ne répond pas'}</span>
        {server.joinUrl && server.online && (
          <a href={server.joinUrl} target='_blank' rel='noopener noreferrer' className='inline-flex h-9 items-center rounded-md bg-[#ff9628] px-4 font-medium text-[#1a0f04] transition-colors hover:bg-[#ffb968] focus-visible:ring-2 focus-visible:ring-[#fff3e6] focus-visible:outline-none'>
            Se connecter
          </a>
        )}
      </div>
      {server.playerNames && server.playerNames.length > 0 && (
        <details className='mt-4 text-sm'>
          <summary className='cursor-pointer text-[rgba(255,243,230,0.7)] hover:text-[#ffb968]'>Voir les joueurs connectés</summary>
          <ul className='mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-auto'>
            {server.playerNames.map((name, i) => <li key={i} className='rounded bg-[rgba(255,243,230,0.06)] px-2 py-0.5'>{name}</li>)}
          </ul>
        </details>
      )}
    </div>
  )
}

function Countdown({ at }: { at: number }) {
  const now = useNow()
  const left = Math.max(at - now, 0)
  const h = Math.floor(left / 3_600_000)
  const m = Math.floor((left % 3_600_000) / 60_000)
  const s = Math.floor((left % 60_000) / 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return <span className='font-display tabular-nums'>{h > 0 ? `${h} h ${pad(m)}` : `${pad(m)}:${pad(s)}`}</span>
}

function MaintenancePlate({ state }: { state: NonNullable<PublicView['maintenance']> }) {
  if (state.maintenance.active) {
    return (
      <div role='status' className='flex gap-3 rounded-xl border border-[#f0545a]/50 bg-[rgba(60,12,14,0.75)] p-4 backdrop-blur-md'>
        <Wrench className='mt-0.5 size-5 shrink-0 text-[#ff8a8f]' aria-hidden />
        <div>
          <p className='font-display text-lg font-semibold tracking-wide'>Maintenance en cours</p>
          <p className='text-sm text-[rgba(255,243,230,0.75)]'>{state.maintenance.reason ?? 'Le serveur revient très vite.'}</p>
        </div>
      </div>
    )
  }
  if (!state.nextRestart) return null
  return (
    <div role='status' className='flex items-center gap-3 rounded-xl border border-[rgba(255,150,40,0.3)] bg-[rgba(14,10,6,0.72)] px-4 py-3 text-sm backdrop-blur-md'>
      <RotateCw className='size-4 shrink-0 text-[#ff9628]' aria-hidden />
      <span>Prochain redémarrage à {format(state.nextRestart.at, 'HH:mm', { locale: fr })}, dans <Countdown at={state.nextRestart.at} /></span>
    </div>
  )
}

function DiscordBlock({ discord }: { discord: NonNullable<PublicView['discord']> }) {
  const n = new Intl.NumberFormat('fr-FR')
  return (
    <Block title='La communauté' aside={<span className='text-[rgba(255,243,230,0.6)]'><span className='font-display text-2xl font-semibold text-[#fff3e6] tabular-nums'>{n.format(discord.total)}</span> membres sur Discord</span>}>
      <ul className='grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3'>
        {discord.guilds.map((g) => (
          <li key={g.name} className='flex items-center gap-3 rounded-lg border border-[rgba(255,243,230,0.08)] bg-[#120d08] p-3'>
            {g.icon
              ? <img src={g.icon} alt='' className='size-11 rounded-xl' />
              : <span aria-hidden className='grid size-11 place-items-center rounded-xl bg-[rgba(255,150,40,0.15)] font-display font-semibold text-[#ffb968]'>{g.name.slice(0, 2)}</span>}
            <div className='min-w-0'>
              <p className='truncate font-medium'>{g.name}</p>
              <p className='flex items-center gap-1 text-sm text-[rgba(255,243,230,0.6)]'><Users className='size-3.5' aria-hidden />{n.format(g.members)} membres</p>
            </div>
          </li>
        ))}
      </ul>
    </Block>
  )
}

function EventsBlock({ events }: { events: NonNullable<PublicView['events']> }) {
  return (
    <Block title='Événements à venir'>
      <ol className='grid gap-3'>
        {events.map((e, i) => (
          <li key={i} className='grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 rounded-lg border border-[rgba(255,243,230,0.08)] bg-[#120d08] p-4 sm:grid-cols-[5.5rem_minmax(0,1fr)_auto] sm:items-center'>
            <div className='grid justify-items-center border-r border-[rgba(255,150,40,0.2)] pr-4 text-center font-display'>
              <span className='text-4xl leading-none font-bold'>{format(e.startsAt, 'd', { locale: fr })}</span>
              <span className='text-sm tracking-wide text-[#ffb968] uppercase'>{format(e.startsAt, 'MMM', { locale: fr })}</span>
            </div>
            <div className='min-w-0'>
              <p className='flex flex-wrap items-center gap-2 font-display text-lg font-semibold tracking-wide'>
                {e.title}
                {e.live && <span className='inline-flex items-center gap-1.5 rounded bg-[rgba(255,150,40,0.15)] px-2 py-0.5 text-xs text-[#ffb968]'><span className='live-dot' aria-hidden />En cours</span>}
              </p>
              <p className='mt-0.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-[rgba(255,243,230,0.6)]'>
                <span className='inline-flex items-center gap-1'><CalendarDays className='size-3.5' aria-hidden />{format(e.startsAt, 'EEEE HH:mm', { locale: fr })}{e.endsAt ? ` – ${format(e.endsAt, 'HH:mm')}` : ''}</span>
                {e.location && <span className='inline-flex items-center gap-1'><MapPin className='size-3.5' aria-hidden />{e.location}</span>}
              </p>
              {e.description && <p className='mt-2 line-clamp-3 text-sm text-[rgba(255,243,230,0.75)]'>{e.description}</p>}
            </div>
            <p className='col-span-2 text-sm text-[rgba(255,243,230,0.6)] sm:col-span-1 sm:text-right'>
              <span className='font-display text-xl font-semibold text-[#fff3e6] tabular-nums'>{e.going}</span>{e.capacity ? ` / ${e.capacity}` : ''} inscrits
            </p>
          </li>
        ))}
      </ol>
    </Block>
  )
}

function StaffBlock({ staff }: { staff: NonNullable<PublicView['staff']> }) {
  return (
    <Block title='L’équipe'>
      <div className='grid gap-8'>
        {staff.map((rank) => (
          <div key={rank.name} className='grid gap-3'>
            <h3 className='flex items-center gap-2 font-display text-lg font-semibold tracking-wide' style={{ color: rank.color ?? '#ffb968' }}>
              <span aria-hidden className='size-2.5 rounded-full' style={{ background: rank.color ?? '#ff9628' }} />
              {rank.name}
              <span className='text-sm font-normal text-[rgba(255,243,230,0.45)]'>{rank.members.length}</span>
            </h3>
            <ul className='grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-2'>
              {rank.members.map((m, i) => (
                <li key={`${m.name}-${i}`} className='flex min-w-0 items-center gap-2.5 rounded-lg bg-[#120d08] p-2 pr-3'>
                  {m.avatar
                    ? <img src={m.avatar} alt='' loading='lazy' className='size-9 rounded-full' style={{ boxShadow: `0 0 0 2px ${rank.color ?? '#ff9628'}55` }} />
                    : <span aria-hidden className='grid size-9 place-items-center rounded-full bg-[rgba(255,243,230,0.08)] text-sm'>{m.name.slice(0, 1)}</span>}
                  <span className='truncate text-sm'>{m.name}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Block>
  )
}

function RecruitmentBlock({ positions }: { positions: NonNullable<PublicView['recruitment']> }) {
  return (
    <Block title='On recrute'>
      <ul className='grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2'>
        {positions.map((p, i) => (
          <li key={i} className='flex flex-col gap-3 rounded-lg border border-[rgba(255,150,40,0.2)] bg-[#120d08] p-4'>
            <div>
              <p className='font-display text-lg font-semibold tracking-wide'>{p.name}</p>
              <p className='text-sm text-[rgba(255,243,230,0.55)]'>{p.server}{p.closesAt ? `, jusqu’au ${format(p.closesAt, 'd MMMM', { locale: fr })}` : ''}</p>
            </div>
            {p.description && <p className='line-clamp-4 text-sm text-[rgba(255,243,230,0.75)]'>{p.description}</p>}
            {p.url && (
              <a href={p.url} target='_blank' rel='noopener noreferrer' className='mt-auto inline-flex h-9 w-fit items-center gap-2 rounded-md bg-[#5865f2] px-4 text-sm font-medium text-white hover:bg-[#4752c4] focus-visible:ring-2 focus-visible:ring-[#ffb968] focus-visible:outline-none'>
                <DiscordIcon className='size-4' /> Postuler sur Discord
              </a>
            )}
          </li>
        ))}
      </ul>
    </Block>
  )
}
