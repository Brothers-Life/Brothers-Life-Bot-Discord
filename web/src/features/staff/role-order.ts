import { toast } from 'sonner'

// Result of putting the network roles back in order on one server
export type RoleOrder = { guildId: string; name: string; moved: boolean; stuck: string[]; error?: string }

// The raw answer of Discord, when the bot could not tell the reason beforehand
const REASONS: Record<string, string> = {
  'Missing Permissions': 'Discord a refusé : le bot n’a pas la permission « Gérer les rôles », ou son rôle est sous les rôles à ranger.',
}

export function showRoleOrder(order: RoleOrder[]) {
  const moved = order.filter((o) => o.moved).length
  if (moved) toast.success(`Rôles remis dans l’ordre sur ${moved} serveur(s)`)
  // One message per reason, with the servers it concerns: fifteen servers refused for the same reason are one message
  const byReason = new Map<string, string[]>()
  for (const o of order) {
    if (o.error) byReason.set(o.error, [...(byReason.get(o.error) ?? []), o.name])
    else if (o.stuck.length) toast.warning(`${o.name} : monte le rôle du bot tout en haut, il est sous ${o.stuck.join(', ')}. Ces rôles restent au-dessus des rôles du réseau.`)
  }
  for (const [reason, names] of byReason) {
    toast.error(`Ordre des rôles non appliqué sur ${names.length} serveur${names.length > 1 ? 's' : ''}`, {
      description: `${REASONS[reason] ?? reason} Serveurs : ${names.join(', ')}.`,
      duration: 20_000,
    })
  }
}
