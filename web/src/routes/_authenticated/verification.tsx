import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Send, ShieldCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AnnouncementEmbed, Channel, Role } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section, Pill, GuildIcon, Notice } from '@/components/app/ui'
import { ChannelSelect } from '@/components/app/pickers'
import { SaveBar, SeeAlso, useConfirm, useDiscardGuard } from '@/components/app/confirm'
import { PROTECTION_SEE_ALSO, others } from '@/features/navigation/see-also'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { EmbedFields, cleanEmbed } from '@/features/announcements/embed-editor'
import { DiscordPreview } from '@/features/announcements/discord-preview'

export const Route = createFileRoute('/_authenticated/verification')({
  component: VerificationPage,
})

type Config = {
  enabled: boolean; mode: 'button' | 'captcha'; channelId: string | null; messageId: string | null; payload: { content: string; embed: AnnouncementEmbed }
  buttonLabel: string; verifiedRoleId: string | null; unverifiedRoleId: string | null; minAccountAgeDays: number; kickAfterMinutes: number
}
type GuildData = { id: string; name: string; icon: string | null; config: Config; pending: number; channels: Channel[]; roles: Role[] }

function VerificationPage() {
  const { data, isLoading } = useQuery({ queryKey: ['verification'], queryFn: () => api<{ guilds: GuildData[] }>('/verification') })
  const [selected, setSelected] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const { guard, dialog } = useDiscardGuard(dirty)
  const guild = data?.guilds.find((g) => g.id === selected) ?? data?.guilds[0]
  return (
    <Page title='Vérification des nouveaux' description='Avant d’accéder au serveur, chaque nouveau clique sur un bouton ou recopie un captcha. Ça arrête les comptes automatiques et complète l’anti-raid.'>
      <SeeAlso links={others(PROTECTION_SEE_ALSO, '/verification')}>La vérification filtre les arrivées. Les autres protections :</SeeAlso>
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && guild && (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {data.guilds.length > 1 && (
            <nav aria-label='Serveurs' className='flex gap-2 overflow-x-auto pb-1'>
              {data.guilds.map((g) => (
                <button key={g.id} type='button' onClick={() => { if (g.id !== guild.id) void guard(() => { setDirty(false); setSelected(g.id) }) }} aria-current={g.id === guild.id ? 'page' : undefined} className='flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors hover:bg-accent aria-[current=page]:border-primary aria-[current=page]:bg-primary/10'>
                  <GuildIcon src={g.icon} name={g.name} className='size-5' />{g.name}{g.config.enabled && <ShieldCheck className='size-3.5 text-success' aria-label='active' />}
                </button>
              ))}
            </nav>
          )}
          <Editor key={guild.id} guild={guild} onDirty={setDirty} />
        </div>
      )}
      {dialog}
    </Page>
  )
}

function Editor({ guild, onDirty }: { guild: GuildData; onDirty: (dirty: boolean) => void }) {
  const { can } = useMe()
  const manage = can('verification.manage')
  const qc = useQueryClient()
  const [c, setC] = useState(guild.config)
  const set = (patch: Partial<Config>) => setC((prev) => ({ ...prev, ...patch }))
  const dirty = JSON.stringify(c) !== JSON.stringify(guild.config)
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])
  const { confirm, dialog } = useConfirm()
  const body = () => ({ ...c, payload: { content: c.payload.content, embed: cleanEmbed(c.payload.embed) } })
  const save = useMutation({ mutationFn: () => api(`/verification/${guild.id}`, { method: 'PUT', body: body() }), onSuccess: () => { toast.success('Vérification enregistrée'); qc.invalidateQueries({ queryKey: ['verification'] }) } })
  const publish = useMutation({
    mutationFn: async () => {
      await api(`/verification/${guild.id}`, { method: 'PUT', body: body() })
      return api(`/verification/${guild.id}/publish`, { method: 'POST' })
    },
    onSuccess: () => { toast.success(c.messageId ? 'Message de vérification mis à jour' : 'Message de vérification publié'); qc.invalidateQueries({ queryKey: ['verification'] }) },
  })
  const roleSelect = (key: 'verifiedRoleId' | 'unverifiedRoleId', label: string, hint: string) => (
    <div className='grid gap-1.5'>
      <Label>{label}</Label>
      <Select value={c[key] ?? 'none'} onValueChange={(v) => set({ [key]: v === 'none' ? null : v })} disabled={!manage}>
        <SelectTrigger aria-label={label}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value='none'>Aucun</SelectItem>
          {guild.roles.map((r) => <SelectItem key={r.id} value={r.id} disabled={!r.editable}>{r.name}{!r.editable ? ' (au-dessus du bot)' : ''}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className='text-xs text-muted-foreground'>{hint}</p>
    </div>
  )

  return (
    <div className='grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]'>
      <Section
        title='Réglages'
        description={c.enabled ? `${guild.pending} nouveau${guild.pending > 1 ? 'x' : ''} pas encore vérifié${guild.pending > 1 ? 's' : ''}.` : 'Désactivée sur ce serveur.'}
        actions={manage && (
          <div className='flex gap-2'>
            <Button size='sm' loading={publish.isPending} disabled={!c.channelId} onClick={async () => {
              const channel = guild.channels.find((x) => x.id === c.channelId)?.name ?? 'salon'
              if (await confirm({
                title: c.messageId ? 'Mettre à jour le message de vérification ?' : 'Publier le message de vérification ?',
                desc: `Les réglages sont enregistrés puis le message est ${c.messageId ? 'modifié' : 'posté'} dans #${channel} (${guild.name}), visible par les nouveaux arrivants.`,
                confirmText: c.messageId ? 'Mettre à jour' : 'Publier',
              })) publish.mutate()
            }}><Send /> {c.messageId ? 'Mettre à jour le message' : 'Publier le message'}</Button>
          </div>
        )}
      >
        <div className='grid gap-5 p-4'>
          <label className='flex items-center gap-2 text-sm font-medium'><Switch checked={c.enabled} onCheckedChange={(enabled) => set({ enabled })} disabled={!manage} /> Vérification active</label>
          <div className='grid gap-2'>
            <Label>Méthode</Label>
            <div className='grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-2' role='radiogroup' aria-label='Méthode'>
              {([['button', 'Bouton', 'Un clic sur « Je ne suis pas un robot ». Simple, arrête les bots basiques.'], ['captcha', 'Captcha', 'Une image avec 5 caractères à recopier. Plus sûr contre les raids de comptes.']] as const).map(([value, title, hint]) => (
                <button key={value} type='button' role='radio' aria-checked={c.mode === value} disabled={!manage} onClick={() => set({ mode: value })} className='grid gap-1 rounded-lg border p-3 text-start transition-colors hover:border-primary/60 aria-checked:border-primary aria-checked:bg-primary/10'>
                  <span className='font-medium'>{title}</span><span className='text-xs text-muted-foreground'>{hint}</span>
                </button>
              ))}
            </div>
          </div>
          <div className='grid gap-1.5'>
            <Label>Salon de vérification</Label>
            <ChannelSelect channels={guild.channels} value={c.channelId} onChange={(channelId) => set({ channelId })} label='Salon de vérification' noneLabel='Choisir un salon' disabled={!manage} />
          </div>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2'>
            {roleSelect('verifiedRoleId', 'Rôle donné une fois vérifié', 'Donne accès aux salons du serveur.')}
            {roleSelect('unverifiedRoleId', 'Rôle « non vérifié »', 'Donné à l’arrivée, retiré une fois vérifié.')}
          </div>
          <div className='grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-3'>
            <div className='grid gap-1.5'><Label htmlFor='v-age'>Âge minimum du compte (jours)</Label><Input id='v-age' type='number' min={0} max={365} value={c.minAccountAgeDays} disabled={!manage} onChange={(e) => set({ minAccountAgeDays: Number(e.target.value) })} /></div>
            <div className='grid gap-1.5'><Label htmlFor='v-kick'>Expulser si non vérifié après (min)</Label><Input id='v-kick' type='number' min={0} max={10080} value={c.kickAfterMinutes} disabled={!manage} onChange={(e) => set({ kickAfterMinutes: Number(e.target.value) })} /><p className='text-xs text-muted-foreground'>0 = jamais</p></div>
            <div className='grid gap-1.5'><Label htmlFor='v-label'>Texte du bouton</Label><Input id='v-label' maxLength={80} value={c.buttonLabel} disabled={!manage} onChange={(e) => set({ buttonLabel: e.target.value })} /></div>
          </div>
          <div className='grid gap-1.5'><Label htmlFor='v-content'>Message</Label><Textarea id='v-content' rows={2} maxLength={2000} value={c.payload.content} disabled={!manage} onChange={(e) => set({ payload: { ...c.payload, content: e.target.value } })} /></div>
          <EmbedFields embed={c.payload.embed} idPrefix='verify' disabled={!manage} onChange={(patch) => set({ payload: { ...c.payload, embed: { ...c.payload.embed, ...patch } } })} />
        </div>
      </Section>

      <div className='grid content-start gap-6'>
        <Section title='Aperçu'>
          <div className='p-4'>
            <DiscordPreview content={c.payload.content} embed={c.payload.embed} roles={new Map()} extras={{ buttons: [{ label: c.buttonLabel, url: '', emoji: c.mode === 'captcha' ? '🔐' : '✅' }] }} />
          </div>
        </Section>
        <Notice tone='info' title='Pour que ça bloque vraiment'>
          Dans les permissions Discord, retire « Voir les salons » à @everyone (ou au rôle « non vérifié ») sur tous les salons, sauf le salon de vérification. Donne ensuite « Voir les salons » au rôle vérifié. Le bot doit être au-dessus de ces rôles.
        </Notice>
        {c.enabled && !c.channelId && <Pill tone='warning'>Choisis un salon puis publie le message</Pill>}
      </div>
      {manage && <div className='xl:col-span-2'><SaveBar dirty={dirty} saving={save.isPending} onSave={() => save.mutate()} onCancel={() => setC(guild.config)} /></div>}
      {dialog}
    </div>
  )
}
