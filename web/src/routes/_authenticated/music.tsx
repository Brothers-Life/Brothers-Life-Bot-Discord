import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDown, ArrowUp, Clapperboard, Disc3, ListMusic, Music, Pause, Play, Plus, Repeat, Repeat1, Save, Search, Shuffle,
  SkipBack, SkipForward, Square, Trash2, Upload, Volume1, Volume2, VolumeX, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Role } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, GuildIcon, UserAvatar } from '@/components/app/ui'
import { RolesPicker } from '@/components/app/pickers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/music')({
  component: MusicPage,
})

type Track = {
  id: number; title: string; author: string | null; url: string | null; durationMs: number | null; thumbnail: string | null
  source: string; live: boolean; youtubeUrl?: string; requestedBy: string; requester?: { name: string | null; avatar: string | null } | null; error?: string
}
type State = {
  guildId: string; connected: boolean; channelId?: string; current?: Track | null; position?: number; paused?: boolean; volume?: number; speed?: number; rate?: number
  loop?: 'off' | 'track' | 'queue'; filters?: string[]; index?: number; queue?: Track[]; upcoming?: Track[]; history?: Track[]; loading?: boolean
}
type Config = { djRoles: Record<string, string[]>; defaultVolume: number; maxQueue: number; maxTrackMinutes: number; idleMinutes: number; announce: boolean }
type GuildInfo = { id: string; name: string; icon: string | null; voiceChannels: { id: string; name: string; parent: string | null; members: number }[]; roles: Role[]; state: State }
type Payload = { guilds: GuildInfo[]; config: Config; filters: Record<string, string>; speeds: number[]; cookies: boolean }
type SearchResult = { title: string; author: string | null; url: string; durationMs: number | null; thumbnail: string | null }

const SOURCE: Record<string, string> = { youtube: 'YouTube', spotify: 'Spotify', soundcloud: 'SoundCloud' }

function clock(ms?: number | null) {
  if (!ms || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

function youtubeId(track?: Track | null) {
  const url = track?.youtubeUrl ?? (track?.source === 'youtube' ? track.url : null)
  if (!url) return null
  return /(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(url)?.[1] ?? null
}

function MusicPage() {
  const { can } = useMe()
  const { data, isLoading } = useQuery({ queryKey: ['music'], queryFn: () => api<Payload>('/music'), refetchInterval: 15_000 })
  const [selected, setSelected] = useState<string | null>(null)
  const guild = data?.guilds.find((g) => g.id === selected) ?? data?.guilds.find((g) => g.state.connected) ?? data?.guilds[0]

  return (
    <Page
      title='Musique'
      description='Le bot rejoint un salon vocal et joue des liens YouTube, Spotify ou SoundCloud, ou une recherche. Tout se pilote ici ou avec /musique et les boutons du message sur Discord.'
    >
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && !data.guilds.length && <EmptyState title='Aucun serveur' icon={Music}>Ajoute d’abord des serveurs au réseau.</EmptyState>}
      {data && guild && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {data.guilds.length > 1 && (
            <nav aria-label='Serveurs' className='flex gap-2 overflow-x-auto pb-1'>
              {data.guilds.map((g) => (
                <button
                  key={g.id}
                  type='button'
                  onClick={() => setSelected(g.id)}
                  aria-current={g.id === guild.id ? 'page' : undefined}
                  className='flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent aria-[current=page]:border-primary aria-[current=page]:bg-primary/10'
                >
                  <GuildIcon src={g.icon} name={g.name} className='size-5' />
                  {g.name}
                  {g.state.connected && <span className={cn('live-dot size-2 rounded-full', g.state.paused ? 'bg-muted-foreground' : 'bg-success')} aria-label='musique en cours' />}
                </button>
              ))}
            </nav>
          )}
          <Player key={guild.id} guild={guild} data={data} />
          {can('music.manage') && <Settings data={data} />}
        </div>
      )}
    </Page>
  )
}

function Player({ guild, data }: { guild: GuildInfo; data: Payload }) {
  const qc = useQueryClient()
  const { data: state, dataUpdatedAt } = useQuery({
    queryKey: ['music-state', guild.id],
    queryFn: () => api<State>(`/music/${guild.id}`),
    initialData: guild.state,
    refetchInterval: 2000,
  })
  const [now, setNow] = useState(dataUpdatedAt)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [])
  const [watching, setWatching] = useState(false)

  const control = useMutation({
    mutationFn: (body: { action: string; value?: unknown; to?: number }) => api<State>(`/music/${guild.id}/control`, { method: 'POST', body }),
    onSuccess: (next) => qc.setQueryData(['music-state', guild.id], next),
  })
  const act = (action: string, value?: unknown, to?: number) => control.mutate({ action, value, to })

  const track = state.connected ? state.current : null
  const running = Boolean(track && !state.paused && !state.loading)
  const position = Math.min(track?.durationMs ?? Infinity, (state.position ?? 0) + (running ? Math.max(0, now - dataUpdatedAt) * (state.rate ?? 1) : 0))
  const videoId = youtubeId(track)

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]'>
      <div className='grid content-start gap-6'>
        <section className='brackets relative overflow-hidden rounded-xl border bg-card'>
          {track?.thumbnail && <img src={track.thumbnail} alt='' aria-hidden className='pointer-events-none absolute inset-0 size-full scale-110 object-cover opacity-20 blur-2xl' />}
          <div className='relative grid gap-5 p-5 sm:grid-cols-[11rem_minmax(0,1fr)] sm:p-6'>
            <div className='relative mx-auto aspect-square w-44 overflow-hidden rounded-lg border bg-muted shadow-lg sm:w-full'>
              {track?.thumbnail ? <img src={track.thumbnail} alt='' className={cn('size-full object-cover', running && 'ken-burns')} /> : (
                <div className='grid size-full place-items-center text-muted-foreground'><Disc3 className={cn('size-16', running && 'animate-spin [animation-duration:4s]')} /></div>
              )}
            </div>
            <div className='grid min-w-0 content-center gap-3'>
              {!state.connected ? (
                <div>
                  <p className='kicker'>À l’arrêt</p>
                  <h2 className='font-display text-2xl font-semibold'>Rien ne joue sur {guild.name}</h2>
                  <p className='text-sm text-muted-foreground'>Ajoute un titre à droite : le bot rejoindra le salon vocal choisi.</p>
                </div>
              ) : !track ? (
                <div>
                  <p className='kicker'>File terminée</p>
                  <h2 className='font-display text-2xl font-semibold'>Le bot attend la suite</h2>
                  <p className='text-sm text-muted-foreground'>Il quitte le vocal après {data.config.idleMinutes} min sans musique.</p>
                </div>
              ) : (
                <div className='min-w-0'>
                  <p className='kicker flex items-center gap-2'>{state.loading ? 'Chargement…' : state.paused ? 'En pause' : 'En cours'}<Pill tone='neutral'>{SOURCE[track.source] ?? track.source}</Pill>{track.live && <Pill tone='danger'>Direct</Pill>}</p>
                  <h2 className='font-display text-2xl font-semibold leading-tight [overflow-wrap:anywhere]'>
                    {track.url ? <a href={track.youtubeUrl ?? track.url} target='_blank' rel='noreferrer' className='hover:underline'>{track.title}</a> : track.title}
                  </h2>
                  {track.author && <p className='text-muted-foreground'>{track.author}</p>}
                  {track.requester && <p className='mt-1 flex items-center gap-1.5 text-xs text-muted-foreground'><UserAvatar src={track.requester.avatar} name={track.requester.name ?? '?'} className='size-4' />demandé par {track.requester.name}</p>}
                </div>
              )}
              {track && (
                <Seek
                  key={`${track.id}-${state.speed}`}
                  position={position}
                  duration={track.live ? null : track.durationMs}
                  disabled={control.isPending || Boolean(state.loading)}
                  onSeek={(ms) => act('seek', ms)}
                />
              )}
              {state.connected && (
                <div className='flex flex-wrap items-center gap-2'>
                  <Button size='icon' variant='ghost' aria-label='Précédent' onClick={() => act('previous')} disabled={control.isPending}><SkipBack /></Button>
                  <Button size='icon' className='size-11 rounded-full' aria-label={state.paused ? 'Reprendre' : 'Pause'} onClick={() => act(state.paused ? 'resume' : 'pause')} disabled={!track || control.isPending}>
                    {state.paused ? <Play className='size-5' /> : <Pause className='size-5' />}
                  </Button>
                  <Button size='icon' variant='ghost' aria-label='Suivant' onClick={() => act('skip')} disabled={!track || control.isPending}><SkipForward /></Button>
                  <Button size='icon' variant='danger-ghost' aria-label='Arrêter et quitter le vocal' onClick={() => act('stop')} disabled={control.isPending}><Square /></Button>
                  <span className='mx-1 h-6 w-px bg-border' aria-hidden />
                  <Button size='icon' variant={state.loop === 'off' ? 'ghost' : 'secondary'} aria-label={`Boucle : ${state.loop === 'track' ? 'titre' : state.loop === 'queue' ? 'file' : 'non'}`} onClick={() => act('loop')}>
                    {state.loop === 'track' ? <Repeat1 className='text-primary' /> : <Repeat className={cn(state.loop === 'queue' && 'text-primary')} />}
                  </Button>
                  <Button size='icon' variant='ghost' aria-label='Mélanger la suite' onClick={() => act('shuffle')} disabled={(state.upcoming?.length ?? 0) < 2}><Shuffle /></Button>
                  {videoId && <Button size='sm' variant={watching ? 'secondary' : 'ghost'} onClick={() => setWatching(!watching)} aria-pressed={watching}><Clapperboard /> Clip</Button>}
                </div>
              )}
            </div>
          </div>
          {state.connected && (
            <div className='relative grid gap-4 border-t bg-background/40 p-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:p-6'>
              <Volume value={state.volume ?? 100} onCommit={(v) => act('volume', v)} />
              <div className='flex flex-wrap items-center gap-2'>
                <Label htmlFor='music-speed' className='text-xs text-muted-foreground'>Vitesse</Label>
                <Select value={String(state.speed ?? 1)} onValueChange={(v) => act('speed', Number(v))}>
                  <SelectTrigger id='music-speed' className='h-8 w-24'><SelectValue /></SelectTrigger>
                  <SelectContent>{data.speeds.map((s) => <SelectItem key={s} value={String(s)}>×{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className='flex flex-wrap gap-1.5 sm:col-span-2' role='group' aria-label='Effets audio'>
                {Object.entries(data.filters).map(([key, label]) => {
                  const on = state.filters?.includes(key)
                  return (
                    <button
                      key={key}
                      type='button'
                      aria-pressed={on}
                      onClick={() => act('filters', on ? state.filters?.filter((f) => f !== key) : [...(state.filters ?? []), key])}
                      className={cn('rounded-full border px-3 py-1 text-xs transition-colors hover:border-primary/60', on ? 'border-primary bg-primary/15 text-primary' : 'text-muted-foreground')}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
        </section>

        {watching && videoId && track && <Clip videoId={videoId} position={position} trackId={track.id} />}
      </div>

      <div className='grid content-start gap-6'>
        <AddMusic guild={guild} connected={state.connected} onAdded={() => qc.invalidateQueries({ queryKey: ['music-state', guild.id] })} />
        {state.connected && <Queue state={state} act={act} busy={control.isPending} />}
      </div>
    </div>
  )
}

// Progress bar that can be dragged; the new position is sent on release
function Seek({ position, duration, disabled, onSeek }: { position: number; duration: number | null; disabled: boolean; onSeek: (ms: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null)
  if (!duration) return <div className='flex items-center gap-2 text-xs text-muted-foreground'><span className='live-dot size-2 rounded-full bg-destructive' /> En direct · {clock(position)}</div>
  const value = drag ?? position
  const commit = () => {
    if (drag !== null) onSeek(drag)
    setDrag(null)
  }
  return (
    <div className='grid gap-1'>
      <input
        type='range'
        min={0}
        max={duration}
        step={1000}
        value={Math.min(value, duration)}
        disabled={disabled}
        aria-label='Position dans le titre'
        aria-valuetext={`${clock(value)} sur ${clock(duration)}`}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        className='h-1.5 w-full cursor-pointer accent-primary disabled:cursor-default'
      />
      <div className='flex justify-between text-xs text-muted-foreground tabular-nums'><span>{clock(value)}</span><span>{clock(duration)}</span></div>
    </div>
  )
}

function Volume({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? value
  const Icon = shown === 0 ? VolumeX : shown < 60 ? Volume1 : Volume2
  const commit = () => {
    if (drag !== null) onCommit(drag)
    setDrag(null)
  }
  return (
    <div className='flex items-center gap-3'>
      <button type='button' aria-label={shown ? 'Couper le son' : 'Remettre le son'} onClick={() => onCommit(shown ? 0 : 80)} className='text-muted-foreground hover:text-foreground'><Icon className='size-5' /></button>
      <input
        type='range' min={0} max={200} step={5} value={shown}
        aria-label='Volume'
        aria-valuetext={`${shown} %`}
        onChange={(e) => setDrag(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        className='h-1.5 w-full max-w-72 cursor-pointer accent-primary'
      />
      <span className={cn('w-12 text-sm tabular-nums', shown > 100 && 'text-warning')}>{shown} %</span>
    </div>
  )
}

// The clip of the song (muted: the sound is in the voice channel), started where the song is
function Clip({ videoId, position, trackId }: { videoId: string; position: number; trackId: number }) {
  const [start, setStart] = useState(Math.floor(position / 1000))
  const [key, setKey] = useState(0)
  return (
    <Section title='Clip' description='Muet : le son passe dans le salon vocal. Resynchronise s’il prend du retard.' actions={<Button size='sm' variant='outline' onClick={() => { setStart(Math.floor(position / 1000)); setKey(key + 1) }}>Resynchroniser</Button>}>
      <div className='aspect-video w-full overflow-hidden rounded-b-xl bg-black'>
        <iframe
          key={`${trackId}-${key}`}
          title='Clip du titre en cours'
          src={`https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&start=${start}&rel=0&modestbranding=1`}
          allow='autoplay; encrypted-media; picture-in-picture; fullscreen'
          referrerPolicy='strict-origin-when-cross-origin'
          className='size-full'
        />
      </div>
    </Section>
  )
}

function AddMusic({ guild, connected, onAdded }: { guild: GuildInfo; connected: boolean; onAdded: () => void }) {
  const [query, setQuery] = useState('')
  const [channelId, setChannelId] = useState(() => [...guild.voiceChannels].sort((a, b) => b.members - a.members)[0]?.id ?? '')
  const [debounced, setDebounced] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const isUrl = /^https?:\/\//i.test(query.trim())
  const results = useQuery({
    queryKey: ['music-search', debounced],
    queryFn: () => api<SearchResult[]>(`/music/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 3,
    staleTime: 10 * 60_000,
  })
  const play = useMutation({
    mutationFn: ({ q, when }: { q: string; when: string }) => api<{ added: number; playlist: { title: string } | null; first: string | null; truncated: boolean }>(`/music/${guild.id}/play`, { method: 'POST', body: { query: q, when, ...(connected ? {} : { channelId }) } }),
    onSuccess: (r) => {
      toast.success(r.playlist ? `${r.playlist.title} : ${r.added} titre${r.added > 1 ? 's' : ''} ajouté${r.added > 1 ? 's' : ''}` : `${r.first} ajouté`)
      setQuery('')
      setDebounced('')
      onAdded()
    },
  })
  const type = (value: string) => {
    setQuery(value)
    clearTimeout(timer.current)
    const text = value.trim()
    timer.current = setTimeout(() => setDebounced(/^https?:\/\//i.test(text) ? '' : text), 500)
  }
  const send = (q: string, when = 'end') => q.trim() && play.mutate({ q: q.trim(), when })

  return (
    <Section title='Ajouter de la musique' description='Lien YouTube, Spotify (titre, album, playlist), SoundCloud… ou une recherche.'>
      <form className='grid gap-3 p-4' onSubmit={(e) => { e.preventDefault(); send(query) }}>
        {!connected && (
          <div className='grid gap-1.5'>
            <Label>Salon vocal</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger aria-label='Salon vocal'><SelectValue placeholder='Choisir un salon' /></SelectTrigger>
              <SelectContent>
                {guild.voiceChannels.map((c) => <SelectItem key={c.id} value={c.id}>🔊 {c.name}{c.members ? ` · ${c.members} connecté${c.members > 1 ? 's' : ''}` : ''}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className='relative'>
          <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
          <Input value={query} onChange={(e) => type(e.target.value)} placeholder='https://… ou « daft punk one more time »' aria-label='Lien ou recherche' className='ps-8' />
        </div>
        <div className='flex flex-wrap gap-2'>
          <Button type='submit' loading={play.isPending} disabled={!query.trim() || (!connected && !channelId)}><Plus /> {connected ? 'Ajouter à la file' : 'Lancer'}</Button>
          {connected && <Button type='button' variant='outline' disabled={!query.trim() || play.isPending} onClick={() => send(query, 'next')}>Jouer ensuite</Button>}
          {connected && <Button type='button' variant='ghost' disabled={!query.trim() || play.isPending} onClick={() => send(query, 'now')}><Play /> Maintenant</Button>}
        </div>
        {!isUrl && debounced.length >= 3 && (
          <ul className='grid gap-1' aria-label='Résultats de la recherche'>
            {results.isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className='h-12 w-full' />)}
            {results.data?.map((r) => (
              <li key={r.url} className='flex items-center gap-3 rounded-md p-1.5 hover:bg-accent/40'>
                {r.thumbnail ? <img src={r.thumbnail} alt='' className='h-10 w-16 shrink-0 rounded object-cover' /> : <span className='h-10 w-16 shrink-0 rounded bg-muted' />}
                <div className='min-w-0 flex-1'>
                  <div className='truncate text-sm font-medium'>{r.title}</div>
                  <div className='truncate text-xs text-muted-foreground'>{r.author}{r.durationMs ? ` · ${clock(r.durationMs)}` : ''}</div>
                </div>
                <Button type='button' size='icon' variant='ghost' aria-label={`Ajouter ${r.title}`} disabled={play.isPending || (!connected && !channelId)} onClick={() => send(r.url)}><Plus /></Button>
              </li>
            ))}
          </ul>
        )}
      </form>
    </Section>
  )
}

function Queue({ state, act, busy }: { state: State; act: (action: string, value?: unknown, to?: number) => void; busy: boolean }) {
  const [showHistory, setShowHistory] = useState(false)
  const index = state.index ?? 0
  const upcoming = state.upcoming ?? []
  const history = state.history ?? []
  const remaining = upcoming.reduce((n, t) => n + (t.durationMs ?? 0), 0)
  const row = (t: Track, i: number, kind: 'past' | 'next') => (
    <li key={t.id} className={cn('group flex items-center gap-3 px-4 py-2', kind === 'past' && 'opacity-60')}>
      <span className='w-6 text-end text-xs text-muted-foreground tabular-nums'>{kind === 'next' ? i - index : '✓'}</span>
      {t.thumbnail ? <img src={t.thumbnail} alt='' className='size-9 shrink-0 rounded object-cover' /> : <span className='grid size-9 shrink-0 place-items-center rounded bg-muted'><Music className='size-4 text-muted-foreground' /></span>}
      <button type='button' className='min-w-0 flex-1 text-start' onClick={() => act('jump', i)} disabled={busy} title='Jouer maintenant'>
        <span className='block truncate text-sm font-medium'>{t.title}</span>
        <span className='block truncate text-xs text-muted-foreground'>{t.error ? <span className='text-destructive'>{t.error}</span> : [t.author, t.durationMs ? clock(t.durationMs) : null, t.requester?.name].filter(Boolean).join(' · ')}</span>
      </button>
      {kind === 'next' && (
        <div className='flex opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100'>
          <Button size='icon' variant='ghost' className='size-7' aria-label='Monter' disabled={busy || i === index + 1} onClick={() => act('move', i, i - 1)}><ArrowUp className='size-3.5' /></Button>
          <Button size='icon' variant='ghost' className='size-7' aria-label='Descendre' disabled={busy || i === (state.queue?.length ?? 0) - 1} onClick={() => act('move', i, i + 1)}><ArrowDown className='size-3.5' /></Button>
          <Button size='icon' variant='danger-ghost' className='size-7' aria-label={`Retirer ${t.title}`} disabled={busy} onClick={() => act('remove', i)}><X className='size-3.5' /></Button>
        </div>
      )}
    </li>
  )
  return (
    <Section
      title={`À suivre (${upcoming.length})`}
      description={upcoming.length ? `Reste ${clock(remaining)}` : undefined}
      actions={upcoming.length > 0 && <Button size='sm' variant='danger-ghost' onClick={() => act('clear')} disabled={busy}><Trash2 /> Vider</Button>}
    >
      {!upcoming.length && !history.length ? <EmptyState title='File vide' icon={ListMusic}>Ajoute des titres : ils passeront à la suite.</EmptyState> : (
        <ul className='max-h-[32rem] divide-y overflow-y-auto'>
          {history.length > 0 && (
            <li className='px-4 py-2'>
              <button type='button' className='text-xs text-primary hover:underline' aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>{showHistory ? 'Masquer' : 'Afficher'} les {history.length} titre{history.length > 1 ? 's' : ''} déjà passé{history.length > 1 ? 's' : ''}</button>
            </li>
          )}
          {showHistory && history.map((t, i) => row(t, i, 'past'))}
          {upcoming.map((t, i) => row(t, index + 1 + i, 'next'))}
        </ul>
      )}
    </Section>
  )
}

function Settings({ data }: { data: Payload }) {
  const qc = useQueryClient()
  const [c, setC] = useState(data.config)
  const [cookies, setCookies] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['music'] })
  const save = useMutation({ mutationFn: () => api('/music/config', { method: 'PUT', body: c }), onSuccess: () => { toast.success('Réglages enregistrés'); refresh() } })
  const upload = useMutation({ mutationFn: () => api('/music/cookies', { method: 'PUT', body: { content: cookies } }), onSuccess: () => { toast.success('Cookies enregistrés'); setCookies(''); refresh() } })
  const removeCookies = useMutation({ mutationFn: () => api('/music/cookies', { method: 'DELETE' }), onSuccess: () => { toast.success('Cookies retirés'); refresh() } })
  const number = (key: keyof Config, label: string, min: number, max: number, hint?: string) => (
    <div className='grid gap-1.5'>
      <Label htmlFor={`music-${key}`}>{label}</Label>
      <Input id={`music-${key}`} type='number' min={min} max={max} value={c[key] as number} onChange={(e) => setC({ ...c, [key]: Number(e.target.value) })} />
      {hint && <p className='text-xs text-muted-foreground'>{hint}</p>}
    </div>
  )
  return (
    <Section title='Réglages' actions={<Button size='sm' loading={save.isPending} onClick={() => save.mutate()}><Save /> Enregistrer</Button>}>
      <div className='grid gap-6 p-4'>
        <div className='grid gap-4 sm:grid-cols-2 lg:grid-cols-4'>
          {number('defaultVolume', 'Volume de départ (%)', 1, 200)}
          {number('maxQueue', 'Titres max dans la file', 10, 1000)}
          {number('maxTrackMinutes', 'Durée max d’un titre (min)', 0, 1440, '0 = pas de limite')}
          {number('idleMinutes', 'Départ du vocal après (min)', 1, 60, 'Seul dans le salon ou file terminée')}
        </div>
        <label className='flex items-center gap-2 text-sm'><Switch checked={c.announce} onCheckedChange={(announce) => setC({ ...c, announce })} /> Message « en cours » avec boutons dans le salon de la commande</label>
        <div className='grid gap-2'>
          <Label>Rôles DJ par serveur</Label>
          <p className='text-xs text-muted-foreground'>Sans rôle DJ, tout le monde dans le salon vocal du bot pilote la musique. Avec, les autres peuvent seulement ajouter des titres. Les rangs qui ont « Piloter la musique » passent toujours.</p>
          <div className='grid gap-3 sm:grid-cols-2'>
            {data.guilds.map((g) => (
              <div key={g.id} className='grid min-w-0 gap-1'>
                <span className='truncate text-xs text-muted-foreground'>{g.name}</span>
                <RolesPicker roles={g.roles} value={c.djRoles[g.id] ?? []} onChange={(ids) => setC({ ...c, djRoles: { ...c.djRoles, [g.id]: ids } })} label={`Rôles DJ sur ${g.name}`} placeholder='Aucun : tout le monde' />
              </div>
            ))}
          </div>
        </div>
        <div className='grid gap-2 rounded-lg border p-3'>
          <div className='flex flex-wrap items-center gap-2'>
            <Label>Cookies YouTube</Label>
            {data.cookies ? <Pill tone='success'>Installés</Pill> : <Pill tone='neutral'>Aucun</Pill>}
            {data.cookies && <Button size='sm' variant='danger-ghost' onClick={() => removeCookies.mutate()} disabled={removeCookies.isPending}><Trash2 /> Retirer</Button>}
          </div>
          <p className='text-xs text-muted-foreground'>
            Si YouTube refuse avec « Sign in to confirm you’re not a bot » (fréquent sur les serveurs hébergés), exporte les cookies d’un compte YouTube secondaire au format <code>cookies.txt</code> (extension « Get cookies.txt LOCALLY ») et colle-les ici. Ils restent sur le serveur du bot.
          </p>
          <Textarea rows={3} value={cookies} onChange={(e) => setCookies(e.target.value)} placeholder='# Netscape HTTP Cookie File…' className='font-mono text-xs' aria-label='Contenu du fichier cookies.txt' />
          <div><Button size='sm' variant='outline' disabled={!cookies.trim() || upload.isPending} onClick={() => upload.mutate()}><Upload /> Enregistrer les cookies</Button></div>
        </div>
      </div>
    </Section>
  )
}
