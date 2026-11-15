import { useDeferredValue, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { ChevronRight, Folder, Image, Link2, Search } from 'lucide-react'
import { api } from '@/lib/api'
import { EmptyState, Page, Pill, Section } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { type MediaFile, useMediaConfig } from '@/features/fivem/media'
import { MediaThumbnail } from '@/features/fivem/media-image'
import { bytes, fmt } from '@/features/telemetry/format'
import { QueryError } from '@/features/telemetry/ui'

export const Route = createFileRoute('/_authenticated/media')({
  component: MediaLibrary,
})

type FolderItem = { id: number; name: string; path: string; parent: string | null; files: number; bytes: number }
type FolderListing = { folder: FolderItem | null; children: FolderItem[] }

function MediaLibrary() {
  const [folder, setFolder] = useState('')
  const [text, setText] = useState('')
  const q = useDeferredValue(text.trim())
  const config = useMediaConfig()
  const folders = useQuery({
    queryKey: ['media-folders', folder],
    queryFn: () => api<FolderListing>(`/media/folders?parent=${encodeURIComponent(folder)}`),
    enabled: config.data?.enabled === true,
  })
  const files = useInfiniteQuery({
    queryKey: ['media-images', folder, q],
    initialPageParam: '',
    queryFn: ({ pageParam }) => api<{ items: MediaFile[]; nextCursor: string | null }>(
      `/media/images?folder=${encodeURIComponent(folder)}&q=${encodeURIComponent(q)}${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`,
    ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: config.data?.enabled === true,
  })
  const items = files.data?.pages.flatMap((page) => page.items) ?? []
  const segments = folder ? folder.split('/') : []

  return (
    <Page
      title='FiveM · Images'
      description='Explore les dossiers du service média, leurs chemins et les liens publics des images.'
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
        <div className='grid grid-cols-[minmax(0,1fr)] gap-4'>
          <Section title='Chemin'>
            <nav aria-label='Chemin du dossier' className='flex flex-wrap items-center gap-1 px-4 py-3 text-sm'>
              <button type='button' onClick={() => setFolder('')} className='font-medium text-primary hover:underline'>Racine</button>
              {segments.map((segment, index) => {
                const path = segments.slice(0, index + 1).join('/')
                return (
                  <span key={path} className='inline-flex min-w-0 items-center gap-1'>
                    <ChevronRight className='size-4 shrink-0 text-muted-foreground' aria-hidden />
                    <button type='button' onClick={() => setFolder(path)} className='max-w-48 truncate hover:text-primary hover:underline' title={path}>{segment}</button>
                  </span>
                )
              })}
              <span className='ms-auto text-xs text-muted-foreground [overflow-wrap:anywhere]'>{folder || '/'}</span>
            </nav>
          </Section>

          <Section
            title={folder ? `Contenu · ${folder}` : 'Contenu · Racine'}
            description={folders.data ? `${folders.data.children.length} dossier${folders.data.children.length === 1 ? '' : 's'} · ${files.data ? fmt(items.length) : '…'} image${items.length === 1 ? '' : 's'} dans ce dossier` : undefined}
            actions={
              <div className='relative w-full sm:w-72'>
                <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' aria-hidden />
                <Input value={text} onChange={(event) => setText(event.target.value)} placeholder='Chercher dans ce dossier…' aria-label='Chercher une image dans ce dossier' className='ps-8' />
              </div>
            }
          >
            {folders.error ? <div className='p-4'><QueryError error={folders.error} /></div> : !folders.data ? (
              <div className='grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 lg:grid-cols-4'>
                {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className='h-20' />)}
              </div>
            ) : folders.data.children.length > 0 ? (
              <div className='grid grid-cols-1 gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3'>
                {folders.data.children.map((child) => <FolderCard key={child.id} folder={child} onOpen={() => { setFolder(child.path); setText('') }} />)}
              </div>
            ) : null}

            {files.error ? <div className='p-4'><QueryError error={files.error} /></div> : !files.data ? (
              <div className='grid grid-cols-2 gap-3 p-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6'>
                {Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className='aspect-square' />)}
              </div>
            ) : items.length === 0 && folders.data?.children.length === 0 ? (
              <EmptyState title={q ? 'Aucune image ne correspond à la recherche.' : 'Ce dossier est vide.'} icon={Image} />
            ) : items.length > 0 ? (
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
            ) : null}
          </Section>
        </div>
      )}
    </Page>
  )
}

function FolderCard({ folder, onOpen }: { folder: FolderItem; onOpen: () => void }) {
  return (
    <button type='button' onClick={onOpen} className='flex min-w-0 items-center gap-3 rounded-lg border bg-background p-3 text-start transition-colors hover:border-primary/50 hover:bg-accent/30'>
      <Folder className='size-5 shrink-0 text-primary' aria-hidden />
      <span className='grid min-w-0 flex-1 gap-0.5'>
        <span className='truncate text-sm font-medium'>{folder.name}</span>
        <span className='truncate text-xs text-muted-foreground' title={folder.path}>{folder.path}</span>
      </span>
      <span className='shrink-0 text-end text-xs text-muted-foreground'>{fmt(folder.files)} fichier{folder.files === 1 ? '' : 's'}<br />{bytes(folder.bytes)}</span>
    </button>
  )
}

function ImageCard({ file }: { file: MediaFile }) {
  return (
    <article className='group min-w-0 overflow-hidden rounded-lg border bg-background transition-colors hover:border-primary/50'>
      <a href={file.url} target='_blank' rel='noreferrer' className='block' aria-label={`Ouvrir ${file.name}`}>
        <MediaThumbnail src={file.url} alt={file.name} className='aspect-square w-full rounded-none border-0 bg-muted/30 p-3 transition-transform group-hover:scale-[1.02]' />
      </a>
      <div className='grid min-w-0 gap-1 p-2.5'>
        <span className='truncate text-sm font-medium' title={file.name}>{file.name}</span>
        <span className='truncate text-xs text-muted-foreground' title={file.folder || 'Racine'}>{file.folder || 'Racine'}</span>
        <span className='flex items-center justify-between gap-1'>
          <span className='text-xs text-muted-foreground'>{bytes(file.size)}</span>
          {file.named && <Pill tone='accent'>Nom stable</Pill>}
        </span>
        <a href={file.url} target='_blank' rel='noreferrer' className='flex min-w-0 items-center gap-1 text-xs text-primary hover:underline' title={file.url}>
          <Link2 className='size-3 shrink-0' aria-hidden />
          <span className='truncate'>{file.url}</span>
        </a>
      </div>
    </article>
  )
}
