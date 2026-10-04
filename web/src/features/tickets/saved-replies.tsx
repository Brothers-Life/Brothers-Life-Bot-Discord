import { useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MessageSquareText, Pencil, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { TicketConfig, TicketReply } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { insertAtCursor } from '@/lib/utils'
import { Section, EmptyState, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { VariablePicker, type VariableGroup } from '@/components/app/variable-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

const ALL = '__all__'

// Variables of a saved reply: ticket, staff, member / server / FiveM, and the form answers of its type
function replyVariables(config: TicketConfig, categoryId: number | null): VariableGroup[] {
  const category = config.categories.find((c) => c.id === categoryId)
  const answers = category ? category.config.form.steps.flatMap((s) => s.questions).map((q) => ({ key: `answer.${q.id}`, label: q.label || q.id })) : []
  return [...(config.replyVariables ?? config.variables), ...(answers.length ? [{ title: 'Réponses du formulaire', items: answers }] : [])]
}

export function SavedReplies({ guildId, config }: { guildId: string; config: TicketConfig }) {
  const { can } = useMe()
  const manage = can('tickets.replies')
  const qc = useQueryClient()
  const [editing, setEditing] = useState<Partial<TicketReply> | null>(null)
  const [deleting, setDeleting] = useState<TicketReply | null>(null)
  const replies = config.replies ?? []
  const remove = useMutation({
    mutationFn: (r: TicketReply) => api(`/tickets/config/${guildId}/replies/${r.id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Réponse supprimée'); setDeleting(null); qc.invalidateQueries({ queryKey: ['ticket-config', guildId] }) },
  })

  return (
    <Section
      title='Réponses enregistrées'
      description='Des textes tout prêts pour le staff : depuis la réponse d’un ticket dans le panel, ou avec /ticket reponse sur Discord. Les variables sont remplies à l’envoi.'
      actions={manage && <Button size='sm' onClick={() => setEditing({ name: '', content: '', categoryId: null })}><Plus /> Réponse</Button>}
    >
      {!replies.length ? <EmptyState title='Aucune réponse enregistrée'>Par exemple « Bienvenue », « Besoin de preuves » ou « Ticket résolu ».</EmptyState> : (
        <ul className='divide-y'>
          {replies.map((r) => {
            const category = config.categories.find((c) => c.id === r.categoryId)
            return (
              <li key={r.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                <MessageSquareText aria-hidden className='size-4 shrink-0 text-muted-foreground' />
                <div className='min-w-48 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='font-medium'>{r.name}</span>
                    <Pill>{category ? `${category.emoji ?? ''} ${category.name}`.trim() : 'Tous les types'}</Pill>
                    {r.uses > 0 && <Pill tone='accent'>{r.uses} envoi{r.uses > 1 ? 's' : ''}</Pill>}
                  </div>
                  <p className='line-clamp-2 text-xs break-words whitespace-pre-wrap text-muted-foreground'>{r.content}</p>
                </div>
                {manage && (
                  <div className='flex gap-2'>
                    <Button size='sm' variant='outline' onClick={() => setEditing(r)}><Pencil /> Modifier</Button>
                    <Button size='sm' variant='danger-ghost' onClick={() => setDeleting(r)}>Supprimer</Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editing && <ReplyDialog guildId={guildId} config={config} initial={editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Supprimer la réponse « ${deleting?.name} » ?`}
        desc='Elle ne sera plus proposée au staff.'
        confirmText='Supprimer'
        destructive
        isLoading={remove.isPending}
        handleConfirm={() => deleting && remove.mutate(deleting)}
      />
    </Section>
  )
}

function ReplyDialog({ guildId, config, initial, onClose }: { guildId: string; config: TicketConfig; initial: Partial<TicketReply>; onClose: () => void }) {
  const qc = useQueryClient()
  const [r, setR] = useState(initial)
  const contentRef = useRef<HTMLTextAreaElement>(null)
  const save = useMutation({
    mutationFn: () => api<TicketReply>(`/tickets/config/${guildId}/replies`, {
      method: 'PUT',
      body: { ...(r.id ? { id: r.id } : {}), name: r.name ?? '', content: r.content ?? '', categoryId: r.categoryId ?? null },
    }),
    onSuccess: () => {
      toast.success('Réponse enregistrée')
      qc.invalidateQueries({ queryKey: ['ticket-config', guildId] })
      onClose()
    },
  })
  const valid = Boolean(r.name?.trim() && r.content?.trim())

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[92svh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{r.id ? `Modifier « ${initial.name} »` : 'Nouvelle réponse enregistrée'}</DialogTitle>
          <DialogDescription>Envoyée au nom du membre du staff qui l’utilise. Elle peut encore être retouchée avant l’envoi depuis le panel.</DialogDescription>
        </DialogHeader>
        <form id='reply-form' className='grid grid-cols-[minmax(0,1fr)] gap-4' onSubmit={(e) => { e.preventDefault(); if (valid) save.mutate() }}>
          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label htmlFor='reply-name'>Nom</Label>
              <Input id='reply-name' value={r.name ?? ''} maxLength={50} required placeholder='Ticket résolu' onChange={(e) => setR({ ...r, name: e.target.value })} />
            </div>
            <div className='grid gap-1.5'>
              <Label>Type de ticket</Label>
              <Select value={r.categoryId ? String(r.categoryId) : ALL} onValueChange={(v) => setR({ ...r, categoryId: v === ALL ? null : Number(v) })}>
                <SelectTrigger aria-label='Type de ticket'><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tous les types</SelectItem>
                  {config.categories.map((c) => <SelectItem key={c.id} value={String(c.id)}>{c.emoji} {c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='reply-content'>Texte</Label>
            <Textarea
              id='reply-content' ref={contentRef} rows={7} maxLength={2000} value={r.content ?? ''}
              placeholder='Bonjour {user}, ton ticket #{number} est réglé. Bon jeu !'
              onChange={(e) => setR({ ...r, content: e.target.value })}
            />
            <div className='flex flex-wrap items-center gap-2'>
              <VariablePicker groups={replyVariables(config, r.categoryId ?? null)} onPick={(t) => setR((prev) => ({ ...prev, content: insertAtCursor(contentRef.current, prev.content ?? '', t).slice(0, 2000) }))} />
              <span className='ms-auto text-xs text-muted-foreground'>{(r.content ?? '').length}/2000</span>
            </div>
          </div>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} type='submit' form='reply-form' disabled={!valid || save.isPending}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
