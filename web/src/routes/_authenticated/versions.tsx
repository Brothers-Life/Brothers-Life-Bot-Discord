import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { api, ApiError, errorMessage } from '@/lib/api'
import type { Release, VersionsPayload } from '@/lib/types'
import { bytes, dateTime } from '@/lib/format'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export const Route = createFileRoute('/_authenticated/versions')({
  component: VersionsPage,
})

type Pending = { release: Release; acceptDataLoss: boolean; lossMessage?: string } | null

function VersionsPage() {
  const { can } = useMe()
  const install = can('versions.install')
  const qc = useQueryClient()
  const [pending, setPending] = useState<Pending>(null)
  const [open, setOpen] = useState<string | null>(null)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['versions'],
    queryFn: () => api<VersionsPayload>('/versions'),
    refetchInterval: (query) => (query.state.data?.install && !query.state.data.install.done ? 3000 : false),
  })

  const doInstall = useMutation({
    mutationFn: (p: NonNullable<Pending>) =>
      api('/versions/install', { method: 'POST', body: { version: p.release.version, confirm: true, acceptDataLoss: p.acceptDataLoss } }),
    onSuccess: (_, p) => {
      toast.success(`Installation de ${p.release.version} lancée. Le bot va redémarrer.`)
      setPending(null)
      qc.invalidateQueries({ queryKey: ['versions'] })
    },
    onError: (error, p) => {
      // Older database schema: ask again, this time explicitly accepting the data loss
      if (error instanceof ApiError && error.code === 'DATA_LOSS') {
        setPending({ release: p.release, acceptDataLoss: true, lossMessage: error.message })
      } else {
        toast.error(errorMessage(error))
      }
    },
  })

  const ignore = useMutation({
    mutationFn: (version: string | null) => api('/versions/ignore', { method: 'POST', body: { version } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['versions'] }),
  })

  const latest = data?.releases.find((r) => !r.prerelease)
  const hasUpdate = latest && !latest.isCurrent && data && data.current.version !== latest.version && compare(latest.version, data.current.version) > 0

  return (
    <Page
      title='Versions'
      description='Les versions sont publiées sur GitHub. Avant chaque installation, la base de données est sauvegardée ; si la nouvelle version ne démarre pas, l’ancienne revient toute seule.'
      actions={
        <Button variant='outline' onClick={() => api('/versions?refresh=true').then(() => refetch())} disabled={isFetching}>
          <RefreshCw className={isFetching ? 'animate-spin' : undefined} /> Vérifier
        </Button>
      }
    >
      {isLoading && <Skeleton className='h-64 w-full' />}
      {data && (
        <>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 rounded-lg border bg-card p-4 sm:grid-cols-3'>
            <div>
              <div className='text-xs text-muted-foreground'>Version en cours</div>
              <div className='text-2xl font-semibold tabular-nums'>{data.current.version}</div>
              {data.current.previous && <div className='text-xs text-muted-foreground'>précédente : {data.current.previous}</div>}
            </div>
            <div>
              <div className='text-xs text-muted-foreground'>Schéma de la base</div>
              <div className='text-2xl font-semibold tabular-nums'>v{data.schemaVersion}</div>
            </div>
            <div>
              <div className='text-xs text-muted-foreground'>Installation</div>
              <div className='mt-1 text-sm'>
                {!data.supervised && 'Impossible : le bot tourne sans launcher.js (npm run dev).'}
                {data.supervised && !data.install && 'Aucune en cours'}
                {data.install && (
                  <span className='flex flex-wrap items-center gap-2'>
                    <Pill tone={data.install.error ? 'danger' : data.install.done ? 'success' : 'warning'}>{data.install.version}</Pill>
                    {data.install.step}{data.install.error ? ` : ${data.install.error}` : ''}
                  </span>
                )}
              </div>
            </div>
          </div>

          {hasUpdate && latest && data.ignored !== latest.version && (
            <div className='flex flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3'>
              <p className='min-w-0 flex-1'><span className='font-medium'>{latest.version} est disponible.</span> Tu utilises {data.current.version}.</p>
              {install && <Button size='sm' onClick={() => setPending({ release: latest, acceptDataLoss: false })}>Installer {latest.version}</Button>}
              {install && <Button size='sm' variant='ghost' onClick={() => ignore.mutate(latest.version)}>Ignorer cette version</Button>}
            </div>
          )}

          <Section title='Versions publiées'>
            {data.error && <p className='px-4 py-3 text-sm text-destructive'>{data.error.message}</p>}
            {!data.error && !data.releases.length && <EmptyState title='Aucune version publiée'>Crée un tag vX.Y.Z sur GitHub : la CI publiera la version.</EmptyState>}
            <ul className='divide-y'>
              {data.releases.map((r) => (
                <li key={r.version} className='px-4 py-3'>
                  <div className='flex flex-wrap items-center gap-3'>
                    <button type='button' className='min-w-0 flex-1 text-start' onClick={() => setOpen(open === r.version ? null : r.version)} aria-expanded={open === r.version}>
                      <span className='flex flex-wrap items-center gap-2'>
                        <span className='font-semibold tabular-nums'>{r.version}</span>
                        {r.isCurrent && <Pill tone='success'>En cours</Pill>}
                        {r.prerelease && <Pill tone='warning'>Pré-version</Pill>}
                        {!r.compatible && <Pill tone='danger'>Base plus ancienne</Pill>}
                      </span>
                      <span className='text-xs text-muted-foreground'>Publiée le {dateTime(r.publishedAt)} · {open === r.version ? 'masquer' : 'voir'} les changements</span>
                    </button>
                    {install && data.supervised && !r.isCurrent && (
                      <Button size='sm' variant={compare(r.version, data.current.version) > 0 ? 'default' : 'outline'} onClick={() => setPending({ release: r, acceptDataLoss: false })}>
                        {compare(r.version, data.current.version) > 0 ? 'Mettre à jour' : 'Revenir à cette version'}
                      </Button>
                    )}
                  </div>
                  {open === r.version && (
                    <pre className='mt-3 max-h-72 overflow-auto rounded-md bg-muted/50 p-3 font-sans text-sm whitespace-pre-wrap'>{r.changelog || 'Pas de notes de version.'}</pre>
                  )}
                </li>
              ))}
            </ul>
          </Section>

          <Section title='Sauvegardes de la base' description='Une sauvegarde est faite avant chaque installation. Les 10 dernières sont gardées.'>
            {!data.backups.length ? <EmptyState title='Aucune sauvegarde pour le moment' /> : (
              <ul className='divide-y'>
                {data.backups.map((b) => (
                  <li key={b.file} className='flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm'>
                    <span className='min-w-0 flex-1 truncate font-mono text-xs'>{b.file}</span>
                    <span className='text-muted-foreground'>{dateTime(b.at)}</span>
                    <span className='text-muted-foreground'>schéma v{b.schemaVersion ?? '?'}</span>
                    <span className='text-muted-foreground tabular-nums'>{bytes(b.size)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}

      <ConfirmDialog
        open={Boolean(pending)}
        onOpenChange={(o) => !o && setPending(null)}
        title={pending?.acceptDataLoss ? `Restaurer une ancienne base pour ${pending.release.version} ?` : `Installer ${pending?.release.version} ?`}
        desc={pending?.acceptDataLoss
          ? `${pending.lossMessage} Cette version ne connaît pas la base actuelle, il faut revenir à une sauvegarde.`
          : 'Le bot redémarre sur la nouvelle version (environ une minute). La base est sauvegardée avant ; en cas d’échec, retour automatique.'}
        confirmText={pending?.acceptDataLoss ? 'Restaurer et installer' : 'Installer'}
        destructive={pending?.acceptDataLoss}
        isLoading={doInstall.isPending}
        handleConfirm={() => pending && doInstall.mutate(pending)}
      />
    </Page>
  )
}

function compare(a: string, b: string) {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}
