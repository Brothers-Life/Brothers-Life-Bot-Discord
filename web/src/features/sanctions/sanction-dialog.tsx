import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Guild, RestrictionProfile, Sanction, SanctionType } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { UserPicker } from '@/components/app/user-picker'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

export const TYPE_LABELS: Record<SanctionType, string> = { ban: 'Bannir', kick: 'Expulser', timeout: 'Timeout', warn: 'Avertir', restrict: 'Restreindre' }

export function SanctionDialog({ userId: initialUserId = '', onClose }: { userId?: string; onClose: () => void }) {
  const { can } = useMe()
  const qc = useQueryClient()
  const allowed = (['warn', 'restrict', 'timeout', 'kick', 'ban'] as SanctionType[]).filter((t) => can(`sanctions.${t}`))
  const [type, setType] = useState<SanctionType>(allowed[0] ?? 'warn')
  const [userId, setUserId] = useState(initialUserId)
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState('')
  const [scope, setScope] = useState<'network' | 'local'>('network')
  const [guildId, setGuildId] = useState('')
  const [profile, setProfile] = useState('')
  const profiles = useQuery({ queryKey: ['restrictions'], queryFn: () => api<{ profiles: RestrictionProfile[] }>('/restrictions'), enabled: type === 'restrict' })

  const validId = /^\d{17,20}$/.test(userId.trim())
  const guilds = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network'), enabled: scope === 'local' })
  const active = guilds.data?.filter((g) => g.status === 'active' && g.botPresent) ?? []

  const needsDuration = type === 'timeout'
  const allowsDuration = type === 'timeout' || type === 'ban' || type === 'restrict'
  const valid = validId && (!needsDuration || duration.trim()) && (type !== 'warn' || reason.trim()) && (scope === 'network' || guildId) && (type !== 'restrict' || profile)

  const submit = useMutation({
    mutationFn: () => api<Sanction>('/sanctions', {
      method: 'POST',
      body: {
        type,
        userId: userId.trim(),
        reason: reason.trim(),
        duration: allowsDuration && duration.trim() ? duration.trim() : null,
        scope: type === 'warn' ? 'network' : scope,
        originGuildId: scope === 'local' ? guildId : null,
        profile: type === 'restrict' ? profile : null,
      },
    }),
    onSuccess: (s) => {
      const failed = Object.values(s.results).filter((r) => !r.ok).length
      if (failed) toast.warning(`Sanction #${s.id} enregistrée, mais en échec sur ${failed} serveur(s)`)
      else toast.success(`Sanction #${s.id} appliquée`)
      qc.invalidateQueries({ queryKey: ['sanctions'] })
      onClose()
    },
  })

  if (!allowed.length) return null

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='sm:max-w-lg'>
        <DialogHeader>
          <DialogTitle>Nouvelle sanction</DialogTitle>
          <DialogDescription>Par défaut, la sanction s’applique à tous les serveurs du réseau.</DialogDescription>
        </DialogHeader>
        <form
          id='sanction-form'
          className='grid gap-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (valid) submit.mutate()
          }}
        >
          <div className='grid gap-1.5'>
            <Label htmlFor='sanction-user'>Membre</Label>
            <UserPicker id='sanction-user' value={userId} onChange={setUserId} autoFocus={!initialUserId} />
            <p className='text-xs text-muted-foreground'>Pour quelqu’un qui a quitté tous les serveurs, colle son ID Discord.</p>
          </div>

          <div className='grid gap-4 sm:grid-cols-2'>
            <div className='grid gap-1.5'>
              <Label>Sanction</Label>
              <Select value={type} onValueChange={(v) => setType(v as SanctionType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allowed.map((t) => <SelectItem key={t} value={t}>{TYPE_LABELS[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {allowsDuration && (
              <div className='grid gap-1.5'>
                <Label htmlFor='sanction-duration'>Durée {type !== 'timeout' && <span className='text-muted-foreground'>(vide = définitif)</span>}</Label>
                <Input id='sanction-duration' value={duration} onChange={(e) => setDuration(e.target.value)} placeholder={type === 'ban' ? '7j' : '1h'} />
              </div>
            )}
          </div>

          {type === 'restrict' && (
            <div className='grid gap-1.5'>
              <Label>Restriction</Label>
              <Select value={profile} onValueChange={setProfile}>
                <SelectTrigger aria-label='Restriction'><SelectValue placeholder='Choisir' /></SelectTrigger>
                <SelectContent>{profiles.data?.profiles.map((p) => <SelectItem key={p.key} value={p.key}>{p.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className='text-xs text-muted-foreground'>Le bot donne un rôle qui interdit ces actions sur tous les salons. Il est redonné si la personne revient.</p>
            </div>
          )}

          <div className='grid gap-1.5'>
            <Label htmlFor='sanction-reason'>Raison {type === 'warn' ? '' : <span className='text-muted-foreground'>(conseillée)</span>}</Label>
            <Textarea id='sanction-reason' value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} rows={3} />
          </div>

          {type !== 'warn' && (
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label>Portée</Label>
                <Select value={scope} onValueChange={(v) => setScope(v as 'network' | 'local')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value='network'>Tout le réseau</SelectItem>
                    <SelectItem value='local'>Un seul serveur</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {scope === 'local' && (
                <div className='grid gap-1.5'>
                  <Label>Serveur</Label>
                  <Select value={guildId} onValueChange={setGuildId}>
                    <SelectTrigger><SelectValue placeholder='Choisir' /></SelectTrigger>
                    <SelectContent>
                      {active.map((g) => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='sanction-form' variant={type === 'ban' || type === 'kick' ? 'destructive' : 'default'} disabled={!valid || submit.isPending}>
            {submit.isPending ? 'Application…' : TYPE_LABELS[type]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
