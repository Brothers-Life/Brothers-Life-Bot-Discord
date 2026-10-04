import { definePermission } from './permissions.js';
import { ForbiddenError, ValidationError } from './errors.js';
import { parseRichText } from './richText.js';

definePermission('public.manage', { label: 'Configurer la page publique (sans connexion)', category: 'Page publique' });

const SETTINGS_KEY = 'public.page';
// The public view is rebuilt at most this often, whatever the traffic
export const CACHE_MS = 30_000;
const SNOWFLAKE = /^\d{17,20}$/;
const HTTP_URL = /^https?:\/\/[^\s<>"']{3,490}$/i;
const MAX_STAFF_PER_RANK = 60;

export const DEFAULT_PUBLIC_PAGE = {
	enabled: false,
	title: 'Brothers Life',
	tagline: '',
	status: { enabled: true, serverIds: [], showPlayerNames: false },
	maintenance: { enabled: true },
	staff: { enabled: false, rankIds: [] },
	rules: { enabled: false, text: '' },
	discord: { enabled: true, guildIds: [] },
	events: { enabled: true, limit: 6 },
	recruitment: { enabled: false },
	links: { enabled: true, discordInvite: '', shop: '', items: [] },
};

function text(value, max, fallback = '') {
	return String(value ?? fallback).trim().slice(0, max);
}

function url(value, label) {
	const clean = String(value ?? '').trim();
	if (!clean) return '';
	if (!HTTP_URL.test(clean)) throw new ValidationError(`${label} : adresse http(s) attendue.`);
	return clean;
}

const ids = (list, test) => [...new Set((Array.isArray(list) ? list : []).filter(test).map(x => (typeof x === 'string' ? x : Number(x))))].slice(0, 50);

// Settings as stored; throws on an invalid link (only when `strict`, i.e. when saving)
export function normalizePublicPage(input = {}, { strict = false } = {}) {
	const d = DEFAULT_PUBLIC_PAGE;
	const s = (key) => ({ ...d[key], ...(input[key] && typeof input[key] === 'object' ? input[key] : {}) });
	const link = (value, label) => {
		try {
			return url(value, label);
		}
		catch (error) {
			if (strict) throw error;
			return '';
		}
	};
	const status = s('status');
	const staff = s('staff');
	const rules = s('rules');
	const discord = s('discord');
	const events = s('events');
	const links = s('links');
	return {
		enabled: Boolean(input.enabled),
		title: text(input.title, 60, d.title) || d.title,
		tagline: text(input.tagline, 200),
		status: { enabled: Boolean(status.enabled), serverIds: ids(status.serverIds, x => Number.isInteger(Number(x)) && Number(x) > 0).map(Number), showPlayerNames: Boolean(status.showPlayerNames) },
		maintenance: { enabled: Boolean(s('maintenance').enabled) },
		staff: { enabled: Boolean(staff.enabled), rankIds: ids(staff.rankIds, x => Number.isInteger(Number(x)) && Number(x) > 0).map(Number) },
		rules: { enabled: Boolean(rules.enabled), text: String(rules.text ?? '').slice(0, 20_000) },
		discord: { enabled: Boolean(discord.enabled), guildIds: ids(discord.guildIds, x => SNOWFLAKE.test(String(x))).map(String) },
		events: { enabled: Boolean(events.enabled), limit: Math.min(Math.max(Number.parseInt(events.limit, 10) || d.events.limit, 1), 20) },
		recruitment: { enabled: Boolean(s('recruitment').enabled) },
		links: {
			enabled: Boolean(links.enabled),
			discordInvite: link(links.discordInvite, 'Invitation Discord'),
			shop: link(links.shop, 'Boutique'),
			items: (Array.isArray(links.items) ? links.items : []).slice(0, 12)
				.filter(item => text(item?.label, 40))
				.map(item => ({ label: text(item.label, 40), url: link(item.url, `Lien « ${text(item.label, 40)} »`) }))
				.filter(item => item.url),
		},
	};
}

// Public page (no login): what visitors may see of the server. Every block is chosen field by field:
// no Discord or FiveM identifier, no sanction, no personal data of the FiveM database.
export function createPublicPage({ settings, audit, network, ranks, executor, fivem, rpEvents, recruitment, maintenance = () => null, logger = console, now = Date.now }) {
	let cache = null;

	const config = () => normalizePublicPage(settings.get(SETTINGS_KEY, {}));

	async function serverStatus(cfg) {
		const all = fivem.list();
		const chosen = cfg.serverIds.length ? all.filter(s => cfg.serverIds.includes(s.id)) : all;
		return chosen.map((s) => {
			const st = s.status;
			return {
				name: s.name,
				online: Boolean(st?.online),
				players: st?.online ? st.players : 0,
				max: st?.max ?? 0,
				onlineSince: st?.online ? st.onlineSince ?? null : null,
				checkedAt: st?.checkedAt ?? null,
				// The cfx.re join link is public by nature; the server address is not shown
				joinUrl: s.joinCode ? `https://cfx.re/join/${s.joinCode}` : null,
				...(cfg.showPlayerNames && st?.online ? { playerNames: (st.list ?? []).map(p => String(p.name).slice(0, 64)) } : {}),
			};
		});
	}

	function maintenanceState() {
		const state = maintenance();
		if (!state || typeof state !== 'object') return null;
		const m = state.maintenance ?? {};
		const next = state.nextRestart?.at;
		return {
			maintenance: { active: Boolean(m.active), reason: m.active && m.reason ? String(m.reason).slice(0, 300) : null, since: m.active && Number.isFinite(m.since) ? m.since : null },
			nextRestart: Number.isFinite(next) && next > now() ? { at: next } : null,
		};
	}

	async function staffTeam(cfg) {
		const mainId = network.getMainId();
		const shown = ranks.list().filter(r => cfg.rankIds.includes(r.id)).sort((a, b) => b.level - a.level);
		if (!shown.length) return [];
		const direct = ranks.listDirectAssignments();
		const placed = new Set();
		const out = [];
		for (const rank of shown) {
			const roleIds = rank.roles.filter(r => r.guildId === mainId).map(r => r.roleId);
			const people = new Map();
			if (mainId && roleIds.length) {
				for (const m of await executor.listMembersWithAnyRole(mainId, roleIds).catch(() => [])) {
					people.set(m.id, { name: m.globalName ?? m.username, avatar: m.avatar ?? null });
				}
			}
			for (const a of direct.filter(x => x.rankId === rank.id && !people.has(x.discordId))) {
				const user = await executor.getUser(a.discordId).catch(() => null);
				if (user) people.set(a.discordId, { name: user.globalName ?? user.username, avatar: user.avatar ?? null });
			}
			// Someone with several shown ranks only appears under the highest one
			const members = [...people].filter(([id]) => !placed.has(id)).slice(0, MAX_STAFF_PER_RANK);
			for (const [id] of members) placed.add(id);
			out.push({
				name: rank.name,
				color: rank.color,
				members: members.map(([, p]) => ({ name: String(p.name ?? '?').slice(0, 64), avatar: typeof p.avatar === 'string' && p.avatar.startsWith('https://') ? p.avatar : null }))
					.sort((a, b) => a.name.localeCompare(b.name, 'fr')),
			});
		}
		return out.filter(r => r.members.length);
	}

	async function discordGuilds(cfg) {
		const active = network.list().filter(g => g.status === 'active' && g.botPresent);
		const chosen = cfg.guildIds.length ? active.filter(g => cfg.guildIds.includes(g.id)) : active;
		const guilds = await Promise.all(chosen.map(async (g) => {
			const info = await executor.getGuildInfo(g.id).catch(() => null);
			if (!info) return null;
			return { name: info.name ?? g.name, icon: info.iconUrl ?? null, members: Number(info.memberCount) || 0, isMain: g.isMain };
		}));
		const list = guilds.filter(Boolean);
		return { guilds: list, total: list.reduce((n, g) => n + g.members, 0) };
	}

	function upcomingEvents(cfg) {
		return rpEvents.upcoming()
			.filter(e => (e.endsAt ?? e.startsAt) > now())
			.slice(0, cfg.limit)
			.map(e => ({
				title: e.title,
				description: e.description ? String(e.description).slice(0, 400) : null,
				location: e.location ?? null,
				startsAt: e.startsAt,
				endsAt: e.endsAt ?? null,
				live: e.status === 'live',
				// Uploaded pictures are served to the panel only; a public https picture is kept
				image: typeof e.image === 'string' && /^https:\/\//.test(e.image) ? e.image : null,
				going: e.counts?.going ?? 0,
				capacity: e.capacity ?? null,
			}));
	}

	function openPositions() {
		const out = [];
		for (const g of network.list().filter(x => x.status === 'active')) {
			for (const p of recruitment.positions(g.id)) {
				if (!p.config.open || (p.config.closesAt && p.config.closesAt <= now())) continue;
				out.push({
					name: p.name,
					description: p.description ? String(p.description).slice(0, 300) : null,
					server: g.name,
					closesAt: p.config.closesAt ?? null,
					// Opens the channel of the application panel in Discord
					url: p.panelChannelId ? `https://discord.com/channels/${g.id}/${p.panelChannelId}` : null,
				});
			}
		}
		return out;
	}

	async function section(label, fn) {
		try {
			return await fn();
		}
		catch (error) {
			logger.warn?.(`Public page: ${label} failed:`, error?.message);
			return null;
		}
	}

	async function build() {
		const cfg = config();
		const view = { title: cfg.title, tagline: cfg.tagline || null, generatedAt: now() };
		if (cfg.status.enabled) view.status = await section('status', () => serverStatus(cfg.status));
		if (cfg.maintenance.enabled) view.maintenance = await section('maintenance', maintenanceState);
		if (cfg.staff.enabled) view.staff = await section('staff', () => staffTeam(cfg.staff));
		if (cfg.rules.enabled && cfg.rules.text.trim()) view.rules = parseRichText(cfg.rules.text);
		if (cfg.discord.enabled) view.discord = await section('discord', () => discordGuilds(cfg.discord));
		if (cfg.events.enabled) view.events = await section('events', () => upcomingEvents(cfg.events));
		if (cfg.recruitment.enabled) view.recruitment = await section('recruitment', openPositions);
		if (cfg.links.enabled) {
			const { discordInvite, shop, items } = cfg.links;
			if (discordInvite || shop || items.length) view.links = { discordInvite: discordInvite || null, shop: shop || null, items };
		}
		return view;
	}

	return {
		enabled: () => config().enabled,
		config,

		save(actor, input) {
			if (!actor.can('public.manage')) throw new ForbiddenError('Permission manquante : public.manage');
			const next = normalizePublicPage(input, { strict: true });
			settings.set(SETTINGS_KEY, next);
			cache = null;
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'publicpage.settings', details: { active: next.enabled ? 'oui' : 'non' } });
			return next;
		},

		// What the public endpoint sends; null when the page is off
		async view() {
			if (!config().enabled) return null;
			if (cache && now() - cache.at < CACHE_MS) return cache.promise;
			const promise = build();
			cache = { at: now(), promise };
			promise.catch(() => {
				cache = null;
			});
			return promise;
		},
	};
}
