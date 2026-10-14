import { ValidationError } from '../errors.js';
import { clampInt } from './util.js';

// Orders of the panel (announcements) picked up by bl_telemetry, port of the commands part of features.js.
// bl_telemetry 1.3+ gets them in the answer of POST /v1/batch?commands=1 and sends the results with its next batch;
// older versions use GET /v1/commands and POST /v1/commands/:id/ack.

export const ANNOUNCE_MODES = ['chat', 'notify', 'both'];
export const ANNOUNCE_TYPES = ['inform', 'success', 'warning', 'error'];

export function createCommands({ q, raw }) {
	return {
		async list() {
			const r = await q('SELECT id, ts, type, payload, author, status, sent_at, done_at, result FROM tel_commands ORDER BY id DESC LIMIT 50');
			return { commands: r.rows };
		},

		// Announcement to every player: { message, title, mode, type, duration }
		async announce(input, author) {
			const p = input && typeof input === 'object' ? input : {};
			const message = String(p.message ?? '').trim().slice(0, 500);
			if (!message) throw new ValidationError('Le message de l’annonce est vide.');
			const payload = {
				message,
				title: String(p.title || 'Annonce').slice(0, 60),
				mode: ANNOUNCE_MODES.includes(p.mode) ? p.mode : 'both',
				type: ANNOUNCE_TYPES.includes(p.type) ? p.type : 'inform',
				duration: clampInt(p.duration, 10000, 3000, 60000),
			};
			// Not swallowed: the panel must know the announcement was not queued
			const r = await raw('INSERT INTO tel_commands (type, payload, author) VALUES (\'announce\', $1, $2) RETURNING id', [JSON.stringify(payload), String(author || '?').slice(0, 80)]);
			return { id: Number(r.rows[0]?.id), payload };
		},

		// FiveM: the pending orders (older than 10 minutes: expired)
		async pull() {
			await q('UPDATE tel_commands SET status = \'expired\' WHERE status = \'pending\' AND ts < now() - interval \'10 minutes\'');
			const r = await q(`UPDATE tel_commands SET status = 'sent', sent_at = now()
				WHERE id IN (SELECT id FROM tel_commands WHERE status = 'pending' ORDER BY id LIMIT 10 FOR UPDATE SKIP LOCKED)
				RETURNING id, type, payload`);
			return r.rows.sort((a, b) => a.id - b.id);
		},

		async ack(id, ok, result) {
			if (!/^\d{1,18}$/.test(String(id))) return;
			await q('UPDATE tel_commands SET status = $2, done_at = now(), result = $3 WHERE id = $1 AND status = \'sent\'',
				[String(id), ok ? 'done' : 'failed', String(result ?? '').slice(0, 300)]);
		},
	};
}
