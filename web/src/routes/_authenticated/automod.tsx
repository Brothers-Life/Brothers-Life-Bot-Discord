import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { AutomodAction, AutomodConfig, AutomodPayload, Channel, Role } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Page, Section, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

export const Route = createFileRoute('/_authenticated/automod')({
  component: AutomodPage,
})

const NETWORK = '*'
const ACTIONS: { value: AutomodAction; label: string }[] = [
  { value: 'delete', label: 'Supprimer le message' },
  { value: 'warn', label: 'Supprimer + avertir' },
  { value: 'timeout', label: 'Supprimer + timeout' },
  { value: 'kick', label: 'Supprimer + expulser' },
  { value: 'ban', label: 'Supprimer + bannir du serveur' },
  { value: 'network_ban', label: 'Supprimer + bannir du réseau' },
]

function AutomodPage() {
  const { can } = useMe()
  const editable = can('automod.manage')
  const { data, isLoading } = useQuery({ queryKey: ['automod'], queryFn: () => api<AutomodPayload>('/automod') })
  const [target, setTarget] = useState(NETWORK)

  const targets = data ? [{ id: NETWORK, name: 'Réglage du réseau', custom: true }, ...data.guilds] : []
  const selectedGuild = data?.guilds.find((g) => g.id === target)
  const config = target === NETWORK ? data?.network : selectedGuild?.config

  return (
    <Page
      title='Automod'
      description='Le réglage du réseau s’applique à tous les serveurs, sauf à ceux que tu personnalises. Le staff qui a la permission « Ignoré par l’automod » n’est jamais touché.'
    >
      {isLoading && <Skeleton className='h-96 w-full' />}
      {data && config && (
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]'>
          <nav aria-label='Serveurs' className='flex gap-1 overflow-x-auto lg:flex-col'>
            {targets.map((t) => (
              <button
                key={t.id}
                type='button'
                onClick={() => setTarget(t.id)}
                aria-current={t.id === target ? 'page' : undefined}
                className='flex shrink-0 items-center justify-between gap-2 rounded-md px-3 py-2 text-start text-sm hover:bg-accent aria-[current=page]:bg-accent aria-[current=page]:font-medium'
              >
                <span className='truncate'>{t.name}</span>
                {t.id !== NETWORK && (t.custom ? <Pill tone='accent'>Personnalisé</Pill> : <span className='text-xs text-muted-foreground'>réseau</span>)}
              </button>
            ))}
          </nav>
          <AutomodForm
            key={`${target}-${JSON.stringify(config)}`}
            target={target}
            initial={config}
            inherited={target !== NETWORK && !selectedGuild?.custom}
            editable={editable}
          />
        </div>
      )}
    </Page>
  )
}

function NumberField({ id, label, value, onChange, disabled, suffix }: { id: string; label: string; value: number; onChange: (v: number) => void; disabled: boolean; suffix?: string }) {
  return (
    <div className='grid gap-1.5'>
      <Label htmlFor={id}>{label}</Label>
      <div className='flex items-center gap-2'>
        <Input id={id} type='number' min={1} value={value} disabled={disabled} onChange={(e) => onChange(Number(e.target.value))} className='w-24' />
        {suffix && <span className='text-sm text-muted-foreground'>{suffix}</span>}
      </div>
    </div>
  )
}

function ActionField({ id, section, onChange, disabled }: {
  id: string
  section: { action: AutomodAction; timeoutMinutes?: number }
  onChange: (patch: { action?: AutomodAction; timeoutMinutes?: number }) => void
  disabled: boolean
}) {
  return (
    <div className='flex flex-wrap items-end gap-4'>
      <div className='grid gap-1.5'>
        <Label htmlFor={id}>Sanction</Label>
        <Select value={section.action} onValueChange={(v) => onChange({ action: v as AutomodAction })} disabled={disabled}>
          <SelectTrigger id={id} className='w-64'><SelectValue /></SelectTrigger>
          <SelectContent>{ACTIONS.map((a) => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
      {section.action === 'timeout' && section.timeoutMinutes !== undefined && (
        <NumberField id={`${id}-minutes`} label='Durée du timeout' value={section.timeoutMinutes} onChange={(v) => onChange({ timeoutMinutes: v })} disabled={disabled} suffix='minutes' />
      )}
    </div>
  )
}

function Block({ title, description, enabled, onToggle, disabled, children }: {
  title: string
  description: string
  enabled: boolean
  onToggle: (v: boolean) => void
  disabled: boolean
  children: React.ReactNode
}) {
  return (
    <Section title={title} description={description} actions={<Switch checked={enabled} onCheckedChange={onToggle} disabled={disabled} aria-label={`Activer ${title}`} />}>
      {enabled && <div className='grid gap-4 p-4'>{children}</div>}
    </Section>
  )
}

const lines = (list: string[]) => list.join('\n')
const toList = (text: string) => text.split('\n').map((l) => l.trim()).filter(Boolean)

function AutomodForm({ target, initial, inherited, editable }: { target: string; initial: AutomodConfig; inherited: boolean; editable: boolean }) {
  const qc = useQueryClient()
  const [config, setConfig] = useState(initial)
  const [confirmReset, setConfirmReset] = useState(false)
  const disabled = !editable

  const options = useQuery({
    queryKey: ['automod-options', target],
    queryFn: () => api<{ channels: Channel[]; roles: Role[] }>(`/automod/${target}/options`),
    enabled: target !== NETWORK,
  })

  const dirty = JSON.stringify(config) !== JSON.stringify(initial)

  const update = <K extends keyof AutomodConfig>(key: K, value: AutomodConfig[K]) => setConfig((c) => ({ ...c, [key]: value }))
  const patch = <K extends 'spam' | 'uploads' | 'scam' | 'invites'>(key: K, value: Partial<AutomodConfig[K]>) =>
    setConfig((c) => ({ ...c, [key]: { ...c[key], ...value } }))
  const toggleIn = (key: 'exemptRoles' | 'exemptChannels', id: string) =>
    update(key, config[key].includes(id) ? config[key].filter((v) => v !== id) : [...config[key], id])

  const save = useMutation({
    mutationFn: () => api(`/automod/${encodeURIComponent(target)}`, { method: 'PUT', body: config }),
    onSuccess: () => {
      toast.success(target === NETWORK ? 'Réglage du réseau enregistré' : 'Réglage du serveur enregistré')
      qc.invalidateQueries({ queryKey: ['automod'] })
    },
  })
  const reset = useMutation({
    mutationFn: () => api(`/automod/${target}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('Le serveur suit de nouveau le réglage du réseau')
      setConfirmReset(false)
      qc.invalidateQueries({ queryKey: ['automod'] })
    },
  })

  return (
    <div className='grid gap-4'>
      {inherited && (
        <p className='rounded-md border border-dashed px-4 py-3 text-sm text-muted-foreground'>
          Ce serveur suit le réglage du réseau. Modifier et enregistrer ici crée un réglage propre à ce serveur.
        </p>
      )}

      <div className='flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card px-4 py-3'>
        <div className='flex items-center gap-3'>
          <Switch id='automod-enabled' checked={config.enabled} onCheckedChange={(v) => update('enabled', v)} disabled={disabled} />
          <Label htmlFor='automod-enabled' className='text-base'>{config.enabled ? 'Automod actif' : 'Automod désactivé'}</Label>
        </div>
        {editable && (
          <div className='flex gap-2'>
            {target !== NETWORK && !inherited && <Button variant='ghost' onClick={() => setConfirmReset(true)}>Revenir au réglage du réseau</Button>}
            <Button onClick={() => save.mutate()} disabled={(!dirty && !inherited) || save.isPending}>Enregistrer</Button>
          </div>
        )}
      </div>

      <Block title='Anti-arnaque' description='Liens d’arnaque connus, faux liens Discord ou Steam, messages « nitro gratuit » ou crypto avec un lien.' enabled={config.scam.enabled} onToggle={(v) => patch('scam', { enabled: v })} disabled={disabled}>
        <ActionField id='scam-action' section={config.scam} onChange={(p) => patch('scam', p)} disabled={disabled} />
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox checked={config.scam.blockEveryoneLinks} onCheckedChange={(v) => patch('scam', { blockEveryoneLinks: v === true })} disabled={disabled} />
          Traiter comme une arnaque un @everyone accompagné d’un lien
        </label>
        <div className='grid gap-4 sm:grid-cols-2'>
          <div className='grid gap-1.5'>
            <Label htmlFor='scam-domains'>Domaines interdits en plus (un par ligne)</Label>
            <Textarea id='scam-domains' rows={4} value={lines(config.scam.customDomains)} onChange={(e) => patch('scam', { customDomains: toList(e.target.value) })} disabled={disabled} placeholder='exemple-arnaque.com' />
          </div>
          <div className='grid gap-1.5'>
            <Label htmlFor='scam-patterns'>Phrases interdites avec un lien (une par ligne)</Label>
            <Textarea id='scam-patterns' rows={4} value={lines(config.scam.customPatterns)} onChange={(e) => patch('scam', { customPatterns: toList(e.target.value) })} disabled={disabled} placeholder='vend compte' />
          </div>
        </div>
      </Block>

      <Block title='Anti-spam' description='Trop de messages d’un coup, messages répétés, mentions en masse.' enabled={config.spam.enabled} onToggle={(v) => patch('spam', { enabled: v })} disabled={disabled}>
        <div className='flex flex-wrap gap-6'>
          <NumberField id='spam-max' label='Messages maximum' value={config.spam.maxMessages} onChange={(v) => patch('spam', { maxMessages: v })} disabled={disabled} />
          <NumberField id='spam-per' label='En' value={config.spam.perSeconds} onChange={(v) => patch('spam', { perSeconds: v })} disabled={disabled} suffix='secondes' />
          <NumberField id='spam-dup' label='Messages identiques maximum' value={config.spam.maxDuplicates} onChange={(v) => patch('spam', { maxDuplicates: v })} disabled={disabled} />
          <NumberField id='spam-dup-s' label='En' value={config.spam.duplicateSeconds} onChange={(v) => patch('spam', { duplicateSeconds: v })} disabled={disabled} suffix='secondes' />
          <NumberField id='spam-mentions' label='Mentions par message maximum' value={config.spam.maxMentions} onChange={(v) => patch('spam', { maxMentions: v })} disabled={disabled} />
        </div>
        <ActionField id='spam-action' section={config.spam} onChange={(p) => patch('spam', p)} disabled={disabled} />
      </Block>

      <Block title='Anti-envoi massif' description='Trop d’images ou de fichiers dans un message ou en peu de temps.' enabled={config.uploads.enabled} onToggle={(v) => patch('uploads', { enabled: v })} disabled={disabled}>
        <div className='flex flex-wrap gap-6'>
          <NumberField id='up-msg' label='Fichiers par message maximum' value={config.uploads.maxPerMessage} onChange={(v) => patch('uploads', { maxPerMessage: v })} disabled={disabled} />
          <NumberField id='up-max' label='Fichiers maximum' value={config.uploads.maxFiles} onChange={(v) => patch('uploads', { maxFiles: v })} disabled={disabled} />
          <NumberField id='up-per' label='En' value={config.uploads.perSeconds} onChange={(v) => patch('uploads', { perSeconds: v })} disabled={disabled} suffix='secondes' />
        </div>
        <ActionField id='uploads-action' section={config.uploads} onChange={(p) => patch('uploads', p)} disabled={disabled} />
      </Block>

      <Block title='Invitations Discord' description='Liens d’invitation vers d’autres serveurs.' enabled={config.invites.enabled} onToggle={(v) => patch('invites', { enabled: v })} disabled={disabled}>
        <ActionField id='invites-action' section={config.invites} onChange={(p) => patch('invites', p)} disabled={disabled} />
        <label className='flex items-center gap-2 text-sm'>
          <Checkbox checked={config.invites.allowNetwork} onCheckedChange={(v) => patch('invites', { allowNetwork: v === true })} disabled={disabled} />
          Autoriser les invitations vers les serveurs du réseau
        </label>
        <div className='grid gap-1.5'>
          <Label htmlFor='invite-codes'>Autres invitations autorisées (code ou lien, une par ligne)</Label>
          <Textarea id='invite-codes' rows={3} value={lines(config.invites.allowedCodes)} onChange={(e) => patch('invites', { allowedCodes: toList(e.target.value) })} disabled={disabled} placeholder='https://discord.gg/partenaire' />
        </div>
      </Block>

      {target !== NETWORK && options.data && (
        <Section title='Exemptions de ce serveur' description='Les salons et rôles cochés ne sont jamais contrôlés.'>
          <div className='grid gap-6 p-4 md:grid-cols-2'>
            <fieldset>
              <legend className='mb-2 text-sm font-medium'>Salons</legend>
              <div className='grid max-h-64 gap-1 overflow-y-auto rounded-md border p-2'>
                {options.data.channels.map((c) => (
                  <label key={c.id} className='flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50'>
                    <Checkbox checked={config.exemptChannels.includes(c.id)} onCheckedChange={() => toggleIn('exemptChannels', c.id)} disabled={disabled} />
                    #{c.name}{c.parent && <span className='text-xs text-muted-foreground'>{c.parent}</span>}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className='mb-2 text-sm font-medium'>Rôles</legend>
              <div className='grid max-h-64 gap-1 overflow-y-auto rounded-md border p-2'>
                {options.data.roles.map((r) => (
                  <label key={r.id} className='flex items-center gap-2 rounded px-1.5 py-1 text-sm hover:bg-accent/50'>
                    <Checkbox checked={config.exemptRoles.includes(r.id)} onCheckedChange={() => toggleIn('exemptRoles', r.id)} disabled={disabled} />
                    {r.name}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title='Revenir au réglage du réseau ?'
        desc='Le réglage propre à ce serveur, y compris ses exemptions, sera supprimé.'
        confirmText='Revenir au réglage du réseau'
        isLoading={reset.isPending}
        handleConfirm={() => reset.mutate()}
      />
    </div>
  )
}
