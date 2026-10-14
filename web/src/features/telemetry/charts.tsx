import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn } from '@/lib/utils'
import { EmptyState } from '@/components/app/ui'
import { compact, dt, fmt, money, moneyCompact, timeLabel } from './format'
import { PALETTE, axis, mergeSeries, tooltipStyle, type Serie } from './chart-utils'

export type { Point, Serie } from './chart-utils'

export function ChartCard({ title, actions, children, className, height = 'h-60', empty }: {
  title: string
  actions?: React.ReactNode
  children: React.ReactElement
  className?: string
  height?: string
  // Shown instead of the chart when there is nothing to draw
  empty?: string | false
}) {
  return (
    <div className={cn('min-w-0 rounded-lg border bg-card p-4', className)}>
      <div className='mb-3 flex flex-wrap items-center justify-between gap-2'>
        <h3 className='text-sm font-semibold'>{title}</h3>
        {actions}
      </div>
      {empty ? <div className={cn('grid place-items-center', height)}><EmptyState title={empty} /></div> : <div className={height}><ResponsiveContainer>{children}</ResponsiveContainer></div>}
    </div>
  )
}

// A chart over time: area (default), line or stacked bars
export function TimeChart({ series, kind = 'area', stacked, unit = 'count', yUnit }: { series: Serie[]; kind?: 'area' | 'line' | 'bar'; stacked?: boolean; unit?: 'count' | 'money'; yUnit?: string }) {
  const data = mergeSeries(series)
  const xs = data.map((d) => d.x as number)
  const span = xs.length ? xs[xs.length - 1] - xs[0] : 0
  const yFormat = (v: number) => (unit === 'money' ? moneyCompact(v) : `${compact(v)}${yUnit ? ` ${yUnit}` : ''}`)
  const common = {
    data,
    margin: { left: 0, right: 8, top: 4, bottom: 0 },
  }
  const children = [
    <CartesianGrid key='g' stroke='var(--border)' strokeDasharray='3 3' vertical={false} />,
    <XAxis key='x' dataKey='x' type='number' scale='time' domain={['dataMin', 'dataMax']} padding={kind === 'bar' ? { left: 12, right: 12 } : undefined} tickFormatter={(v) => timeLabel(Number(v), span)} {...axis} minTickGap={32} />,
    <YAxis key='y' {...axis} width={56} tickFormatter={yFormat} />,
    <Tooltip
      key='t'
      contentStyle={tooltipStyle}
      cursor={kind === 'bar' ? { fill: 'var(--accent)' } : undefined}
      labelFormatter={(v) => dt(Number(v))}
      formatter={(v, name) => [unit === 'money' ? money(Number(v)) : `${fmt(Number(v))}${yUnit ? ` ${yUnit}` : ''}`, String(name)]}
    />,
    ...(series.length > 1 ? [<Legend key='l' wrapperStyle={{ fontSize: 12 }} />] : []),
  ]
  if (kind === 'bar') {
    return (
      <BarChart {...common}>
        {children}
        {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} stackId={stacked ? 's' : undefined} fill={s.color ?? PALETTE[i % PALETTE.length]} maxBarSize={18} radius={stacked ? 0 : [3, 3, 0, 0]} />)}
      </BarChart>
    )
  }
  if (kind === 'line') {
    return (
      <LineChart {...common}>
        {children}
        {series.map((s, i) => <Line key={s.key} type='monotone' dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i % PALETTE.length]} strokeWidth={1.8} dot={false} connectNulls />)}
      </LineChart>
    )
  }
  return (
    <AreaChart {...common}>
      <defs>
        {series.map((s, i) => (
          <linearGradient key={s.key} id={`tg-${s.key}`} x1='0' y1='0' x2='0' y2='1'>
            <stop offset='0%' stopColor={s.color ?? PALETTE[i % PALETTE.length]} stopOpacity={0.35} />
            <stop offset='100%' stopColor={s.color ?? PALETTE[i % PALETTE.length]} stopOpacity={0} />
          </linearGradient>
        ))}
      </defs>
      {children}
      {series.map((s, i) => <Area key={s.key} type='monotone' dataKey={s.key} name={s.label} stroke={s.color ?? PALETTE[i % PALETTE.length]} fill={`url(#tg-${s.key})`} strokeWidth={2} connectNulls />)}
    </AreaChart>
  )
}

// Horizontal bars by label (shops, resources…)
export function HBarChart({ rows, unit = 'count', suffix, series }: {
  rows: Record<string, string | number>[]
  unit?: 'count' | 'money'
  suffix?: string
  series: { key: string; label: string; color?: string }[]
}) {
  const format = (v: number) => (unit === 'money' ? moneyCompact(v) : `${compact(v)}${suffix ? ` ${suffix}` : ''}`)
  return (
    <BarChart data={rows} layout='vertical' margin={{ left: 0, right: 12, top: 0, bottom: 0 }}>
      <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' horizontal={false} />
      <XAxis type='number' {...axis} tickFormatter={format} />
      <YAxis type='category' dataKey='name' {...axis} width={110} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
      <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--accent)' }} formatter={(v, name) => [unit === 'money' ? money(Number(v)) : `${fmt(Number(v))}${suffix ? ` ${suffix}` : ''}`, String(name)]} />
      {series.length > 1 && <Legend wrapperStyle={{ fontSize: 12 }} />}
      {series.map((s, i) => <Bar key={s.key} dataKey={s.key} name={s.label} fill={s.color ?? PALETTE[i % PALETTE.length]} radius={[0, 4, 4, 0]} maxBarSize={20} />)}
    </BarChart>
  )
}

export function Donut({ rows }: { rows: { name: string; n: number }[] }) {
  return (
    <PieChart>
      <Pie data={rows} dataKey='n' nameKey='name' innerRadius='50%' outerRadius='80%' paddingAngle={1} stroke='var(--card)'>
        {rows.map((r, i) => <Cell key={r.name} fill={PALETTE[i % PALETTE.length]} />)}
      </Pie>
      <Tooltip contentStyle={tooltipStyle} formatter={(v, name) => [fmt(Number(v)), String(name)]} />
      <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign='bottom' />
    </PieChart>
  )
}
