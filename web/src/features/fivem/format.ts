export const hours = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}` : `${Math.round(s / 60)} min`)
export const money = (n?: number | null) => `${Number(n ?? 0).toLocaleString('fr-FR')} $`
export const count = (n: number) => n.toLocaleString('fr-FR')
export const plural = (n: number, word: string, many = `${word}s`) => `${count(n)} ${n > 1 ? many : word}`
