import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Channel, LogRoute, LogsPayload } from '@/lib/types'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const Route = createFileRoute('/_authenticated/logs')({
  component: LogsPage,
})

const MIRROR = '*'
const NONE = '__none__'

function LogsPage() {
  const { data, isLoading } = useQuery({ queryKey: ['logs'], queryFn: () => api<LogsPayload>('/logs') })
  const [selected, setSelected] = useState<string | null>(null)

  const targets = data
    ? [
        ...data.guilds.map((g) => ({ id: g.id, label: g.name, isMain: g.isMain, routes: g.routes, channelsOf: g.id })),
        ...(data.mainGuildId ? [{ id: MIRROR, label: 'Miroir réseau', isMain: false, routes: data.mirror, channelsOf: data.mainGuildId }] : []),
      ]
    : []
  const current = targets.find((t) => t.id === selected) ?? targets.find((t) => t.isMain) ?? targets[0]

  return (
    <Page
      title='Salons de logs'
      description='Pour chaque serveur, choisis où va chaque catégorie de logs. Plusieurs catégories peuvent partager un salon. Le miroir réseau recopie les logs de tous les serveurs dans un salon du serveur principal.'
    >
      {isLoading && <Skeleton className='h-64 w-full' />}
      {data && !targets.length && (
        <Section title='Aucun serveur'>
          <EmptyState title='Aucun serveur à configurer'>Ajoute d’abord des serveurs au réseau.</EmptyState>
        </Section>
      )}
      <RetentionSetting />
      {current && data && (
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]'>
          <nav aria-label='Serveurs' className='flex gap-1 overflow-x-auto lg:flex-col'>
            {targets.map((t) => (
              <button
                key={t.id}
                type='button'
                onClick={() => setSelected(t.id)}
                aria-current={t.id === current.id ? 'page' : undefined}
                className='flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium'
              >
                <span className='truncate'>{t.label}</span>
                <span className='text-xs text-muted-foreground tabular-nums'>{t.routes.filter((r) => r.enabled).length}</span>
              </button>
            ))}
          </nav>
          <RouteTable
            key={current.id}
            guildId={current.id}
            title={current.id === MIRROR ? 'Miroir réseau (salons du serveur principal)' : current.label}
            channelsOf={current.channelsOf}
            routes={current.routes}
            categories={data.categories}
          />
        </div>
      )}
    </Page>
  )
}

function RouteTable({ guildId, title, channelsOf, routes, categories }: {
  guildId: string
  title: string
  channelsOf: string
  routes: LogRoute[]
  categories: LogsPayload['categories']
}) {
  const qc = useQueryClient()
  const channels = useQuery({ queryKey: ['channels', channelsOf], queryFn: () => api<Channel[]>(`/network/${channelsOf}/channels`) })

  const save = useMutation({
    mutationFn: ({ category, channelId, enabled }: { category: string; channelId: string | null; enabled: boolean }) =>
      api(`/logs/${encodeURIComponent(guildId)}/${category}`, { method: 'PUT', body: { channelId, enabled } }),
    onSuccess: () => {
      toast.success('Salon de logs enregistré')
      qc.invalidateQueries({ queryKey: ['logs'] })
    },
  })

  return (
    <Section title={title}>
      <ul className='divide-y'>
        {categories.map((category) => {
          const route = routes.find((r) => r.category === category.key)
          const channel = channels.data?.find((c) => c.id === route?.channelId)
          return (
            <li key={category.key} className='flex flex-wrap items-center gap-3 px-4 py-3'>
              <div className='min-w-48 flex-1'>
                <div className='text-sm font-medium'>{category.label}</div>
                {route && !route.enabled && <Pill tone='warning' className='mt-1'>Désactivé</Pill>}
                {route && channels.data && !channel && <Pill tone='danger' className='mt-1'>Salon introuvable</Pill>}
              </div>
              <Select
                value={route?.channelId ?? NONE}
                onValueChange={(value) => save.mutate({ category: category.key, channelId: value === NONE ? null : value, enabled: true })}
                disabled={save.isPending || channels.isLoading}
              >
                <SelectTrigger className='w-64' aria-label={`Salon pour ${category.label}`}>
                  <SelectValue placeholder='Aucun salon' />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Aucun salon</SelectItem>
                  {channels.data?.map((c) => (
                    <SelectItem key={c.id} value={c.id} disabled={!c.canSend}>
                      #{c.name}{c.parent ? ` · ${c.parent}` : ''}{!c.canSend ? ' (le bot ne peut pas écrire)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Switch
                checked={Boolean(route?.enabled)}
                disabled={!route || save.isPending}
                aria-label={`Activer les logs ${category.label}`}
                onCheckedChange={(enabled) => route && save.mutate({ category: category.key, channelId: route.channelId, enabled })}
              />
            </li>
          )
        })}
      </ul>
    </Section>
  )
}

function RetentionSetting() {
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
      className='flex flex-wrap items-center gap-2 text-sm'
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate(Number(value))
      }}
    >
      <label htmlFor='retention'>Conserver les événements</label>
      <Input id='retention' type='number' min={1} max={365} value={value} onChange={(e) => setDays(e.target.value)} className='h-8 w-20' />
      <span>jours dans la base</span>
      {days !== '' && Number(days) !== data.retentionDays && <Button loading={save.isPending} size='sm' type='submit' disabled={save.isPending}>Enregistrer</Button>}
    </form>
  )
}
