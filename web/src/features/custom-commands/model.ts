import type { Channel, RankSummary } from '@/lib/types'

export type Message = { content: string; embed: { title: string; description: string; color: string; imageUrl: string | null; footer: string } | null }
export type Condition =
  | { kind: 'hasRole'; roleIds: string[]; match: 'any' | 'all'; negate: boolean }
  | { kind: 'inChannel'; channelIds: string[]; negate: boolean }
  | { kind: 'hasPermission'; permission: string; negate: boolean }
  | { kind: 'option'; name: string; op: 'equals' | 'contains' | 'startsWith' | 'gt' | 'lt' | 'set' | 'notSet'; value: string; negate: boolean }
  | { kind: 'accountAge' | 'memberAge'; op: 'gt' | 'lt'; days: number; negate: boolean }
  | { kind: 'counter'; key: string; perUser: boolean; op: 'equals' | 'gt' | 'lt'; value: number; negate: boolean }
  | { kind: 'chance'; percent: number; negate: boolean }
  | { kind: 'userIs'; userIds: string[]; negate: boolean }

export type Block =
  | { type: 'if'; match: 'all' | 'any'; conditions: Condition[]; then: Block[]; else: Block[] }
  | ({ type: 'reply'; ephemeral: boolean; components: string[] } & Message)
  | ({ type: 'send'; channelId: string; components: string[] } & Message)
  | ({ type: 'dm'; target: string } & Message)
  | { type: 'role'; mode: 'add' | 'remove' | 'toggle'; target: string; roleIds: string[]; durationMinutes: number | null }
  | { type: 'nickname'; target: string; value: string }
  | { type: 'sanction'; kind: 'warn' | 'timeout'; target: string; reason: string; durationMinutes: number | null }
  | { type: 'react'; emoji: string }
  | { type: 'wait'; seconds: number }
  | { type: 'counter'; key: string; perUser: boolean; op: 'add' | 'set' | 'reset'; value: number }
  | { type: 'log'; content: string }
  | { type: 'deleteTrigger' }
  | { type: 'stop' }

export type Option = { name: string; description: string; type: 'string' | 'integer' | 'number' | 'boolean' | 'user' | 'role' | 'channel'; required: boolean; choices?: { name: string; value: string }[]; min?: number; max?: number; maxLength?: number }
export type Component = { id: string; kind: 'button' | 'select'; label?: string; style?: 'primary' | 'secondary' | 'success' | 'danger'; emoji?: string | null; placeholder?: string; options?: { label: string; value: string; description: string }[]; flow: Block[] }
export type Trigger = { type: 'slash' | 'user' | 'message' | 'keyword'; keyword?: { mode: 'contains' | 'startsWith' | 'exact' | 'regex'; patterns: string[]; caseSensitive: boolean; channelIds: string[] } }

export type CustomCommand = {
  id?: number
  name: string
  description: string
  trigger: Trigger
  options: Option[]
  scope: { mode: 'network' | 'guilds'; guildIds: string[] }
  access: { rankIds: number[]; roleIds: string[]; denyRoleIds: string[]; permission: string | null; channelIds: string[]; deniedMessage: string }
  cooldown: { seconds: number; scope: 'user' | 'guild' }
  components: Component[]
  flow: Block[]
  enabled?: boolean
  uses?: number
  updatedAt?: number
}

export type Guild = { id: string; name: string; roles: { id: string; name: string; color: number | string | null; editable: boolean }[]; channels: Channel[] }
export type Data = { commands: CustomCommand[]; guilds: Guild[]; ranks: RankSummary[]; counters: { key: string; userId: string; value: number }[] }

// Everything a block editor needs to offer choices
export type EditorContext = {
  guilds: Guild[]
  optionNames: string[]
  userOptionNames: string[]
  components: Component[]
  canSensitive: boolean
  trigger: Trigger['type']
}

export const TRIGGERS: Record<Trigger['type'], { label: string; hint: string }> = {
  slash: { label: 'Commande slash', hint: '/nom avec des options' },
  user: { label: 'Clic droit sur un membre', hint: 'Applications › ta commande' },
  message: { label: 'Clic droit sur un message', hint: 'Applications › ta commande' },
  keyword: { label: 'Mot-clé dans un message', hint: 'ex. « !regles »' },
}

export const PERMISSIONS: Record<string, string> = {
  Administrator: 'Administrateur', ManageGuild: 'Gérer le serveur', ManageRoles: 'Gérer les rôles', ManageChannels: 'Gérer les salons',
  ManageMessages: 'Gérer les messages', ModerateMembers: 'Exclure temporairement', KickMembers: 'Expulser', BanMembers: 'Bannir',
  MentionEveryone: 'Mentionner @everyone', MuteMembers: 'Rendre muet', MoveMembers: 'Déplacer des membres', ManageNicknames: 'Gérer les pseudos',
}

export const BLOCK_LABELS: Record<Block['type'], string> = {
  if: 'Si… alors… sinon', reply: 'Répondre', send: 'Envoyer dans un salon', dm: 'Envoyer un MP', role: 'Rôle', nickname: 'Changer le pseudo',
  sanction: 'Sanction', react: 'Réagir', wait: 'Attendre', counter: 'Compteur', log: 'Écrire dans les logs', deleteTrigger: 'Supprimer le message déclencheur', stop: 'Arrêter',
}

export const EMPTY_MESSAGE: Message = { content: '', embed: null }

export function newBlock(type: Block['type']): Block {
  switch (type) {
    case 'if': return { type, match: 'all', conditions: [{ kind: 'chance', percent: 50, negate: false }], then: [], else: [] }
    case 'reply': return { type, ...EMPTY_MESSAGE, content: 'Salut {user} !', ephemeral: false, components: [] }
    case 'send': return { type, ...EMPTY_MESSAGE, content: '', channelId: 'current', components: [] }
    case 'dm': return { type, ...EMPTY_MESSAGE, content: '', target: 'invoker' }
    case 'role': return { type, mode: 'add', target: 'invoker', roleIds: [], durationMinutes: null }
    case 'nickname': return { type, target: 'invoker', value: '' }
    case 'sanction': return { type, kind: 'warn', target: '', reason: '', durationMinutes: null }
    case 'react': return { type, emoji: '👍' }
    case 'wait': return { type, seconds: 2 }
    case 'counter': return { type, key: 'points', perUser: true, op: 'add', value: 1 }
    case 'log': return { type, content: '{user} a utilisé la commande.' }
    default: return { type } as Block
  }
}

export const EMPTY_COMMAND: CustomCommand = {
  name: '', description: '', trigger: { type: 'slash' }, options: [],
  scope: { mode: 'network', guildIds: [] },
  access: { rankIds: [], roleIds: [], denyRoleIds: [], permission: null, channelIds: [], deniedMessage: '' },
  cooldown: { seconds: 0, scope: 'user' }, components: [], flow: [newBlock('reply')],
}

export const VARIABLES = ['{user}', '{user.name}', '{server}', '{server.members}', '{channel}', '{date}', '{time}', '{option.nom}', '{counter.clé}', '{counter.clé.user}', '{random:1-100}', '{choice:a|b|c}']
