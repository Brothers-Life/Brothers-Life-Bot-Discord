import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Clock, Plus, TimerReset, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Role, TempRole } from '@/lib/types'
import { dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

function remaining(at: number) {
  const ms = at - Date.now()
  if (ms <= 0) return 'expire maintenant'
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  if (days) return `encore ${days} j${hours ? ` ${hours} h` : ''}`
  const minutes = Math.ceil((ms % 3_600_000) / 60_000)
  return hours ? `encore ${hours} h ${minutes} min` : `encore ${minutes} min`
}

// Temporary roles of someone on one server: list, give, extend, remove now
export function TempRoles({ userId, guildId, roles }: { userId: string; guildId: string; roles: Role[] }) {
  const { can } = useMe()
  const manage = can('commands.roles')
  const qc = useQueryClient()
  const key = ['temp-roles', userId, guildId]
  const { data = [] } = useQuery({ queryKey: key, queryFn: () => api<TempRole[]>(`/temp-roles?userId=${userId}&guildId=${guildId}`) })
  const [roleId, setRoleId] = useState('')
  const [duration, setDuration] = useState('7j')
  const [extension, setExtension] = useState('1j')

  const refresh = () => {
    qc.invalidateQueries({ queryKey: key })
    qc.invalidateQueries({ queryKey: ['person', userId] })
  }
  const give = useMutation({
    mutationFn: () => api('/temp-roles', { method: 'POST', body: { guildId, userId, roleId, duration } }),
    onSuccess: () => { toast.success('Rôle temporaire donné'); setRoleId(''); refresh() },
  })
  const extend = useMutation({
    mutationFn: (id: number) => api(`/temp-roles/${id}/extend`, { method: 'POST', body: { duration: extension } }),
    onSuccess: () => { toast.success('Rôle prolongé'); refresh() },
  })
  const remove = useMutation({
    mutationFn: (id: number) => api(`/temp-roles/${id}`, { method: 'DELETE', body: { confirm: true } }),
    onSuccess: () => { toast.success('Rôle retiré'); refresh() },
  })

  if (!data.length && !manage) return null
  const givable = roles.filter((r) => r.editable && !r.dangerous)

  return (
    <div className='grid gap-2 rounded-md border border-dashed p-3'>
      <div className='flex items-center gap-2 text-sm font-medium'><Clock className='size-4 text-muted-foreground' /> Rôles temporaires</div>
      {!data.length && <p className='text-xs text-muted-foreground'>Aucun rôle temporaire en cours.</p>}
      <ul className='grid gap-1.5'>
        {data.map((t) => (
          <li key={t.id} className='flex flex-wrap items-center gap-2 text-sm'>
            <span className='font-medium'>{t.roleName ?? t.roleId}</span>
            <span className='text-xs text-muted-foreground' title={dateTime(t.expiresAt)}>{remaining(t.expiresAt)}</span>
            {manage && (
              <span className='ms-auto flex gap-1'>
                <Popover>
                  <PopoverTrigger asChild><Button size='sm' variant='ghost' className='h-7'><TimerReset /> Prolonger</Button></PopoverTrigger>
                  <PopoverContent className='flex w-56 gap-2 p-2'>
                    <Input value={extension} onChange={(e) => setExtension(e.target.value)} aria-label='Durée à ajouter' className='h-8' />
                    <Button size='sm' className='h-8' onClick={() => extend.mutate(t.id)} disabled={extend.isPending}>OK</Button>
                  </PopoverContent>
                </Popover>
                <Button size='sm' variant='ghost' className='h-7 text-destructive' onClick={() => remove.mutate(t.id)} disabled={remove.isPending}><X /> Retirer</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {manage && givable.length > 0 && (
        <form className='flex flex-wrap items-center gap-2' onSubmit={(e) => { e.preventDefault(); if (roleId && duration.trim()) give.mutate() }}>
          <Select value={roleId} onValueChange={setRoleId}>
            <SelectTrigger className='h-8 w-52' aria-label='Rôle temporaire'><SelectValue placeholder='Choisir un rôle' /></SelectTrigger>
            <SelectContent>{givable.map((r) => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}</SelectContent>
          </Select>
          <Input value={duration} onChange={(e) => setDuration(e.target.value)} className='h-8 w-24' aria-label='Durée' placeholder='7j' />
          <Button loading={give.isPending} size='sm' type='submit' className='h-8' disabled={!roleId || !duration.trim() || give.isPending}><Plus /> Donner</Button>
          <span className='text-xs text-muted-foreground'>Durées : 30m, 12h, 7j, 2sem</span>
        </form>
      )}
    </div>
  )
}
