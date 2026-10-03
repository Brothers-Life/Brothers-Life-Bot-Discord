// Unicode emoji catalogue (French labels + GitHub-style shortcodes), loaded on first use only
export type UnicodeEmoji = { unicode: string; label: string; group: number; order: number; name: string; search: string; shortcode: string | null; skins?: string[] }

type FullEmoji = { emoji: string; label: string; group?: number; order?: number; tags?: string[]; hexcode: string; version: number; skins?: { emoji: string; version: number }[] }

// Newest Emoji version Discord displays and accepts: newer emojis make it refuse the whole message
const DISCORD_EMOJI_VERSION = 15.1

export const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae')
// Words separated by single spaces, with a leading space so ' word' finds word starts
const words = (s: string) => ` ${normalize(s).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()}`

let cache: Promise<UnicodeEmoji[]> | null = null

export function loadEmojis(): Promise<UnicodeEmoji[]> {
  cache ??= Promise.all([
    import('emojibase-data/fr/data.json'),
    import('emojibase-data/en/shortcodes/github.json'),
  ]).then(([data, codes]) => {
    const shortcodes = codes.default as Record<string, string | string[]>
    return (data.default as FullEmoji[])
      // Group 2 = skin tones and hair components, not emojis on their own
      .filter((e) => e.group !== undefined && e.group !== 2 && e.version <= DISCORD_EMOJI_VERSION)
      .map((e) => {
        const raw = shortcodes[e.hexcode]
        const all = raw ? (Array.isArray(raw) ? raw : [raw]) : []
        return {
          unicode: e.emoji,
          label: e.label,
          group: e.group!,
          order: e.order ?? 0,
          shortcode: all[0] ?? null,
          name: words(e.label),
          search: words([e.label, ...(e.tags ?? []), ...all].join(' ')),
          skins: e.skins?.filter((s) => s.version <= DISCORD_EMOJI_VERSION).map((s) => s.emoji),
        }
      })
      .sort((a, b) => a.order - b.order)
  })
  cache.catch(() => { cache = null })
  return cache
}

// Emojis whose words start with every typed word, the best label matches first
export function searchEmojis(all: UnicodeEmoji[], query: string): UnicodeEmoji[] {
  const typed = words(query).trim().split(' ').filter(Boolean)
  if (!typed.length) return []
  const first = ` ${typed[0]}`
  const exact = typed.join(' ')
  // Exact label or shortcode, then whole first word, then label start, then any word start
  const score = (e: UnicodeEmoji) => {
    if (e.name === ` ${exact}` || e.shortcode === exact.replace(/ /g, '_')) return 0
    if (`${e.name} `.includes(`${first} `)) return 1
    if (e.name.startsWith(first)) return 2
    return e.name.includes(first) ? 3 : 4
  }
  return all
    .filter((e) => typed.every((w) => e.search.includes(` ${w}`)))
    .map((e) => [score(e), e] as const)
    .sort((a, b) => a[0] - b[0] || a[1].order - b[1].order)
    .map(([, e]) => e)
}
