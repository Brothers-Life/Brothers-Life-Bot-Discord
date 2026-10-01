import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';
import { zonedParts, zonedTime } from './recurrence.js';

definePermission('schedules.view', { label: 'Voir les horaires des salons', category: 'Salons automatiques' });
definePermission('schedules.manage', { label: 'Programmer l’ouverture et la fermeture des salons', category: 'Salons automatiques' });

const SNOWFLAKE = /^\d{17,20}$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const TZ = 'Europe/Paris';
const MINUTE = 60_000;
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

const minutesOf = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function normalizeSchedule(input = {}) {
	const name = String(input.name ?? '').trim().slice(0, 60);
	if (!name) throw new ValidationError('Donne un nom à cet horaire.');
	const channelIds = [...new Set((Array.isArray(input.channelIds) ? input.channelIds : []).filter(id => SNOWFLAKE.test(id)))].slice(0, 25);
	if (!channelIds.length) throw new ValidationError('Choisis au moins un salon.');
	const weekly = (Array.isArray(input.weekly) ? input.weekly : []).slice(0, 20).map((slot) => {
		const days = [...new Set((slot?.days ?? []).map(Number).filter(d => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
		if (!days.length) throw new ValidationError('Chaque créneau a besoin d’au moins un jour.');
		if (!TIME.test(slot?.from ?? '') || !TIME.test(slot?.to ?? '')) throw new ValidationError('Heure invalide (format HH:MM).');
		if (slot.from === slot.to) throw new ValidationError('Un créneau doit durer (début et fin différents).');
		return { days, from: slot.from, to: slot.to };
	});
	const dates = (Array.isArray(input.dates) ? input.dates : []).slice(0, 50).map((d) => {
		const from = Number(d?.from);
		const to = Number(d?.to);
		if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) throw new ValidationError('Chaque période a besoin d’un début et d’une fin après le début.');
		return { from, to, label: String(d?.label ?? '').trim().slice(0, 60) };
	});
	if (!weekly.length && !dates.length) throw new ValidationError('Ajoute au moins un créneau ou une date.');
	return {
		name, channelIds, weekly, dates,
		mode: input.mode === 'closed_during' ? 'closed_during' : 'open_during',
		lockType: input.lockType === 'hide' ? 'hide' : 'write',
		announce: input.announce !== false,
		enabled: input.enabled !== false,
	};
}

// Is `at` inside one of the slots or dated periods? (weekly slots in Paris time; "to" before "from" = past midnight)
export function inWindow(rule, at) {
	if (rule.dates.some(d => at >= d.from && at < d.to)) return true;
	const p = zonedParts(at, TZ);
	const minute = p.hour * 60 + p.minute;
	const yesterday = (p.weekday + 6) % 7;
	return rule.weekly.some((slot) => {
		const from = minutesOf(slot.from);
		const to = minutesOf(slot.to);
		if (from < to) return slot.days.includes(p.weekday) && minute >= from && minute < to;
		return (slot.days.includes(p.weekday) && minute >= from) || (slot.days.includes(yesterday) && minute < to);
	});
}

export function stateAt(rule, at) {
	const inside = inWindow(rule, at);
	return (rule.mode === 'open_during') === inside ? 'open' : 'closed';
}

// When the state changes next (null if never): only the edges of slots and periods can change it
export function nextChange(rule, from) {
	const current = stateAt(rule, from);
	const candidates = rule.dates.flatMap(d => [d.from, d.to]);
	for (let offset = 0; offset <= 8; offset++) {
		const day = zonedParts(from + offset * 1440 * MINUTE, TZ);
		for (const slot of rule.weekly) {
			for (const time of [slot.from, slot.to]) candidates.push(zonedTime(day.year, day.month, day.day, Number(time.slice(0, 2)), Number(time.slice(3)), TZ));
		}
	}
	for (const at of [...new Set(candidates)].filter(t => t > from).sort((a, b) => a - b)) {
		const state = stateAt(rule, at);
		if (state !== current) return { at, state };
	}
	return null;
}

export function describeSlot(slot) {
	const days = slot.days.length === 7 ? 'tous les jours' : slot.days.length === 5 && !slot.days.includes(0) && !slot.days.includes(6) ? 'en semaine' : slot.days.map(d => DAYS[d]).join(', ');
	return `${days} de ${slot.from} à ${slot.to}`;
}

// Opening hours of channels: weekly slots and dated periods. Every minute the channels are opened or
// closed (writing blocked, or hidden) for @everyone, with an optional message in the channel.
export function createChannelSchedules({ db, network, audit, executor, logger = console, now = Date.now }) {
	const q = {
		all: db.prepare('SELECT * FROM channel_schedules ORDER BY guild_id, name'),
		get: db.prepare('SELECT * FROM channel_schedules WHERE id = ?'),
		insert: db.prepare(`
			INSERT INTO channel_schedules (guild_id, name, channel_ids, mode, lock_type, weekly, dates, announce, enabled, created_at, updated_at)
			VALUES (@guildId, @name, @channelIds, @mode, @lockType, @weekly, @dates, @announce, @enabled, @at, @at)
		`),
		update: db.prepare(`
			UPDATE channel_schedules SET name = @name, channel_ids = @channelIds, mode = @mode, lock_type = @lockType, weekly = @weekly, dates = @dates,
				announce = @announce, enabled = @enabled, applied = NULL, updated_at = @at WHERE id = @id
		`),
		applied: db.prepare('UPDATE channel_schedules SET applied = ? WHERE id = ?'),
		remove: db.prepare('DELETE FROM channel_schedules WHERE id = ?'),
	};
	const toRule = row => row && ({
		id: row.id, guildId: row.guild_id, name: row.name, channelIds: JSON.parse(row.channel_ids), mode: row.mode, lockType: row.lock_type,
		weekly: JSON.parse(row.weekly), dates: JSON.parse(row.dates), announce: Boolean(row.announce), enabled: Boolean(row.enabled), applied: row.applied,
	});
	const need = (actor) => {
		if (!actor.can('schedules.manage')) throw new ForbiddenError('Permission manquante : schedules.manage');
	};
	function getOrThrow(id) {
		const rule = toRule(q.get.get(id));
		if (!rule) throw new NotFoundError('Horaire introuvable.');
		return rule;
	}

	async function apply(rule, state, { announce = rule.announce } = {}) {
		const closed = state === 'closed';
		const next = nextChange(rule, now());
		for (const channelId of rule.channelIds) {
			try {
				await executor.setChannelAccess(channelId, { closed, hide: rule.lockType === 'hide' }, `Horaire « ${rule.name} »`);
				if (announce && !(closed && rule.lockType === 'hide')) {
					const when = next ? ` ${closed ? 'Réouverture' : 'Fermeture'} <t:${Math.round(next.at / 1000)}:R> (<t:${Math.round(next.at / 1000)}:f>).` : '';
					await executor.sendMessage(channelId, { payload: { content: `${closed ? '🔒 Salon fermé.' : '🔓 Salon ouvert !'}${when}`, embed: { enabled: false } }, files: [], mentionUserIds: [] });
				}
			}
			catch (error) {
				logger.warn(`Schedule « ${rule.name} » on ${channelId}:`, error.message);
			}
		}
		q.applied.run(state, rule.id);
	}

	const service = {
		list(guildId = null) {
			return q.all.all().map(toRule).filter(r => !guildId || r.guildId === guildId).map(r => ({ ...r, state: stateAt(r, now()), next: nextChange(r, now()) }));
		},

		async save(actor, input) {
			need(actor);
			if (network.find(input.guildId)?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const rule = normalizeSchedule(input);
			const row = { ...rule, guildId: input.guildId, channelIds: JSON.stringify(rule.channelIds), weekly: JSON.stringify(rule.weekly), dates: JSON.stringify(rule.dates), announce: rule.announce ? 1 : 0, enabled: rule.enabled ? 1 : 0, at: now() };
			let id = input.id;
			if (id) {
				const previous = getOrThrow(id);
				q.update.run({ ...row, id });
				// Channels taken out of the rule get their access back
				const dropped = previous.channelIds.filter(c => !rule.channelIds.includes(c));
				if (previous.applied === 'closed' && dropped.length) await apply({ ...previous, channelIds: dropped }, 'open', { announce: false });
			}
			else {
				id = Number(q.insert.run(row).lastInsertRowid);
			}
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'schedules.save', guildId: input.guildId, target: String(id), details: { horaire: rule.name, salons: rule.channelIds.length } });
			await service.tick();
			return service.list().find(r => r.id === id);
		},

		// Deleted (or disabled): the channels are opened again
		async remove(actor, id) {
			need(actor);
			const rule = getOrThrow(id);
			if (rule.applied === 'closed') await apply(rule, 'open', { announce: false });
			q.remove.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'schedules.delete', guildId: rule.guildId, target: String(id), details: { horaire: rule.name } });
		},

		// Every minute: channels whose state should change
		async tick() {
			for (const rule of q.all.all().map(toRule)) {
				if (network.find(rule.guildId)?.status !== 'active') continue;
				if (!rule.enabled) {
					if (rule.applied === 'closed') await apply(rule, 'open', { announce: false });
					continue;
				}
				const state = stateAt(rule, now());
				// First application: no message (the channel may already be in that state)
				if (state !== rule.applied) await apply(rule, state, { announce: rule.applied !== null && rule.announce });
			}
		},
	};
	return service;
}
