import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// How long the Discord history (page « Historique Discord ») is kept in the database
export function RetentionSetting() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['events-settings'], queryFn: () => api<{ retentionDays: number }>('/events/settings') })
  const [days, setDays] = useState<string>('')
  const save = useMutation({
    mutationFn: (retentionDays: number) => api('/events/settings', { method: 'PUT', body: { retentionDays } }),
    onSuccess: () => {
      toast.success('Durée de conservation enregistrée')
      qc.invalidateQueries({ queryKey: ['events-settings'] })
      setDays('')
    },
  })
  if (!data) return null
  const value = days === '' ? String(data.retentionDays) : days
  return (
    <form
      className='flex flex-wrap items-center gap-2 rounded-lg border bg-card px-4 py-2 text-sm'
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(Number(value))
      }}
    >
      <label htmlFor='retention'>Conserver l’historique</label>
      <Input id='retention' type='number' min={1} max={365} value={value} onChange={(e) => setDays(e.target.value)} className='h-8 w-20' />
      <span>jours dans la base</span>
      {days !== '' && Number(days) !== data.retentionDays && <Button loading={save.isPending} size='sm' type='submit' disabled={save.isPending}>Enregistrer</Button>}
    </form>
  )
}
