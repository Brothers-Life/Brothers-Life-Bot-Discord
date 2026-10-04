import { useState } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Inbox, Plus, Save, Scale, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, Role } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, StatCards, UserAvatar } from '@/components/app/ui'
import { ChannelSelect, RolesPicker } from '@/components/app/pickers'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/appeals')({
  component: AppealsPage,
})

type Person = { name: string | null; avatar: string | null } | null
type Appeal = {
  id: number; sanctionId: number; userId: string; status: 'pending' | 'accepted' | 'rejected'; answers: { question: string; answer: string }[]
  decidedBy: string | null; decisionReason: string | null; createdAt: number; decidedAt: number | null
  sanction: { id: number; type: string; reason: string | null; createdAt: number; expiresAt: number | null; revokedAt: number | null; moderatorId: string }
  user: Person; decider: Person; moderator: Person
}
type Config = { enabled: boolean; guildId: string | null; channelId: string | null; pingRoleIds: string[]; types: string[]; cooldownDays: number; questions: string[] }
type Payload = { appeals: Appeal[]; config: Config; guilds: { id: string; name: string; channels: Channel[]; roles: Role[] }[] }

const TYPES: Record<string, string> = { ban: 'Ban', timeout: 'Timeout', warn: 'Avertissement', restrict: 'Restriction' }
const STATUS = { pending: { label: 'En attente', tone: 'warning' }, accepted: { label: 'Accepté', tone: 'success' }, rejected: { label: 'Refusé', tone: 'danger' } } as const

function AppealsPage() {
  const { can } = useMe()
  const { data, isLoading } = useQuery({ queryKey: ['appeals'], queryFn: () => api<Payload>('/appeals'), refetchInterval: 30_000 })
  const [filter, setFilter] = useState<'pending' | 'all'>('pending')
  const [deciding, setDeciding] = useState<{ appeal: Appeal; accepted: boolean } | null>(null)
  const list = (data?.appeals ?? []).filter((a) => filter === 'all' || a.status === 'pending')
  const count = (s: Appeal['status']) => data?.appeals.filter((a) => a.status === s).length ?? 0

  return (
    <Page title='Appels de sanction' description='Quand c’est activé, chaque MP de sanction contient un bouton « Faire appel ». La personne répond à quelques questions ; le staff accepte (la sanction est levée) ou refuse, ici ou avec les boutons du salon staff.'>
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          <StatCards items={[
            { label: 'En attente', value: count('pending'), icon: Inbox, tone: 'warning' },
            { label: 'Acceptés', value: count('accepted'), icon: Check, tone: 'success' },
            { label: 'Refusés', value: count('rejected'), icon: X, tone: 'danger' },
          ]} />
          <Section
            title='Appels'
            actions={
              <Select value={filter} onValueChange={(v) => setFilter(v as 'pending' | 'all')}>
                <SelectTrigger className='w-40' aria-label='Filtre'><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value='pending'>En attente</SelectItem><SelectItem value='all'>Tous</SelectItem></SelectContent>
              </Select>
            }
          >
            {!list.length ? <EmptyState title={filter === 'pending' ? 'Aucun appel en attente' : 'Aucun appel'} icon={Scale}>{data.config.enabled ? 'Les appels arrivent ici dès qu’une personne sanctionnée en dépose un.' : 'Active les appels dans les réglages ci-dessous.'}</EmptyState> : (
              <ul className='divide-y'>
                {list.map((a) => (
                  <li key={a.id} className='grid gap-3 px-4 py-4'>
                    <div className='flex flex-wrap items-center gap-2'>
                      <UserAvatar src={a.user?.avatar} name={a.user?.name ?? '?'} className='size-8' />
                      <Link to='/people' search={{ id: a.userId }} className='font-medium hover:underline'>{a.user?.name ?? a.userId}</Link>
                      <Pill tone='neutral'>{TYPES[a.sanction.type] ?? a.sanction.type} #{a.sanctionId}</Pill>
                      <Pill tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Pill>
                      <span className='text-xs text-muted-foreground'>déposé le {dateTime(a.createdAt)}</span>
                    </div>
                    <p className='text-sm text-muted-foreground'>Sanction du {dateTime(a.sanction.createdAt)} par {a.moderator?.name ?? a.sanction.moderatorId}{a.sanction.reason ? ` · « ${a.sanction.reason} »` : ''}</p>
                    <dl className='grid gap-2 rounded-lg border bg-muted/30 p-3'>
                      {a.answers.map((x, i) => (
                        <div key={i}><dt className='text-xs font-medium text-muted-foreground'>{x.question}</dt><dd className='text-sm whitespace-pre-line [overflow-wrap:anywhere]'>{x.answer || '—'}</dd></div>
                      ))}
                    </dl>
                    {a.status !== 'pending' && <p className='text-sm'>{a.status === 'accepted' ? 'Accepté' : 'Refusé'} par {a.decider?.name ?? a.decidedBy} le {dateTime(a.decidedAt)}{a.decisionReason ? ` · ${a.decisionReason}` : ''}</p>}
                    {a.status === 'pending' && can('sanctions.revoke') && (
                      <div className='flex flex-wrap gap-2'>
                        <Button size='sm' variant='success' onClick={() => setDeciding({ appeal: a, accepted: true })}><Check /> Accepter et lever</Button>
                        <Button size='sm' variant='danger-outline' onClick={() => setDeciding({ appeal: a, accepted: false })}><X /> Refuser</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {can('appeals.manage') && <Settings key={JSON.stringify(data.config)} data={data} />}
        </div>
      )}
      {deciding && <DecideDialog appeal={deciding.appeal} accepted={deciding.accepted} onClose={() => setDeciding(null)} />}
    </Page>
  )
}

function DecideDialog({ appeal, accepted, onClose }: { appeal: Appeal; accepted: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const decide = useMutation({
    mutationFn: () => api(`/appeals/${appeal.id}/decide`, { method: 'POST', body: { accepted, reason } }),
    onSuccess: () => { toast.success(accepted ? 'Appel accepté, sanction levée' : 'Appel refusé'); qc.invalidateQueries({ queryKey: ['appeals'] }); onClose() },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{accepted ? 'Accepter l’appel' : 'Refuser l’appel'}</DialogTitle>
          <DialogDescription>{accepted ? `La sanction #${appeal.sanctionId} sera levée sur tout le réseau.` : 'La personne reçoit la raison en message privé.'}</DialogDescription>
        </DialogHeader>
        <div className='grid gap-1.5'>
          <Label htmlFor='decision'>{accepted ? 'Mot pour la personne (facultatif)' : 'Raison du refus'}</Label>
          <Textarea id='decision' rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button variant={accepted ? 'success' : 'destructive'} loading={decide.isPending} disabled={!accepted && !reason.trim()} onClick={() => decide.mutate()}>{accepted ? 'Accepter' : 'Refuser'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Settings({ data }: { data: Payload }) {
  const qc = useQueryClient()
  const [c, setC] = useState<Config>({ ...data.config, guildId: data.config.guildId ?? data.guilds[0]?.id ?? null })
  const guild = data.guilds.find((g) => g.id === c.guildId)
  const save = useMutation({ mutationFn: () => api('/appeals/config', { method: 'PUT', body: c }), onSuccess: () => { toast.success('Réglages enregistrés'); qc.invalidateQueries({ queryKey: ['appeals'] }) } })
  return (
    <Section title='Réglages' actions={<Button size='sm' loading={save.isPending} onClick={() => save.mutate()}><Save /> Enregistrer</Button>}>
      <div className='grid gap-5 p-4'>
        <label className='flex items-center gap-2 text-sm font-medium'><Switch checked={c.enabled} onCheckedChange={(enabled) => setC({ ...c, enabled })} /> Appels ouverts</label>
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
          <div className='grid gap-1.5'>
            <Label>Serveur du salon staff</Label>
            <Select value={c.guildId ?? ''} onValueChange={(guildId) => setC({ ...c, guildId, channelId: null, pingRoleIds: [] })}>
              <SelectTrigger aria-label='Serveur'><SelectValue /></SelectTrigger>
              <SelectContent>{data.guilds.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className='grid gap-1.5'>
            <Label>Salon où arrivent les appels</Label>
            <ChannelSelect channels={guild?.channels ?? []} value={c.channelId} onChange={(channelId) => setC({ ...c, channelId })} label='Salon des appels' noneLabel='Choisir un salon' />
          </div>
        </div>
        <div className='grid gap-1.5'>
          <Label>Rôles mentionnés à chaque appel</Label>
          <RolesPicker roles={guild?.roles ?? []} value={c.pingRoleIds} onChange={(pingRoleIds) => setC({ ...c, pingRoleIds })} label='Rôles mentionnés' placeholder='Personne' />
        </div>
        <div className='grid gap-2'>
          <Label>Sanctions qui peuvent faire l’objet d’un appel</Label>
          <div className='flex flex-wrap gap-4'>
            {Object.entries(TYPES).map(([type, label]) => (
              <label key={type} className='flex items-center gap-2 text-sm'>
                <Checkbox checked={c.types.includes(type)} onCheckedChange={(on) => setC({ ...c, types: on ? [...c.types, type] : c.types.filter((t) => t !== type) })} />{label}
              </label>
            ))}
          </div>
          <p className='text-xs text-muted-foreground'>Les expulsions ne s’annulent pas : pas d’appel pour elles.</p>
        </div>
        <div className='grid gap-1.5 sm:max-w-xs'>
          <Label htmlFor='cooldown'>Délai avant un nouvel appel après un refus (jours)</Label>
          <Input id='cooldown' type='number' min={0} max={365} value={c.cooldownDays} onChange={(e) => setC({ ...c, cooldownDays: Number(e.target.value) })} />
        </div>
        <div className='grid gap-2'>
          <Label>Questions (45 caractères max, la première est obligatoire)</Label>
          {c.questions.map((q, i) => (
            <div key={i} className='flex gap-2'>
              <Input value={q} maxLength={45} aria-label={`Question ${i + 1}`} onChange={(e) => setC({ ...c, questions: c.questions.map((x, j) => (j === i ? e.target.value : x)) })} />
              <Button size='icon' variant='danger-ghost' aria-label='Retirer la question' disabled={c.questions.length <= 1} onClick={() => setC({ ...c, questions: c.questions.filter((_, j) => j !== i) })}><Trash2 /></Button>
            </div>
          ))}
          {c.questions.length < 5 && <div><Button size='sm' variant='ghost' onClick={() => setC({ ...c, questions: [...c.questions, ''] })}><Plus /> Question</Button></div>}
        </div>
      </div>
    </Section>
  )
}
