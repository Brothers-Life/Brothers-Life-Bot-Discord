import { randomInt } from 'node:crypto';
import { definePermission } from './permissions.js';
import { ForbiddenError, ValidationError } from './errors.js';
import { normalizePayload } from './announcements.js';

definePermission('verification.view', { label: 'Voir la vérification des nouveaux', category: 'Accueil' });
definePermission('verification.manage', { label: 'Configurer la vérification des nouveaux (bouton, captcha)', category: 'Accueil' });

const SNOWFLAKE = /^\d{17,20}$/;
// No 0/O, 1/I/L: easy to read on the image
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL = 5 * 60_000;
const MAX_ATTEMPTS = 3;
const DAY = 86_400_000;

const DEFAULT_PAYLOAD = {
	content: '',
	embed: {
		enabled: true,
		title: '🔐 Vérification',
		description: 'Pour accéder au serveur, prouve que tu n’es pas un robot en cliquant sur le bouton ci-dessous.',
		color: '#ff9628',
		fields: [],
	},
};

export function normalizeVerification(input = {}) {
	const id = v => (SNOWFLAKE.test(v ?? '') ? v : null);
	return {
		enabled: Boolean(input.enabled),
		mode: input.mode === 'captcha' ? 'captcha' : 'button',
		channelId: id(input.channelId),
		messageId: id(input.messageId),
		payload: normalizePayload(input.payload ?? DEFAULT_PAYLOAD),
		buttonLabel: String(input.buttonLabel ?? 'Je ne suis pas un robot').slice(0, 80) || 'Je ne suis pas un robot',
		// Given once verified / given on arrival and removed once verified (either or both)
		verifiedRoleId: id(input.verifiedRoleId),
		unverifiedRoleId: id(input.unverifiedRoleId),
		minAccountAgeDays: Math.min(365, Math.max(0, Math.round(Number(input.minAccountAgeDays) || 0))),
		kickAfterMinutes: Math.min(10_080, Math.max(0, Math.round(Number(input.kickAfterMinutes) || 0))),
	};
}

// Verification of newcomers: a button (or a captcha to type) before getting access to the server.
export function createVerification({ db, network, audit, settings, executor, logs, logger = console, now = Date.now }) {
	logs.registerCategory('verification', 'Vérification des nouveaux', {
		passed: 'Vérification réussie',
		failed: 'Captcha raté',
		refused: 'Compte trop récent refusé',
		kicked: 'Expulsé faute de vérification',
	});
	const q = {
		add: db.prepare('INSERT OR REPLACE INTO verification_pending (guild_id, user_id, joined_at) VALUES (?, ?, ?)'),
		get: db.prepare('SELECT * FROM verification_pending WHERE guild_id = ? AND user_id = ?'),
		done: db.prepare('DELETE FROM verification_pending WHERE guild_id = ? AND user_id = ?'),
		attempt: db.prepare('UPDATE verification_pending SET attempts = attempts + 1 WHERE guild_id = ? AND user_id = ?'),
		overdue: db.prepare('SELECT * FROM verification_pending WHERE guild_id = ? AND joined_at <= ?'),
		count: db.prepare('SELECT COUNT(*) AS n FROM verification_pending WHERE guild_id = ?'),
	};
	// `${guildId}:${userId}` -> { code, expiresAt, attempts }
	const codes = new Map();

	const all = () => settings.get('verification.config', {});
	function config(guildId) {
		return normalizeVerification(all()[guildId] ?? {});
	}

	function log(guildId, type, title, description, color = 'info') {
		logs.log(guildId, 'verification', { title, description, color }, type);
	}

	async function grant(guildId, userId) {
		const cfg = config(guildId);
		if (cfg.verifiedRoleId) await executor.addRole(guildId, userId, cfg.verifiedRoleId, 'Vérification réussie');
		if (cfg.unverifiedRoleId) await executor.removeRole(guildId, userId, cfg.unverifiedRoleId, 'Vérification réussie').catch(() => undefined);
		q.done.run(guildId, userId);
		codes.delete(`${guildId}:${userId}`);
		log(guildId, 'passed', 'Vérification réussie', `<@${userId}>`, 'success');
	}

	const service = {
		config,
		pending: guildId => q.count.get(guildId).n,

		setConfig(actor, guildId, input) {
			if (!actor.can('verification.manage')) throw new ForbiddenError('Permission manquante : verification.manage');
			if (!network.find(guildId)) throw new ValidationError('Serveur inconnu.');
			const previous = config(guildId);
			const cfg = { ...normalizeVerification(input), messageId: previous.messageId };
			if (cfg.enabled && !cfg.verifiedRoleId && !cfg.unverifiedRoleId) throw new ValidationError('Choisis le rôle donné une fois vérifié, ou le rôle « non vérifié » retiré ensuite.');
			settings.set('verification.config', { ...all(), [guildId]: cfg });
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'verification.config', guildId });
			return cfg;
		},

		// The message with the button, in the verification channel (edited in place when it exists)
		async publish(actor, guildId) {
			if (!actor.can('verification.manage')) throw new ForbiddenError('Permission manquante : verification.manage');
			const cfg = config(guildId);
			if (!cfg.channelId) throw new ValidationError('Choisis d’abord le salon de vérification.');
			const messageId = await executor.publishVerificationPanel(cfg.channelId, cfg.messageId, cfg);
			settings.set('verification.config', { ...all(), [guildId]: { ...cfg, messageId } });
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'verification.publish', guildId });
			return { messageId };
		},

		// A newcomer: the "not verified" role right away, and a deadline when the server kicks the slow ones
		async memberJoined(guildId, userId, { bot = false } = {}) {
			const cfg = config(guildId);
			if (!cfg.enabled || bot || network.find(guildId)?.status !== 'active') return;
			q.add.run(guildId, userId, now());
			if (cfg.unverifiedRoleId) await executor.addRole(guildId, userId, cfg.unverifiedRoleId, 'Arrivée : vérification à faire').catch(error => logger.warn('Unverified role failed:', error.message));
		},

		memberLeft(guildId, userId) {
			q.done.run(guildId, userId);
			codes.delete(`${guildId}:${userId}`);
		},

		// Click on the button: verified at once, or a captcha code to type ({ code } to draw)
		async start(guildId, userId, { accountCreatedAt = null } = {}) {
			const cfg = config(guildId);
			if (!cfg.enabled) throw new ValidationError('La vérification n’est pas active sur ce serveur.');
			if (cfg.minAccountAgeDays && accountCreatedAt && now() - accountCreatedAt < cfg.minAccountAgeDays * DAY) {
				log(guildId, 'refused', 'Compte trop récent', `<@${userId}> : compte créé <t:${Math.round(accountCreatedAt / 1000)}:R>`, 'warning');
				throw new ValidationError(`Ton compte Discord doit avoir au moins ${cfg.minAccountAgeDays} jour${cfg.minAccountAgeDays > 1 ? 's' : ''}. Réessaie plus tard ou contacte le staff.`);
			}
			if (cfg.mode === 'button') {
				await grant(guildId, userId);
				return { verified: true };
			}
			const code = Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
			codes.set(`${guildId}:${userId}`, { code, expiresAt: now() + CODE_TTL, attempts: 0 });
			return { verified: false, code };
		},

		// The code typed in the form (case and spaces ignored)
		async answer(guildId, userId, input) {
			const key = `${guildId}:${userId}`;
			const pending = codes.get(key);
			if (!pending || pending.expiresAt < now()) {
				codes.delete(key);
				throw new ValidationError('Le code a expiré : reclique sur le bouton pour en avoir un nouveau.');
			}
			if (String(input ?? '').replace(/\s/g, '').toUpperCase() === pending.code) {
				await grant(guildId, userId);
				return { verified: true };
			}
			pending.attempts += 1;
			q.attempt.run(guildId, userId);
			log(guildId, 'failed', 'Captcha raté', `<@${userId}> (essai ${pending.attempts}/${MAX_ATTEMPTS})`, 'warning');
			if (pending.attempts >= MAX_ATTEMPTS) {
				codes.delete(key);
				throw new ValidationError('Code faux trois fois : reclique sur le bouton pour une nouvelle image.');
			}
			throw new ValidationError(`Code faux, il te reste ${MAX_ATTEMPTS - pending.attempts} essai${MAX_ATTEMPTS - pending.attempts > 1 ? 's' : ''}.`);
		},

		// Every minute: newcomers still not verified after the delay are kicked (when the server wants it)
		async tick() {
			for (const guildId of network.activeIds()) {
				const cfg = config(guildId);
				if (!cfg.enabled || !cfg.kickAfterMinutes) continue;
				for (const row of q.overdue.all(guildId, now() - cfg.kickAfterMinutes * 60_000)) {
					q.done.run(guildId, row.user_id);
					const result = await executor.kick(guildId, row.user_id, 'Pas de vérification à temps').catch(error => logger.warn('Verification kick failed:', error.message));
					if (result !== 'not_member') log(guildId, 'kicked', 'Expulsé faute de vérification', `<@${row.user_id}> (${cfg.kickAfterMinutes} min)`, 'danger');
				}
			}
		},
	};
	return service;
}
