import { api } from '@/lib/api'

const MAX_BYTES = 8 * 1024 * 1024

// Sends an image picked in the browser; returns the value used in designs: "upload:<id>"
export async function uploadImage(file: File): Promise<string> {
  if (file.size > MAX_BYTES) throw new Error('Image trop lourde : 8 Mo maximum.')
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
  const saved = await api<{ id: string }>('/uploads', { method: 'POST', body: { data } })
  return `upload:${saved.id}`
}

// "upload:<id>" -> URL the browser can display
export function imageUrl(src: string | null | undefined) {
  if (!src) return null
  return src.startsWith('upload:') ? `/api/uploads/${src.slice(7)}` : src
}
