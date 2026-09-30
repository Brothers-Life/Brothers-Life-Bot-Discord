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
		// guildId -> [{ id, name, editable, dangerous }]
		roles: new Map(),
		async listRoles(guildId) {
			return this.roles.get(guildId) ?? [];
		},
		// guildId -> [{ id, username, globalName, nickname }]
		guildMembers: new Map(),
		async searchMembers(guildId, query, limit) {
			const q = query.toLowerCase();
			return (this.guildMembers.get(guildId) ?? [])
				.filter(m => [m.username, m.globalName, m.nickname].some(n => n?.toLowerCase().startsWith(q)))
				.slice(0, limit)
				.map(m => ({ avatar: null, globalName: null, nickname: null, ...m }));
		},
		async getMemberInfo(guildId, userId) {
			const roles = memberRoles.get(`${guildId}:${userId}`);
			if (!roles) return null;
			const known = this.roles.get(guildId) ?? [];
			return { nickname: null, joinedAt: 0, timeoutUntil: null, roles: roles.map(id => ({ id, name: known.find(r => r.id === id)?.name ?? id, color: '#000000', editable: true })) };
		},
		async setNickname(guildId, userId, nickname) {
			this.calls.push(['nickname', guildId, userId, nickname]);
		},
		async addRole(guildId, userId, roleId) {
			const key = `${guildId}:${userId}`;
			memberRoles.set(key, [...(memberRoles.get(key) ?? []), roleId]);
			this.calls.push(['addRole', guildId, userId, roleId]);
		},
		async removeRole(guildId, userId, roleId) {
			const key = `${guildId}:${userId}`;
			memberRoles.set(key, (memberRoles.get(key) ?? []).filter(r => r !== roleId));
			this.calls.push(['removeRole', guildId, userId, roleId]);
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
		// invite code -> guildId
		invites: new Map(),
		async resolveInvite(code) {
			return this.invites.get(code) ?? null;
		},
		// Tickets
		ticketChannels: new Map(),
		async createTicketChannel(options) {
			const id = String(700000000000000000n + BigInt(this.ticketChannels.size + 1));
			this.ticketChannels.set(id, { ...options, members: [options.openerId], messages: [] });
			return id;
		},
		async sendTicketWelcome(channelId) {
			this.ticketChannels.get(channelId).messages.push('welcome');
		},
		// `${guildId}:${roleId}` -> { name, permissions, editable }
		rolePermissions: new Map(),
		async getRolePermissions(guildId, roleId) {
			return this.rolePermissions.get(`${guildId}:${roleId}`) ?? null;
		},
		async setRolePermissions(guildId, roleId, permissions) {
			this.guard(guildId);
			const role = this.rolePermissions.get(`${guildId}:${roleId}`);
			this.rolePermissions.set(`${guildId}:${roleId}`, { ...role, permissions: [...permissions] });
			this.calls.push(['setPermissions', guildId, roleId]);
		},
		async listCategoryChannels() {
			return [];
		},
		async publishTicketPanel(channelId, messageId) {
			this.calls.push(['panel', channelId, messageId]);
			return messageId ?? '600000000000000001';
		},
		async addChannelMember(channelId, userId) {
			this.ticketChannels.get(channelId).members.push(userId);
		},
		async fetchTranscript() {
			return '[10:00] alice: bonjour';
		},
		async deleteChannel(channelId) {
			this.ticketChannels.delete(channelId);
		},
		async deleteMessage(channelId, messageId) {
			this.deleted.push([channelId, messageId]);
		},
		async sendDM(userId, content, files) {
			this.dms.push([userId, content, files]);
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
