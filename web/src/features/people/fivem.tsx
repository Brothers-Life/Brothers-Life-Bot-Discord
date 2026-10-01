import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Gamepad2 } from 'lucide-react'
import { api } from '@/lib/api'
import { dateTime } from '@/lib/format'
import { Pill } from '@/components/app/ui'
import { Button } from '@/components/ui/button'

type Group = { label: string; gradeLabel: string | null }
type Linked = {
  userId: number | null
  summary: { userId: number; username: string; characters: { citizenId: string; name: string; job: Group | null; gang: Group | null }[]; lastSeen: number | null; online: boolean; playSeconds: number; sessions: number } | null
}

const hours = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h` : `${Math.round(s / 60)} min`)

// The FiveM account linked to this Discord member (silent when the FiveM base is off or no account is linked)
export function FivemLink({ userId }: { userId: string }) {
  const { data } = useQuery({ queryKey: ['fivem-by-discord', userId], queryFn: () => api<Linked>(`/fivem-data/by-discord/${userId}`), retry: false })
  const s = data?.summary
  if (!s) return null
  return (
    <section className='flex flex-wrap items-center gap-4 rounded-lg border bg-card px-4 py-3'>
      <Gamepad2 className='size-5 text-primary' aria-hidden />
      <div className='min-w-0 flex-1'>
        <div className='flex flex-wrap items-center gap-2 font-medium'>
          Compte FiveM {s.username}
          {s.online ? <Pill tone='success'>En jeu</Pill> : <span className='text-xs font-normal text-muted-foreground'>{s.lastSeen ? `vu ${dateTime(s.lastSeen)}` : 'jamais vu'}</span>}
        </div>
        <div className='mt-1 flex flex-wrap gap-1'>
          {s.characters.map((c) => <Pill key={c.citizenId} tone='neutral'>{c.name}{c.job ? ` · ${c.job.label}${c.job.gradeLabel ? ` (${c.job.gradeLabel})` : ''}` : ''}{c.gang ? ` · ${c.gang.label}` : ''}</Pill>)}
        </div>
      </div>
      <div className='text-end text-sm'>
        <div className='font-display text-lg font-semibold tabular-nums'>{hours(s.playSeconds)}</div>
        <div className='text-xs text-muted-foreground'>{s.sessions} session{s.sessions > 1 ? 's' : ''}</div>
      </div>
      <Button variant='outline' size='sm' asChild>
        <Link to='/fivem-players' search={{ id: s.userId }}>Fiche complète</Link>
      </Button>
    </section>
  )
}
