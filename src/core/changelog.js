import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('changelog.view', { label: 'Voir le changelog', category: 'Changelog' });
definePermission('changelog.manage', { label: 'Écrire et publier le changelog', category: 'Changelog' });

const SNOWFLAKE = /^\d{17,20}$/;
export const ITEM_TYPES = {
	added: { label: 'Ajouts', emoji: '✨' },
	changed: { label: 'Changements', emoji: '🔧' },
	fixed: { label: 'Corrections', emoji: '🐛' },
	removed: { label: 'Retraits', emoji: '🗑️' },
	security: { label: 'Sécurité', emoji: '🔒' },
};

function normalize(input) {
	const title = String(input.title ?? '').trim();
	if (!title || title.length > 150) throw new ValidationError('Le titre fait 1 à 150 caractères.');
	const version = String(input.version ?? '').trim().slice(0, 30) || null;
	const items = (Array.isArray(input.items) ? input.items : []).slice(0, 60).map((item) => {
		const text = String(item?.text ?? '').trim().slice(0, 300);
		return { type: ITEM_TYPES[item?.type] ? item.type : 'added', text };
	}).filter(i => i.text);
	const image = typeof input.image === 'string' && /^https:\/\/\S+$/.test(input.image) ? input.image : null;
	const color = typeof input.color === 'string' && /^#[0-9a-f]{6}$/i.test(input.color) ? input.color : '#d6a249';
	const seen = new Set();
	const targets = (Array.isArray(input.targets) ? input.targets : [])
		.filter(t => SNOWFLAKE.test(t?.guildId) && SNOWFLAKE.test(t?.channelId) && !seen.has(t.channelId) && seen.add(t.channelId))
		.slice(0, 30)
		.map(t => ({ guildId: t.guildId, channelId: t.channelId }));
	return { version, title, intro: String(input.intro ?? '').slice(0, 1500), items, image, color, targets };
}

// Embed of an entry: items grouped by type, each group with its emoji
export function changelogPayload(entry) {
	const groups = Object.entries(ITEM_TYPES)
		.map(([type, meta]) => ({ meta, lines: entry.items.filter(i => i.type === type).map(i => `• ${i.text}`) }))
		.filter(g => g.lines.length);
	const fields = groups.map(g => ({ name: `${g.meta.emoji} ${g.meta.label}`, value: g.lines.join('\n').slice(0, 1024), inline: false }));
	return {
		content: '',
		embed: {
			enabled: true,
			title: `${entry.version ? `${entry.version} · ` : ''}${entry.title}`.slice(0, 256),
			url: null,
			description: entry.intro,
			color: entry.color,
			authorName: 'Changelog',
			authorIconUrl: null,
			thumbnailUrl: null,
			imageUrl: entry.image,
			footerText: '',
			footerIconUrl: null,
			timestamp: true,
			fields: fields.slice(0, 25),
		},
	};
}

export function createChangelog({ db, network, audit, executor, logger = console, now = Date.now }) {
	const q = {
		list: db.prepare('SELECT * FROM changelog_entries ORDER BY COALESCE(published_at, created_at) DESC'),
		get: db.prepare('SELECT * FROM changelog_entries WHERE id = ?'),
		byVersion: db.prepare('SELECT * FROM changelog_entries WHERE status = \'published\' AND version = ? ORDER BY published_at DESC LIMIT 1'),
		latest: db.prepare('SELECT * FROM changelog_entries WHERE status = \'published\' ORDER BY published_at DESC LIMIT 1'),
		insert: db.prepare(`
			INSERT INTO changelog_entries (version, title, intro, items, image, color, targets, created_by, created_at, updated_at)
			VALUES (@version, @title, @intro, @items, @image, @color, @targets, @by, @at, @at)
		`),
		update: db.prepare(`
			UPDATE changelog_entries SET version = @version, title = @title, intro = @intro, items = @items, image = @image, color = @color, targets = @targets, updated_at = @at WHERE id = @id
		`),
		published: db.prepare('UPDATE changelog_entries SET status = \'published\', messages = ?, published_at = COALESCE(published_at, ?) WHERE id = ?'),
		remove: db.prepare('DELETE FROM changelog_entries WHERE id = ?'),
	};

	const toEntry = row => row && ({
		id: row.id,
		version: row.version,
		title: row.title,
		intro: row.intro,
		items: JSON.parse(row.items),
		image: row.image,
		color: row.color,
		status: row.status,
		targets: JSON.parse(row.targets),
		messages: JSON.parse(row.messages),
		createdBy: row.created_by,
		createdAt: row.created_at,
		updatedAt: row.updated_at,
		publishedAt: row.published_at,
	});

	function need(actor) {
		if (!actor.can('changelog.manage')) throw new ForbiddenError('Permission manquante : changelog.manage');
	}

	function getOrThrow(id) {
		const entry = toEntry(q.get.get(id));
		if (!entry) throw new NotFoundError('Entrée introuvable.');
		return entry;
	}

	// Posts in new channels, edits where it is already posted, removes from channels taken out
	async function sync(entry) {
		const payload = changelogPayload(entry);
		const previous = new Map(entry.messages.map(m => [m.channelId, m]));
		const messages = [];
		const results = [];
		for (const target of entry.targets) {
			if (network.find(target.guildId)?.status !== 'active') continue;
			try {
				const id = await executor.upsertMessage(target.channelId, previous.get(target.channelId)?.messageId ?? null, payload, { repost: true });
				messages.push({ ...target, messageId: id });
				results.push({ channelId: target.channelId, ok: true });
			}
			catch (error) {
				if (previous.has(target.channelId)) messages.push(previous.get(target.channelId));
				results.push({ channelId: target.channelId, ok: false, error: error.message });
				logger.warn(`Changelog #${entry.id} in ${target.channelId}:`, error.message);
			}
		}
		for (const old of entry.messages.filter(m => !entry.targets.some(t => t.channelId === m.channelId))) {
			await executor.deleteMessage(old.channelId, old.messageId).catch(() => null);
		}
		q.published.run(JSON.stringify(messages), now(), entry.id);
		return results;
	}

	return {
		list: () => q.list.all().map(toEntry),
		get: getOrThrow,
		latest: version => toEntry(version ? q.byVersion.get(version) : q.latest.get()),

		create(actor, input) {
			need(actor);
			const values = normalize(input);
			const id = Number(q.insert.run({ ...values, items: JSON.stringify(values.items), targets: JSON.stringify(values.targets), by: actor.id, at: now() }).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'changelog.create', target: String(id), details: { title: values.title } });
			return getOrThrow(id);
		},

		// A published entry is edited everywhere it was posted
		async update(actor, id, input) {
			need(actor);
			const entry = getOrThrow(id);
			const values = normalize(input);
			q.update.run({ ...values, items: JSON.stringify(values.items), targets: JSON.stringify(values.targets), id, at: now() });
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'changelog.update', target: String(id), details: { title: values.title } });
			const results = entry.status === 'published' ? await sync(getOrThrow(id)) : [];
			return { ...getOrThrow(id), results };
		},

		async publish(actor, id) {
			need(actor);
			const entry = getOrThrow(id);
			if (!entry.targets.length) throw new ValidationError('Choisis au moins un salon.');
			if (!entry.items.length && !entry.intro.trim()) throw new ValidationError('L’entrée est vide : ajoute un texte ou des éléments.');
			const results = await sync(entry);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'changelog.publish', target: String(id), details: { title: entry.title, channels: results.filter(r => r.ok).length } });
			return { ...getOrThrow(id), results };
		},

		async remove(actor, id) {
			need(actor);
			const entry = getOrThrow(id);
			for (const m of entry.messages) await executor.deleteMessage(m.channelId, m.messageId).catch(() => null);
			q.remove.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'changelog.delete', target: String(id), details: { title: entry.title } });
		},
	};
}
