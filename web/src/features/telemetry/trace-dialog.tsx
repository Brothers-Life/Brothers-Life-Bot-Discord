import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Notice } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { dt, money, n0 } from './format'
import { JournalItem, type JournalEntry } from './journal'
import { QueryError } from './ui'

type Balance = { ts: string; cash: number | string | null; bank: number | string | null } | null
type Trace = {
  cid: string
  windowMin: number
  before: Balance
  after: Balance
  flows: { ts: string; data: Record<string, unknown> }[]
  purchases: { ts: string; shop: string | null; article: string | null; qty: number | null; total: number | string | null }[]
  events: { ts: string; type: string; subtype: string | null; data: Record<string, unknown> }[]
  staff: { ts: string; data: Record<string, unknown> }[]
}

export type TraceTarget = { cid: string; ts: string; name?: string | null }

const balance = (b: Balance) => (b ? n0(b.cash) + n0(b.bank) : null)

function Part({ title, items, cid, empty }: { title: string; items: JournalEntry[]; cid: string; empty: string }) {
  return (
    <div className='grid gap-1'>
      <h3 className='text-xs font-semibold tracking-wide text-muted-foreground uppercase'>{title}</h3>
      {items.length ? <ul className='divide-y rounded-md border'>{items.map((it, i) => <JournalItem key={i} it={it} cid={cid} />)}</ul> : <p className='text-sm text-muted-foreground'>{empty}</p>}
    </div>
  )
}

// Where a money jump comes from: everything about the player in the hour before it (and 5 minutes after)
export function TraceDialog({ target, onClose }: { target: TraceTarget | null; onClose: () => void }) {
  const trace = useQuery({
    queryKey: ['telemetry', 'trace', target?.cid, target?.ts],
    queryFn: () => api<Trace>(`/telemetry/trace?cid=${encodeURIComponent(target!.cid)}&ts=${encodeURIComponent(target!.ts)}&min=60`),
    enabled: Boolean(target),
  })
  const d = trace.data
  const flows: JournalEntry[] = (d?.flows ?? []).map((f) => ({ ts: f.ts, kind: 'bank_flow', data: f.data }))
  const purchases: JournalEntry[] = (d?.purchases ?? []).map((p) => ({ ts: p.ts, kind: 'purchase', data: { shop: p.shop, article: p.article, qty: p.qty, total: p.total } }))
  const events: JournalEntry[] = (d?.events ?? []).map((e) => ({ ts: e.ts, kind: e.subtype || e.type, data: e.data }))
  const staff: JournalEntry[] = (d?.staff ?? []).map((s) => ({ ts: s.ts, kind: 'admin_action', data: s.data }))
  const explained = flows.length > 0 || staff.length > 0
  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => { if (!o) onClose() }}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>Origine du saut d’argent · {target?.name || target?.cid}</DialogTitle>
          <DialogDescription>Tout ce qui concerne ce joueur dans l’heure qui précède le saut (et 5 min après).</DialogDescription>
        </DialogHeader>
        {trace.error ? <QueryError error={trace.error} /> : !d ? <Skeleton className='h-60 w-full' /> : (
          <div className='grid gap-4'>
            <div className='flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 p-3 text-sm'>
              <div className='grid'><span className='text-xs text-muted-foreground'>Avant ({d.before ? dt(d.before.ts) : '–'})</span><b className='font-display text-lg'>{money(balance(d.before))}</b></div>
              <ArrowRight className='size-4 text-muted-foreground' aria-hidden />
              <div className='grid'><span className='text-xs text-muted-foreground'>Après ({d.after ? dt(d.after.ts) : 'pas encore de relevé'})</span><b className='font-display text-lg'>{money(balance(d.after))}</b></div>
            </div>
            <Part title='Flux bancaires' items={flows} cid={d.cid} empty='Aucun virement ni dépôt enregistré : l’argent ne vient pas de la banque.' />
            <Part title='Achats' items={purchases} cid={d.cid} empty='Aucun achat.' />
            <Part title='Autres événements' items={events} cid={d.cid} empty='Rien d’autre.' />
            <Part title='Actions staff mentionnant ce joueur' items={staff} cid={d.cid} empty='Aucune.' />
            <Notice tone={explained ? 'info' : 'warning'} title='Conclusion'>
              {explained
                ? 'Les mouvements ci-dessus expliquent au moins en partie ce montant.'
                : 'Aucun virement ni action staff n’explique ce montant : à vérifier (script, exploit, give manuel non tracé).'}
            </Notice>
            <div>
              <Button asChild variant='outline' size='sm' onClick={onClose}>
                <Link to='/telemetry/players/$cid' params={{ cid: d.cid }}>Ouvrir la fiche du joueur</Link>
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
