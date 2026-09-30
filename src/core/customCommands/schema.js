import { ValidationError } from '../errors.js';

// Definition of a custom command, checked field by field. Everything the panel sends goes through here.

const SNOWFLAKE = /^\d{17,20}$/;
const SLASH_NAME = /^[-_\p{Ll}\p{Lo}\p{N}]{1,32}$/u;
const OPTION_TYPES = ['string', 'integer', 'number', 'boolean', 'user', 'role', 'channel'];
export const TRIGGERS = ['slash', 'user', 'message', 'keyword'];
export const DISCORD_PERMISSIONS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'ModerateMembers', 'KickMembers', 'BanMembers', 'MentionEveryone', 'MuteMembers', 'MoveMembers', 'ManageNicknames'];
// Actions that change members: adding them needs the panel permission customcommands.sensitive
export const SENSITIVE_ACTIONS = new Set(['role', 'sanction', 'nickname']);
export const MAX_BLOCKS = 80;
const MAX_DEPTH = 6;

function text(value, max, label, { required = false } = {}) {
	const v = value === undefined || value === null ? '' : String(value);
	if (required && !v.trim()) throw new ValidationError(`${label} : obligatoire.`);
	if (v.length > max) throw new ValidationError(`${label} : ${max} caractères au maximum.`);
	return v;
}

function ids(list, max = 25) {
	return [...new Set((Array.isArray(list) ? list : []).filter(v => SNOWFLAKE.test(String(v))).map(String))].slice(0, max);
}

function int(value, min, max, label) {
	const n = Number(value);
	if (!Number.isFinite(n) || n < min || n > max) throw new ValidationError(`${label} : entre ${min} et ${max}.`);
	return Math.round(n);
}

function oneOf(value, list, fallback) {
	return list.includes(value) ? value : fallback;
}

// A message (text + optional embed) written in a block
function message(input = {}, label) {
	const embed = input.embed ?? null;
	const out = {
		content: text(input.content, 2000, `${label} : texte`),
		embed: embed && embed.enabled !== false ? {
			title: text(embed.title, 256, `${label} : titre`),
			description: text(embed.description, 4000, `${label} : description`),
			color: /^#[0-9a-f]{6}$/i.test(embed.color ?? '') ? embed.color : '#ff9628',
			imageUrl: /^https:\/\/\S+$/.test(embed.imageUrl ?? '') ? embed.imageUrl : null,
			footer: text(embed.footer, 200, `${label} : pied`),
		} : null,
	};
	if (!out.content.trim() && !out.embed?.title && !out.embed?.description) throw new ValidationError(`${label} : message vide.`);
	return out;
}

// "invoker" or "option:<name>" (a user option)
function target(value, optionNames) {
	if (value === 'invoker' || value === undefined || value === null || value === '') return 'invoker';
	const m = /^option:(.+)$/.exec(String(value));
	if (!m || !optionNames.has(m[1])) throw new ValidationError('Cible inconnue : choisis « la personne qui lance » ou une option membre.');
	return `option:${m[1]}`;
}

function condition(c, optionNames) {
	const negate = Boolean(c?.negate);
	switch (c?.kind) {
	case 'hasRole': return { kind: 'hasRole', roleIds: ids(c.roleIds), match: oneOf(c.match, ['any', 'all'], 'any'), negate };
	case 'inChannel': return { kind: 'inChannel', channelIds: ids(c.channelIds), negate };
	case 'hasPermission': return { kind: 'hasPermission', permission: oneOf(c.permission, DISCORD_PERMISSIONS, 'ManageMessages'), negate };
	case 'option': {
		if (!optionNames.has(c.name)) throw new ValidationError(`Condition sur une option inconnue : ${c.name}.`);
		return { kind: 'option', name: c.name, op: oneOf(c.op, ['equals', 'contains', 'startsWith', 'gt', 'lt', 'set', 'notSet'], 'equals'), value: text(c.value, 200, 'Condition : valeur'), negate };
	}
	case 'accountAge':
	case 'memberAge': return { kind: c.kind, op: oneOf(c.op, ['gt', 'lt'], 'gt'), days: int(c.days ?? 0, 0, 3650, 'Condition : jours'), negate };
	case 'counter': return { kind: 'counter', key: counterKey(c.key), perUser: Boolean(c.perUser), op: oneOf(c.op, ['equals', 'gt', 'lt'], 'gt'), value: int(c.value ?? 0, -1e9, 1e9, 'Condition : valeur'), negate };
	case 'chance': return { kind: 'chance', percent: int(c.percent ?? 50, 0, 100, 'Condition : pourcentage'), negate };
	case 'userIs': return { kind: 'userIs', userIds: ids(c.userIds, 50), negate };
	default: throw new ValidationError('Type de condition inconnu.');
	}
}

function counterKey(key) {
	const k = String(key ?? '').trim().toLowerCase();
	if (!/^[a-z0-9_-]{1,32}$/.test(k)) throw new ValidationError('Nom de compteur : lettres, chiffres, - et _ (32 max).');
	return k;
}

function blocks(list, ctx, depth = 0) {
	if (!Array.isArray(list)) return [];
	if (depth > MAX_DEPTH) throw new ValidationError('Trop de conditions imbriquées (6 niveaux au maximum).');
	return list.map((b) => {
		ctx.count++;
		if (ctx.count > MAX_BLOCKS) throw new ValidationError(`Déroulé trop long : ${MAX_BLOCKS} blocs au maximum.`);
		const { optionNames, componentIds } = ctx;
		switch (b?.type) {
		case 'if': {
			const conditions = (Array.isArray(b.conditions) ? b.conditions : []).slice(0, 10).map(c => condition(c, optionNames));
			if (!conditions.length) throw new ValidationError('Un bloc « Si » a besoin d’au moins une condition.');
			return { type: 'if', match: oneOf(b.match, ['all', 'any'], 'all'), conditions, then: blocks(b.then, ctx, depth + 1), else: blocks(b.else, ctx, depth + 1) };
		}
		case 'reply': return { type: 'reply', ...message(b, 'Réponse'), ephemeral: Boolean(b.ephemeral), components: (b.components ?? []).filter(id => componentIds.has(id)).slice(0, 5) };
		case 'send': return { type: 'send', channelId: b.channelId === 'current' || !b.channelId ? 'current' : (SNOWFLAKE.test(b.channelId) ? b.channelId : 'current'), ...message(b, 'Message'), components: (b.components ?? []).filter(id => componentIds.has(id)).slice(0, 5) };
		case 'dm': return { type: 'dm', target: target(b.target, optionNames), ...message(b, 'MP') };
		case 'role': {
			const roleIds = ids(b.roleIds, 10);
			if (!roleIds.length) throw new ValidationError('Bloc rôle : choisis au moins un rôle.');
			return { type: 'role', mode: oneOf(b.mode, ['add', 'remove', 'toggle'], 'add'), target: target(b.target, optionNames), roleIds, durationMinutes: b.durationMinutes ? int(b.durationMinutes, 1, 525_600, 'Durée du rôle (minutes)') : null };
		}
		case 'nickname': return { type: 'nickname', target: target(b.target, optionNames), value: text(b.value, 32, 'Pseudo') };
		case 'sanction': {
			const t = target(b.target, optionNames);
			if (t === 'invoker') throw new ValidationError('Bloc sanction : la cible doit être une option membre.');
			const kind = oneOf(b.kind, ['warn', 'timeout'], 'warn');
			return { type: 'sanction', kind, target: t, reason: text(b.reason, 500, 'Raison', { required: true }), durationMinutes: kind === 'timeout' ? int(b.durationMinutes ?? 10, 1, 40_320, 'Durée du timeout (minutes)') : null };
		}
		case 'react': return { type: 'react', emoji: text(b.emoji, 64, 'Émoji', { required: true }).trim() };
		case 'wait': return { type: 'wait', seconds: int(b.seconds ?? 1, 1, 30, 'Attente (secondes)') };
		case 'counter': return { type: 'counter', key: counterKey(b.key), perUser: Boolean(b.perUser), op: oneOf(b.op, ['add', 'set', 'reset'], 'add'), value: int(b.value ?? 1, -1e9, 1e9, 'Compteur : valeur') };
		case 'log': return { type: 'log', content: text(b.content, 1000, 'Log', { required: true }) };
		case 'deleteTrigger': return { type: 'deleteTrigger' };
		case 'stop': return { type: 'stop' };
		default: throw new ValidationError('Type de bloc inconnu.');
		}
	});
}

// Walks every block (and nested branches), components included
export function everyBlock(def, fn) {
	const walk = (list) => {
		for (const b of list ?? []) {
			fn(b);
			if (b.type === 'if') {
				walk(b.then);
				walk(b.else);
			}
		}
	};
	walk(def.flow);
	for (const c of def.components ?? []) walk(c.flow);
}

export function normalizeCommand(input = {}, { reservedNames = new Set() } = {}) {
	const trigger = { type: oneOf(input.trigger?.type, TRIGGERS, 'slash') };
	let name = String(input.name ?? '').trim();
	if (trigger.type === 'slash') {
		name = name.toLowerCase();
		if (!SLASH_NAME.test(name)) throw new ValidationError('Nom de commande slash : 1 à 32 caractères, minuscules, chiffres, - ou _, sans espace.');
		if (reservedNames.has(name)) throw new ValidationError(`/${name} existe déjà dans le bot : choisis un autre nom.`);
	}
	else if (!name || name.length > 32) {
		throw new ValidationError('Nom : 1 à 32 caractères.');
	}
	if (trigger.type === 'keyword') {
		const k = input.trigger?.keyword ?? {};
		const patterns = [...new Set((Array.isArray(k.patterns) ? k.patterns : []).map(p => String(p).trim()).filter(Boolean))].slice(0, 10);
		if (!patterns.length) throw new ValidationError('Mot-clé : ajoute au moins un mot ou une phrase.');
		const mode = oneOf(k.mode, ['contains', 'startsWith', 'exact', 'regex'], 'contains');
		for (const p of patterns) {
			if (p.length > 100) throw new ValidationError('Mot-clé : 100 caractères au maximum.');
			if (mode === 'regex') {
				try {
					new RegExp(p, 'iu');
				}
				catch {
					throw new ValidationError(`Expression régulière invalide : ${p}`);
				}
				// Nested repetitions like (a+)+ and back-references like \1 can freeze the bot on a crafted message
				if (/\([^)]*[+*][^)]*\)\s*[+*{]/.test(p) || /\\[1-9]/.test(p)) throw new ValidationError(`Expression régulière trop risquée (répétitions imbriquées) : ${p}`);
			}
		}
		trigger.keyword = { mode, patterns, caseSensitive: Boolean(k.caseSensitive), channelIds: ids(k.channelIds) };
	}

	// Options: slash only, required ones first (Discord's rule)
	const options = trigger.type !== 'slash' ? [] : (Array.isArray(input.options) ? input.options : []).slice(0, 10).map((o) => {
		const optName = String(o?.name ?? '').trim().toLowerCase();
		if (!SLASH_NAME.test(optName)) throw new ValidationError(`Nom d’option invalide : « ${o?.name ?? ''} ».`);
		const type = oneOf(o.type, OPTION_TYPES, 'string');
		const opt = { name: optName, description: text(o.description || optName, 100, 'Description d’option'), type, required: Boolean(o.required) };
		if (['string', 'integer', 'number'].includes(type)) {
			opt.choices = (Array.isArray(o.choices) ? o.choices : []).slice(0, 25).map(c => ({ name: text(c?.name, 100, 'Choix', { required: true }), value: text(c?.value ?? c?.name, 100, 'Valeur du choix') })).filter(c => c.name.trim());
		}
		if (type === 'integer' || type === 'number') {
			if (o.min !== undefined && o.min !== null && o.min !== '') opt.min = Number(o.min);
			if (o.max !== undefined && o.max !== null && o.max !== '') opt.max = Number(o.max);
		}
		if (type === 'string' && o.maxLength) opt.maxLength = int(o.maxLength, 1, 1000, 'Longueur max');
		return opt;
	}).sort((a, b) => Number(b.required) - Number(a.required));
	if (new Set(options.map(o => o.name)).size !== options.length) throw new ValidationError('Deux options ont le même nom.');
	const optionNames = new Set(options.map(o => o.name));
	// Right click on a member gives a "target" member option to the flow
	if (trigger.type === 'user') optionNames.add('cible');
	if (trigger.type === 'message') {
		optionNames.add('auteur');
		optionNames.add('contenu');
	}
	// A keyword command can test the whole message
	if (trigger.type === 'keyword') optionNames.add('message');

	const scope = input.scope?.mode === 'guilds'
		? { mode: 'guilds', guildIds: ids(input.scope.guildIds, 50) }
		: { mode: 'network', guildIds: [] };
	if (scope.mode === 'guilds' && !scope.guildIds.length) throw new ValidationError('Choisis au moins un serveur, ou « tout le réseau ».');

	const a = input.access ?? {};
	const access = {
		rankIds: [...new Set((Array.isArray(a.rankIds) ? a.rankIds : []).map(Number).filter(Number.isInteger))].slice(0, 20),
		roleIds: ids(a.roleIds, 50),
		denyRoleIds: ids(a.denyRoleIds, 50),
		permission: a.permission && DISCORD_PERMISSIONS.includes(a.permission) ? a.permission : null,
		channelIds: ids(a.channelIds, 50),
		deniedMessage: text(a.deniedMessage, 200, 'Message de refus'),
	};
	const cooldown = { seconds: int(input.cooldown?.seconds ?? 0, 0, 86_400, 'Délai'), scope: oneOf(input.cooldown?.scope, ['user', 'guild'], 'user') };

	// Buttons and menus: each has its own flow, published by a reply / send block
	const rawComponents = (Array.isArray(input.components) ? input.components : []).slice(0, 10);
	const componentIds = new Set(rawComponents.map(c => String(c?.id ?? '')).filter(id => /^[a-z0-9]{1,12}$/.test(id)));
	const ctx = { count: 0, optionNames, componentIds };
	const components = rawComponents.filter(c => componentIds.has(String(c?.id))).map((c) => {
		const kind = oneOf(c.kind, ['button', 'select'], 'button');
		const base = { id: String(c.id), kind, flow: [] };
		if (kind === 'button') {Object.assign(base, { label: text(c.label, 80, 'Texte du bouton', { required: true }), style: oneOf(c.style, ['primary', 'secondary', 'success', 'danger'], 'primary'), emoji: text(c.emoji, 64, 'Émoji').trim() || null });}
		else {
			const choices = (Array.isArray(c.options) ? c.options : []).slice(0, 25).map(o => ({ label: text(o?.label, 100, 'Choix du menu', { required: true }), value: text(o?.value || o?.label, 100, 'Valeur'), description: text(o?.description, 100, 'Description') }));
			if (!choices.length) throw new ValidationError('Menu : ajoute au moins un choix.');
			Object.assign(base, { placeholder: text(c.placeholder, 150, 'Texte du menu'), options: choices });
		}
		return base;
	});
	// A menu's flow can test the chosen value with the "choix" option
	const componentOptionNames = new Set([...optionNames, 'choix']);
	for (const [i, c] of components.entries()) components[i].flow = blocks(rawComponents.find(r => String(r.id) === c.id)?.flow, { ...ctx, optionNames: componentOptionNames });
	const flow = blocks(input.flow, ctx);
	if (!flow.length) throw new ValidationError('Le déroulé est vide : ajoute au moins une action.');

	return {
		name,
		description: trigger.type === 'slash' ? text(input.description || 'Commande personnalisée', 100, 'Description', { required: true }) : '',
		trigger, options, scope, access, cooldown, components, flow,
	};
}

// Blocks that need extra rights to be written
export function sensitiveBlocks(def) {
	const found = [];
	everyBlock(def, (b) => {
		if (SENSITIVE_ACTIONS.has(b.type)) found.push(b);
	});
	return found;
}
