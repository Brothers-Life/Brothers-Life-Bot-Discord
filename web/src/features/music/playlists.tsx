import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, ListMusic, Lock, Music, Pencil, Play, Plus, Save, Search, Shuffle, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMe } from '@/hooks/use-me'
import { Section, EmptyState, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'

export type PlaylistTrack = { title: string; author: string | null; url: string | null; durationMs: number | null; thumbnail: string | null; source: string }
export type Playlist = {
  id: number; name: string; ownerId: string; shared: boolean; plays: number; count: number; durationMs: number; cover: string | null
  owner?: { name: string | null; avatar: string | null } | null; tracks?: PlaylistTrack[]
}
type SearchResult = { title: string; author: string | null; url: string; durationMs: number | null; thumbnail: string | null }

export function clock(ms?: number | null) {
  if (!ms || ms < 0) return '0:00'
  const total = Math.floor(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = String(total % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`
}

export function usePlaylists() {
  return useQuery({ queryKey: ['music-playlists'], queryFn: () => api<Playlist[]>('/music/playlists') })
}

// Own playlists and shared ones: play (in the order or shuffled), open to edit, save the current queue
export function Playlists({ guildId, connected, channelId, onPlayed }: { guildId: string; connected: boolean; channelId: string; onPlayed: () => void }) {
  const { me, can } = useMe()
  const qc = useQueryClient()
  const { data } = usePlaylists()
  const [open, setOpen] = useState<number | null>(null)
  const [creating, setCreating] = useState<'empty' | 'queue' | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['music-playlists'] })
  const play = useMutation({
    mutationFn: ({ id, shuffle, when }: { id: number; shuffle: boolean; when: string }) => api<{ added: number; playlist: { title: string } }>(`/music/${guildId}/playlist/${id}`, { method: 'POST', body: { shuffle, when, ...(connected ? {} : { channelId }) } }),
    onSuccess: (r) => { toast.success(`${r.playlist.title} : ${r.added} titre${r.added > 1 ? 's' : ''} ajouté${r.added > 1 ? 's' : ''}`); refresh(); onPlayed() },
  })
  const mine = (p: Playlist) => p.ownerId === me?.user.id || can('music.manage')

  return (
    <Section
      title='Playlists'
      description='Les tiennes et celles partagées par les autres. Une playlist se lance ici, avec /musique playlist ou le bouton 💾 du message sur Discord.'
      actions={
        <div className='flex flex-wrap gap-2'>
          {connected && <Button size='sm' variant='outline' onClick={() => setCreating('queue')}><Save /> Enregistrer la file</Button>}
          <Button size='sm' onClick={() => setCreating('empty')}><Plus /> Nouvelle playlist</Button>
        </div>
      }
    >
      {!data ? <Skeleton className='m-4 h-32' /> : !data.length ? (
        <EmptyState title='Aucune playlist' icon={ListMusic}>Crée-en une, ou enregistre la file en cours pour la relancer plus tard.</EmptyState>
      ) : (
        <ul className='grid gap-3 p-4 sm:grid-cols-2'>
          {data.map((p) => (
            <li key={p.id} className='lift flex min-w-0 gap-3 rounded-lg border bg-card p-3'>
              <button type='button' onClick={() => setOpen(p.id)} className='relative size-16 shrink-0 overflow-hidden rounded-md bg-muted' aria-label={`Ouvrir ${p.name}`}>
                {p.cover ? <img src={p.cover} alt='' className='size-full object-cover' /> : <Music className='m-auto size-6 text-muted-foreground' />}
              </button>
              <div className='grid min-w-0 flex-1 content-start gap-1'>
                <button type='button' onClick={() => setOpen(p.id)} className='truncate text-start font-medium hover:underline'>{p.name}</button>
                <div className='flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground'>
                  <span>{p.count} titre{p.count > 1 ? 's' : ''} · {clock(p.durationMs)}</span>
                  {p.shared ? <Pill tone='info'><Users className='size-3' />partagée</Pill> : <Pill tone='neutral'><Lock className='size-3' />privée</Pill>}
                  {p.ownerId !== me?.user.id && p.owner?.name && <span>de {p.owner.name}</span>}
                </div>
                <div className='mt-1 flex flex-wrap gap-1'>
                  <Button size='sm' className='h-7' disabled={!p.count || play.isPending || (!connected && !channelId)} onClick={() => play.mutate({ id: p.id, shuffle: false, when: 'end' })}><Play /> Jouer</Button>
                  <Button size='sm' variant='outline' className='h-7' disabled={!p.count || play.isPending || (!connected && !channelId)} onClick={() => play.mutate({ id: p.id, shuffle: true, when: 'end' })}><Shuffle /> Mélanger</Button>
                  {connected && <Button size='sm' variant='ghost' className='h-7' disabled={!p.count || play.isPending} onClick={() => play.mutate({ id: p.id, shuffle: false, when: 'next' })}>Ensuite</Button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open !== null && <PlaylistDialog id={open} editable={Boolean(data?.find((p) => p.id === open) && mine(data.find((p) => p.id === open)!))} onClose={() => setOpen(null)} onChanged={refresh} />}
      {creating && <CreateDialog fromGuildId={creating === 'queue' ? guildId : null} onClose={() => setCreating(null)} onCreated={(id) => { refresh(); setOpen(id) }} />}
    </Section>
  )
}

function CreateDialog({ fromGuildId, onClose, onCreated }: { fromGuildId: string | null; onClose: () => void; onCreated: (id: number) => void }) {
  const [name, setName] = useState('')
  const [shared, setShared] = useState(true)
  const create = useMutation({
    mutationFn: () => api<Playlist>('/music/playlists', { method: 'POST', body: { name: name.trim(), shared, ...(fromGuildId ? { fromGuildId } : {}) } }),
    onSuccess: (p) => { toast.success(`Playlist « ${p.name} » créée (${p.count} titre${p.count > 1 ? 's' : ''})`); onClose(); onCreated(p.id) },
  })
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-md'>
        <DialogHeader>
          <DialogTitle>{fromGuildId ? 'Enregistrer la file en playlist' : 'Nouvelle playlist'}</DialogTitle>
          <DialogDescription>{fromGuildId ? 'Tous les titres de la file (déjà passés compris) sont enregistrés.' : 'Tu pourras y ajouter des liens ou des recherches ensuite.'}</DialogDescription>
        </DialogHeader>
        <form id='playlist-form' className='grid gap-4' onSubmit={(e) => { e.preventDefault(); if (name.trim()) create.mutate() }}>
          <div className='grid gap-1.5'><Label htmlFor='pl-name'>Nom</Label><Input id='pl-name' value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder='Soirée RP' autoFocus /></div>
          <label className='flex items-center gap-2 text-sm'><Switch checked={shared} onCheckedChange={setShared} /> Partagée : tout le monde peut la lancer (toi seul la modifies)</label>
        </form>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button type='submit' form='playlist-form' loading={create.isPending} disabled={!name.trim()}>Créer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlaylistDialog({ id, editable, onClose, onChanged }: { id: number; editable: boolean; onClose: () => void; onChanged: () => void }) {
  const qc = useQueryClient()
  const { data: list } = useQuery({ queryKey: ['music-playlist', id], queryFn: () => api<Playlist>(`/music/playlists/${id}`) })
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const results = useQuery({ queryKey: ['music-search', search], queryFn: () => api<SearchResult[]>(`/music/search?q=${encodeURIComponent(search)}`), enabled: search.length >= 2, staleTime: 10 * 60_000 })
  const done = (next: Playlist) => { qc.setQueryData(['music-playlist', id], next); onChanged() }
  const add = useMutation({ mutationFn: (q: string) => api<Playlist>(`/music/playlists/${id}/tracks`, { method: 'POST', body: { query: q } }), onSuccess: (p) => { toast.success('Ajouté à la playlist'); setQuery(''); done(p) } })
  const removeTrack = useMutation({ mutationFn: (index: number) => api<Playlist>(`/music/playlists/${id}/tracks/${index}`, { method: 'DELETE' }), onSuccess: done })
  const move = useMutation({ mutationFn: ({ from, to }: { from: number; to: number }) => api<Playlist>(`/music/playlists/${id}/move`, { method: 'POST', body: { from, to } }), onSuccess: done })
  const update = useMutation({ mutationFn: (patch: { name?: string; shared?: boolean }) => api<Playlist>(`/music/playlists/${id}`, { method: 'PATCH', body: patch }), onSuccess: (p) => { setRenaming(null); done(p) } })
  const remove = useMutation({ mutationFn: () => api(`/music/playlists/${id}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Playlist supprimée'); onChanged(); onClose() } })
  const submit = () => {
    const text = query.trim()
    if (!text) return
    if (/^https?:\/\//i.test(text)) add.mutate(text)
    else setSearch(text)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='grid max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle className='flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]'>
            {renaming !== null ? (
              <form className='flex flex-1 gap-2' onSubmit={(e) => { e.preventDefault(); if (renaming.trim()) update.mutate({ name: renaming.trim() }) }}>
                <Input value={renaming} maxLength={60} onChange={(e) => setRenaming(e.target.value)} autoFocus aria-label='Nom de la playlist' />
                <Button size='sm' type='submit' loading={update.isPending}>OK</Button>
              </form>
            ) : (
              <>
                {list?.name ?? 'Playlist'}
                {editable && list && <Button size='icon' variant='ghost' className='size-7' aria-label='Renommer' onClick={() => setRenaming(list.name)}><Pencil className='size-3.5' /></Button>}
              </>
            )}
          </DialogTitle>
          <DialogDescription>
            {list ? `${list.count} titre${list.count > 1 ? 's' : ''} · ${clock(list.durationMs)} · lancée ${list.plays} fois` : 'Chargement…'}
          </DialogDescription>
          {editable && list && <label className='flex items-center gap-2 text-sm'><Switch checked={list.shared} onCheckedChange={(shared) => update.mutate({ shared })} /> Partagée avec tout le monde</label>}
        </DialogHeader>

        <div className='grid min-h-0 content-start gap-3 overflow-y-auto'>
          {editable && (
            <div className='grid gap-2'>
              <form className='flex gap-2' onSubmit={(e) => { e.preventDefault(); submit() }}>
                <div className='relative flex-1'>
                  <Search className='pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground' />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder='Lien (titre, playlist YouTube/Spotify) ou recherche' aria-label='Ajouter à la playlist' className='ps-8' />
                </div>
                <Button type='submit' loading={add.isPending} disabled={!query.trim()}>{/^https?:\/\//i.test(query.trim()) ? <><Plus /> Ajouter</> : <><Search /> Chercher</>}</Button>
              </form>
              {search && (
                <ul className='grid gap-1 rounded-lg border p-1' aria-label='Résultats'>
                  {results.isLoading && Array.from({ length: 3 }, (_, i) => <Skeleton key={i} className='h-11 w-full' />)}
                  {results.data?.map((r) => (
                    <li key={r.url} className='flex items-center gap-2 rounded-md p-1 hover:bg-accent/40'>
                      {r.thumbnail ? <img src={r.thumbnail} alt='' className='h-9 w-14 shrink-0 rounded object-cover' /> : <span className='h-9 w-14 shrink-0 rounded bg-muted' />}
                      <div className='min-w-0 flex-1'><div className='truncate text-sm'>{r.title}</div><div className='truncate text-xs text-muted-foreground'>{r.author}{r.durationMs ? ` · ${clock(r.durationMs)}` : ''}</div></div>
                      <Button size='icon' variant='ghost' aria-label={`Ajouter ${r.title}`} disabled={add.isPending} onClick={() => add.mutate(r.url)}><Plus /></Button>
                    </li>
                  ))}
                  <li className='text-end'><Button size='sm' variant='ghost' onClick={() => setSearch('')}><X /> Fermer</Button></li>
                </ul>
              )}
            </div>
          )}
          {!list ? <Skeleton className='h-40' /> : !list.tracks?.length ? <EmptyState title='Playlist vide' icon={ListMusic}>{editable ? 'Ajoute des titres avec la barre ci-dessus.' : 'Son créateur n’y a encore rien mis.'}</EmptyState> : (
            <ol className='divide-y rounded-lg border'>
              {list.tracks.map((t, i) => (
                <li key={`${i}-${t.url}`} className='group flex items-center gap-3 px-3 py-2'>
                  <span className='w-6 text-end text-xs text-muted-foreground tabular-nums'>{i + 1}</span>
                  {t.thumbnail ? <img src={t.thumbnail} alt='' className='size-9 shrink-0 rounded object-cover' /> : <span className='grid size-9 shrink-0 place-items-center rounded bg-muted'><Music className='size-4 text-muted-foreground' /></span>}
                  <div className='min-w-0 flex-1'>
                    <div className='truncate text-sm font-medium'>{t.title}</div>
                    <div className='truncate text-xs text-muted-foreground'>{[t.author, t.durationMs ? clock(t.durationMs) : null].filter(Boolean).join(' · ')}</div>
                  </div>
                  {editable && (
                    <div className={cn('flex transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100')}>
                      <Button size='icon' variant='ghost' className='size-7' aria-label='Monter' disabled={i === 0 || move.isPending} onClick={() => move.mutate({ from: i, to: i - 1 })}><ArrowUp className='size-3.5' /></Button>
                      <Button size='icon' variant='ghost' className='size-7' aria-label='Descendre' disabled={i === list.tracks!.length - 1 || move.isPending} onClick={() => move.mutate({ from: i, to: i + 1 })}><ArrowDown className='size-3.5' /></Button>
                      <Button size='icon' variant='danger-ghost' className='size-7' aria-label={`Retirer ${t.title}`} disabled={removeTrack.isPending} onClick={() => removeTrack.mutate(i)}><X className='size-3.5' /></Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>

        <DialogFooter>
          {editable && <Button variant='danger-ghost' className='sm:me-auto' onClick={() => setDeleting(true)}><Trash2 /> Supprimer</Button>}
          <Button variant='outline' onClick={onClose}>Fermer</Button>
        </DialogFooter>
        <ConfirmDialog open={deleting} onOpenChange={setDeleting} title={`Supprimer « ${list?.name ?? ''} » ?`} desc='La playlist disparaît pour tout le monde.' confirmText='Supprimer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
      </DialogContent>
    </Dialog>
  )
}
