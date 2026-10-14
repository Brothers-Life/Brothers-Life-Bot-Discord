// Names of the game events (explosions, sources of the game logs) and short summaries of their data
// Explosion types of GTA V (index = id sent by the game)
const EXPLOSIONS = ['grenade', 'lance-grenades', 'bombe collante', 'molotov', 'roquette', 'obus de tank', 'hi-octane', 'voiture', 'avion',
  'pompe à essence', 'moto', 'vapeur', 'flamme', 'bouche incendie', 'bonbonne de gaz', 'bateau', 'navire', 'camion', 'balle explosive',
  'lance-fumigènes', 'fumigène', 'gaz BZ', 'fusée éclairante', 'bidon d’essence', 'extincteur', 'charge programmable', 'train', 'baril',
  'propane', 'dirigeable', 'flamme explosive', 'citerne', 'roquette d’avion', 'balle de véhicule', 'réservoir', 'fiente d’oiseau']
export const explosionLabel = (t: unknown) => {
  const n = Number(t)
  return Number.isInteger(n) && EXPLOSIONS[n] ? `${EXPLOSIONS[n]} (${n})` : String(t ?? '?')
}

// Names of the game logs and event sources
const GAME_LABELS: Record<string, string> = {
  bl_ac_detections: 'Anticheat', xt_prison: 'Prison', admindash_sanctions: 'Sanction staff', admindash_audit_log: 'Journal staff',
  admindash_reports: 'Signalement', admindash_staff_sessions: 'Service staff', mdt_audit: 'MDT police', mdt_plate_scans: 'Plaque scannée',
  premium_purchases: 'Achat premium', premium_shop_item_purchases: 'Boutique premium', premium_crate_openings: 'Caisse premium',
  garage_admin_logs: 'Garage (staff)', shop_admin_logs: 'Boutique (staff)', job_admin_logs: 'Métier (staff)', job_safe_log: 'Coffre métier',
  gang_safe_log: 'Coffre gang', player_transactions: 'Transaction', sky_phone_bank_transactions: 'Banque (téléphone)',
  sky_phone_billing_invoices: 'Facture', bl_safezones_audit: 'Zone safe', teleport_admin_logs: 'Téléportation (staff)',
  harvest_zone_logs: 'Récolte', door_logs: 'Porte', bl_weapon_skin_log: 'Skin d’arme', shop_admin: 'Boutique (staff)',
  bank_flow: 'Flux bancaire', chat: 'Chat', command: 'Commande', explosion: 'Explosion', character_loaded: 'Personnage chargé',
  server_start: 'Démarrage serveur', anticheat: 'Anticheat', admin_action: 'Action staff',
  txAdmin: 'txAdmin', panel: 'Panel', banque: 'Banque (staff)', mapeditor_audit: 'Éditeur de map', dj_audit: 'DJ',
  tv_admin_logs: 'TV (staff)', admindash_role_actions: 'Rôles staff', admindash_blip_logs: 'Blips (staff)',
  admindash_staff_loans: 'Prêts staff', qbx_vehicle_admin_probe: 'Véhicules (staff)', explosion_flood: 'Rafale d’explosions', game_log: 'Journal du jeu',
}
export const sourceLabel = (type?: string | null, subtype?: string | null) => GAME_LABELS[subtype ?? ''] || GAME_LABELS[type ?? ''] || String(subtype || type || '?').replace(/_/g, ' ')

const SKIP_KEYS = new Set(['id', 'citizenid', 'created_at', 'updated_at', 'createdAt', 'backfill', 'extra'])
// "key : value · key : value" of the plain fields of an event
export function summarize(data: unknown, max = 5) {
  if (!data || typeof data !== 'object') return ''
  return Object.entries(data as Record<string, unknown>)
    .filter(([k, v]) => !SKIP_KEYS.has(k) && v !== null && v !== '' && typeof v !== 'object')
    .slice(0, max)
    .map(([k, v]) => `${k.replace(/_/g, ' ')} : ${String(v).slice(0, 120)}`)
    .join(' · ')
}

export const dayLabel = (ts: string) => new Date(ts).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
