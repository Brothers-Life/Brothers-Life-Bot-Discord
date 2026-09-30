import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'

export type DayPoint = { day: string; messages: number; voiceHours: number; active: number; joins: number; leaves: number; memberCount: number | null }

const shortDay = (day: string) => {
  const [, m, d] = day.split('-')
  return `${d}/${m}`
}
const n = (v: number) => v.toLocaleString('fr-FR')

const axis = { stroke: 'var(--muted-foreground)', fontSize: 12, tickLine: false, axisLine: false }
const tooltip = {
  contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)', fontSize: 12 },
  labelFormatter: (label: unknown) => shortDay(String(label)),
  formatter: (value: unknown) => n(Number(value)),
}

function Frame({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <h3 className='mb-3 text-sm font-semibold'>{title}</h3>
      <div className='h-64'>{children}</div>
    </div>
  )
}

export function ActivityChart({ days }: { days: DayPoint[] }) {
  return (
    <Frame title='Messages et membres actifs' className='lg:col-span-2'>
      <ResponsiveContainer>
        <AreaChart data={days} margin={{ left: -12, right: 8, top: 4 }}>
          <defs>
            <linearGradient id='g-messages' x1='0' y1='0' x2='0' y2='1'>
              <stop offset='0%' stopColor='var(--primary)' stopOpacity={0.45} />
              <stop offset='100%' stopColor='var(--primary)' stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
          <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
          <YAxis yAxisId='left' {...axis} />
          <YAxis yAxisId='right' orientation='right' {...axis} />
          <Tooltip {...tooltip} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Area yAxisId='left' type='monotone' dataKey='messages' name='Messages' stroke='var(--primary)' fill='url(#g-messages)' strokeWidth={2} />
          <Line yAxisId='right' type='monotone' dataKey='active' name='Membres actifs' stroke='var(--success)' strokeWidth={2} dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </Frame>
  )
}

export function VoiceChart({ days }: { days: DayPoint[] }) {
  return (
    <Frame title='Heures de vocal'>
      <ResponsiveContainer>
        <BarChart data={days} margin={{ left: -12, right: 8, top: 4 }}>
          <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
          <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
          <YAxis {...axis} />
          <Tooltip {...tooltip} cursor={{ fill: 'var(--accent)' }} />
          <Bar dataKey='voiceHours' name='Heures' fill='var(--chart-2, #5b9cf6)' radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  )
}

export function MembersChart({ days }: { days: DayPoint[] }) {
  return (
    <Frame title='Arrivées et départs'>
      <ResponsiveContainer>
        <BarChart data={days} margin={{ left: -12, right: 8, top: 4 }}>
          <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
          <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
          <YAxis {...axis} allowDecimals={false} />
          <Tooltip {...tooltip} cursor={{ fill: 'var(--accent)' }} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey='joins' name='Arrivées' fill='var(--success)' radius={[4, 4, 0, 0]} />
          <Bar dataKey='leaves' name='Départs' fill='var(--destructive)' radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Frame>
  )
}

export function MemberCountChart({ days }: { days: DayPoint[] }) {
  const data = days.filter((d) => d.memberCount !== null)
  return (
    <Frame title='Nombre de membres'>
      {data.length < 2
        ? <p className='grid h-full place-items-center text-sm text-muted-foreground'>La courbe apparaît après quelques jours de collecte.</p>
        : (
          <ResponsiveContainer>
            <LineChart data={data} margin={{ left: -4, right: 8, top: 4 }}>
              <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
              <XAxis dataKey='day' tickFormatter={shortDay} {...axis} minTickGap={24} />
              <YAxis {...axis} domain={['dataMin - 5', 'dataMax + 5']} allowDecimals={false} />
              <Tooltip {...tooltip} />
              <Line type='monotone' dataKey='memberCount' name='Membres' stroke='var(--warning)' strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
    </Frame>
  )
}

const WEEK = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']

// Weekday x hour, the darker the busier
export function Heatmap({ grid, metric }: { grid: { messages: number; voiceHours: number }[][]; metric: 'messages' | 'voiceHours' }) {
  const max = Math.max(1, ...grid.flat().map((c) => c[metric]))
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[640px] table-fixed border-separate border-spacing-0.5 text-xs'>
        <thead>
          <tr>
            <th className='w-10' />
            {Array.from({ length: 24 }, (_, h) => <th key={h} className='font-normal text-muted-foreground'>{h % 3 === 0 ? `${h}h` : ''}</th>)}
          </tr>
        </thead>
        <tbody>
          {grid.map((row, d) => (
            <tr key={d}>
              <th className='pe-2 text-end font-normal text-muted-foreground'>{WEEK[d]}</th>
              {row.map((cell, h) => {
                const value = cell[metric]
                const ratio = value / max
                return (
                  <td
                    key={h}
                    title={`${WEEK[d]} ${h}h : ${n(value)} ${metric === 'messages' ? 'messages' : 'h de vocal'}`}
                    className='h-7 rounded-[3px] transition-colors'
                    style={{ background: value ? `color-mix(in oklab, var(--primary) ${Math.round(15 + ratio * 85)}%, transparent)` : 'var(--muted)' }}
                  />
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
