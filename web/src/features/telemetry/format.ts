// Formatting of the FiveM telemetry views. PostgreSQL sends numerics and counts as strings: always go through num().
import { formatDistanceToNowStrict } from 'date-fns'
import { fr } from 'date-fns/locale'

export type Value = number | string | null | undefined

export const num = (v: Value): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
export const n0 = (v: Value) => num(v) ?? 0

const fmtInt = new Intl.NumberFormat('fr-FR')
const fmtCompact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 })

export const fmt = (v: Value) => (num(v) === null ? '–' : fmtInt.format(Math.round(num(v)!)))
export const compact = (v: Value) => (num(v) === null ? '–' : fmtCompact.format(num(v)!))
export const money = (v: Value) => (num(v) === null ? '–' : `${fmtInt.format(Math.round(num(v)!))} $`)
export const moneyCompact = (v: Value) => (num(v) === null ? '–' : `${fmtCompact.format(num(v)!)} $`)
export const decimal = (v: Value, digits = 1) => (num(v) === null ? '–' : num(v)!.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }))
export const percent = (v: Value, digits = 2) => (num(v) === null ? '–' : `${decimal(v, digits)} %`)

// Milliseconds of a timestamp: epoch ms (number or numeric string) or ISO date
export const msOf = (v: Value | Date): number => {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number') return v
  if (typeof v === 'string' && /^\d+(\.\d+)?$/.test(v)) return Number(v)
  return v ? new Date(v).getTime() : NaN
}

export const dt = (v: Value) => {
  const ms = msOf(v)
  return Number.isFinite(ms) ? new Date(ms).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–'
}
export const clock = (v: Value) => {
  const ms = msOf(v)
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '–'
}
export const rel = (v: Value) => {
  const ms = msOf(v)
  if (!Number.isFinite(ms)) return '–'
  if (Date.now() - ms < 60_000) return 'à l’instant'
  return formatDistanceToNowStrict(new Date(ms), { addSuffix: true, locale: fr })
}

// FiveM colour codes (^1, ^7…) out of console and chat lines
export const clean = (s: unknown) => String(s ?? '').replace(/\^\d/g, '')

export const bytes = (v: Value) => {
  const units = ['o', 'Ko', 'Mo', 'Go', 'To']
  let b = n0(v)
  let i = 0
  while (b >= 1024 && i < units.length - 1) {
    b /= 1024
    i++
  }
  return `${i ? b.toLocaleString('fr-FR', { maximumFractionDigits: b < 10 ? 1 : 0 }) : b} ${units[i]}`
}

// Axis label of a time scale: hour for a day, date beyond
export function timeLabel(ms: number, span: number) {
  const d = new Date(ms)
  if (span > 4 * 86400e3) return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
  if (span > 36 * 3600e3) return `${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.getHours()}h`
  return d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

export const plural = (n: number, word: string, many = `${word}s`) => `${fmt(n)} ${n > 1 ? many : word}`
