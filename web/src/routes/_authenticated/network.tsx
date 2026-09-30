import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Crown } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Guild } from '@/lib/types'
import { ago } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, GuildIcon } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/network')({
  component: NetworkPage,
})

type Pending = { guild: Guild; action: 'main' | 'remove' } | null

function statusPill(guild: Guild) {
  if (!guild.botPresent) return <Pill tone='danger'>Bot absent</Pill>
  if (guild.status === 'active') return <Pill tone='success'>Dans le réseau</Pill>
  if (guild.status === 'pending') return <Pill tone='warning'>En attente</Pill>
  return <Pill>Retiré</Pill>
}

function NetworkPage() {
  const { can } = useMe()
  const manage = can('network.manage')
  const qc = useQueryClient()
  const [pending, setPending] = useState<Pending>(null)
  const { data: guilds, isLoading } = useQuery({ queryKey: ['network'], queryFn: () => api<Guild[]>('/network') })

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['network'] })
    qc.invalidateQueries({ queryKey: ['overview'] })
    qc.invalidateQueries({ queryKey: ['me'] })
  }

  const activate = useMutation({
    mutationFn: (g: Guild) => api<Guild>(`/network/${g.id}/activate`, { method: 'POST' }),
    onSuccess: (g) => { toast.success(`${g.name} fait maintenant partie du réseau`); refresh() },
  })
  const confirmAction = useMutation({
    mutationFn: ({ guild, action }: NonNullable<Pending>) =>
      api<Guild>(`/network/${guild.id}/${action}`, { method: 'POST', body: { confirm: true } }),
    onSuccess: (g, { action }) => {
      toast.success(action === 'main' ? `${g.name} est le serveur principal` : `${g.name} a été retiré du réseau`)
      setPending(null)
      refresh()
    },
  })

  const main = guilds?.find((g) => g.isMain)
  const groups = [
    { title: 'Dans le réseau', items: guilds?.filter((g) => g.status === 'active' && g.botPresent) ?? [] },
    { title: 'En attente', items: guilds?.filter((g) => g.status === 'pending' && g.botPresent) ?? [], hint: 'Le bot est sur ces serveurs, mais rien n’y est synchronisé tant qu’ils ne sont pas ajoutés au réseau.' },
    { title: 'Retirés ou quittés', items: guilds?.filter((g) => g.status === 'removed' || !g.botPresent) ?? [] },
  ]

  return (
    <Page
      title='Serveurs'
      description='Un serveur ne rejoint le réseau que si tu l’ajoutes ici : inviter le bot ne suffit pas. Les rangs du staff se lisent sur les rôles du serveur principal.'
    >
      {isLoading && <Skeleton className='h-48 w-full' />}
      {guilds && !guilds.length && (
        <Section title='Aucun serveur'>
          <EmptyState title='Le bot n’est sur aucun serveur'>Invite-le sur tes serveurs depuis le Developer Portal, ils apparaîtront ici.</EmptyState>
        </Section>
      )}
      {groups.map((group) => group.items.length > 0 && (
        <Section key={group.title} title={`${group.title} (${group.items.length})`} description={group.hint}>
          <ul className='divide-y'>
            {group.items.map((g) => (
              <li key={g.id} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                <GuildIcon src={g.icon} name={g.name} />
                <div className='min-w-0 flex-1'>
                  <div className='flex flex-wrap items-center gap-2'>
                    <span className='truncate font-medium'>{g.name}</span>
                    {g.isMain && <Pill tone='accent'><Crown className='size-3' />Principal</Pill>}
                    {statusPill(g)}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {g.id} · {g.joinedNetworkAt ? `dans le réseau depuis ${ago(g.joinedNetworkAt).replace('il y a ', '')}` : `vu ${ago(g.firstSeenAt)}`}
                  </div>
                </div>
                {manage && g.botPresent && (
                  <div className='flex flex-wrap gap-2'>
                    {g.status !== 'active' && (
                      <Button size='sm' onClick={() => activate.mutate(g)} disabled={activate.isPending}>Ajouter au réseau</Button>
                    )}
                    {!g.isMain && (
                      <Button size='sm' variant='outline' onClick={() => setPending({ guild: g, action: 'main' })}>
                        Définir comme principal
                      </Button>
                    )}
                    {g.status === 'active' && !g.isMain && (
                      <Button size='sm' variant='ghost' className='text-destructive' onClick={() => setPending({ guild: g, action: 'remove' })}>
                        Retirer
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </Section>
      ))}

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(open) => !open && setPending(null)}
        title={pending?.action === 'main' ? `Faire de ${pending.guild.name} le serveur principal ?` : `Retirer ${pending?.guild.name} du réseau ?`}
        desc={
          pending?.action === 'main'
            ? main
              ? `Les rangs seront lus sur les rôles de ${pending.guild.name} au lieu de ${main.name}. Les liaisons rôles → rangs de ${main.name} ne compteront plus : pense à les refaire.`
              : `Les rangs du staff seront lus sur les rôles de ${pending.guild.name}. Il est aussi ajouté au réseau.`
            : 'Plus rien ne sera synchronisé sur ce serveur. Le bot y reste et l’historique est conservé. Tu pourras le rajouter plus tard.'
        }
        confirmText={pending?.action === 'main' ? 'Définir comme principal' : 'Retirer du réseau'}
        destructive={pending?.action === 'remove'}
        isLoading={confirmAction.isPending}
        handleConfirm={() => pending && confirmAction.mutate(pending)}
      />
    </Page>
  )
}
