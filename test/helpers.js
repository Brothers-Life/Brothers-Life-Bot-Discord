import { openDb } from '../src/db/index.js';
import { createCore } from '../src/core/context.js';
import { parseConfig } from '../src/utils/config.js';

export const OWNER = '100000000000000001';
export const ALICE = '100000000000000002';
export const BOB = '100000000000000003';
export const MAIN = '900000000000000001';
export const OTHER = '900000000000000002';

// In-memory stand-in for src/bot/executor.js
export function createFakeExecutor() {
	const sent = [];
	// channelId -> { guildId, name }
	const channels = new Map();
	// `${guildId}:${userId}` -> roleIds
	const memberRoles = new Map();
	// channelId -> Discord error code thrown when sending there
	const failures = new Map();
	const users = new Map();

	return {
		sent,
		channels,
		memberRoles,
		failures,
		users,
		async sendLog(channelId, message) {
			if (failures.has(channelId)) {
				const error = new Error('Discord error');
				error.code = failures.get(channelId);
				throw error;
			}
			sent.push({ channelId, message });
		},
		async getTextChannel(guildId, channelId) {
			const channel = channels.get(channelId);
			return channel && channel.guildId === guildId ? { id: channelId, ...channel } : null;
		},
		async listTextChannels(guildId) {
			return [...channels].filter(([, c]) => c.guildId === guildId).map(([id, c]) => ({ id, parent: null, canSend: true, ...c }));
		},
		async listRoles() {
			return [];
		},
		async getMemberRoleIds(guildId, userId) {
			return memberRoles.get(`${guildId}:${userId}`) ?? null;
		},
		async listMembersWithAnyRole(guildId, roleIds) {
			const wanted = new Set(roleIds);
			return [...memberRoles]
				.filter(([key, roles]) => key.startsWith(`${guildId}:`) && roles.some(r => wanted.has(r)))
				.map(([key, roles]) => ({ id: key.split(':')[1], username: `user-${key.slice(-4)}`, globalName: null, avatar: null, roleIds: roles.filter(r => wanted.has(r)) }));
		},
		guildIcon() {
			return null;
		},
		// Moderation: records calls, `members` decides who is on which server, `failOn` makes a server fail
		calls: [],
		dms: [],
		members: new Map(),
		bans: new Map(),
		failOn: new Set(),
		async ban(guildId, userId, options) {
			this.guard(guildId);
			this.calls.push(['ban', guildId, userId, options?.reason]);
		},
		async unban(guildId, userId) {
			this.guard(guildId);
			this.calls.push(['unban', guildId, userId]);
		},
		async kick(guildId, userId) {
			this.guard(guildId);
			if (!this.members.get(guildId)?.has(userId)) return 'not_member';
			this.calls.push(['kick', guildId, userId]);
		},
		async timeout(guildId, userId, ms) {
			this.guard(guildId);
			if (!this.members.get(guildId)?.has(userId)) return 'not_member';
			this.calls.push(['timeout', guildId, userId, ms]);
		},
		async fetchBans(guildId) {
			return this.bans.get(guildId) ?? [];
		},
		deleted: [],
		async deleteMessage(channelId, messageId) {
			this.deleted.push([channelId, messageId]);
		},
		async sendDM(userId, content) {
			this.dms.push([userId, content]);
		},
		guard(guildId) {
			if (this.failOn.has(guildId)) {
				const error = new Error('Missing Permissions');
				error.code = 50013;
				throw error;
			}
		},
		async getUser(userId) {
			return users.get(userId) ?? { id: userId, username: `user-${userId.slice(-4)}`, avatar: null };
		},
		status() {
			return { ready: true, ping: 42, guilds: 2, user: { id: '1', username: 'bot' } };
		},
	};
}

export function createTestCore(overrides = {}) {
	const db = openDb(':memory:');
	const executor = createFakeExecutor();
	const config = { ...parseConfig({ OWNER_ID: OWNER }), ...overrides };
	const noop = () => undefined;
	const silent = { info: noop, warn: noop, error: noop, debug: noop, success: noop };
	const core = createCore({ db, config, executor, logger: silent });
	return { core, executor, db };
}

// Owner principal, main server set up with MAIN (+ OTHER pending)
export async function withNetwork() {
	const ctx = createTestCore();
	const { core } = ctx;
	core.network.upsertSeen({ id: MAIN, name: 'Main' });
	core.network.upsertSeen({ id: OTHER, name: 'Other' });
	const owner = await core.ranks.resolve(OWNER);
	core.network.setMain(owner, MAIN);
	return { ...ctx, owner };
}
