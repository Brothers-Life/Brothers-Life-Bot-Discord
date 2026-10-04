import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { dateTime } from '@/lib/format'
import { Pill, Section } from '@/components/app/ui'
import { hours, money, plural } from './format'
import type { Sheet } from './types'

const axis = { stroke: 'var(--muted-foreground)', fontSize: 12, tickLine: false, axisLine: false }

// Hours played per day over the last 30 days (days without play included)
export function PlayerActivityChart({ p }: { p: Sheet }) {
  const byDay = new Map(p.activity.map((d) => [d.day, d]))
  const [now] = useState(() => Date.now())
  const days = Array.from({ length: 30 }, (_, i) => new Date(now - (29 - i) * 86_400_000).toISOString().slice(0, 10)).map((day) => ({ day, hours: byDay.get(day)?.hours ?? 0, sessions: byDay.get(day)?.sessions ?? 0 }))
  return (
    <Section title='Heures jouées sur 30 jours'>
      <div className='h-48 p-3'>
        <ResponsiveContainer>
          <BarChart data={days} margin={{ left: -20, right: 8, top: 4 }}>
            <CartesianGrid stroke='var(--border)' strokeDasharray='3 3' vertical={false} />
            <XAxis dataKey='day' tickFormatter={(d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`} {...axis} minTickGap={24} />
            <YAxis {...axis} />
            <Tooltip
              contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--popover-foreground)', fontSize: 12 }}
              labelFormatter={(d: unknown) => String(d).split('-').reverse().join('/')}
              cursor={{ fill: 'var(--accent)' }}
            />
            <Bar dataKey='hours' name='Heures' fill='var(--primary)' radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Section>
  )
}

// Sections without rows are left out: a sheet only shows what exists for this player
function List<T>({ title, description, rows, render }: { title: string; description?: string; rows: T[]; empty?: string; render: (row: T, i: number) => React.ReactNode }) {
  if (!rows.length) return null
  return (
    <Section title={title} description={description}>
      <ul className='divide-y'>{rows.map(render)}</ul>
    </Section>
  )
}

const line = 'flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2 text-sm'
const when = (at: number | null) => <span className='ms-auto text-xs text-muted-foreground tabular-nums'>{dateTime(at)}</span>

export function PlayerWork({ p }: { p: Sheet }) {
  const j = p.jobs
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
      <List title='Prises de service' description='Dernière entrée et sortie de service par métier.' rows={j.checkins} empty='Aucune prise de service' render={(c, i) => (
        <li key={i} className={line}><Pill tone='info'>{c.job}</Pill><span>{c.character}</span><span className='ms-auto text-xs text-muted-foreground'>{dateTime(c.checkin)} → {c.checkout && c.checkin && c.checkout >= c.checkin ? `${dateTime(c.checkout)} (${hours((c.checkout - c.checkin) / 1000)})` : 'en service'}</span></li>
      )} />
      <List title='Actions de métier' rows={j.actions} empty='Aucune action' render={(a, i) => (
        <li key={i} className={line}><Pill tone='neutral'>{a.job}</Pill><span>{a.action}</span>{a.amount ? <span className='font-medium'>{money(a.amount)}</span> : null}<span className='text-xs text-muted-foreground'>{a.character}</span>{when(a.at)}</li>
      )} />
      <List title='Coffres de métier et de gang' rows={j.safe} empty='Aucun mouvement' render={(s, i) => (
        <li key={i} className={line}><Pill tone={s.action.includes('withdraw') || s.action.includes('retir') ? 'warning' : 'success'}>{s.action}</Pill><span>{s.place}</span><span className='font-medium'>{s.item ? `${s.item} ×${s.amount}` : s.amount}</span>{s.reason && <span className='text-xs text-muted-foreground'>{s.reason}</span>}{when(s.at)}</li>
      )} />
      <div className='grid content-start gap-6'>
        {p.permissions.economy && (
          <List title='Paies reçues' rows={j.payroll} empty='Aucune paie' render={(r, i) => (
            <li key={i} className={line}><Pill tone={r.failed ? 'danger' : 'success'}>{r.failed ? 'échec' : 'payé'}</Pill><span>{r.job} · grade {r.grade}</span><span className='font-medium'>{money(r.amount)}</span><span className='text-xs text-muted-foreground'>{hours(r.dutySeconds)} de service</span>{when(r.at)}</li>
          )} />
        )}
        {p.permissions.economy && (
          <List title='Factures émises' rows={j.invoices} empty='Aucune facture' render={(f, i) => (
            <li key={i} className={line}><Pill tone={f.settled ? 'success' : 'warning'}>{f.settled ? 'réglée' : 'en attente'}</Pill><span>{f.job}</span><span className='font-medium'>{money(f.amount)}</span>{when(f.at)}</li>
          )} />
        )}
        {p.skills.harvested > 0 && <p className='rounded-xl border bg-card px-4 py-3 text-sm'><span className='font-display text-lg font-semibold'>{plural(p.skills.harvested, 'objet')}</span> récolté{p.skills.harvested > 1 ? 's' : ''} dans les zones de récolte</p>}
        <List title='Artisanat' rows={p.skills.crafting} empty='Rien fabriqué' render={(c, i) => (
          <li key={i} className={line}><span className='font-medium'>{c.item}</span><span>{c.crafted}/{c.requested}</span><span className='text-xs text-muted-foreground'>{c.character}</span>{when(c.at)}</li>
        )} />
      </div>
    </div>
  )
}

export function PlayerPolice({ p }: { p: Sheet }) {
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
      <List title='Recherches de la police (MDT)' description='Quand un agent a consulté ou modifié son dossier.' rows={p.police.lookups} empty='Aucune consultation' render={(l, i) => (
        <li key={i} className={line}><span className='font-medium'>{l.by}</span>{l.role && <span className='text-xs text-muted-foreground'>{l.role}</span>}<Pill tone={l.effect === 'allow' ? 'neutral' : 'warning'}>{l.field} {l.effect}</Pill>{l.reason && <span className='text-xs'>{l.reason}</span>}{when(l.at)}</li>
      )} />
      <List title='Appels passés au central' rows={p.police.calls} empty='Aucun appel' render={(c, i) => (
        <li key={i} className={line}><Pill tone='info'>{c.code}</Pill><span>{c.title}{c.place ? ` · ${c.place}` : ''}</span><Pill tone='neutral'>{c.state}</Pill>{when(c.at)}</li>
      )} />
    </div>
  )
}

export function PlayerPhone({ p }: { p: Sheet }) {
  if (!p.phone) return null
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
      <List title='Factures reçues' rows={p.phone.invoices} empty='Aucune facture' render={(f, i) => (
        <li key={i} className={line}><Pill tone={f.status === 'paid' ? 'success' : 'warning'}>{f.status}</Pill><span>{f.from}{f.title ? ` · ${f.title}` : ''}</span><span className='font-medium'>{money(f.amount)}</span><span className='text-xs text-muted-foreground'>{f.character}</span>{when(f.at)}</li>
      )} />
      <List title='Banque du téléphone' rows={p.phone.bank} empty='Aucune opération' render={(t, i) => (
        <li key={i} className={line}><Pill tone='neutral'>{t.kind}</Pill><span>{t.label}</span><span className='font-medium'>{money(t.amount)}</span><span className='text-xs text-muted-foreground'>{t.character}</span>{when(t.at)}</li>
      )} />
    </div>
  )
}

export function PlayerShop({ p }: { p: Sheet }) {
  if (!p.shop) return null
  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3'>
      <List title='Achats boutique' rows={p.shop.purchases} empty='Aucun achat' render={(b, i) => (
        <li key={i} className={line}><span>{b.label}</span><span className='font-medium'>{b.price} pts</span>{when(b.at)}</li>
      )} />
      <List title='Caisses ouvertes' rows={p.shop.crates} empty='Aucune caisse' render={(c, i) => (
        <li key={i} className={line}><Pill tone='accent'>{c.rarity ?? c.kind}</Pill><span className='min-w-0 truncate'>{c.label}</span>{c.refund ? <span className='text-xs text-muted-foreground'>+{c.refund} pts</span> : null}{when(c.at)}</li>
      )} />
      <List title='Cadeaux' rows={p.shop.gifts} empty='Aucun cadeau' render={(g, i) => (
        <li key={i} className={line}><Pill tone={g.sent ? 'info' : 'success'}>{g.sent ? 'envoyé' : `reçu de ${g.from ?? '?'}`}</Pill><span>{g.label ?? `${g.points} pts`}</span><Pill tone='neutral'>{g.status}</Pill>{when(g.at)}</li>
      )} />
    </div>
  )
}

export function PlayerStaff({ p }: { p: Sheet }) {
  const s = p.staff
  return (
    <div className='grid gap-6'>
      {s && (
        <section className='flex flex-wrap items-center gap-x-8 gap-y-3 rounded-xl border bg-card p-4'>
          <div><div className='text-xs text-muted-foreground'>Rôle staff en jeu</div><div className='flex flex-wrap gap-1'>{s.roles.map((r) => <Pill key={r} tone='accent'>{r}</Pill>)}{s.active && <Pill tone='success'>en service</Pill>}</div></div>
          <div><div className='text-xs text-muted-foreground'>En service (total)</div><div className='font-display text-lg font-semibold'>{hours(s.seconds)}</div></div>
          <div><div className='text-xs text-muted-foreground'>Ces 30 jours</div><div className='font-display text-lg font-semibold'>{hours(s.recentSeconds)}</div></div>
          <div><div className='text-xs text-muted-foreground'>Sessions</div><div className='font-display text-lg font-semibold'>{s.sessions}</div></div>
          <div><div className='text-xs text-muted-foreground'>Dernière fois</div><div className='font-display text-lg font-semibold'>{s.active ? 'maintenant' : dateTime(s.lastSeen)}</div></div>
        </section>
      )}
      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-2'>
        {s && (
          <List title='Ses actions dans le menu admin' rows={s.actions} empty='Aucune action' render={(a, i) => (
            <li key={i} className={line}><Pill tone='neutral'>{a.action}</Pill>{a.target && <span>→ {a.target}</span>}{a.details && <span className='min-w-0 truncate text-xs text-muted-foreground'>{a.details}</span>}{when(a.at)}</li>
          )} />
        )}
        <div className='grid content-start gap-6'>
          <List title='Éditeur de carte' rows={p.creations.mapEdits} empty='Aucun objet posé' render={(m, i) => (
            <li key={i} className={line}><Pill tone='neutral'>{m.action}</Pill><span className='text-xs text-muted-foreground'>{m.object}</span>{when(m.at)}</li>
          )} />
          <List title='Musique en voiture (CarPlay)' rows={p.creations.carplay} empty='Aucune musique' render={(c, i) => (
            <li key={i} className={line}><Pill tone={c.verdict === 'allowed' ? 'success' : 'warning'}>{c.verdict}</Pill><span className='min-w-0 truncate'>{c.label}</span>{when(c.at)}</li>
          )} />
        </div>
      </div>
    </div>
  )
}

