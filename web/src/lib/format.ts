import { formatDistanceToNowStrict, format } from 'date-fns'
import { fr } from 'date-fns/locale'

export function ago(at: number | string | null | undefined): string {
  if (!at) return '—'
  return formatDistanceToNowStrict(new Date(at), { addSuffix: true, locale: fr })
}

export function dateTime(at: number | string | null | undefined): string {
  if (!at) return '—'
  return format(new Date(at), 'dd/MM/yyyy HH:mm', { locale: fr })
}

export function time(at: number): string {
  return format(new Date(at), 'HH:mm:ss')
}

export function duration(ms: number | null | undefined): string {
  if (!ms) return '—'
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d) return `${d} j ${h} h`
  if (h) return `${h} h ${m} min`
  return `${m} min`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} o`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} Ko`
  return `${(n / 1024 ** 2).toFixed(1)} Mo`
}

export function userName(user: { username?: string | null; globalName?: string | null; id: string }): string {
  return user.globalName || user.username || user.id
}
