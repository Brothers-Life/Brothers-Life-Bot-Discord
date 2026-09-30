import type { Announcement } from '@/lib/types'

export const STATUS: Record<Announcement['status'], { label: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'accent' }> = {
  draft: { label: 'Brouillon', tone: 'neutral' },
  scheduled: { label: 'Programmée', tone: 'accent' },
  sending: { label: 'Envoi…', tone: 'warning' },
  sent: { label: 'Envoyée', tone: 'success' },
  partial: { label: 'Envoi partiel', tone: 'warning' },
  failed: { label: 'Échec', tone: 'danger' },
  deleted: { label: 'Supprimée de Discord', tone: 'neutral' },
}
