import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Sanction, SanctionType } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { EmptyState, Pill, UserAvatar } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

const TYPE: Record<SanctionType, { label: string; tone: 'danger' | 'warning' }> = {
  ban: { label: 'Ban', tone: 'danger' },
  kick: { label: 'Kick', tone: 'danger' },
  timeout: { label: 'Timeout', tone: 'warning' },
  warn: { label: 'Warn', tone: 'warning' },
  restrict: { label: 'Restriction', tone: 'warning' },
}
const SOURCE: Record<Sanction['source'], string> = { bot: 'commande', panel: 'panel', native: 'Discord', automod: 'automod', system: 'système' }
const REVOKE_LABEL: Record<SanctionType, string> = { ban: 'Débannir', timeout: 'Lever le timeout', warn: 'Retirer', kick: '', restrict: 'Lever la restriction' }

function results(s: Sanction) {
  const values = Object.values(s.results)
  if (!values.length) return null
  const failed = values.filter((r) => !r.ok)
  if (!failed.length) return `${values.length} serveur${values.length > 1 ? 's' : ''}`
  return `${values.length - failed.length}/${values.length} serveurs — échec : ${failed.map((f) => f.error).join(', ')}`
}

export function SanctionList({ sanctions, showUser = true }: { sanctions: Sanction[]; showUser?: boolean }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const [revoking, setRevoking] = useState<Sanction | null>(null)
  const [reason, setReason] = useState('')
  const [editing, setEditing] = useState<Sanction | null>(null)
  const [newReason, setNewReason] = useState('')

  const revoke = useMutation({
    mutationFn: (s: Sanction) => api(`/sanctions/${s.id}/revoke`, { method: 'POST', body: { confirm: true, reason } }),
    onSuccess: () => {
      toast.success('Sanction levée')
      setRevoking(null)
      setReason('')
      qc.invalidateQueries({ queryKey: ['sanctions'] })
    },
  })

  const edit = useMutation({
    mutationFn: (s: Sanction) => api(`/sanctions/${s.id}`, { method: 'PATCH', body: { reason: newReason } }),
    onSuccess: () => {
      toast.success('Raison modifiée')
      setEditing(null)
      qc.invalidateQueries({ queryKey: ['sanctions'] })
    },
  })

  if (!sanctions.length) return <EmptyState title='Aucune sanction'>Les sanctions données par commande, depuis le panel ou directement dans Discord apparaissent ici.</EmptyState>

  return (
    <>
      <ul className='divide-y'>
        {sanctions.map((s) => {
          const name = s.user?.name ?? s.userName ?? s.userId
          const line = results(s)
          return (
            <li key={s.id} className='flex flex-wrap items-start gap-3 px-4 py-3'>
              {showUser && <UserAvatar src={s.user?.avatar} name={name} />}
              <div className='min-w-56 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <Pill tone={s.revokedAt ? 'neutral' : TYPE[s.type].tone}>{TYPE[s.type].label}{s.profileLabel ? ` · ${s.profileLabel}` : ''}</Pill>
                  {showUser && <span className='font-medium'>{name}</span>}
                  {s.active && <Pill tone='accent'>En cours</Pill>}
                  {s.revokedAt && <Pill>Levée</Pill>}
                  {s.scope === 'local' && <Pill>Local</Pill>}
                  <span className='text-xs text-muted-foreground'>#{s.id}</span>
                </div>
                <p className='mt-1 text-sm'>{s.reason || <span className='text-muted-foreground'>Sans raison</span>}</p>
                <p className='mt-0.5 text-xs text-muted-foreground'>
                  <time title={dateTime(s.createdAt)}>{ago(s.createdAt)}</time>
                  {' '}par {s.moderator?.name ?? (s.moderatorId === 'unknown' ? 'inconnu' : s.moderatorId)} ({SOURCE[s.source]})
                  {s.expiresAt && !s.revokedAt && <> · jusqu’au {dateTime(s.expiresAt)}</>}
                  {line && <> · {line}</>}
                  {s.revokedAt && <> · levée {ago(s.revokedAt)}{s.revokeReason ? ` (${s.revokeReason})` : ''}</>}
                </p>
              </div>
              <div className='flex gap-2'>
                {can('sanctions.edit') && (
                  <Button size='sm' variant='ghost' onClick={() => { setEditing(s); setNewReason(s.reason ?? '') }}>Modifier la raison</Button>
                )}
                {can('sanctions.revoke') && !s.revokedAt && s.type !== 'kick' && (s.type === 'warn' || s.active) && (
                  <Button size='sm' variant='outline' onClick={() => setRevoking(s)}>{REVOKE_LABEL[s.type]}</Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
      <ConfirmDialog
        open={Boolean(revoking)}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={revoking ? `${REVOKE_LABEL[revoking.type]} — sanction #${revoking.id}` : ''}
        desc={revoking?.scope === 'network' && revoking.type !== 'warn' ? 'La sanction est levée sur tous les serveurs du réseau.' : 'La sanction reste dans l’historique, marquée comme levée.'}
        confirmText={revoking ? REVOKE_LABEL[revoking.type] : ''}
        isLoading={revoke.isPending}
        handleConfirm={() => revoking && revoke.mutate(revoking)}
      >
        <Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder='Raison (facultatif)' maxLength={500} rows={2} />
      </ConfirmDialog>
      <ConfirmDialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
        title={editing ? `Raison de la sanction #${editing.id}` : ''}
        desc='L’ancienne raison reste visible dans le journal.'
        confirmText='Enregistrer'
        isLoading={edit.isPending}
        handleConfirm={() => editing && edit.mutate(editing)}
      >
        <Textarea value={newReason} onChange={(e) => setNewReason(e.target.value)} maxLength={500} rows={3} aria-label='Nouvelle raison' />
      </ConfirmDialog>
    </>
  )
}
