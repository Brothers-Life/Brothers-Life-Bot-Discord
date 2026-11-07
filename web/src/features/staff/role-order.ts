import { toast } from 'sonner'

// Result of putting the network roles back in order on one server
export type RoleOrder = { guildId: string; name: string; moved: boolean; stuck: string[]; error?: string }

export function showRoleOrder(order: RoleOrder[]) {
  const moved = order.filter((o) => o.moved).length
  if (moved) toast.success(`Rôles remis dans l’ordre sur ${moved} serveur(s)`)
  for (const o of order) {
    if (o.error) toast.error(`${o.name} : ordre des rôles non appliqué (${o.error})`)
    else if (o.stuck.length) toast.warning(`${o.name} : monte le rôle du bot tout en haut, il est sous ${o.stuck.join(', ')}. Ces rôles restent au-dessus des rôles du réseau.`)
  }
}
