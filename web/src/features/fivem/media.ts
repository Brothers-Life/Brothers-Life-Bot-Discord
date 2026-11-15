import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

export type MediaConfig = {
  enabled: boolean
  baseUrl: string | null
  itemsFolder: string
  vehiclesFolder: string
}

export type MediaFile = {
  id: string
  name: string
  folder: string
  mime: string
  size: number
  url: string
  createdAt: string
  named: boolean
}

export function useMediaConfig() {
  return useQuery({
    queryKey: ['media-config'],
    queryFn: () => api<MediaConfig>('/media/config'),
    staleTime: 5 * 60_000,
  })
}

export function gameAssetUrl(config: MediaConfig | undefined, type: 'item' | 'vehicle', name: string | null | undefined) {
  if (!config?.enabled || !config.baseUrl || !name) return null
  const filename = name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64)
  if (!filename) return null
  const folder = type === 'item' ? config.itemsFolder : config.vehiclesFolder
  return `${config.baseUrl}/n/${folder}/${encodeURIComponent(filename)}.png`
}
