import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import type { RestrictionProfile } from '@/lib/types'
import { useMe } from '@/hooks/use-me'
import { Section, Pill } from '@/components/app/ui'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'

// Names of the Discord permissions a restriction can deny
const LABELS: Record<string, string> = {
  ViewChannel: 'Voir les salons',
  SendMessages: 'Envoyer des messages',
  SendMessagesInThreads: 'Écrire dans les fils',
  CreatePublicThreads: 'Créer des fils publics',
  CreatePrivateThreads: 'Créer des fils privés',
  AddReactions: 'Réagir',
  AttachFiles: 'Envoyer des fichiers',
  EmbedLinks: 'Intégrer des liens',
  UseExternalEmojis: 'Émojis externes',
  UseExternalStickers: 'Stickers externes',
  MentionEveryone: 'Mentionner @everyone',
  UseApplicationCommands: 'Commandes d’applications',
  Connect: 'Se connecter en vocal',
  Speak: 'Parler',
  Stream: 'Vidéo et partage d’écran',
  UseVAD: 'Détection de la voix',
  UseSoundboard: 'Soundboard',
  SendVoiceMessages: 'Messages vocaux',
  SendPolls: 'Créer des sondages',
  ChangeNickname: 'Changer de pseudo',
  CreateInstantInvite: 'Créer des invitations',
}

export function RestrictionsEditor() {
  const { can } = useMe()
  const manage = can('restrictions.manage')
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['restrictions'], queryFn: () => api<{ profiles: RestrictionProfile[]; restrictable: string[] }>('/restrictions') })
  const [draft, setDraft] = useState<RestrictionProfile[] | null>(null)
  const [repairing, setRepairing] = useState(false)
  const profiles = draft ?? data?.profiles ?? []

  const save = useMutation({
    mutationFn: () => api<RestrictionProfile[]>('/restrictions', { method: 'PUT', body: profiles }),
    onSuccess: () => { toast.success('Profils enregistrés. Lance « Réparer » pour mettre à jour les salons.'); setDraft(null); qc.invalidateQueries({ queryKey: ['restrictions'] }) },
  })
  const repair = useMutation({
    mutationFn: () => api<Record<string, { ok: boolean; error?: string }>>('/restrictions/repair', { method: 'POST', body: { confirm: true } }),
    onSuccess: (results) => {
      const failed = Object.values(results).filter((r) => !r.ok).length
      if (failed) toast.warning(`Réparé, sauf sur ${failed} serveur(s)`)
      else toast.success('Rôles et salons remis en ordre sur tout le réseau')
      setRepairing(false)
    },
  })
  const patch = (i: number, value: Partial<RestrictionProfile>) => setDraft(profiles.map((p, j) => (j === i ? { ...p, ...value } : p)))

  if (!data) return null
  return (
    <Section
      title='Restrictions (rôles de punition)'
      description='Chaque restriction est un rôle créé par le bot sur chaque serveur, interdit sur tous les salons. Utilisable avec /restreindre ou « Nouvelle sanction ».'
      actions={manage && (
        <div className='flex flex-wrap gap-2'>
          <Button size='sm' variant='outline' onClick={() => setRepairing(true)}><Wrench /> Réparer</Button>
          <Button size='sm' variant='outline' onClick={() => setDraft([...profiles, { key: `restriction_${profiles.length + 1}`, label: 'Nouvelle restriction', deny: ['SendMessages'], position: profiles.length }])} disabled={profiles.length >= 15}>
            <Plus /> Restriction
          </Button>
          {draft && <Button size='sm' onClick={() => save.mutate()} disabled={save.isPending}>Enregistrer</Button>}
        </div>
      )}
    >
      <ul className='divide-y'>
        {profiles.map((p, i) => (
          <li key={i} className='grid grid-cols-[minmax(0,1fr)] gap-2 px-4 py-3 md:grid-cols-[16rem_1fr_auto] md:items-center'>
            <Input value={p.label} maxLength={40} disabled={!manage} aria-label='Nom de la restriction' onChange={(e) => patch(i, { label: e.target.value })} />
            <div className='flex flex-wrap items-center gap-1'>
              {p.deny.map((d) => <Pill key={d} tone='danger'>{LABELS[d] ?? d}</Pill>)}
              {manage && (
                <Popover>
                  <PopoverTrigger asChild><Button size='sm' variant='ghost'>Modifier</Button></PopoverTrigger>
                  <PopoverContent align='start' className='max-h-80 w-72 overflow-y-auto p-1'>
                    {data.restrictable.map((perm) => (
                      <label key={perm} className='flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-accent'>
                        <Checkbox checked={p.deny.includes(perm)} onCheckedChange={() => patch(i, { deny: p.deny.includes(perm) ? p.deny.filter((x) => x !== perm) : [...p.deny, perm] })} />
                        {LABELS[perm] ?? perm}
                      </label>
                    ))}
                  </PopoverContent>
                </Popover>
              )}
            </div>
            {manage && (
              <Button size='icon' variant='danger-ghost' aria-label={`Supprimer ${p.label}`} disabled={profiles.length === 1} onClick={() => setDraft(profiles.filter((_, j) => j !== i))}>
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={repairing}
        onOpenChange={setRepairing}
        title='Réparer les restrictions ?'
        desc='Le bot recrée les rôles manquants et réapplique les interdictions sur tous les salons de tous les serveurs. Ça peut prendre une minute.'
        confirmText='Réparer'
        isLoading={repair.isPending}
        handleConfirm={() => repair.mutate()}
      />
    </Section>
  )
}
