import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Megaphone, Send } from 'lucide-react'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { EmptyState, Notice, Page, Pill, Section, type Tone } from '@/components/app/ui'
import { useConfirm } from '@/components/app/confirm'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import type { Command } from '@/features/telemetry/types'
import { QueryError, Segmented, When } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/telemetry/announce')({
  component: TelemetryAnnounce,
})

type Mode = 'both' | 'chat' | 'notify'
type Kind = 'inform' | 'success' | 'warning' | 'error'
const MODES: { value: Mode; label: string }[] = [{ value: 'both', label: 'Chat + notification' }, { value: 'chat', label: 'Chat' }, { value: 'notify', label: 'Notification' }]
const KINDS: { value: Kind; label: string }[] = [{ value: 'inform', label: 'Info' }, { value: 'success', label: 'Succès' }, { value: 'warning', label: 'Attention' }, { value: 'error', label: 'Urgent' }]
const DURATIONS = [{ value: 5000, label: '5 s' }, { value: 10000, label: '10 s' }, { value: 20000, label: '20 s' }, { value: 30000, label: '30 s' }]
const KIND_STYLE: Record<Kind, string> = {
  inform: 'border-info/50 bg-info/10',
  success: 'border-success/50 bg-success/10',
  warning: 'border-warning/50 bg-warning/10',
  error: 'border-destructive/50 bg-destructive/10',
}
const STATUS: Record<string, [Tone, string]> = {
  pending: ['warning', 'en attente'],
  sent: ['info', 'envoyée au serveur'],
  done: ['success', 'affichée en jeu'],
  failed: ['danger', 'échec'],
  expired: ['danger', 'expirée (serveur hors ligne ?)'],
}

function TelemetryAnnounce() {
  const { can } = useMe()
  const qc = useQueryClient()
  const { confirm, dialog } = useConfirm()
  const [title, setTitle] = useState('')
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<Mode>('both')
  const [kind, setKind] = useState<Kind>('inform')
  const [duration, setDuration] = useState(10000)
  const allowed = can('telemetry.announce')
  const list = useQuery({ queryKey: ['telemetry', 'commands'], queryFn: () => api<{ commands: Command[] }>('/telemetry/commands'), refetchInterval: 5000 })
  const send = useMutation({
    mutationFn: () => api<{ ok: boolean; id: number }>('/telemetry/commands', { method: 'POST', body: { type: 'announce', payload: { title: title.trim() || 'Annonce', message: message.trim(), mode, type: kind, duration } } }),
    onSuccess: () => {
      toast.success('Annonce envoyée : elle s’affichera en jeu d’ici quelques secondes.')
      setMessage('')
      qc.invalidateQueries({ queryKey: ['telemetry', 'commands'] })
    },
    onError: (error) => toast.error(errorMessage(error)),
  })

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!message.trim()) return
    const ok = await confirm({
      title: 'Envoyer l’annonce à tous les joueurs ?',
      desc: `« ${title.trim() || 'Annonce'} » s’affichera tout de suite pour tous les joueurs connectés au serveur FiveM. Elle ne peut pas être retirée.`,
      confirmText: <><Send /> Envoyer en jeu</>,
    })
    if (ok) send.mutate()
  }

  return (
    <Page title='Télémétrie · Annonces en jeu' description='Un message affiché à tous les joueurs connectés, dans le chat et/ou en notification. Le serveur le récupère au prochain envoi de bl_telemetry (quelques secondes).'>
      {dialog}
      <div className='grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]'>
        {allowed ? (
          <Section title='Nouvelle annonce'>
            <form onSubmit={submit} className='grid gap-4 p-4'>
              <div className='grid gap-1.5'>
                <Label htmlFor='an-title'>Titre</Label>
                <Input id='an-title' value={title} onChange={(e) => setTitle(e.target.value)} placeholder='Annonce' maxLength={60} />
              </div>
              <div className='grid gap-1.5'>
                <div className='flex items-center justify-between'>
                  <Label htmlFor='an-msg'>Message</Label>
                  <span className='text-xs text-muted-foreground tabular-nums'>{message.length} / 500</span>
                </div>
                <Textarea id='an-msg' value={message} onChange={(e) => setMessage(e.target.value)} placeholder='Redémarrage du serveur dans 10 minutes…' maxLength={500} rows={4} required />
              </div>
              <div className='grid gap-1.5'><Label>Où</Label><Segmented label='Où' value={mode} options={MODES} onChange={setMode} /></div>
              <div className='grid gap-1.5'><Label>Style</Label><Segmented label='Style' value={kind} options={KINDS} onChange={setKind} /></div>
              {mode !== 'chat' && <div className='grid gap-1.5'><Label>Durée de la notification</Label><Segmented label='Durée' value={duration} options={DURATIONS} onChange={setDuration} /></div>}
              <div className='grid gap-1.5'>
                <Label>Aperçu</Label>
                <div className={cn('grid gap-0.5 rounded-lg border-s-4 border bg-card px-4 py-3 text-sm', KIND_STYLE[kind])}>
                  <b>{title.trim() || 'Annonce'}</b>
                  <span className='break-words whitespace-pre-wrap text-muted-foreground'>{message || 'Ton message apparaîtra ici.'}</span>
                </div>
              </div>
              <div><Button type='submit' disabled={!message.trim() || send.isPending}><Send /> Envoyer à tous les joueurs</Button></div>
            </form>
          </Section>
        ) : <Notice tone='info'>Ton rang ne te permet pas d’envoyer des annonces en jeu. Tu vois seulement l’historique.</Notice>}

        <Section title='Dernières annonces' description='Mis à jour toutes les 5 s.'>
          {list.error ? <div className='p-4'><QueryError error={list.error} /></div> : !list.data ? <Skeleton className='m-4 h-40' /> : !list.data.commands.length ? <EmptyState title='Aucune annonce pour le moment.' icon={Megaphone} /> : (
            <ul className='divide-y'>
              {list.data.commands.map((c) => {
                const [tone, label] = STATUS[c.status] ?? ['neutral', c.status]
                return (
                  <li key={String(c.id)} className='grid gap-1 px-4 py-3'>
                    <p className='font-medium break-words'>{c.payload?.title || 'Annonce'}</p>
                    <p className='text-sm break-words whitespace-pre-wrap text-muted-foreground'>{c.payload?.message}</p>
                    <div className='flex flex-wrap items-center gap-2 text-xs'>
                      <When at={c.ts} />
                      <span>par <b>{c.author || '?'}</b></span>
                      <Pill tone={tone}>{label}</Pill>
                      {c.result && <span className='text-muted-foreground'>{c.result}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </Section>
      </div>
    </Page>
  )
}
