import { scrub } from './privacy.js';

// Alert engine, port of raiseAlert / checkAlerts of bl-panel-api/server.js: server down or back, burst of
// console errors, anticheat lines, money jumps. An alert is stored (tel_alerts), then sent as a log of the
// "telemetry" category (instead of the Discord webhook) and as a panel notification.

export const ALERT_KINDS = {
	anticheat: 'Anticheat',
	server_down: 'Serveur injoignable',
	server_up: 'Serveur de nouveau en ligne',
	error_burst: 'Rafale d’erreurs console',
	money_jump: 'Saut d’argent',
};

const SEVERITY_COLOR = { critical: 'danger', warn: 'warning', info: 'info', ok: 'success' };
const fmtMoney = v => `${new Intl.NumberFormat('fr-FR').format(Math.round(Number(v) || 0))} $`;
const stripColors = s => String(s ?? '').replace(/\^\d/g, '');

export function createAlerts({ q, getConfig, logs, notify, now, logger }) {
	// In memory, as in the original: the process running the ticks (the bot) owns it
	const state = { serverDown: null, lastErrorBurst: 0, lastLogId: null, lastMoneyCheck: null, moneyCooldown: new Map() };

	async function raiseAlert(kind, severity, title, detail, citizenid = null, data = {}) {
		const safeTitle = scrub(String(title)).slice(0, 250);
		const safeDetail = detail ? scrub(String(detail)) : null;
		const r = await q('INSERT INTO tel_alerts (kind, severity, title, detail, citizenid, data) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
			[kind, severity, safeTitle, safeDetail, citizenid, JSON.stringify(scrub(data ?? {}))]);
		const id = r.rows[0]?.id;
		if (!id) return null;
		let sent = [];
		try {
			sent = await logs?.log(null, 'telemetry', {
				title: safeTitle,
				description: (safeDetail || '').slice(0, 2000) || undefined,
				color: SEVERITY_COLOR[severity] ?? 'warning',
				footer: ALERT_KINDS[kind] ?? kind,
			}, kind) ?? [];
		}
		catch (error) {
			logger?.warn?.('Telemetry alert log failed:', error?.message ?? error);
		}
		notify({ type: 'telemetry_alert', permission: 'telemetry.view', title: safeTitle, body: safeDetail ? safeDetail.slice(0, 300) : null, url: '/telemetry/alerts' });
		if (sent.length) await q('UPDATE tel_alerts SET notified = true WHERE id = $1', [id]);
		return Number(id);
	}

	async function check() {
		const { alerts: cfg } = await getConfig();
		const at = now();

		// 1) Server down / back: two readings in a row to be sure
		const up = await q('SELECT value FROM tel_perf_metrics WHERE metric = \'server_up\' ORDER BY ts DESC LIMIT 2');
		if (up.rows.length === 2) {
			const down = up.rows.every(r => Number(r.value) === 0);
			const back = Number(up.rows[0].value) === 1;
			if (state.serverDown === null) {state.serverDown = down;}
			else if (down && !state.serverDown) {
				state.serverDown = true;
				await raiseAlert('server_down', 'critical', 'Serveur injoignable', 'Le serveur FiveM ne répond plus aux deux derniers relevés.');
			}
			else if (back && state.serverDown) {
				state.serverDown = false;
				await raiseAlert('server_up', 'ok', 'Serveur de nouveau en ligne', 'Le serveur FiveM répond à nouveau.');
			}
		}

		// 2) Burst of console errors (15 min cooldown)
		if (at - state.lastErrorBurst > 15 * 60_000) {
			const e = await q('SELECT COUNT(*)::int AS n, (array_agg(DISTINCT channel))[1:5] AS channels FROM tel_server_logs WHERE level = \'error\' AND ts > now() - interval \'5 minutes\'');
			const n = e.rows[0]?.n || 0;
			if (n >= cfg.errors5min) {
				state.lastErrorBurst = at;
				await raiseAlert('error_burst', 'warn', `${n} erreurs console en 5 minutes`, `Canaux : ${(e.rows[0].channels || []).filter(Boolean).join(', ')}`, null, { n });
			}
		}

		// 3) Anticheat: new warn/error lines on the anticheat channel
		const maxId = async () => Number((await q('SELECT COALESCE(MAX(id), 0) AS id FROM tel_server_logs')).rows[0]?.id || 0);
		if (state.lastLogId === null) {
			state.lastLogId = await maxId();
		}
		else {
			const ac = await q('SELECT id, ts, channel, level, line FROM tel_server_logs WHERE id > $1 AND channel ILIKE $2 AND level IN (\'warn\', \'error\') ORDER BY id LIMIT 50',
				[state.lastLogId, `%${cfg.anticheatChannel}%`]);
			state.lastLogId = (await maxId()) || state.lastLogId;
			const lines = ac.rows.map(r => stripColors(r.line).trim());
			if (lines.length === 1) await raiseAlert('anticheat', 'critical', 'Anticheat', lines[0]);
			else if (lines.length > 1) await raiseAlert('anticheat', 'critical', `Anticheat : ${lines.length} détections`, lines.slice(0, 8).map(l => `• ${l.slice(0, 200)}`).join('\n'), null, { n: lines.length });
		}

		// 4) Money jump between two snapshots of a player (30 min cooldown per player). Snapshots carry the game's
		// time and arrive up to a few seconds later (batches, retries): 5 minutes of margin, the cooldown dedupes.
		const since = new Date((state.lastMoneyCheck?.getTime() ?? at - 60_000) - 5 * 60_000);
		state.lastMoneyCheck = new Date(at);
		const jumps = await q(`
			WITH s AS (
				SELECT citizenid, name, ts, COALESCE(cash, 0) + COALESCE(bank, 0) AS total,
					lag(COALESCE(cash, 0) + COALESCE(bank, 0)) OVER (PARTITION BY citizenid ORDER BY ts) AS prev
				FROM tel_player_snapshots WHERE ts > $1::timestamptz - interval '2 hours')
			SELECT citizenid, name, ts, prev, total, total - prev AS jump FROM s
			WHERE ts > $1 AND prev IS NOT NULL AND total - prev >= $2 ORDER BY jump DESC LIMIT 20`, [since, cfg.moneyJump]);
		for (const j of jumps.rows) {
			const last = state.moneyCooldown.get(j.citizenid) || 0;
			if (at - last < 30 * 60_000) continue;
			if (state.moneyCooldown.size > 5000) state.moneyCooldown.clear();
			state.moneyCooldown.set(j.citizenid, at);
			await raiseAlert('money_jump', 'warn', `Saut d’argent : ${j.name || j.citizenid} +${fmtMoney(j.jump)}`,
				`${fmtMoney(j.prev)} → ${fmtMoney(j.total)} (citizenid ${j.citizenid})`, j.citizenid, { prev: j.prev, total: j.total, jump: j.jump });
		}
	}

	return { raiseAlert, check, state };
}
