import crypto from 'node:crypto';
import { definePermission, isKnownPermission } from './permissions.js';
import { ValidationError, ForbiddenError, NotFoundError } from './errors.js';

definePermission('api.use', { label: 'Créer et utiliser ses propres clés d’API', category: 'API' });
definePermission('api.manage', { label: 'Voir et révoquer les clés d’API de tout le staff', category: 'API' });

export const KEY_PREFIX = 'brl_';
const KEY_PATTERN = /^brl_[A-Za-z0-9_-]{43}$/;
const TOUCH_THROTTLE_MS = 60_000;
const MAX_KEYS_PER_USER = 20;
const MAX_EXPIRY_DAYS = 3650;

const hashOf = secret => crypto.createHash('sha256').update(secret).digest('hex');

// API keys: a key acts as its owner, limited to the permissions chosen at creation.
// Losing a permission (or panel.access) takes it away from the owner's keys as well.
export function createApiKeys({ db, audit, ranks, now = Date.now }) {
	const q = {
		insert: db.prepare(`
			INSERT INTO api_keys (name, owner_id, prefix, hash, permissions, created_at, expires_at)
			VALUES (@name, @ownerId, @prefix, @hash, @permissions, @at, @expiresAt)
		`),
		byHash: db.prepare('SELECT * FROM api_keys WHERE hash = ?'),
		get: db.prepare('SELECT * FROM api_keys WHERE id = ?'),
		all: db.prepare('SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC'),
		byOwner: db.prepare('SELECT * FROM api_keys WHERE owner_id = ? AND revoked_at IS NULL ORDER BY created_at DESC'),
		touch: db.prepare('UPDATE api_keys SET last_used_at = ?, last_ip = ?, uses = uses + ? WHERE id = ?'),
		revoke: db.prepare('UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL'),
	};
	// Uses are counted in memory and written at most once a minute per key
	const pending = new Map();

	function toKey(row) {
		return {
			id: row.id,
			name: row.name,
			ownerId: row.owner_id,
			prefix: row.prefix,
			permissions: row.permissions ? JSON.parse(row.permissions) : null,
			createdAt: row.created_at,
			expiresAt: row.expires_at,
			lastUsedAt: pending.get(row.id)?.at ?? row.last_used_at,
			lastIp: pending.get(row.id)?.ip ?? row.last_ip,
			uses: row.uses + (pending.get(row.id)?.count ?? 0),
		};
	}

	function record(actor, action, key, details = {}) {
		audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action, target: String(key.id), details: { name: key.name, owner: `<@${key.ownerId}>`, ...details } });
	}

	function flush(id) {
		const p = pending.get(id);
		if (!p) return;
		q.touch.run(p.at, p.ip, p.count, id);
		p.count = 0;
		p.flushedAt = p.at;
	}

	return {
		create(actor, { name, permissions = null, expiresInDays = null }) {
			if (!actor.can('api.use')) throw new ForbiddenError('Permission manquante : api.use');
			name = String(name ?? '').trim();
			if (!name || name.length > 60) throw new ValidationError('Donne un nom à la clé (60 caractères max).');
			if (q.byOwner.all(actor.id).length >= MAX_KEYS_PER_USER) throw new ValidationError(`Tu as déjà ${MAX_KEYS_PER_USER} clés : révoque celles qui ne servent plus.`);

			if (permissions !== null) {
				if (!Array.isArray(permissions) || !permissions.length) throw new ValidationError('Choisis au moins une permission, ou « toutes mes permissions ».');
				permissions = [...new Set(permissions.map(String))];
				const unknown = permissions.filter(p => !isKnownPermission(p));
				if (unknown.length) throw new ValidationError(`Permission inconnue : ${unknown.join(', ')}`);
				const missing = permissions.filter(p => !actor.can(p));
				if (missing.length) throw new ForbiddenError(`Tu ne peux pas donner à une clé ce que tu n’as pas : ${missing.join(', ')}`);
				// Without these two, the key could not be used at all
				permissions = [...new Set([...permissions, 'panel.access', 'api.use'])].sort();
			}

			let expiresAt = null;
			if (expiresInDays !== null && expiresInDays !== undefined) {
				const days = Number(expiresInDays);
				if (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) throw new ValidationError(`Durée de validité entre 1 et ${MAX_EXPIRY_DAYS} jours.`);
				expiresAt = now() + days * 86_400_000;
			}

			const secret = KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
			const { lastInsertRowid } = q.insert.run({
				name, ownerId: actor.id, prefix: secret.slice(0, 12), hash: hashOf(secret),
				permissions: permissions ? JSON.stringify(permissions) : null, at: now(), expiresAt,
			});
			const key = toKey(q.get.get(lastInsertRowid));
			record(actor, 'api.create', key, { permissions: permissions ? permissions.join(', ') : 'toutes', expiration: expiresAt ? new Date(expiresAt).toISOString() : 'jamais' });
			// The secret leaves the server this once: only its hash is kept
			return { ...key, secret };
		},

		// Key of an Authorization header, or null (unknown, revoked, expired)
		authenticate(secret, ip = null) {
			if (typeof secret !== 'string' || !KEY_PATTERN.test(secret)) return null;
			const row = q.byHash.get(hashOf(secret));
			if (!row || row.revoked_at) return null;
			const at = now();
			if (row.expires_at && row.expires_at <= at) return null;

			const p = pending.get(row.id) ?? { count: 0, flushedAt: row.last_used_at ?? 0 };
			p.count += 1;
			p.at = at;
			p.ip = ip;
			pending.set(row.id, p);
			if (at - p.flushedAt > TOUCH_THROTTLE_MS) flush(row.id);
			return toKey(q.get.get(row.id));
		},

		// The actor of a request made with this key: the owner, cut down to the key's permissions
		async actorFor(key) {
			const principal = await ranks.resolve(key.ownerId);
			const scope = key.permissions ? new Set(key.permissions) : null;
			const can = permission => principal.can(permission) && (!scope || scope.has(permission));
			return {
				...principal,
				permissions: principal.permissions.filter(can),
				// Same source as the panel (the database only knows those); the audit names the key
				source: 'panel',
				apiKey: { id: key.id, name: key.name },
				can,
			};
		},

		list(actor, { all = false } = {}) {
			if (!actor.can('api.use') && !actor.can('api.manage')) throw new ForbiddenError('Permission manquante : api.use');
			const rows = all && actor.can('api.manage') ? q.all.all() : q.byOwner.all(actor.id);
			const at = now();
			return rows.map(toKey).map(k => ({ ...k, expired: Boolean(k.expiresAt && k.expiresAt <= at) }));
		},

		async revoke(actor, id) {
			const row = q.get.get(Number(id));
			if (!row || row.revoked_at) throw new NotFoundError('Clé introuvable.');
			const key = toKey(row);
			if (key.ownerId !== actor.id) {
				if (!actor.can('api.manage')) throw new ForbiddenError('Permission manquante : api.manage');
				const owner = await ranks.resolve(key.ownerId);
				if (!actor.isOwner && owner.level >= actor.level) throw new ForbiddenError('Tu ne peux pas révoquer la clé de quelqu’un de niveau égal ou supérieur au tien.');
			}
			flush(key.id);
			pending.delete(key.id);
			q.revoke.run(now(), key.id);
			record(actor, 'api.revoke', key);
			return { ok: true };
		},

		// Writes the pending usage counters (on shutdown)
		flushAll() {
			for (const id of pending.keys()) flush(id);
		},
	};
}
