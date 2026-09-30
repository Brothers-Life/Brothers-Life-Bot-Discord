import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { PanelMember, RanksPayload } from '@/lib/types'
import { userName } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, RankBadge, UserAvatar } from '@/components/app/ui'
import { UserPicker } from '@/components/app/user-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/members')({
  component: MembersPage,
})

function MembersPage() {
  const { me, can } = useMe()
  const assign = can('members.assign')
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<PanelMember[]>('/members') })
  const ranks = useQuery({ queryKey: ['ranks'], queryFn: () => api<RanksPayload>('/ranks') })

  const myLevel = me?.isOwner ? Infinity : (me?.level ?? 0)
  const assignable = (ranks.data?.ranks ?? []).filter((r) => r.level < myLevel)

  const unassign = useMutation({
    mutationFn: ({ userId, rankId }: { userId: string; rankId: number }) =>
      api(`/members/${userId}/ranks/${rankId}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Rang retiré')
      qc.invalidateQueries({ queryKey: ['members'] })
    },
  })

  return (
    <Page
      title='Membres du panel'
      description='Qui a un rang, et comment : par un rôle du serveur principal, ou attribué directement ici (utile pour quelqu’un qui n’a pas de rôle Discord).'
      actions={assign && assignable.length > 0 && (
        <Button onClick={() => setAdding(true)}><UserPlus /> Attribuer un rang</Button>
      )}
    >
      {members.isLoading && <Skeleton className='h-48 w-full' />}
      {members.data && (
        <Section title={`${members.data.length} membre${members.data.length > 1 ? 's' : ''} avec un rang`}>
          {!members.data.length ? (
            <EmptyState title='Personne n’a encore de rang'>
              Lie un rang à un rôle du serveur principal, ou attribue-le directement à quelqu’un.
            </EmptyState>
          ) : (
            <ul className='divide-y'>
              {members.data.map((m) => (
                <li key={m.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                  <UserAvatar src={m.avatar} name={userName(m)} />
                  <div className='min-w-40 flex-1'>
                    <div className='font-medium'>{userName(m)}</div>
                    <div className='text-xs text-muted-foreground'>{m.id}</div>
                  </div>
                  <div className='flex flex-wrap gap-1.5'>
                    {m.ranks.map((r) => (
                      <span key={`${r.id}-${r.via}-${r.roleId ?? ''}`} className='inline-flex items-center gap-1'>
                        <RankBadge name={r.name} color={r.color} />
                        <span className='text-xs text-muted-foreground'>{r.via === 'role' ? 'par rôle' : 'direct'}</span>
                        {r.via === 'direct' && assign && r.level < myLevel && m.id !== me?.user.id && (
                          <Button
                            size='icon'
                            variant='ghost'
                            className='size-6'
                            aria-label={`Retirer le rang ${r.name}`}
                            onClick={() => unassign.mutate({ userId: m.id, rankId: r.id })}
                          >
                            <X className='size-3.5' />
                          </Button>
                        )}
                      </span>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {adding && <AssignDialog ranks={assignable} onClose={() => setAdding(false)} />}
    </Page>
  )
}

function AssignDialog({ ranks, onClose }: { ranks: RanksPayload['ranks']; onClose: () => void }) {
  const qc = useQueryClient()
  const [userId, setUserId] = useState('')
  const [rankId, setRankId] = useState<string>(ranks[0] ? String(ranks[0].id) : '')
  const validId = /^\d{17,20}$/.test(userId.trim())

  const assign = useMutation({
    mutationFn: () => api(`/members/${userId.trim()}/ranks`, { method: 'POST', body: { rankId: Number(rankId) } }),
    onSuccess: () => {
      toast.success('Rang attribué')
      qc.invalidateQueries({ queryKey: ['members'] })
      onClose()
    },
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>Attribuer un rang</DialogTitle>
          <DialogDescription>
            Pour donner l’accès au panel à quelqu’un sans lui donner de rôle Discord.
          </DialogDescription>
        </DialogHeader>
        <form
          id='assign-form'
          className='grid gap-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (validId && rankId) assign.mutate()
          }}
        >
          <div className='grid gap-1.5'>
            <Label htmlFor='assign-user'>Membre</Label>
            <UserPicker id='assign-user' value={userId} onChange={setUserId} autoFocus />
          </div>
          <div className='grid gap-1.5'>
            <Label>Rang</Label>
            <Select value={rankId} onValueChange={setRankId}>
              <SelectTrigger><SelectValue placeholder='Choisir un rang' /></SelectTrigger>
              <SelectContent>
                {ranks.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.name} (niveau {r.level})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='assign-form' disabled={!validId || !rankId || assign.isPending}>Attribuer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
