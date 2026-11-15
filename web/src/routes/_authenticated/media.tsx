import { useDeferredValue, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Image, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Page, Pill, Section } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { type MediaFile, useMediaConfig } from '@/features/fivem/media'
import { MediaThumbnail } from '@/features/fivem/media-image'
import { bytes } from '@/features/telemetry/format'
import { QueryError } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/media')({
  component: MediaLibrary,
})

function MediaLibrary() {
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const config = useMediaConfig()
  const files = useInfiniteQuery({
    queryKey: ['media-images', q],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: MediaFile[]; nextCursor: string | null }>(
      `/media/images?q=${encodeURIComponent(q)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
    ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: config.data?.enabled === true,
  })
  const items = files.data?.pages.flatMap((page) => page.items) ?? []

  return (
    <Page
      title='FiveM · Images'
      description='Toutes les images du service média, dont les icônes d’objets et de véhicules utilisées dans les fiches joueurs.'
    >
      {!config.data && config.isLoading ? <Skeleton className='h-32 w-full' /> : config.error ? (
        <QueryError error={config.error} />
      ) : !config.data?.enabled ? (
        <Section title='Service média non configuré'>
          <EmptyState title='Les images ne sont pas encore reliées au panel.' icon={Image}>
            Configure MEDIA_BASE_URL et une clé API limitée à files:read sur le serveur de l’API.
          </EmptyState>
        </Section>
      ) : (
        <Section
          title={files.data ? `${items.length} image${items.length === 1 ? '' : 's'} chargée${items.length === 1 ? '' : 's'}` : 'Bibliothèque d’images'}
          actions={
            <div className='relative w-full sm:w-72'>
              <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
              <Input value={text} onChange={(event) => setText(event.target.value)} placeholder='Chercher une image…' aria-label='Chercher une image' className='ps-8' />
            </div>
          }
        >
          {files.error ? <div className='p-4'><QueryError error={files.error} /></div> : !files.data ? (
            <div className='grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'>
              {Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className='aspect-square' />)}
            </div>
          ) : !items.length ? (
            <EmptyState title='Aucune image trouvée.' icon={Image} />
          ) : (
            <>
              <div className='grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'>
                {items.map((file) => <ImageCard key={file.id} file={file} />)}
              </div>
              {files.hasNextPage && (
                <div className='border-t p-3 text-center'>
                  <Button variant='outline' onClick={() => files.fetchNextPage()} loading={files.isFetchingNextPage}>Charger plus d’images</Button>
                </div>
              )}
            </>
          )}
        </Section>
      )}
    </Page>
  )
}

function ImageCard({ file }: { file: MediaFile }) {
  return (
    <a href={file.url} target='_blank' rel='noreferrer' className='group min-w-0 overflow-hidden rounded-lg border bg-background transition-colors hover:border-primary/50'>
      <MediaThumbnail src={file.url} alt={file.name} className='aspect-square w-full rounded-none border-0 bg-muted/30 p-3 transition-transform group-hover:scale-[1.02]' />
      <div className='grid gap-1 p-2.5'>
        <span className='truncate text-sm font-medium' title={file.name}>{file.name}</span>
        <span className='truncate text-xs text-muted-foreground' title={file.folder || 'Racine'}>{file.folder || 'Racine'}</span>
        <span className='flex items-center justify-between gap-1'>
          <span className='text-xs text-muted-foreground'>{bytes(file.size)}</span>
          {file.named && <Pill tone='accent'>Nom stable</Pill>}
        </span>
      </div>
    </a>
  )
}
