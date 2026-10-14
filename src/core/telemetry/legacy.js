// Takes over the settings of the old FiveM panel (bl-panel-api / bl-panel-front) from its variables, copied as
// they were onto the new service (config.LEGACY_PANEL), so that moving to the bot needs no retyping:
// - telemetry settings: ingest token, FiveM address, alert thresholds, retention, time zone;
// - panel access: its webmasters and the accounts it allowed become two ranks, its Discord roles grant the first.
// Each part runs once (settings flags) and never overwrites what was set from the panel.
import pg from 'pg';
import { SYSTEM } from '../permissions.js';

const SETTINGS_KEY = 'telemetry.config';
const ACCESS_DONE = 'legacyPanel.access';
const DISCORD_ID = /^\d{17,20}$/;
export const LEGACY_RANKS = {
	viewer: { name: 'FiveM — ancien panel', level: 5, permissions: ['panel.access', 'telemetry.view', 'telemetry.economy', 'telemetry.logs'] },
	webmaster: { name: 'FiveM — webmaster', level: 6, permissions: ['panel.access', 'telemetry.view', 'telemetry.economy', 'telemetry.logs', 'telemetry.announce', 'telemetry.manage'] },
};

const ids = value => String(value ?? '').split(/[\s,;]+/).filter(id => DISCORD_ID.test(id));
const int = value => (/^\d+$/.test(String(value ?? '').trim()) ? Number(value) : undefined);

// The telemetry settings written in the old panel-api variables (only those that were set)
export function legacyTelemetryConfig(legacy = {}) {
	const out = {};
	if (legacy.INGEST_TOKEN) out.ingestToken = legacy.INGEST_TOKEN;
	if (legacy.FIVEM_BASE) out.fivemBase = legacy.FIVEM_BASE;
	if (legacy.PANEL_TZ) out.timezone = legacy.PANEL_TZ;
	const alerts = {};
	if (int(legacy.ALERT_ERRORS_5MIN) !== undefined) alerts.errors5min = int(legacy.ALERT_ERRORS_5MIN);
	if (int(legacy.ALERT_MONEY_JUMP) !== undefined) alerts.moneyJump = int(legacy.ALERT_MONEY_JUMP);
	if (legacy.ALERT_ANTICHEAT_CHANNEL) alerts.anticheatChannel = legacy.ALERT_ANTICHEAT_CHANNEL;
	if (Object.keys(alerts).length) out.alerts = alerts;
	// Same split as purgeOld() of bl-panel-api
	const retention = {};
	const set = (days, tables) => {
		if (days !== undefined) for (const table of tables) retention[table] = days;
	};
	set(int(legacy.RETENTION_DAYS), ['events', 'economy_snapshots', 'vehicles_owned', 'alerts', 'db_table_stats', 'commands']);
	set(int(legacy.RETENTION_LOGS_DAYS), ['server_logs']);
	set(int(legacy.RETENTION_PERF_DAYS), ['perf_metrics', 'perf_windows', 'perf_buckets', 'profiler_runs']);
	set(int(legacy.RETENTION_SNAPSHOTS_DAYS), ['player_snapshots']);
	if (Object.keys(retention).length) out.retention = retention;
	return out;
}

async function takeSettings({ core, legacy, logger }) {
	if (await core.settings.get(SETTINGS_KEY, null)) return null;
	const partial = legacyTelemetryConfig(legacy);
	if (!Object.keys(partial).length) return null;
	// One bad value (an address now refused…) must not lose the others
	const taken = [];
	for (const [key, value] of Object.entries(partial)) {
		try {
			await core.telemetry.setConfig(SYSTEM, { [key]: value });
			taken.push(key);
		}
		catch (error) {
			logger.warn(`Old panel setting ${key} not taken over: ${error.message}`);
		}
	}
	return taken;
}

// Accounts the old panel allowed by hand (its access list), read from its database
async function grantedAccounts(url) {
	if (!url) return [];
	const pool = new pg.Pool({ connectionString: url, max: 1 });
	try {
		const { rows } = await pool.query('SELECT discord_id FROM panel_users WHERE access = \'granted\'');
		return rows.map(r => String(r.discord_id));
	}
	catch {
		// No panel_users table: nothing to take over
		return [];
	}
	finally {
		await pool.end().catch(() => undefined);
	}
}

async function rankFor(core, def) {
	const existing = (await core.ranks.list()).find(r => r.name === def.name);
	return existing ?? core.ranks.create(SYSTEM, { ...def, syncRoles: false });
}

async function takeAccess({ core, db, legacy, importUrl, logger }) {
	if (await core.settings.get(ACCESS_DONE, null)) return null;
	const webmasters = ids(legacy.WEBMASTER_DISCORD_IDS);
	const roleIds = ids(legacy.DISCORD_ALLOWED_ROLE_IDS);
	const guildId = DISCORD_ID.test(legacy.DISCORD_GUILD_ID ?? '') ? legacy.DISCORD_GUILD_ID : null;
	const granted = (await grantedAccounts(importUrl)).filter(id => DISCORD_ID.test(id) && !webmasters.includes(id));
	if (!webmasters.length && !granted.length && !(roleIds.length && guildId)) return null;

	const ownerId = core.config.OWNER_ID;
	const assign = async (rank, userIds) => {
		let n = 0;
		for (const userId of userIds) {
			if (userId === ownerId) continue;
			try {
				await core.ranks.assignDirect(SYSTEM, userId, rank.id);
				n++;
			}
			catch (error) {
				logger.warn(`Old panel access of ${userId} not taken over: ${error.message}`);
			}
		}
		return n;
	};
	const result = { webmasters: 0, accounts: 0, roles: 0 };
	if (webmasters.length) result.webmasters = await assign(await rankFor(core, LEGACY_RANKS.webmaster), webmasters);
	const viewer = granted.length || (roleIds.length && guildId) ? await rankFor(core, LEGACY_RANKS.viewer) : null;
	if (granted.length) result.accounts = await assign(viewer, granted);
	if (roleIds.length && guildId) {
		// The roles of the old panel's server grant the rank, as DISCORD_ALLOWED_ROLE_IDS did
		for (const roleId of roleIds) {
			await db.prepare('INSERT INTO rank_roles (rank_id, guild_id, role_id) VALUES (?, ?, ?) ON CONFLICT DO NOTHING').run(viewer.id, guildId, roleId);
		}
		core.ranks.invalidate();
		result.roles = roleIds.length;
	}
	await core.settings.set(ACCESS_DONE, { at: Date.now(), ...result });
	await core.audit.record({ actorId: 'system', source: 'system', action: 'ranks.legacy', details: result });
	return result;
}

// Called by the API (and the all-in-one process) at start; never throws
export async function takeOverLegacyPanel({ core, db, config, logger = console }) {
	const legacy = config.LEGACY_PANEL ?? {};
	const out = {};
	try {
		out.settings = await takeSettings({ core, legacy, logger });
		if (out.settings?.length) logger.success(`Old FiveM panel settings taken over: ${out.settings.join(', ')}`);
	}
	catch (error) {
		logger.warn('Old FiveM panel settings not taken over:', error?.message ?? error);
	}
	try {
		out.access = await takeAccess({ core, db, legacy, importUrl: config.TELEMETRY_IMPORT_FROM, logger });
		if (out.access) logger.success(`Old FiveM panel access taken over: ${out.access.webmasters} webmaster(s), ${out.access.accounts} account(s), ${out.access.roles} role(s)`);
	}
	catch (error) {
		logger.warn('Old FiveM panel access not taken over:', error?.message ?? error);
	}
	return out;
}
