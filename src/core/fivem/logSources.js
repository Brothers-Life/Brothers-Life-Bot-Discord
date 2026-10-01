// Unix seconds or milliseconds stored as INT
export const unix = col => `IF(${col} > 100000000000, FROM_UNIXTIME(${col} / 1000), FROM_UNIXTIME(${col}))`;

// Every log table of the FiveM server, mapped to one shape: when, who, what, on what, details.
// Columns are SQL expressions on the table; a source whose table is missing is skipped.
export const LOG_SOURCES = [
	{ key: 'admin', label: 'Menu admin', table: 'admindash_audit_log', actor: 'issued_by_name', action: 'action', target: 'target_name', details: 'details' },
	{ key: 'sanctions', label: 'Sanctions', table: 'admindash_sanctions', actor: 'issued_by_name', action: 'type', target: 'target_name', details: 'CONCAT_WS(\' · \', reason, IF(duration_minutes IS NULL, NULL, CONCAT(duration_minutes, \' min\')))' },
	{ key: 'staffmsg', label: 'Messages staff', table: 'admindash_staffmsg_history', actor: 'issued_by_name', action: '\'message\'', target: 'target_label', details: 'line' },
	{ key: 'blips', label: 'Blips', table: 'admindash_blip_logs', actor: 'admin_name', action: 'action', target: 'blip_label', details: 'details' },
	{ key: 'garages', label: 'Garages', table: 'garage_admin_logs', actor: 'admin_name', action: 'action', target: 'garage_name', details: 'details' },
	{ key: 'jobs', label: 'Métiers (admin)', table: 'job_admin_logs', actor: 'admin_name', action: 'action', target: 'job_name', details: 'details' },
	{ key: 'jobactions', label: 'Actions de métier', table: 'job_action_history', actor: 'player_name', action: 'action_label', target: 'job_name', details: 'IF(amount IS NULL, NULL, CONCAT(amount, \' $\'))' },
	{ key: 'jobsafe', label: 'Coffres de métier', table: 'job_safe_log', actor: 'player_name', action: 'action', target: 'job_name', details: 'CONCAT_WS(\' · \', CONCAT(item, \' ×\', amount), reason)' },
	{ key: 'gangs', label: 'Gangs (admin)', table: 'gang_admin_logs', actor: 'admin_name', action: 'action', target: 'gang_name', details: 'details' },
	{ key: 'gangsafe', label: 'Coffres de gang', table: 'gang_safe_log', actor: 'player_name', action: 'action', target: 'gang_name', details: 'CONCAT_WS(\' · \', amount, reason)' },
	{ key: 'shops', label: 'Magasins', table: 'shop_admin_logs', actor: 'admin_name', action: 'action', target: 'shop_label', details: 'details' },
	{ key: 'blshops', label: 'Magasins (BL)', table: 'bl_shops_admin_logs', actor: 'admin_name', action: 'action', target: 'shop_id', details: 'details' },
	{ key: 'doors', label: 'Portes', table: 'door_logs', actor: 'admin_name', action: 'action', target: 'door_name', details: 'details' },
	{ key: 'harvest', label: 'Zones de récolte', table: 'harvest_zone_logs', actor: 'admin_name', action: 'action', target: 'zone_label', details: 'details' },
	{ key: 'crafting', label: 'Artisanat', table: 'bl_crafting_logs', actor: 'char_name', action: '\'craft\'', target: 'result_item', details: 'CONCAT(crafted, \'/\', requested)' },
	{ key: 'safezones', label: 'Zones safe', table: 'bl_safezones_audit', actor: 'actor_name', action: 'CONCAT_WS(\' \', category, action)', target: 'zone_name', details: 'details' },
	{ key: 'teleports', label: 'Téléporteurs', table: 'teleport_admin_logs', actor: 'admin_name', action: 'action', target: 'passage_id', details: 'details' },
	{ key: 'mapeditor', label: 'Éditeur de carte', table: 'mapeditor_audit', actor: 'player_name', action: 'action', target: 'object_id', details: 'detail' },
	{ key: 'mdt', label: 'MDT police', table: 'mdt_audit', at: unix('at'), actor: 'CONCAT_WS(\' · \', actor_name, actor_role)', action: 'CONCAT_WS(\' \', field, effect)', target: 'target_name', details: 'reason' },
	{ key: 'bank', label: 'Banque (admin)', table: 'bank_audit_log', actor: 'admin_name', action: 'action', target: 'target', details: 'CONCAT_WS(\' · \', CONCAT(amount_before, \' → \', amount_after), details)', permission: 'fivemdata.economy' },
	{ key: 'premium', label: 'Boutique premium', table: 'premium_shop_logs', actor: 'NULL', action: 'action', target: 'entry_label', details: 'CONCAT_WS(\' · \', details, amount)', permission: 'fivemdata.economy' },
	{ key: 'dj', label: 'DJ', table: 'dj_audit', actor: 'actor_name', action: 'action', target: 'venue_id', details: 'details' },
	{ key: 'carplay', label: 'CarPlay (musique)', table: 'carplay_logs', actor: 'player_name', action: 'verdict', target: 'COALESCE(label, vehicle)', details: 'url' },
	{ key: 'billboards', label: 'Panneaux', table: 'billboard_history', actor: 'actor', action: 'action', target: 'billboard_id', details: 'details' },
	{ key: 'tv', label: 'Écrans TV', table: 'tv_admin_logs', actor: 'admin_name', action: 'action', target: 'screen_uid', details: 'details' },
	{ key: 'phone', label: 'Téléphone (admin)', table: 'sky_phone_admin_audit', actor: 'actor_name', action: 'action', target: 'NULL', details: 'details' },
];

const text = expr => `CONVERT(${expr} USING utf8mb4) COLLATE utf8mb4_unicode_ci`;

// One SELECT per source, all with the same columns, to UNION
export function sourceSelect(source) {
	const at = source.at ?? 'created_at';
	return `SELECT ${text(`'${source.key}'`)} AS source, ${at} AS at, ${text(source.actor)} AS actor, ${text(source.action)} AS action, ${text(source.target)} AS target, LEFT(${text(source.details)}, 500) AS details FROM \`${source.table}\``;
}
