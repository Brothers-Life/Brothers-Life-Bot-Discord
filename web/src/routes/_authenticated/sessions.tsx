import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { Session } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, UserAvatar } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'

import { useConfirm } from '@/components/app/confirm'

export const Route = createFileRoute('/_authenticated/sessions')({
  component: SessionsPage,
})

function device(userAgent: string | null) {
  if (!userAgent) return 'Appareil inconnu'
  const browser = /Edg\//.test(userAgent) ? 'Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : 'Navigateur'
  const os = /Windows/.test(userAgent) ? 'Windows' : /Android/.test(userAgent) ? 'Android' : /iPhone|iPad/.test(userAgent) ? 'iOS' : /Mac OS/.test(userAgent) ? 'macOS' : /Linux/.test(userAgent) ? 'Linux' : ''
  return os ? `${browser} sur ${os}` : browser
}

function SessionsPage() {
  const { can } = useMe()
  const qc = useQueryClient()
  const [all, setAll] = useState(false)
  const { data } = useQuery({ queryKey: ['sessions', all], queryFn: () => api<Session[]>(`/sessions${all ? '?all=true' : ''}`) })

  const { confirm, dialog } = useConfirm()
  const revoke = useMutation({
    mutationFn: (s: Session) => api(`/sessions/${s.key}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Session révoquée')
      qc.invalidateQueries({ queryKey: ['sessions'] })
    },
  })

  return (
    <Page
      title='Sessions'
      description='Les appareils connectés au panel. Une session expire après 12 h, ou après 2 h sans activité.'
      actions={can('sessions.manage') && (
        <div className='flex items-center gap-2'>
          <Switch id='all-sessions' checked={all} onCheckedChange={setAll} />
          <Label htmlFor='all-sessions'>Tout le staff</Label>
        </div>
      )}
    >
      <Section title={all ? 'Toutes les sessions' : 'Mes sessions'}>
        {!data?.length ? (
          <EmptyState title='Aucune session' />
        ) : (
          <ul className='divide-y'>
            {data.map((s) => (
              <li key={s.key} className='flex flex-wrap items-center gap-3 px-4 py-3'>
                {all && <UserAvatar src={s.avatar} name={s.username ?? s.discordId} />}
                <div className='min-w-48 flex-1'>
                  <div className='flex flex-wrap items-center gap-2 text-sm font-medium'>
                    {all && <span>{s.username ?? s.discordId} ·</span>}
                    {device(s.userAgent)}
                    {s.current && <Pill tone='success'>Cet appareil</Pill>}
                  </div>
                  <div className='text-xs text-muted-foreground'>
                    {s.ip ?? 'IP inconnue'} · active {ago(s.lastSeenAt)} · ouverte le {dateTime(s.createdAt)}
                  </div>
                </div>
                {!s.current && (
                  <Button size='sm' variant='outline' disabled={revoke.isPending} onClick={async () => {
                    if (await confirm({ title: 'Révoquer cette session ?', desc: `${all ? `${s.username ?? s.discordId} sera` : 'Cet appareil sera'} déconnecté du panel (${device(s.userAgent)}${s.ip ? `, ${s.ip}` : ''}) et devra se reconnecter avec Discord.`, confirmText: 'Révoquer', destructive: true })) revoke.mutate(s)
                  }}>Révoquer</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {dialog}
    </Page>
  )
}
