import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
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
		async listMembers(guildId) {
			return (this.guildMembers.get(guildId) ?? []).map(m => ({ avatar: null, globalName: null, nickname: null, bot: false, joinedAt: 0, ...m }));
		},
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
		announcements: [],
		async sendAnnouncement(channelId, payload, target, options = {}) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			this.announcements.push({ channelId, payload, target, options });
			return String(650000000000000000n + BigInt(this.announcements.length));
		},
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
		async sendTicketWelcome(channelId, data) {
			this.ticketChannels.get(channelId).messages.push('welcome');
			this.ticketChannels.get(channelId).welcome = data;
		},
		async updateTicketChannel(channelId, edit) {
			const channel = this.ticketChannels.get(channelId);
			if (channel) Object.assign(channel, edit.name ? { name: edit.name } : {}, edit.parentId ? { parentId: edit.parentId } : {});
			this.calls.push(['updateTicket', channelId, edit]);
		},
		async setTicketWriters(channelId, data) {
			this.calls.push(['writers', channelId, data.claimerId]);
		},
		async removeChannelMember(channelId, userId) {
			const channel = this.ticketChannels.get(channelId);
			if (channel) channel.members = channel.members.filter(m => m !== userId);
		},
		notices: [],
		async sendTicketNotice(channelId, data) {
			this.notices.push({ channelId, kind: data.kind });
		},
		ratings: [],
		async sendTicketRating(userId, ticket) {
			this.ratings.push([userId, ticket.id]);
		},
		replies: [],
		async sendTicketReply(channelId, data) {
			this.replies.push({ channelId, ...data });
			return String(660000000000000000n + BigInt(this.replies.length));
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
		async publishTicketPanel(channelId, messageId, panel) {
			this.lastPanel = panel;
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
		// Moderation commands
		async purgeMessages(channelId, options) {
			this.calls.push(['purge', channelId, options]);
			return Math.min(options.count, 42);
		},
		async setChannelLocked(channelId, locked) {
			this.calls.push([locked ? 'lock' : 'unlock', channelId]);
		},
		async lockGuild(guildId) {
			this.calls.push(['lockGuild', guildId]);
			return ['610000000000000001', '610000000000000002'];
		},
		async unlockChannels(channelIds) {
			this.calls.push(['unlockChannels', channelIds]);
		},
		async setSlowmode(channelId, seconds) {
			this.calls.push(['slowmode', channelId, seconds]);
		},
		inVoice: new Set(),
		async voiceDisconnect(guildId, userId) {
			if (!this.inVoice.has(userId)) return 'not_in_voice';
			this.calls.push(['voiceDisconnect', guildId, userId]);
		},
		async voiceMove(guildId, userId, channelId) {
			if (!this.inVoice.has(userId)) return 'not_in_voice';
			this.calls.push(['voiceMove', guildId, userId, channelId]);
		},
		async voiceMute(guildId, userId, muted) {
			if (!this.inVoice.has(userId)) return 'not_in_voice';
			this.calls.push(['voiceMute', guildId, userId, muted]);
		},
		topRolePositions: new Map(),
		async getMemberTopRolePosition(guildId, userId) {
			return this.topRolePositions.get(`${guildId}:${userId}`) ?? null;
		},
		// `${guildId}:${name}` -> roleId of restriction roles created
		restrictionRoles: new Map(),
		async ensureRestrictionRole(guildId, { roleId, name }) {
			this.guard(guildId);
			if (roleId) return roleId;
			const id = String(880000000000000000n + BigInt(this.restrictionRoles.size + 1));
			this.restrictionRoles.set(`${guildId}:${name}`, id);
			return id;
		},
		async applyRestrictionOverwrites(channelId, entries) {
			this.calls.push(['restrictChannel', channelId, entries.length]);
		},
		// Messages from the panel (welcome, leave, boost...)
		messages: [],
		async sendMessage(channelId, data) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			this.messages.push({ channelId, ...data });
			return String(670000000000000000n + BigInt(this.messages.length));
		},
		dmPayloads: [],
		async sendDMPayload(userId, payload) {
			this.dmPayloads.push({ userId, payload });
		},
		guildInfo: new Map(),
		async getGuildInfo(guildId) {
			return this.guildInfo.get(guildId) ?? { id: guildId, name: 'Serveur', iconUrl: null, memberCount: 100, boosts: 3, tier: 1 };
		},
		async publishRules(channelId, messageId, data) {
			this.calls.push(['rules', channelId, messageId, data.button?.label ?? null]);
			return messageId ?? '680000000000000001';
		},
		guildCounts: new Map(),
		async getGuildCounts(guildId) {
			return this.guildCounts.get(guildId) ?? { members: 120, humans: 110, bots: 10, voice: 4, boosts: 3 };
		},
		createdCounters: [],
		async createCounterChannel(guildId, { name }) {
			const id = String(690000000000000000n + BigInt(this.createdCounters.length + 1));
			this.createdCounters.push({ guildId, id, name });
			return id;
		},
		renamed: [],
		async renameChannel(channelId, name) {
			this.renamed.push([channelId, name]);
		},
		async listVoiceChannels() {
			return [];
		},
		// Personal voice channels: channelId -> { guildId, parentId, members: [], state }
		voiceChannels: new Map(),
		async createHubChannel(guildId, { name }) {
			const id = String(710000000000000000n + BigInt(this.voiceChannels.size + 1));
			this.voiceChannels.set(id, { guildId, name, parentId: null, members: [] });
			return id;
		},
		async parentOf(channelId) {
			return this.voiceChannels.get(channelId)?.parentId ?? null;
		},
		async createVoiceRoom(guildId, options) {
			const id = String(720000000000000000n + BigInt(this.voiceChannels.size + 1));
			this.voiceChannels.set(id, { guildId, name: options.name, parentId: options.parentId, members: [], state: options });
			return id;
		},
		async applyVoiceRoom(channelId, state) {
			const channel = this.voiceChannels.get(channelId);
			if (channel) channel.state = state;
		},
		async voiceChannelMembers(channelId) {
			return this.voiceChannels.get(channelId)?.members ?? null;
		},
		roomPanels: [],
		async sendRoomPanel(channelId, data) {
			this.roomPanels.push({ channelId, ...data });
		},
		// Messages edited in place: channelId -> Map(messageId -> payload)
		posted: new Map(),
		async upsertMessage(channelId, messageId, payload) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			const messages = this.posted.get(channelId) ?? new Map();
			this.posted.set(channelId, messages);
			const id = messageId && messages.has(messageId) ? messageId : String(730000000000000000n + BigInt(this.calls.length + messages.size + 1));
			messages.set(id, payload);
			this.calls.push(['upsert', channelId, id]);
			return id;
		},
		polls: [],
		async upsertPollMessage(channelId, messageId, data) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			this.polls.push({ channelId, messageId, data });
			return messageId ?? String(740000000000000000n + BigInt(this.polls.length));
		},
		pollResults: [],
		async sendPollResults(channelId, messageId, data) {
			this.pollResults.push({ channelId, messageId, data });
		},
		giveawayMessages: [],
		async upsertGiveawayMessage(channelId, messageId, data) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			this.giveawayMessages.push({ channelId, messageId, data });
			return messageId ?? String(750000000000000000n + BigInt(this.giveawayMessages.length));
		},
		winnerAnnouncements: [],
		async announceGiveawayWinners(channelId, messageId, data) {
			this.winnerAnnouncements.push({ channelId, messageId, userIds: data.userIds, text: data.text });
		},
		feedbackMessages: [],
		async upsertFeedbackMessage(channelId, messageId, view, options = {}) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			this.feedbackMessages.push({ channelId, messageId, status: view.status.key, up: view.item.up, pingRoleIds: options.pingRoleIds ?? [] });
			return { messageId: messageId ?? String(760000000000000000n + BigInt(this.feedbackMessages.length)), threadId: options.thread ? '770000000000000001' : null };
		},
		reviews: [],
		async sendFeedbackReview(channelId, view) {
			this.reviews.push({ channelId, itemId: view.item.id });
			return String(780000000000000000n + BigInt(this.reviews.length));
		},
		async publishFeedbackPanel(channelId, messageId) {
			return messageId ?? '790000000000000001';
		},
		lockedThreads: [],
		async lockThread(threadId) {
			this.lockedThreads.push(threadId);
		},
		// Server templates: guildId -> { id, name, community, botRolePosition, roles, channels, settings }
		guildModels: new Map(),
		nextModelId: 870000000000000000n,
		model(guildId) {
			const m = this.guildModels.get(guildId);
			if (!m) throw new Error('Unknown guild');
			return m;
		},
		async snapshotMemberRoles(guildId) {
			return [...memberRoles].filter(([key, roles]) => key.startsWith(`${guildId}:`) && roles.length).map(([key, roles]) => ({ id: key.split(':')[1], roleIds: [...roles] }));
		},
		async snapshotGuild(guildId) {
			return structuredClone(this.model(guildId));
		},
		async createRole(guildId, data) {
			const m = this.model(guildId);
			if (this.failOn.has(`role:${data.name}`)) throw new Error('Missing Permissions');
			const id = String(this.nextModelId++);
			m.roles.push({ ...data, id, position: m.roles.length, managed: false, everyone: false });
			return id;
		},
		async editRole(guildId, roleId, data) {
			const r = this.model(guildId).roles.find(x => x.id === roleId);
			if (!r) throw new Error('rôle introuvable');
			Object.assign(r, data, r.everyone ? { name: '@everyone' } : {});
		},
		async deleteRole(guildId, roleId) {
			const m = this.model(guildId);
			m.roles = m.roles.filter(r => r.id !== roleId);
		},
		async setRolePositions(guildId, roleIds) {
			const m = this.model(guildId);
			roleIds.forEach((id, i) => {
				const r = m.roles.find(x => x.id === id);
				if (r) r.position = i + 1;
			});
		},
		async createChannel(guildId, data) {
			const m = this.model(guildId);
			const id = String(this.nextModelId++);
			m.channels.push({ id, type: data.type, name: data.name, parentId: data.parentId, position: m.channels.length, topic: data.topic ?? null, overwrites: data.overwrites.map(o => ({ ...o, type: 'role' })) });
			this.channels.set(id, { guildId, name: data.name });
			return id;
		},
		async editChannel(guildId, channelId, data) {
			const c = this.model(guildId).channels.find(x => x.id === channelId);
			if (!c) throw new Error('salon introuvable');
			Object.assign(c, { name: data.name, parentId: data.parentId, topic: data.topic ?? null, overwrites: data.overwrites.map(o => ({ ...o, type: 'role' })) });
		},
		async removeTemplateChannel(guildId, channelId) {
			const m = this.model(guildId);
			m.channels = m.channels.filter(c => c.id !== channelId);
			this.channels.delete(channelId);
		},
		async editGuildSettings(guildId, settings) {
			Object.assign(this.model(guildId).settings, settings);
		},
		directs: [],
		dmsClosed: new Set(),
		async sendDirect(userId, data) {
			if (this.dmsClosed.has(userId)) throw Object.assign(new Error('DMs closed'), { code: 'DMS_CLOSED' });
			this.directs.push({ userId, ...data });
			return String(850000000000000000n + BigInt(this.directs.length));
		},
		absenceMessages: [],
		async upsertAbsenceMessage(channelId, messageId, view, options = {}) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			this.absenceMessages.push({ channelId, messageId, view, options });
			return messageId ?? String(870000000000000000n + BigInt(this.absenceMessages.length));
		},
		eventMessages: [],
		async upsertEventMessage(channelId, messageId, event, options = {}) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			this.eventMessages.push({ channelId, messageId, event, options });
			return messageId ?? String(860000000000000000n + BigInt(this.eventMessages.length));
		},
		fivemMessages: [],
		async upsertFivemMessage(channelId, messageId, data) {
			if (this.failOn.has(channelId)) throw new Error('Missing Access');
			this.fivemMessages.push({ channelId, messageId, data });
			return messageId ?? String(840000000000000000n + BigInt(this.fivemMessages.length));
		},
		botStatus: null,
		async setBotStatus(text) {
			this.botStatus = text;
		},
		applications: [],
		async upsertApplicationMessage(channelId, messageId, view, options = {}) {
			this.applications.push({ channelId, messageId, status: view.application.status, score: view.application.score });
			return { messageId: messageId ?? String(800000000000000000n + BigInt(this.applications.length)), threadId: options.thread ? '810000000000000001' : null };
		},
		async publishRecruitmentPanel(channelId, messageId) {
			return messageId ?? '820000000000000001';
		},
		interviews: [],
		async createInterviewChannel(guildId, options) {
			this.interviews.push({ guildId, ...options });
			return '830000000000000001';
		},
		raidLocks: [],
		async setRaidLocks(guildId, options) {
			this.raidLocks.push(['lock', guildId, options]);
			return { verificationLevel: 1, invitesDisabled: false };
		},
		async restoreRaidLocks(guildId, previous) {
			this.raidLocks.push(['restore', guildId, previous]);
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
	const config = { ...parseConfig({ OWNER_ID: OWNER }), DATA_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'brl-test-')), ...overrides };
	const noop = () => undefined;
	const silent = { info: noop, warn: noop, error: noop, debug: noop, success: noop };
	// No network in tests: every remote image is "not found"
	const fetchImpl = async () => new Response(null, { status: 404 });
	const core = createCore({ db, config, executor, logger: silent, fetchImpl });
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
