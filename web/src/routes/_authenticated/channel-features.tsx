import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Hash, Image, Megaphone, Pencil, Pin, Plus, RotateCcw, Trash2, Type } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, Channel } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section, EmptyState, Pill, GuildIcon } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { EMPTY_EMBED, EmbedFields, cleanEmbed } from '@/features/announcements/embed-editor'

export const Route = createFileRoute('/_authenticated/channel-features')({
  component: ChannelFeaturesPage,
})

type Kind = 'counting' | 'oneword' | 'sticky' | 'autopublish' | 'mediaonly'
type Config = Record<string, unknown> & { payload?: { content: string; embed: AnnouncementEmbed } }
type Feature = { channelId: string; guildId: string; kind: Kind; config: Config; state: Record<string, unknown> }
type GuildData = { id: string; name: string; icon: string | null; channels: Channel[]; features: Feature[] }
type Payload = { kinds: Record<Kind, string>; guilds: GuildData[] }

const KIND_INFO: Record<Kind, { icon: React.ElementType; hint: string }> = {
  counting: { icon: Hash, hint: 'Chacun écrit le nombre suivant, à tour de rôle. Une erreur remet le compteur à zéro.' },
  oneword: { icon: Type, hint: 'Chacun ajoute un seul mot pour écrire une phrase ensemble. Un point la termine et le bot la publie.' },
  sticky: { icon: Pin, hint: 'Un message qui revient toujours en bas du salon, quelques secondes après les autres.' },
  autopublish: { icon: Megaphone, hint: 'Salon d’annonces : chaque message est publié automatiquement vers les serveurs abonnés.' },
  mediaonly: { icon: Image, hint: 'Seuls les messages avec image, vidéo ou lien restent. Le texte seul est supprimé (sauf staff).' },
}
const ORDER: Kind[] = ['counting', 'oneword', 'sticky', 'autopublish', 'mediaonly']

function ChannelFeaturesPage() {
  const { can } = useMe()
  const manage = can('channelfeatures.manage')
  const { data, isLoading } = useQuery({ queryKey: ['channel-features'], queryFn: () => api<Payload>('/channel-features'), refetchInterval: 15_000 })
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ kind: Kind; feature?: Feature } | null>(null)
  const guild = data?.guilds.find((g) => g.id === selected) ?? data?.guilds[0]

  return (
    <Page title='Salons automatiques' description='Des salons qui ont une règle ou un jeu : compteur, histoire un mot à la fois, message toujours en bas, publication automatique, images uniquement.'>
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && guild && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {data.guilds.length > 1 && (
            <nav aria-label='Serveurs' className='flex gap-2 overflow-x-auto pb-1'>
              {data.guilds.map((g) => (
                <button key={g.id} type='button' onClick={() => setSelected(g.id)} aria-current={g.id === guild.id ? 'page' : undefined} className='flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent aria-[current=page]:border-primary aria-[current=page]:bg-primary/10'>
                  <GuildIcon src={g.icon} name={g.name} className='size-5' />{g.name}{g.features.length > 0 && <span className='text-xs text-muted-foreground'>{g.features.length}</span>}
                </button>
              ))}
            </nav>
          )}

          {manage && (
            <div className='stagger grid gap-3 sm:grid-cols-2 xl:grid-cols-5'>
              {ORDER.map((kind) => {
                const Icon = KIND_INFO[kind].icon
                return (
                  <button key={kind} type='button' onClick={() => setEditing({ kind })} className='lift grid content-start gap-1.5 rounded-lg border bg-card p-3 text-start transition-colors hover:border-primary/60 focus-visible:border-primary focus-visible:outline-none'>
                    <span className='flex items-center gap-2 font-medium'><Icon className='size-4 text-primary' />{data.kinds[kind]}</span>
                    <span className='text-xs text-muted-foreground'>{KIND_INFO[kind].hint}</span>
                    <span className='mt-1 inline-flex items-center gap-1 text-xs text-primary'><Plus className='size-3' />Ajouter un salon</span>
                  </button>
                )
              })}
            </div>
          )}

          <Section title={`Salons configurés sur ${guild.name}`}>
            {!guild.features.length ? <EmptyState title='Aucun salon automatique' icon={Hash}>Choisis un type ci-dessus pour l’appliquer à un salon.</EmptyState> : (
              <ul className='divide-y'>
                {guild.features.map((f) => <FeatureRow key={`${f.channelId}-${f.kind}`} feature={f} guild={guild} label={data.kinds[f.kind]} manage={manage} onEdit={() => setEditing({ kind: f.kind, feature: f })} />)}
              </ul>
            )}
          </Section>
          {editing && <FeatureDialog key={`${editing.kind}-${editing.feature?.channelId ?? 'new'}`} guild={guild} kind={editing.kind} label={data.kinds[editing.kind]} feature={editing.feature} onClose={() => setEditing(null)} />}
        </div>
      )}
    </Page>
  )
}

function FeatureRow({ feature: f, guild, label, manage, onEdit }: { feature: Feature; guild: GuildData; label: string; manage: boolean; onEdit: () => void }) {
  const qc = useQueryClient()
  const [removing, setRemoving] = useState(false)
  const [count, setCount] = useState('')
  const refresh = () => qc.invalidateQueries({ queryKey: ['channel-features'] })
  const remove = useMutation({ mutationFn: () => api(`/channel-features/${f.channelId}/${f.kind}`, { method: 'DELETE' }), onSuccess: () => { toast.success('Réglage retiré'); setRemoving(false); refresh() } })
  const setCountM = useMutation({ mutationFn: (value: number) => api(`/channel-features/${f.channelId}/count`, { method: 'POST', body: { count: value } }), onSuccess: () => { toast.success('Compteur modifié'); setCount(''); refresh() } })
  const Icon = KIND_INFO[f.kind].icon
  const channel = guild.channels.find((c) => c.id === f.channelId)
  const s = f.state as { count?: number; best?: number; fails?: number; words?: string[]; sentences?: number }

  return (
    <li className='flex flex-wrap items-center gap-3 px-4 py-3'>
      <span className='grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary'><Icon className='size-4' /></span>
      <div className='min-w-0 flex-1 basis-60'>
        <div className='flex flex-wrap items-center gap-2'><span className='font-medium'>#{channel?.name ?? 'salon supprimé'}</span><Pill tone='accent'>{label}</Pill></div>
        <div className='text-xs text-muted-foreground [overflow-wrap:anywhere]'>
          {f.kind === 'counting' && <>Compteur à <strong className='text-foreground'>{s.count ?? 0}</strong> · record {s.best ?? 0} · {s.fails ?? 0} série{(s.fails ?? 0) > 1 ? 's' : ''} cassée{(s.fails ?? 0) > 1 ? 's' : ''}</>}
          {f.kind === 'oneword' && <>{s.sentences ?? 0} phrase{(s.sentences ?? 0) > 1 ? 's' : ''} écrite{(s.sentences ?? 0) > 1 ? 's' : ''}{s.words?.length ? <> · en cours : « {s.words.join(' ')} … »</> : null}</>}
          {f.kind === 'sticky' && <>Revient après {String(f.config.delaySeconds)} s : {f.config.payload?.content || f.config.payload?.embed.title || 'embed'}</>}
          {f.kind === 'autopublish' && <>{f.config.onlyBots ? 'Messages des bots seulement' : 'Tous les messages'}</>}
          {f.kind === 'mediaonly' && <>{f.config.allowLinks ? 'Images, vidéos et liens' : 'Images et vidéos'}{f.config.notice ? ' · avertit l’auteur' : ''}</>}
        </div>
      </div>
      {manage && (
        <div className='flex flex-wrap items-center gap-1'>
          {f.kind === 'counting' && (
            <form className='flex items-center gap-1' onSubmit={(e) => { e.preventDefault(); if (count !== '') setCountM.mutate(Number(count)) }}>
              <Input type='number' min={0} value={count} onChange={(e) => setCount(e.target.value)} placeholder='Remettre à…' aria-label='Remettre le compteur à' className='h-8 w-28' />
              <Button size='icon' variant='ghost' type='submit' aria-label='Remettre le compteur' disabled={count === '' || setCountM.isPending}><RotateCcw /></Button>
            </form>
          )}
          <Button size='icon' variant='ghost' aria-label={`Modifier ${label}`} onClick={onEdit}><Pencil /></Button>
          <Button size='icon' variant='danger-ghost' aria-label={`Retirer ${label}`} onClick={() => setRemoving(true)}><Trash2 /></Button>
        </div>
      )}
      <ConfirmDialog open={removing} onOpenChange={setRemoving} title={`Retirer « ${label} » de #${channel?.name ?? ''} ?`} desc={f.kind === 'sticky' ? 'Le message en bas du salon est supprimé.' : 'Le salon redevient normal.'} confirmText='Retirer' destructive isLoading={remove.isPending} handleConfirm={() => remove.mutate()} />
    </li>
  )
}

function FeatureDialog({ guild, kind, label, feature, onClose }: { guild: GuildData; kind: Kind; label: string; feature?: Feature; onClose: () => void }) {
  const qc = useQueryClient()
  const [channelId, setChannelId] = useState<string | null>(feature?.channelId ?? null)
  const [c, setC] = useState<Config>(feature?.config ?? (kind === 'sticky' ? { delaySeconds: 8, payload: { content: '', embed: { ...EMPTY_EMBED, color: '#ff9628' } } } : kind === 'oneword' ? { minWords: 3, maxLength: 30 } : kind === 'mediaonly' ? { allowLinks: true, notice: true } : kind === 'counting' ? { resetOnFail: true, deleteOthers: true } : {}))
  const set = (patch: Config) => setC((prev) => ({ ...prev, ...patch }))
  const channels = kind === 'autopublish' ? guild.channels.filter((ch) => ch.announcement) : guild.channels
  const save = useMutation({
    mutationFn: () => api('/channel-features', {
      method: 'PUT',
      body: { guildId: guild.id, channelId, kind, config: kind === 'sticky' && c.payload ? { ...c, payload: { content: c.payload.content, embed: cleanEmbed(c.payload.embed) } } : c },
    }),
    onSuccess: () => { toast.success(`${label} : enregistré`); qc.invalidateQueries({ queryKey: ['channel-features'] }); onClose() },
  })
  const toggle = (key: string, text: string) => <label className='flex items-center gap-2 text-sm'><Switch checked={Boolean(c[key])} onCheckedChange={(v) => set({ [key]: v })} /> {text}</label>
  const number = (key: string, text: string, min: number, max: number) => (
    <div className='grid gap-1.5'><Label htmlFor={`f-${key}`}>{text}</Label><Input id={`f-${key}`} type='number' min={min} max={max} value={Number(c[key] ?? min)} onChange={(e) => set({ [key]: Number(e.target.value) })} /></div>
  )

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='max-h-[90vh] overflow-y-auto sm:max-w-2xl'>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{KIND_INFO[kind].hint}</DialogDescription>
        </DialogHeader>
        <div className='grid gap-4'>
          <div className='grid gap-1.5'>
            <Label>Salon</Label>
            {feature ? <p className='text-sm'>#{guild.channels.find((ch) => ch.id === feature.channelId)?.name}</p> : <ChannelSelect channels={channels} value={channelId} onChange={setChannelId} label='Salon' noneLabel='Choisir un salon' />}
            {kind === 'autopublish' && !channels.length && <p className='text-xs text-warning'>Aucun salon d’annonces sur ce serveur (Paramètres du serveur, Communauté).</p>}
          </div>
          {kind === 'counting' && <>{toggle('resetOnFail', 'Une erreur remet le compteur à zéro (sinon le mauvais nombre est juste supprimé)')}{toggle('allowTwice', 'Autoriser la même personne deux fois de suite')}{toggle('deleteOthers', 'Supprimer les messages qui ne sont pas des nombres')}</>}
          {kind === 'oneword' && <div className='grid gap-4 sm:grid-cols-2'>{number('minWords', 'Mots minimum par phrase', 1, 50)}{number('maxLength', 'Longueur max d’un mot', 5, 50)}<div className='sm:col-span-2'>{toggle('allowTwice', 'Autoriser la même personne deux fois de suite')}</div></div>}
          {kind === 'autopublish' && toggle('onlyBots', 'Seulement les messages des bots (flux, alertes)')}
          {kind === 'mediaonly' && <>{toggle('allowLinks', 'Autoriser aussi les liens (YouTube, Imgur…)')}{toggle('notice', 'Prévenir la personne quand son message est supprimé')}</>}
          {kind === 'sticky' && c.payload && (
            <>
              {number('delaySeconds', 'Revient en bas après (secondes de calme)', 3, 300)}
              <div className='grid gap-1.5'><Label htmlFor='sticky-content'>Texte</Label><Textarea id='sticky-content' rows={2} maxLength={2000} value={c.payload.content} onChange={(e) => set({ payload: { ...c.payload!, content: e.target.value } })} /></div>
              <label className='flex items-center gap-2 text-sm'><Switch checked={c.payload.embed.enabled} onCheckedChange={(enabled) => set({ payload: { ...c.payload!, embed: { ...c.payload!.embed, enabled } } })} /> Avec un embed</label>
              {c.payload.embed.enabled && <EmbedFields embed={c.payload.embed} idPrefix='sticky' onChange={(patch) => set({ payload: { ...c.payload!, embed: { ...c.payload!.embed, ...patch } } })} />}
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={onClose}>Annuler</Button>
          <Button loading={save.isPending} disabled={!channelId} onClick={() => save.mutate()}>Enregistrer</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
