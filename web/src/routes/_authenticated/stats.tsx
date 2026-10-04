import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Clock, Download, Hash, MessageSquare, Mic, Plus, Trash2, UserPlus, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, Guild } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, UserAvatar, Pill } from '@/components/app/ui'
import { UserPicker } from '@/components/app/user-picker'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { ActivityChart, Heatmap, MemberCountChart, MembersChart, VoiceChart, type DayPoint } from '@/features/stats/charts'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export const Route = createFileRoute('/_authenticated/stats')({
  component: StatsPage,
})

type Overview = {
  from: string
  to: string
  totals: { messages: number; voiceHours: number; active: number; joins: number; leaves: number; memberCount: number | null; memberGrowth: number | null }
  days: DayPoint[]
}
type MemberRow = { userId: string; messages: number; voiceHours: number; days: number; user: { name: string | null; avatar: string | null } }
type ChannelRow = { guildId: string; guildName: string; channelId: string; name: string; messages: number; voiceHours: number; members: number }
type StaffRow = {
  userId: string; user: { name: string | null; avatar: string | null }; sanctions: Record<string, number>; sanctionsTotal: number
  ticketsClaimed: number; ticketsClosed: number; avgResolutionHours: number | null; rating: number | null; ratings: number; messages: number; voiceHours: number
}
type Counter = { id: number; guildId: string; channelId: string; template: string; lastName: string | null; updatedAt: number | null }
type Options = { textChannels: Channel[]; voiceChannels: { id: string; name: string }[]; categories: { id: string; name: string }[]; variables?: string[] }

const ALL = 'all'
const PERIODS = [
  { value: '7', label: '7 derniers jours' },
  { value: '30', label: '30 derniers jours' },
  { value: '90', label: '90 derniers jours' },
  { value: '365', label: '12 derniers mois' },
  { value: 'custom', label: 'Dates choisies' },
]
const n = (v: number | null | undefined) => (v ?? 0).toLocaleString('fr-FR')

function StatCard({ icon: Icon, label, value, hint, tone }: { icon: React.ElementType; label: string; value: string; hint?: string; tone: string }) {
  return (
    <div className='flex animate-in items-center gap-3 rounded-lg border bg-card p-4 fade-in-0 slide-in-from-bottom-1'>
      <span className={cn('grid size-10 shrink-0 place-items-center rounded-lg', tone)}><Icon className='size-5' /></span>
      <div className='min-w-0'>
        <div className='text-xs text-muted-foreground'>{label}</div>
        <div className='text-xl font-semibold tabular-nums'>{value}</div>
        {hint && <div className='text-xs text-muted-foreground'>{hint}</div>}
      </div>
    </div>
  )
}

function StatsPage() {
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []
  const [guildId, setGuildId] = useState(ALL)
  const [period, setPeriod] = useState('30')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [channelId, setChannelId] = useState(ALL)
  const [userId, setUserId] = useState('')
  const [staffOnly, setStaffOnly] = useState(false)
  const [heatMetric, setHeatMetric] = useState<'messages' | 'voiceHours'>('messages')
  const [memberMetric, setMemberMetric] = useState<'messages' | 'voice'>('messages')

  const params = new URLSearchParams({ guildId })
  if (period === 'custom' && from && to) {
    params.set('from', String(new Date(`${from}T00:00`).getTime()))
    params.set('to', String(new Date(`${to}T23:59`).getTime()))
  }
  else params.set('days', period === 'custom' ? '30' : period)
  if (channelId !== ALL && guildId !== ALL) params.set('channelId', channelId)
  if (/^\d{17,20}$/.test(userId)) params.set('userId', userId)
  if (staffOnly) params.set('staffOnly', 'true')
  const qs = params.toString()

  const options = useQuery({ queryKey: ['stats-options', guildId], queryFn: () => api<Options>(`/stats/options?guildId=${guildId}`), enabled: guildId !== ALL })
  const overview = useQuery({ queryKey: ['stats', 'overview', qs], queryFn: () => api<Overview>(`/stats/overview?${qs}`) })
  const heatmap = useQuery({ queryKey: ['stats', 'heatmap', qs], queryFn: () => api<{ messages: number; voiceHours: number }[][]>(`/stats/heatmap?${qs}`) })
  const members = useQuery({ queryKey: ['stats', 'members', qs, memberMetric], queryFn: () => api<MemberRow[]>(`/stats/members?${qs}&metric=${memberMetric}`) })
  const channels = useQuery({ queryKey: ['stats', 'channels', qs], queryFn: () => api<ChannelRow[]>(`/stats/channels?${qs}`) })
  const staff = useQuery({ queryKey: ['stats', 'staff', qs], queryFn: () => api<StaffRow[]>(`/stats/staff?${qs}`) })

  const exportLink = (kind: string) => `/api/stats/export?${qs}&kind=${kind}${kind === 'members' ? `&metric=${memberMetric}` : ''}`
  const totals = overview.data?.totals

  return (
    <Page
      title='Statistiques'
      description='L’activité des serveurs : messages, vocal (compté seulement à deux ou plus), arrivées et départs, heures de pointe et travail du staff. Les bots ne sont pas comptés.'
    >
      <div className='mb-6 flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3'>
        <div className='grid gap-1'>
          <Label className='text-xs text-muted-foreground'>Serveur</Label>
          <Select value={guildId} onValueChange={(v) => { setGuildId(v); setChannelId(ALL) }}>
            <SelectTrigger className='w-52'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL}>Tout le réseau</SelectItem>
              {active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className='grid gap-1'>
          <Label className='text-xs text-muted-foreground'>Période</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className='w-44'><SelectValue /></SelectTrigger>
            <SelectContent>{PERIODS.map((p) => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {period === 'custom' && (
          <>
            <div className='grid gap-1'><Label htmlFor='st-from' className='text-xs text-muted-foreground'>Du</Label><Input id='st-from' type='date' value={from} onChange={(e) => setFrom(e.target.value)} className='w-40' /></div>
            <div className='grid gap-1'><Label htmlFor='st-to' className='text-xs text-muted-foreground'>Au</Label><Input id='st-to' type='date' value={to} onChange={(e) => setTo(e.target.value)} className='w-40' /></div>
          </>
        )}
        {guildId !== ALL && (
          <div className='grid gap-1'>
            <Label className='text-xs text-muted-foreground'>Salon</Label>
            <Select value={channelId} onValueChange={setChannelId}>
              <SelectTrigger className='w-48'><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les salons</SelectItem>
                {options.data?.textChannels.map((c) => <SelectItem key={c.id} value={c.id}>#{c.name}</SelectItem>)}
                {options.data?.voiceChannels.map((c) => <SelectItem key={c.id} value={c.id}>🔊 {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className='grid gap-1'>
          <Label className='text-xs text-muted-foreground'>Membre</Label>
          <UserPicker value={userId} onChange={setUserId} placeholder='Tout le monde' className='w-56' />
        </div>
        <label className='flex h-9 items-center gap-2 text-sm'><Switch checked={staffOnly} onCheckedChange={setStaffOnly} /> Staff seulement</label>
      </div>

      <Tabs defaultValue='overview'>
        <TabsList className='h-auto flex-wrap [&>button]:h-8 [&>button]:flex-none'>
          <TabsTrigger value='overview'>Vue d’ensemble</TabsTrigger>
          <TabsTrigger value='activity'>Heures de pointe</TabsTrigger>
          <TabsTrigger value='members'>Membres</TabsTrigger>
          <TabsTrigger value='channels'>Salons</TabsTrigger>
          <TabsTrigger value='staff'>Staff</TabsTrigger>
          <TabsTrigger value='counters'>Salons compteurs</TabsTrigger>
        </TabsList>

        <TabsContent value='overview' className='mt-4 grid gap-4'>
          {!totals ? <Skeleton className='h-96 w-full' /> : (
            <>
              <div className='grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 xl:grid-cols-5'>
                <StatCard icon={MessageSquare} label='Messages' value={n(totals.messages)} tone='bg-primary/15 text-primary' />
                <StatCard icon={Mic} label='Heures de vocal' value={n(totals.voiceHours)} tone='bg-sky-500/15 text-sky-500' />
                <StatCard icon={Activity} label='Membres actifs' value={n(totals.active)} tone='bg-success/15 text-success' />
                <StatCard icon={UserPlus} label='Arrivées' value={n(totals.joins)} hint={`${n(totals.leaves)} départ${totals.leaves > 1 ? 's' : ''}`} tone='bg-warning/15 text-warning' />
                <StatCard
                  icon={Users} label='Membres' value={totals.memberCount === null ? '—' : n(totals.memberCount)}
                  hint={totals.memberGrowth ? `${totals.memberGrowth > 0 ? '+' : ''}${n(totals.memberGrowth)} sur la période` : undefined}
                  tone='bg-violet-500/15 text-violet-500'
                />
              </div>
              <div className='grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2'>
                <ActivityChart days={overview.data!.days} />
                <VoiceChart days={overview.data!.days} />
                <MembersChart days={overview.data!.days} />
                <MemberCountChart days={overview.data!.days} />
              </div>
              <div><Button variant='outline' size='sm' asChild><a href={exportLink('days')}><Download /> Exporter jour par jour (CSV)</a></Button></div>
            </>
          )}
        </TabsContent>

        <TabsContent value='activity' className='mt-4'>
          <Section
            title='Heures de pointe'
            description='Heure de Paris. Utile pour choisir le bon moment d’une annonce ou d’un événement.'
            actions={
              <Select value={heatMetric} onValueChange={(v) => setHeatMetric(v as 'messages' | 'voiceHours')}>
                <SelectTrigger className='w-40'><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='messages'>Messages</SelectItem>
                  <SelectItem value='voiceHours'>Vocal</SelectItem>
                </SelectContent>
              </Select>
            }
          >
            <div className='p-4'>{heatmap.data ? <Heatmap grid={heatmap.data} metric={heatMetric} /> : <Skeleton className='h-60 w-full' />}</div>
          </Section>
        </TabsContent>

        <TabsContent value='members' className='mt-4'>
          <Section
            title='Membres les plus actifs'
            actions={
              <div className='flex gap-2'>
                <Select value={memberMetric} onValueChange={(v) => setMemberMetric(v as 'messages' | 'voice')}>
                  <SelectTrigger className='w-40'><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='messages'>Par messages</SelectItem>
                    <SelectItem value='voice'>Par vocal</SelectItem>
                  </SelectContent>
                </Select>
                <Button variant='outline' size='sm' asChild><a href={exportLink('members')}><Download /> CSV</a></Button>
              </div>
            }
          >
            <RankTable
              rows={members.data ?? []}
              empty='Pas encore d’activité sur la période.'
              columns={[
                { label: 'Messages', value: (r) => n(r.messages), bar: (r) => r.messages },
                { label: 'Vocal', value: (r) => `${n(r.voiceHours)} h`, bar: (r) => r.voiceHours },
                { label: 'Jours actifs', value: (r) => n(r.days) },
              ]}
              barKey={memberMetric === 'voice' ? 1 : 0}
            />
          </Section>
        </TabsContent>

        <TabsContent value='channels' className='mt-4'>
          <Section title='Salons les plus actifs' actions={<Button variant='outline' size='sm' asChild><a href={exportLink('channels')}><Download /> CSV</a></Button>}>
            {!channels.data?.length ? <EmptyState title='Aucune donnée'>Les salons apparaissent dès qu’il y a de l’activité.</EmptyState> : (
              <ul className='divide-y'>
                {channels.data.map((c, i) => {
                  const max = Math.max(...channels.data.map((x) => x.messages + x.voiceHours * 60), 1)
                  return (
                    <li key={`${c.guildId}${c.channelId}`} className='grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-2.5'>
                      <span className='text-sm text-muted-foreground tabular-nums'>{i + 1}</span>
                      <div className='min-w-0'>
                        <div className='flex items-center gap-2 text-sm font-medium'><Hash className='size-3.5 text-muted-foreground' />{c.name}{guildId === ALL && <Pill>{c.guildName}</Pill>}</div>
                        <div className='mt-1 h-1.5 rounded-full bg-muted'><div className='h-full rounded-full bg-primary transition-[width] duration-500' style={{ width: `${((c.messages + c.voiceHours * 60) / max) * 100}%` }} /></div>
                      </div>
                      <span className='text-end text-xs text-muted-foreground tabular-nums'>{n(c.messages)} messages · {n(c.voiceHours)} h · {n(c.members)} membres</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </Section>
        </TabsContent>

        <TabsContent value='staff' className='mt-4'>
          <Section title='Travail du staff' description='Sanctions données, tickets pris en charge et fermés, satisfaction, et activité sur la période.' actions={<Button variant='outline' size='sm' asChild><a href={exportLink('staff')}><Download /> CSV</a></Button>}>
            {!staff.data?.length ? <EmptyState title='Aucune donnée'>Rien sur la période choisie.</EmptyState> : (
              <div className='overflow-x-auto'>
                <table className='w-full min-w-[760px] text-sm'>
                  <thead className='text-xs text-muted-foreground'>
                    <tr className='border-b'>
                      <th className='px-4 py-2 text-start font-medium'>Membre du staff</th>
                      <th className='px-2 py-2 text-end font-medium'>Sanctions</th>
                      <th className='px-2 py-2 text-end font-medium'>Tickets pris</th>
                      <th className='px-2 py-2 text-end font-medium'>Fermés</th>
                      <th className='px-2 py-2 text-end font-medium'>Résolution moy.</th>
                      <th className='px-2 py-2 text-end font-medium'>Note</th>
                      <th className='px-2 py-2 text-end font-medium'>Messages</th>
                      <th className='px-4 py-2 text-end font-medium'>Vocal</th>
                    </tr>
                  </thead>
                  <tbody className='divide-y'>
                    {staff.data.map((s) => (
                      <tr key={s.userId} className='hover:bg-accent/30'>
                        <td className='px-4 py-2'><span className='flex items-center gap-2'><UserAvatar src={s.user.avatar} name={s.user.name ?? s.userId} className='size-7' />{s.user.name ?? s.userId}</span></td>
                        <td className='px-2 py-2 text-end tabular-nums' title={Object.entries(s.sanctions).map(([k, v]) => `${k} : ${v}`).join(', ')}>{n(s.sanctionsTotal)}</td>
                        <td className='px-2 py-2 text-end tabular-nums'>{n(s.ticketsClaimed)}</td>
                        <td className='px-2 py-2 text-end tabular-nums'>{n(s.ticketsClosed)}</td>
                        <td className='px-2 py-2 text-end tabular-nums'>{s.avgResolutionHours === null ? '—' : `${n(s.avgResolutionHours)} h`}</td>
                        <td className='px-2 py-2 text-end tabular-nums'>{s.rating === null ? '—' : <span title={`${s.ratings} note(s)`}>{s.rating} ★</span>}</td>
                        <td className='px-2 py-2 text-end tabular-nums'>{n(s.messages)}</td>
                        <td className='px-4 py-2 text-end tabular-nums'>{n(s.voiceHours)} h</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value='counters' className='mt-4'>
          {guildId === ALL
            ? <EmptyState title='Choisis un serveur'>Les salons compteurs se règlent serveur par serveur.</EmptyState>
            : <Counters guildId={guildId} options={options.data} />}
        </TabsContent>
      </Tabs>
    </Page>
  )
}

function RankTable({ rows, columns, empty, barKey }: {
  rows: MemberRow[]
  columns: { label: string; value: (r: MemberRow) => string; bar?: (r: MemberRow) => number }[]
  empty: string
  barKey: number
}) {
  if (!rows.length) return <EmptyState title='Aucune donnée'>{empty}</EmptyState>
  const barOf = columns[barKey].bar!
  const max = Math.max(...rows.map(barOf), 1)
  const medals = ['🥇', '🥈', '🥉']
  return (
    <ul className='divide-y'>
      {rows.map((r, i) => (
        <li key={r.userId} className='grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5'>
          <span className='text-center text-sm tabular-nums'>{medals[i] ?? i + 1}</span>
          <div className='min-w-0'>
            <div className='flex items-center gap-2 text-sm font-medium'><UserAvatar src={r.user.avatar} name={r.user.name ?? r.userId} className='size-6' /><span className='truncate'>{r.user.name ?? r.userId}</span></div>
            <div className='mt-1 h-1.5 rounded-full bg-muted'><div className='h-full rounded-full bg-primary transition-[width] duration-500' style={{ width: `${(barOf(r) / max) * 100}%` }} /></div>
          </div>
          <span className='flex gap-4 text-end text-xs text-muted-foreground tabular-nums'>
            {columns.map((c) => <span key={c.label}><span className='hidden sm:inline'>{c.label} : </span>{c.value(r)}</span>)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Counters({ guildId, options }: { guildId: string; options?: Options }) {
  const { can } = useMe()
  const manage = can('stats.manage')
  const qc = useQueryClient()
  const key = ['stats-counters', guildId]
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api<Counter[]>(`/stats/counters?guildId=${guildId}`) })
  const [template, setTemplate] = useState('👥 Membres : {members}')
  const [categoryId, setCategoryId] = useState('none')
  const [deleting, setDeleting] = useState<Counter | null>(null)
  const channelName = (id: string) => options?.voiceChannels.find((c) => c.id === id)?.name ?? 'salon supprimé'

  const create = useMutation({
    mutationFn: () => api('/stats/counters', { method: 'POST', body: { guildId, template, categoryId: categoryId === 'none' ? null : categoryId } }),
    onSuccess: () => { toast.success('Compteur créé'); qc.invalidateQueries({ queryKey: key }) },
  })
  const remove = useMutation({
    mutationFn: (c: Counter) => api(`/stats/counters/${c.id}`, { method: 'DELETE', body: { confirm: true, deleteChannel: true } }),
    onSuccess: () => { toast.success('Compteur supprimé'); setDeleting(null); qc.invalidateQueries({ queryKey: key }) },
  })

  return (
    <Section title='Salons compteurs' description='Des salons vocaux verrouillés dont le nom affiche un chiffre en direct. Discord limite les renommages : mise à jour toutes les 10 minutes.'>
      <div className='grid gap-4 p-4'>
        {manage && (
          <form className='flex flex-wrap items-end gap-3' onSubmit={(e) => { e.preventDefault(); create.mutate() }}>
            <div className='grid min-w-64 flex-1 gap-1.5'>
              <Label htmlFor='ct-template'>Nom du salon</Label>
              <Input id='ct-template' value={template} maxLength={90} onChange={(e) => setTemplate(e.target.value)} />
            </div>
            <div className='grid gap-1.5'>
              <Label>Catégorie</Label>
              <Select value={categoryId} onValueChange={setCategoryId}>
                <SelectTrigger className='w-48'><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value='none'>En haut du serveur</SelectItem>
                  {options?.categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button loading={create.isPending} type='submit' disabled={create.isPending || !template.trim()}><Plus /> Créer le compteur</Button>
          </form>
        )}
        <p className='text-xs text-muted-foreground'>Variables : {(options?.variables ?? []).map((v) => `{${v}}`).join(' ')}</p>
        {!data.length ? <EmptyState title='Aucun compteur'>Crée par exemple « 👥 Membres : {'{members}'} » ou « 🎮 En jeu : {'{fivem.players}'}/{'{fivem.max}'} ».</EmptyState> : (
          <ul className='divide-y rounded-lg border'>
            {data.map((c) => (
              <li key={c.id} className='flex flex-wrap items-center gap-3 px-3 py-2'>
                <Clock className='size-4 text-muted-foreground' aria-hidden />
                <div className='min-w-48 flex-1'>
                  <div className='text-sm font-medium'>{c.lastName ?? channelName(c.channelId)}</div>
                  <div className='text-xs text-muted-foreground'>{c.template}</div>
                </div>
                {manage && <Button size='sm' variant='danger-ghost' onClick={() => setDeleting(c)}><Trash2 /> Supprimer</Button>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title='Supprimer ce compteur ?'
        desc='Le salon vocal du compteur est aussi supprimé de Discord.'
        confirmText='Supprimer'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Section>
  )
}

