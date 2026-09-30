import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDownUp, Download, Gavel, Headphones, LifeBuoy, Save, Trophy, Users } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, StatCards, UserAvatar, RankBadge } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export const Route = createFileRoute('/_authenticated/staff-activity')({
  component: StaffActivityPage,
})

type Member = {
  userId: string; name: string; avatar: string | null; level: number; ranks: { id: number; name: string; color: string | null }[]
  ticketsClosed: number; ticketsClaimed: number; ticketReplies: number; rating: number | null; sanctions: number; sanctionsDetail: { bans: number; warns: number; timeouts: number }
  dmReplies: number; panelActions: number; messages: number; voiceHours: number; absentDays: number; score: number
}
type Data = { from: number; to: number; weights: Record<string, number>; members: Member[]; config: { enabled: boolean; guildId: string | null; channelId: string | null } | null; guilds: { id: string; name: string; channels: Channel[] }[] }
type SortKey = 'score' | 'ticketsClosed' | 'ticketReplies' | 'sanctions' | 'dmReplies' | 'panelActions' | 'messages' | 'voiceHours' | 'absentDays'

const DAY = 86_400_000
const COLUMNS: { key: SortKey; label: string; hint?: string }[] = [
  { key: 'score', label: 'Score' },
  { key: 'ticketsClosed', label: 'Tickets', hint: 'fermés' },
  { key: 'ticketReplies', label: 'Réponses', hint: 'en ticket' },
  { key: 'sanctions', label: 'Sanctions' },
  { key: 'dmReplies', label: 'MP' },
  { key: 'panelActions', label: 'Panel', hint: 'actions' },
  { key: 'messages', label: 'Messages' },
  { key: 'voiceHours', label: 'Vocal', hint: 'heures' },
  { key: 'absentDays', label: 'Absence', hint: 'jours' },
]

// Periods as [from, to]
function periodOf(key: string, at: number): [number, number] {
  const d = new Date(at)
  if (key === 'month') return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), at]
  if (key === 'lastMonth') return [new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), new Date(d.getFullYear(), d.getMonth(), 1).getTime() - 1]
  return [at - Number(key) * DAY, at]
}

function StaffActivityPage() {
  const { can } = useMe()
  const [period, setPeriod] = useState('30')
  const [now] = useState(() => Date.now())
  const [from, to] = periodOf(period, now)
  const [sort, setSort] = useState<SortKey>('score')
  const { data } = useQuery({ queryKey: ['staff-activity', from, to], queryFn: () => api<Data>(`/staff-activity?from=${from}&to=${to}`) })
  const members = [...(data?.members ?? [])].sort((a, b) => (b[sort] as number) - (a[sort] as number))
  const max = (key: SortKey) => Math.max(1, ...members.map((m) => m[key] as number))
  const sum = (key: keyof Member) => members.reduce((n, m) => n + (m[key] as number), 0)

  return (
    <Page
      title='Activité du staff'
      description='Ce que chaque membre du staff a fait : tickets, sanctions, MP, actions dans le panel, présence sur Discord et absences. Le score résume le tout, avec des coefficients affichés en bas de page.'
      actions={
        <div className='flex gap-2'>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className='w-48' aria-label='Période'><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value='7'>7 derniers jours</SelectItem><SelectItem value='30'>30 derniers jours</SelectItem><SelectItem value='90'>90 derniers jours</SelectItem>
              <SelectItem value='month'>Ce mois-ci</SelectItem><SelectItem value='lastMonth'>Le mois dernier</SelectItem>
            </SelectContent>
          </Select>
          <Button variant='outline' asChild><a href={`/api/staff-activity/export?from=${from}&to=${to}`}><Download /> CSV</a></Button>
        </div>
      }
    >
      {!data ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards items={[
            { label: 'Membres du staff', value: members.length, icon: Users, tone: 'accent' },
            { label: 'Tickets fermés', value: sum('ticketsClosed'), icon: LifeBuoy, tone: 'success' },
            { label: 'Sanctions', value: sum('sanctions'), icon: Gavel, tone: 'warning' },
            { label: 'Heures de vocal', value: Math.round(sum('voiceHours')), icon: Headphones, tone: 'info' },
          ]} />

          {members.length >= 3 && sort === 'score' && (
            <div className='stagger grid gap-3 sm:grid-cols-3'>
              {[1, 0, 2].map((i) => {
                const m = members[i]
                return (
                  <div key={m.userId} className={cn('brackets flex flex-col items-center gap-2 rounded-xl border bg-card p-5 text-center', i === 0 && 'sm:-translate-y-3 border-brand/40')}>
                    <Trophy className={cn('size-6', i === 0 ? 'text-brand' : i === 1 ? 'text-muted-foreground' : 'text-warning')} />
                    <UserAvatar src={m.avatar} name={m.name} className='size-14' />
                    <div className='font-display text-lg font-semibold'>{m.name}</div>
                    <div className='font-display text-3xl font-bold text-primary tabular-nums'>{m.score}</div>
                    <div className='text-xs text-muted-foreground'>{m.ticketsClosed} tickets · {m.sanctions} sanctions · {m.voiceHours} h vocal</div>
                  </div>
                )
              })}
            </div>
          )}

          <Section title='Détail par membre'>
            {!members.length ? <EmptyState title='Aucun membre du staff' icon={Users}>Donne des rangs dans le panel pour voir leur activité.</EmptyState> : (
              <div className='overflow-x-auto'>
                <table className='w-full min-w-[56rem] text-sm'>
                  <thead>
                    <tr className='border-b text-xs text-muted-foreground'>
                      <th className='px-4 py-2 text-start font-medium'>Membre</th>
                      {COLUMNS.map((c) => (
                        <th key={c.key} className='px-2 py-2 text-end font-medium'>
                          <button type='button' onClick={() => setSort(c.key)} aria-pressed={sort === c.key} className={cn('inline-flex items-center gap-1 hover:text-foreground', sort === c.key && 'text-primary')}>
                            {c.label}{c.hint && <span className='hidden xl:inline'> ({c.hint})</span>}{sort === c.key && <ArrowDownUp className='size-3' />}
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className='divide-y'>
                    {members.map((m, i) => (
                      <tr key={m.userId} className='row-enter transition-colors hover:bg-accent/30'>
                        <td className='px-4 py-2'>
                          <div className='flex items-center gap-2'>
                            <span className='w-5 text-xs text-muted-foreground tabular-nums'>{i + 1}</span>
                            <UserAvatar src={m.avatar} name={m.name} className='size-7' />
                            <div className='min-w-0'>
                              <div className='truncate font-medium'>{m.name}</div>
                              <div className='flex gap-1'>{m.ranks.slice(0, 2).map((r) => <RankBadge key={r.id} name={r.name} color={r.color} className='py-0 text-[10px]' />)}</div>
                            </div>
                          </div>
                        </td>
                        {COLUMNS.map((c) => {
                          const value = m[c.key] as number
                          return (
                            <td key={c.key} className='px-2 py-2 text-end tabular-nums'>
                              <div className='grid justify-items-end gap-1'>
                                <span className={cn(c.key === 'score' && 'font-display font-semibold text-primary', c.key === 'absentDays' && value > 0 && 'text-warning')}>
                                  {value}{c.key === 'ticketsClosed' && m.rating ? <span className='ms-1 text-xs text-muted-foreground'>★{m.rating}</span> : null}
                                </span>
                                {c.key !== 'absentDays' && <span className='h-1 rounded-full bg-brand/70 transition-[width] duration-500' style={{ width: `${Math.round((value / max(c.key)) * 100) * 0.6}px` }} aria-hidden />}
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <p className='text-xs text-muted-foreground'>
            Score = {Object.entries(data.weights).map(([k, w]) => `${COLUMNS.find((c) => c.key === k)?.label ?? k} × ${w}`).join(' + ')}. Les jours d’absence sont affichés mais ne comptent pas contre la personne.
          </p>

          {can('staffactivity.manage') && data.config && <MonthlySettings key={JSON.stringify(data.config)} data={data} />}
        </div>
      )}
    </Page>
  )
}

function MonthlySettings({ data }: { data: Data }) {
  const qc = useQueryClient()
  const [c, setC] = useState(data.config!)
  const [guildId, setGuildId] = useState(c.guildId ?? data.guilds[0]?.id ?? '')
  const save = useMutation({ mutationFn: () => api('/staff-activity/config', { method: 'PUT', body: { ...c, guildId } }), onSuccess: () => { toast.success('Réglages enregistrés'); qc.invalidateQueries({ queryKey: ['staff-activity'] }) } })
  return (
    <Section title='Rapport mensuel' description='Le 1er de chaque mois, le classement du mois écoulé est publié dans un salon du staff.' actions={<Button size='sm' loading={save.isPending} onClick={() => save.mutate()}><Save /> Enregistrer</Button>}>
      <div className='grid gap-4 p-4 sm:grid-cols-3 sm:items-end'>
        <label className='flex items-center gap-2 text-sm'><Switch checked={c.enabled} onCheckedChange={(enabled) => setC({ ...c, enabled })} /> Publier chaque mois</label>
        <div className='grid gap-1.5'>
          <Label>Serveur</Label>
          <Select value={guildId} onValueChange={(v) => { setGuildId(v); setC({ ...c, channelId: null }) }}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className='grid gap-1.5'>
          <Label>Salon</Label>
          <ChannelSelect channels={data.guilds.find((g) => g.id === guildId)?.channels ?? []} value={c.channelId} onChange={(channelId) => setC({ ...c, channelId })} label='Salon du rapport' noneLabel='Choisir un salon' />
        </div>
      </div>
    </Section>
  )
}
