import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import type { AuditEntry } from '@/lib/types'
import { ago, dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import { EmptyState, Pill } from '@/components/app/ui'

export const ACTION_LABELS: Record<string, string> = {
  'network.bot_joined': 'Bot ajouté sur un serveur',
  'network.bot_left': 'Bot retiré d’un serveur',
  'network.add': 'Serveur ajouté au réseau',
  'network.remove': 'Serveur retiré du réseau',
  'network.main': 'Serveur principal changé',
  'ranks.create': 'Rang créé',
  'ranks.update': 'Rang modifié',
  'ranks.delete': 'Rang supprimé',
  'ranks.roles': 'Rôles d’un rang modifiés',
  'ranks.assign': 'Rang attribué',
  'ranks.unassign': 'Rang retiré',
  'panel.login': 'Connexion au panel',
  'panel.login_denied': 'Connexion refusée',
  'panel.logout': 'Déconnexion',
  'panel.session_revoked': 'Session révoquée',
  'logs.route': 'Salon de logs modifié',
  'system.start': 'Bot démarré',
  'system.restart': 'Redémarrage demandé',
  'system.stop': 'Arrêt demandé',
  'system.install': 'Installation d’une version',
  'system.version_available': 'Nouvelle version disponible',
  'sanctions.ban': 'Bannissement',
  'sanctions.unban': 'Débannissement',
  'sanctions.kick': 'Expulsion',
  'sanctions.unkick': 'Expulsion retirée de l’historique',
  'appeals.moot': 'Appel de sanction clos (sans objet)',
  'sanctions.timeout': 'Exclusion temporaire',
  'sanctions.untimeout': 'Fin d’exclusion temporaire',
  'sanctions.warn': 'Avertissement',
  'sanctions.unwarn': 'Avertissement retiré',
  'sanctions.sync': 'Bans synchronisés sur un serveur',
  'automod.trigger': 'Automod déclenché',
  'automod.config': 'Automod reconfiguré',
  'automod.reset': 'Automod : retour au réglage réseau',
  'staff_sync.member': 'Rôles du staff synchronisés',
  'staff_sync.links': 'Rôles liés à un rang sur un serveur',
  'members.role_add': 'Rôle ajouté à un membre',
  'members.role_remove': 'Rôle retiré à un membre',
  'members.nickname': 'Pseudo modifié',
  'tickets.open': 'Ticket ouvert',
  'tickets.claim': 'Ticket pris en charge',
  'tickets.close': 'Ticket fermé',
  'tickets.add_member': 'Membre ajouté à un ticket',
  'tickets.settings': 'Réglages des tickets modifiés',
  'tickets.category': 'Catégorie de tickets enregistrée',
  'tickets.category_delete': 'Catégorie de tickets supprimée',
  'tickets.panel': 'Panneau des tickets publié',
  'permissions.profile': 'Profil de permissions modifié',
  'permissions.apply': 'Profils de permissions appliqués',
  'permissions.drift': 'Écart de permissions détecté',
  'ranks.import': 'Rangs importés depuis les rôles',
  'announcements.create': 'Annonce créée',
  'announcements.send': 'Annonce envoyée',
  'announcements.schedule': 'Annonce programmée',
  'announcements.unschedule': 'Programmation annulée',
  'announcements.delete': 'Annonce supprimée',
}

const SOURCE_LABELS: Record<AuditEntry['source'], string> = {
  bot: 'Bot',
  panel: 'Panel',
  native: 'Discord',
  system: 'Système',
}

const DANGER = new Set(['network.bot_left', 'network.remove', 'ranks.delete', 'panel.login_denied', 'system.stop', 'sanctions.ban', 'sanctions.kick', 'automod.trigger'])

function describe(entry: AuditEntry) {
  const d = entry.details ?? {}
  const name = typeof d.name === 'string' ? d.name : null
  const parts: string[] = []
  if (name) parts.push(name)
  if (typeof d.rank === 'string') parts.push(`rang ${d.rank}`)
  if (entry.action.startsWith('ranks.') && entry.target && /^\d{17,20}$/.test(entry.target)) parts.push(`utilisateur ${entry.target}`)
  if (entry.action === 'system.install' && entry.target) parts.push(entry.target)
  if (entry.action === 'automod.trigger' && typeof d.reason === 'string') parts.push(`${d.user ?? ''} : ${d.reason}`)
  if (typeof d.username === 'string') parts.push(d.username)
  if (entry.action.startsWith('sanctions.') && typeof d.user === 'string') parts.push(d.user)
  if (entry.action.startsWith('sanctions.') && typeof d.reason === 'string' && d.reason) parts.push(`« ${d.reason} »`)
  return parts.join(' · ')
}

function actor(entry: AuditEntry) {
  if (entry.actorId === 'system') return 'Système'
  return entry.actorName ?? entry.actorId
}

export function AuditList({ entries, compact = false }: { entries: AuditEntry[]; compact?: boolean }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!entries.length) return <EmptyState title='Rien pour le moment'>Les actions sur le réseau, les rangs et le panel s’afficheront ici.</EmptyState>

  return (
    <ul className='divide-y'>
      {entries.map((entry) => {
        const expanded = open === entry.id
        const summary = describe(entry)
        return (
          <li key={entry.id}>
            <button
              type='button'
              onClick={() => setOpen(expanded ? null : entry.id)}
              aria-expanded={expanded}
              className='flex w-full items-start gap-3 px-4 py-2.5 text-start hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none'
            >
              <ChevronRight className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
              <div className='min-w-0 flex-1'>
                <div className='flex flex-wrap items-center gap-2'>
                  <span className={cn('text-sm font-medium', DANGER.has(entry.action) && 'text-destructive')}>
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </span>
                  {!compact && <Pill>{SOURCE_LABELS[entry.source]}</Pill>}
                </div>
                <div className='truncate text-xs text-muted-foreground'>
                  {summary ? `${summary} — ` : ''}par {actor(entry)}
                </div>
              </div>
              <time className='shrink-0 text-xs text-muted-foreground' dateTime={new Date(entry.at).toISOString()} title={dateTime(entry.at)}>
                {ago(entry.at)}
              </time>
            </button>
            {expanded && (
              <dl className='grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-1 bg-muted/40 px-11 py-3 text-xs sm:grid-cols-[max-content_1fr]'>
                <dt className='text-muted-foreground'>Date</dt><dd>{dateTime(entry.at)}</dd>
                <dt className='text-muted-foreground'>Auteur</dt><dd>{actor(entry)} ({SOURCE_LABELS[entry.source]}){entry.actorName ? ` · ${entry.actorId}` : ''}</dd>
                {entry.guildId && <><dt className='text-muted-foreground'>Serveur</dt><dd>{entry.guildId}</dd></>}
                {entry.target && <><dt className='text-muted-foreground'>Cible</dt><dd>{entry.target}</dd></>}
                {entry.details && (
                  <>
                    <dt className='text-muted-foreground'>Détails</dt>
                    <dd><pre className='font-mono text-[11px] whitespace-pre-wrap'>{JSON.stringify(entry.details, null, 2)}</pre></dd>
                  </>
                )}
                <dt className='text-muted-foreground'>Référence</dt><dd>#{entry.id} · {entry.action}</dd>
              </dl>
            )}
          </li>
        )
      })}
    </ul>
  )
}
