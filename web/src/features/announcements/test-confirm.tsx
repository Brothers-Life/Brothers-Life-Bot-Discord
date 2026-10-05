import type { AnnouncementTarget, AnnouncementTargetsPayload } from '@/lib/types'
import type { ConfirmOptions } from '@/components/app/confirm'

export const TEST_LABEL = 'Envoyer un essai (sans mention)'

type Where = { guildId: string; channelId: string }

// "#salon · Serveur" list for confirmations
export function ChannelList({ targets, guilds }: { targets: Where[]; guilds: AnnouncementTargetsPayload }) {
  return (
    <ul className='grid max-h-48 gap-0.5 overflow-y-auto rounded-md border px-3 py-2 text-foreground'>
      {targets.map((t) => {
        const g = guilds.find((x) => x.id === t.guildId)
        const c = g?.channels.find((x) => x.id === t.channelId)
        return (
          <li key={`${t.guildId}-${t.channelId}`} className='truncate'>
            <span className='font-medium'>{c ? `#${c.name}` : `salon ${t.channelId}`}</span> <span className='text-muted-foreground'>· {g?.name ?? 'serveur inconnu'}</span>
          </li>
        )
      })}
    </ul>
  )
}

// Confirmation of a trial message: says exactly which channels receive it
export function testConfirm(targets: AnnouncementTarget[], guilds: AnnouncementTargetsPayload, what = 'un message d’essai'): ConfirmOptions {
  return {
    title: 'Envoyer un essai ?',
    desc: targets.length ? (
      <div className='grid gap-2'>
        <p>Le bot publie {what} <strong>pour de vrai</strong>, visible par tous, dans {targets.length > 1 ? `ces ${targets.length} salons` : 'ce salon'} :</p>
        <ChannelList targets={targets} guilds={guilds} />
        <p>Personne n’est mentionné (ni @everyone, ni @here, ni rôle) et rien n’est republié dans les salons d’annonces suivis.</p>
      </div>
    ) : 'Aucun salon n’est choisi : rien ne sera publié.',
    confirmText: 'Envoyer l’essai',
  }
}

// Confirmation before publishing a message for real
export function publishConfirm(targets: Where[], guilds: AnnouncementTargetsPayload, { title, what, confirmText = 'Publier', extra }: { title: string; what: string; confirmText?: string; extra?: React.ReactNode }): ConfirmOptions {
  return {
    title,
    desc: (
      <div className='grid gap-2'>
        <p>{what} {targets.length > 1 ? `dans ces ${targets.length} salons` : 'dans ce salon'} :</p>
        <ChannelList targets={targets} guilds={guilds} />
        {extra}
      </div>
    ),
    confirmText,
  }
}
