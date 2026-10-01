import type { Sheet } from './types'

// Which optional tabs a player sheet has
export const hasStaffTab = (p: Sheet) => Boolean(p.staff || p.creations.mapEdits.length || p.creations.carplay.length)
export const hasWorkTab = (p: Sheet) => Boolean(p.jobs.checkins.length || p.jobs.actions.length || p.jobs.safe.length || p.jobs.payroll.length || p.jobs.invoices.length || p.skills.crafting.length || p.skills.harvested)
export const hasPoliceTab = (p: Sheet) => Boolean(p.police.lookups.length || p.police.calls.length)
