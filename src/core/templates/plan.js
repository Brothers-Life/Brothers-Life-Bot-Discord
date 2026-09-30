// From a template (photo of a model server) and the current state of a target server, the ordered list of
// operations to run. Pure: ids of the template are "keys", resolved to target ids while the job runs.
//
// guild snapshot: { id, community, botRolePosition, roles: [...], channels: [...], settings: {...} }
// mapping: { roles: { templateId: targetId }, channels: { templateId: targetId } } kept from the last application

const COMMUNITY_ONLY = { announcement: 'text', stage: 'voice' };

export function roleData(r) {
	return { name: r.name, color: r.color, hoist: r.hoist, mentionable: r.mentionable, permissions: r.permissions };
}

export function channelData(c, { community }) {
	const type = !community && COMMUNITY_ONLY[c.type] ? COMMUNITY_ONLY[c.type] : c.type;
	return {
		type, name: c.name, topic: c.topic ?? null, nsfw: Boolean(c.nsfw), rateLimitPerUser: c.rateLimitPerUser ?? 0,
		bitrate: c.bitrate ?? null, userLimit: c.userLimit ?? 0, rtcRegion: c.rtcRegion ?? null,
		defaultAutoArchiveDuration: c.defaultAutoArchiveDuration ?? null, availableTags: c.availableTags ?? [],
		// Role overwrites only; resolved later (template role keys -> target roles)
		overwrites: (c.overwrites ?? []).filter(o => o.type === 'role'),
		parentKey: c.parentId ?? null,
	};
}

// Roles the bot may touch on the target
export function editableRoles(guild) {
	return guild.roles.filter(r => !r.everyone && !r.managed && r.position < guild.botRolePosition);
}

function byPosition(a, b) {
	return a.position - b.position;
}

export function plan(template, target, mapping = { roles: {}, channels: {} }, mode = 'reset') {
	const tpl = template.guild;
	const ops = [];
	const warnings = [];

	// --- Roles: kept in place when they already exist (members keep them) ---------------------------
	const tplRoles = tpl.roles.filter(r => !r.everyone && !r.managed).sort(byPosition);
	const candidates = editableRoles(target);
	const used = new Set();
	for (const r of tplRoles) {
		const mapped = mapping.roles?.[r.id];
		const match = candidates.find(x => x.id === mapped && !used.has(x.id)) ?? candidates.find(x => x.name === r.name && !used.has(x.id));
		if (match) {
			used.add(match.id);
			ops.push({ op: 'editRole', key: r.id, targetId: match.id, name: r.name, data: roleData(r) });
		}
		else {
			ops.push({ op: 'createRole', key: r.id, name: r.name, data: roleData(r) });
		}
	}
	const everyone = tpl.roles.find(r => r.everyone);
	if (everyone) ops.push({ op: 'editRole', key: everyone.id, targetId: target.id, name: '@everyone', data: { permissions: everyone.permissions } });
	if (mode === 'reset' || mode === 'restore') {
		for (const r of candidates) if (!used.has(r.id)) ops.push({ op: 'deleteRole', targetId: r.id, name: r.name });
	}
	for (const r of target.roles.filter(x => !x.everyone && !x.managed && x.position >= target.botRolePosition)) {
		if (tplRoles.some(t => t.name === r.name)) warnings.push(`Rôle « ${r.name} » au-dessus du bot : il n’est pas modifié.`);
	}

	// --- Channels: categories first, then the others ------------------------------------------------
	const tplChannels = [...tpl.channels.filter(c => c.type === 'category').sort(byPosition), ...tpl.channels.filter(c => c.type !== 'category').sort(byPosition)];
	const community = Boolean(target.community);
	const usedChannels = new Set();
	const nameOfParent = (guild, id) => guild.channels.find(c => c.id === id)?.name ?? null;
	for (const c of tplChannels) {
		const data = channelData(c, { community });
		if (data.type !== c.type) warnings.push(`Salon « ${c.name} » : type réservé aux serveurs Communauté, créé en ${data.type === 'text' ? 'salon texte' : 'salon vocal'}.`);
		if (mode === 'repair' || mode === 'restore') {
			const mapped = mapping.channels?.[c.id];
			const parentName = nameOfParent(tpl, c.parentId);
			const match = target.channels.find(x => x.id === mapped && !usedChannels.has(x.id))
				?? target.channels.find(x => !usedChannels.has(x.id) && x.name === c.name && x.type === data.type && nameOfParent(target, x.parentId) === parentName);
			if (match) {
				usedChannels.add(match.id);
				ops.push({ op: 'editChannel', key: c.id, targetId: match.id, name: c.name, data });
				continue;
			}
		}
		ops.push({ op: 'createChannel', key: c.id, name: c.name, data });
	}

	// Server settings point to the new channels before the old ones go away
	ops.push({
		op: 'settings',
		data: {
			verificationLevel: tpl.settings.verificationLevel,
			defaultMessageNotifications: tpl.settings.defaultMessageNotifications,
			explicitContentFilter: tpl.settings.explicitContentFilter,
			afkTimeout: tpl.settings.afkTimeout,
			systemChannelFlags: tpl.settings.systemChannelFlags,
			preferredLocale: tpl.settings.preferredLocale,
			afkChannelKey: tpl.settings.afkChannelId ?? null,
			systemChannelKey: tpl.settings.systemChannelId ?? null,
			// Only on Community servers, and only when the model is one too
			rulesChannelKey: community && tpl.community ? tpl.settings.rulesChannelId ?? null : null,
			publicUpdatesChannelKey: community && tpl.community ? tpl.settings.publicUpdatesChannelId ?? null : null,
		},
	});

	if (mode === 'restore') {
		// Channels the backup did not have (a raid, a mistake): removed, children before their categories
		const extra = target.channels.filter(c => !usedChannels.has(c.id));
		for (const c of [...extra.filter(x => x.type !== 'category'), ...extra.filter(x => x.type === 'category')]) ops.push({ op: 'deleteChannel', targetId: c.id, name: c.name });
	}
	if (mode === 'reset') {
		// Children before their categories
		const old = [...target.channels.filter(c => c.type !== 'category'), ...target.channels.filter(c => c.type === 'category')];
		for (const c of old) ops.push({ op: 'deleteChannel', targetId: c.id, name: c.name });
	}

	ops.push({ op: 'rolePositions', keys: tplRoles.map(r => r.id) });
	ops.push({ op: 'panel' });
	return { ops, warnings };
}

// Every Discord id of the model found in a value (JSON text, arrays, objects) replaced by its target id
export function remapDeep(value, ids) {
	if (typeof value === 'string') {
		if (ids.has(value)) return ids.get(value);
		const t = value.trim();
		if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
			try {
				return JSON.stringify(remapDeep(JSON.parse(t), ids));
			}
			catch {
				return value;
			}
		}
		return value;
	}
	if (Array.isArray(value)) return value.map(v => remapDeep(v, ids));
	if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapDeep(v, ids)]));
	return value;
}
