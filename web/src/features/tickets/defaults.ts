import type { TicketCategoryConfig } from '@/lib/types'

// Same defaults as src/core/ticketConfig.js, for a type created in the panel
export const DEFAULT_CATEGORY_CONFIG: TicketCategoryConfig = {
  buttonStyle: 'secondary',
  form: { steps: [{ title: '', when: null, questions: [{ id: 'subject', type: 'paragraph', label: 'Sujet de ta demande', description: '', placeholder: '', required: true, minLength: 0, maxLength: 200, defaultValue: '' }] }] },
  nameTemplate: 'ticket-{number}-{user}',
  ping: 'staff',
  pingRoleIds: [],
  welcome: { title: 'Ticket #{number} · {type}', message: 'Bonjour {user}, l’équipe va te répondre ici. Explique ta demande en détail.', color: '#d6a249', showAnswers: true },
  access: {
    requiredRoleIds: [],
    requiredMode: 'any',
    blockedRoleIds: [],
    maxOpen: 0,
    cooldownMinutes: 0,
    minAccountAgeDays: 0,
    hours: {
      enabled: false,
      timezone: 'Europe/Paris',
      days: Array.from({ length: 7 }, () => ({ open: true, from: '09:00', to: '23:00' })),
      closedMessage: 'Les tickets de ce type sont fermés en ce moment. Reviens pendant les horaires d’ouverture.',
    },
  },
  claim: { exclusiveWrite: false },
  close: { requireReason: false, openerCanClose: true, confirm: true, mode: 'delete', deleteDelaySeconds: 10 },
  inactivity: { reminderHours: 0, closeHours: 0 },
  rating: { enabled: false },
  transcriptDm: true,
  statusParents: {},
  closeRequest: { autoCloseHours: 24 },
  sla: { firstResponseMinutes: 0 },
}

export const DAYS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

export const PRIORITY_LABELS = { low: 'Basse', normal: 'Normale', high: 'Haute', urgent: 'Urgente' } as const
export const PRIORITY_TONES = { low: 'neutral', normal: 'accent', high: 'warning', urgent: 'danger' } as const
