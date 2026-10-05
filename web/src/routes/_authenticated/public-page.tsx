import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { Page, Section, Notice } from '@/components/app/ui'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import type { PublicConfig, PublicConfigPayload } from '@/features/public-page/types'
import { SaveBar } from '@/components/app/confirm'

export const Route = createFileRoute('/_authenticated/public-page')({
  component: PublicPageSettings,
})

type SectionKey = 'status' | 'maintenance' | 'staff' | 'rules' | 'discord' | 'events' | 'recruitment' | 'links'

// A list of choices as checkboxes; nothing checked means "all" when `allWhenEmpty`
function ChoiceList<T extends string | number>({ options, value, onChange, allWhenEmpty, empty }: {
  options: { id: T; name: string; color?: string | null }[]
  value: T[]
  onChange: (next: T[]) => void
  allWhenEmpty?: boolean
  empty: string
}) {
  if (!options.length) return <p className='text-sm text-muted-foreground'>{empty}</p>
  return (
    <div className='grid gap-2'>
      {allWhenEmpty && <p className='text-xs text-muted-foreground'>{value.length ? `${value.length} sélectionné(s)` : 'Rien de coché : tout est affiché.'}</p>}
      <div className='flex flex-wrap gap-2'>
        {options.map((o) => {
          const checked = value.includes(o.id)
          return (
            <label key={String(o.id)} className={cn('flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors', checked ? 'border-primary/60 bg-primary/10' : 'hover:bg-accent')}>
              <Checkbox checked={checked} onCheckedChange={() => onChange(checked ? value.filter((x) => x !== o.id) : [...value, o.id])} />
              {o.color !== undefined && <span aria-hidden className='size-2 rounded-full' style={{ background: o.color ?? 'var(--muted-foreground)' }} />}
              {o.name}
            </label>
          )
        })}
      </div>
    </div>
  )
}

function PublicPageSettings() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['public-page-config'], queryFn: () => api<PublicConfigPayload>('/public-page/config') })
  const [draft, setDraft] = useState<PublicConfig | null>(null)

  const save = useMutation({
    mutationFn: (config: PublicConfig) => api<PublicConfig>('/public-page/config', { method: 'PUT', body: config }),
    onSuccess: (saved) => {
      toast.success('Page publique enregistrée')
      setDraft(null)
      qc.setQueryData<PublicConfigPayload>(['public-page-config'], (old) => (old ? { ...old, config: saved } : old))
    },
  })

  const config = draft ?? data?.config
  const set = (patch: Partial<PublicConfig>) => config && setDraft({ ...config, ...patch })
  function setSection<K extends SectionKey>(key: K, patch: Partial<PublicConfig[K]>) {
    if (config) setDraft({ ...config, [key]: { ...config[key], ...patch } })
  }
  const toggle = (key: SectionKey, label: string) => config && (
    <Switch checked={config[key].enabled} onCheckedChange={(v) => setSection(key, { enabled: v } as Partial<PublicConfig[typeof key]>)} aria-label={`Afficher : ${label}`} />
  )

  return (
    <Page
      title='Page publique'
      description='Une page visible sans connexion, à partager aux joueurs : état du serveur, équipe, règlement, événements. Chaque bloc s’active à part ; aucune donnée sensible n’y apparaît (ni identifiants, ni sanctions, ni données de la base FiveM).'
      actions={config && (
        <>
          {data?.config.enabled && (
            <Button variant='outline' asChild>
              <a href='/public' target='_blank' rel='noopener noreferrer'><ExternalLink /> Ouvrir la page</a>
            </Button>
          )}
          <Button disabled={!draft || save.isPending} onClick={() => draft && save.mutate(draft)}><Save /> Enregistrer</Button>
        </>
      )}
    >
      {!data || !config ? <Skeleton className='h-96 w-full' /> : (
        <div className='grid grid-cols-[minmax(0,1fr)] gap-6'>
          {/* The banner shows what is live (saved), the switch what will be saved */}
          <div className={cn('flex flex-wrap items-center gap-4 rounded-lg border p-4', data.config.enabled ? 'border-success/40 bg-success/8' : 'bg-card')}>
            <div className='min-w-56 flex-1'>
              <div className='font-semibold'>{data.config.enabled ? 'Page publiée' : 'Page désactivée'}</div>
              <div className='text-sm text-muted-foreground'>
                {data.config.enabled ? <>Visible par tout le monde à l’adresse <code className='rounded bg-muted px-1'>{window.location.origin}/public</code>.</> : 'L’adresse /public répond « page introuvable » tant qu’elle est désactivée.'}
              </div>
              {config.enabled !== data.config.enabled && (
                <div className='mt-1 text-sm font-medium text-warning'>{config.enabled ? 'Sera publiée quand tu enregistreras.' : 'Sera désactivée quand tu enregistreras.'}</div>
              )}
            </div>
            <Switch checked={config.enabled} onCheckedChange={(v) => set({ enabled: v })} aria-label='Publier la page' />
          </div>

          <Section title='En-tête'>
            <div className='grid gap-4 p-4 sm:grid-cols-2'>
              <div className='grid gap-1.5'>
                <Label htmlFor='pp-title'>Titre</Label>
                <Input id='pp-title' maxLength={60} value={config.title} onChange={(e) => set({ title: e.target.value })} />
              </div>
              <div className='grid gap-1.5'>
                <Label htmlFor='pp-tagline'>Phrase d’accroche</Label>
                <Input id='pp-tagline' maxLength={200} value={config.tagline} placeholder='Serveur RP FiveM, whitelist ouverte' onChange={(e) => set({ tagline: e.target.value })} />
              </div>
            </div>
          </Section>

          <Section title='État du serveur FiveM' description='Joueurs connectés, places, durée en ligne et bouton de connexion. L’adresse IP n’est jamais affichée.' actions={toggle('status', 'état du serveur')}>
            <div className='grid gap-4 p-4'>
              <ChoiceList allWhenEmpty empty='Aucun serveur FiveM configuré (page FiveM).' options={data.options.servers} value={config.status.serverIds} onChange={(serverIds) => setSection('status', { serverIds })} />
              <label className='flex items-center gap-3 text-sm'>
                <Switch checked={config.status.showPlayerNames} onCheckedChange={(v) => setSection('status', { showPlayerNames: v })} />
                Afficher les noms des joueurs connectés (noms en jeu seulement)
              </label>
            </div>
          </Section>

          <Section title='Maintenance et redémarrages' description='Bandeau de maintenance et compte à rebours avant le prochain redémarrage.' actions={toggle('maintenance', 'maintenance')}>
            {!data.options.maintenanceAvailable && (
              <div className='p-4'><Notice tone='info'>Ce bloc s’affichera dès que la gestion des maintenances FiveM sera disponible dans le bot.</Notice></div>
            )}
          </Section>

          <Section title='Équipe' description='Les membres des rangs cochés, du plus haut au plus bas, avec leur nom et leur avatar Discord.' actions={toggle('staff', 'équipe')}>
            <div className='p-4'>
              <ChoiceList empty='Aucun rang.' options={data.options.ranks.map((r) => ({ id: r.id, name: r.name, color: r.color }))} value={config.staff.rankIds} onChange={(rankIds) => setSection('staff', { rankIds })} />
            </div>
          </Section>

          <Section title='Règlement' description='Mise en forme simple : # titre, **gras**, *italique*, listes avec - ou 1., liens [texte](https://…), --- pour un séparateur.' actions={toggle('rules', 'règlement')}>
            <div className='p-4'>
              <Textarea rows={12} maxLength={20000} className='font-mono text-sm' value={config.rules.text} onChange={(e) => setSection('rules', { text: e.target.value })} placeholder={'# Règlement général\n- Respecte les autres joueurs\n- **Pas de freekill**'} aria-label='Texte du règlement' />
            </div>
          </Section>

          <Section title='Communauté Discord' description='Nombre de membres de chaque serveur du réseau.' actions={toggle('discord', 'communauté Discord')}>
            <div className='p-4'>
              <ChoiceList allWhenEmpty empty='Aucun serveur actif.' options={data.options.guilds} value={config.discord.guildIds} onChange={(guildIds) => setSection('discord', { guildIds })} />
            </div>
          </Section>

          <Section title='Événements RP à venir' description='Titre, date, lieu et nombre d’inscrits. Seules les images en https sont reprises.' actions={toggle('events', 'événements')}>
            <div className='flex items-center gap-3 p-4 text-sm'>
              <Label htmlFor='pp-events'>Nombre maximum</Label>
              <Input id='pp-events' type='number' min={1} max={20} className='w-20' value={config.events.limit} onChange={(e) => setSection('events', { limit: Number(e.target.value) })} />
            </div>
          </Section>

          <Section title='Recrutement' description='Les postes ouverts, avec un bouton « Postuler sur Discord » vers le salon de candidature.' actions={toggle('recruitment', 'recrutement')}>
            <span />
          </Section>

          <Section title='Liens' description='Invitation Discord et boutique en haut de page, autres liens en bas.' actions={toggle('links', 'liens')}>
            <div className='grid gap-4 p-4'>
              <div className='grid gap-4 sm:grid-cols-2'>
                <div className='grid gap-1.5'>
                  <Label htmlFor='pp-invite'>Invitation Discord</Label>
                  <Input id='pp-invite' type='url' placeholder='https://discord.gg/…' value={config.links.discordInvite} onChange={(e) => setSection('links', { discordInvite: e.target.value })} />
                </div>
                <div className='grid gap-1.5'>
                  <Label htmlFor='pp-shop'>Boutique (Tebex)</Label>
                  <Input id='pp-shop' type='url' placeholder='https://….tebex.io' value={config.links.shop} onChange={(e) => setSection('links', { shop: e.target.value })} />
                </div>
              </div>
              <div className='grid gap-2'>
                <Label>Autres liens</Label>
                {config.links.items.map((item, i) => (
                  <div key={i} className='grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-[12rem_minmax(0,1fr)_auto]'>
                    <Input aria-label='Nom du lien' maxLength={40} placeholder='TikTok' value={item.label} className='max-sm:col-span-2'
                      onChange={(e) => setSection('links', { items: config.links.items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} />
                    <Input aria-label='Adresse du lien' type='url' placeholder='https://…' value={item.url}
                      onChange={(e) => setSection('links', { items: config.links.items.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} />
                    <Button variant='ghost' size='icon' aria-label='Retirer ce lien' onClick={() => setSection('links', { items: config.links.items.filter((_, j) => j !== i) })}><Trash2 /></Button>
                  </div>
                ))}
                {config.links.items.length < 12 && (
                  <Button variant='outline' size='sm' className='w-fit' onClick={() => setSection('links', { items: [...config.links.items, { label: '', url: '' }] })}><Plus /> Ajouter un lien</Button>
                )}
              </div>
            </div>
          </Section>
        </div>
      )}
      <SaveBar dirty={Boolean(draft)} saving={save.isPending} onSave={() => draft && save.mutate(draft)} onCancel={() => setDraft(null)} />
    </Page>
  )
}
