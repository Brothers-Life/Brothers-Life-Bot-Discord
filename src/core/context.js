import path from 'node:path';
import { createSettings } from '../db/index.js';
import { createAudit } from './audit.js';
import { createNetwork } from './network.js';
import { createRankService } from './ranks.js';
import { createLogRouting } from './logRouting.js';
import { createSessions } from './sessions.js';
import { createApiKeys } from './apiKeys.js';
import { createSanctions } from './sanctions.js';
import { createSanctionTemplates } from './sanctionTemplates.js';
import { createMusic } from './music/index.js';
import { createMemberInsights } from './memberInsights.js';
import { createChannelFeatures } from './channelFeatures.js';
import { createVerification } from './verification.js';
import { createEmbedBuilder } from './embedBuilder.js';
import { createAppeals } from './appeals.js';
import { createChannelSchedules } from './channelSchedules.js';
import { createArchives } from './archives.js';
import { createMeetings } from './meetings.js';
import { createFivemData } from './fivemData.js';
import { createFivemRoles } from './fivemRoles.js';
import { createTebex } from './tebex.js';
import { createRestrictions } from './restrictions.js';
import { createModeration } from './moderation.js';
import { createEvents } from './events.js';
import { createAutomod } from './automod/index.js';
import { createStaffSync } from './staffSync.js';
import { createMembers } from './members.js';
import { createRoleImport } from './roleImport.js';
import { createAnnouncements } from './announcements.js';
import { createTickets } from './tickets.js';
import { createVariables } from './variables.js';
import { createUploads } from './uploads.js';
import { createOnboarding } from './onboarding.js';
import { createAntiraid } from './antiraid.js';
import { createStats } from './stats.js';
import { createVoiceRooms } from './voiceRooms.js';
import { createLiveMessages } from './liveMessages.js';
import { createChangelog } from './changelog.js';
import { createPolls } from './polls.js';
import { createGiveaways } from './giveaways.js';
import { createFeedback } from './feedback.js';
import { createRecruitment } from './recruitment.js';
import { createAbsences } from './absences.js';
import { createStreams } from './streams.js';
import { createFeeds } from './feeds.js';
import { createFivem } from './fivem.js';
import { createFivemEvents } from './fivemEvents.js';
import { createDms } from './dms.js';
import { createTemplates } from './templates/index.js';
import { createCustomCommands } from './customCommands/index.js';
import { createBackups } from './backups.js';
import { createStaffActivity } from './staffActivity.js';
import { createRpEvents } from './rpEvents.js';
import { COMMANDS } from './commandCatalog.js';
import { createPermissionSync } from './permissionSync.js';
import { createAntinuke } from './antinuke.js';
import { createNotifications } from './notifications.js';
import { attachNotificationSources } from './notificationSources.js';
import { createPublicPage } from './publicPage.js';
import { definePermission } from './permissions.js';

definePermission('members.view', { label: 'Rechercher des membres sur le réseau', category: 'Membres' });
definePermission('members.manage', { label: 'Modifier les rôles et pseudos des membres', category: 'Membres' });
import { auditTypes, describeAuditEntry } from './describe.js';

const SELF_LOGGED_ACTIONS = new Set(['tickets.close']);

// Wires every core service together. `executor` is the only door to Discord:
// the real one lives in src/bot/executor.js, tests use a fake.
export function createCore({ db, config, executor, logger = console, fetchImpl = fetch }) {
	const settings = createSettings(db);
	const audit = createAudit({ db });
	const network = createNetwork({ db, audit });
	const ranks = createRankService({
		db,
		audit,
		ownerId: config.OWNER_ID,
		getMainGuildId: () => network.getMainId(),
		getMemberRoleIds: (guildId, userId) => executor.getMemberRoleIds(guildId, userId),
	});
	const logs = createLogRouting({ db, executor, network, audit, logger });
	const sessions = createSessions({ db });
	const apiKeys = createApiKeys({ db, audit, ranks });
	logs.registerCategory('api', 'API (clés créées, révoquées)');
	const restrictions = createRestrictions({ db, network, audit, executor, logger });
	const sanctions = createSanctions({ db, audit, network, ranks, executor, restrictions, logger });
	const sanctionTemplates = createSanctionTemplates({ db, audit, restrictions });
	logs.registerCategory('sanctions', 'Sanctions (ban, kick, timeout, warn)');
	const events = createEvents({ db, network, logs, settings });
	const automod = createAutomod({ db, network, sanctions, ranks, audit, executor, logs, logger });
	const staffSync = createStaffSync({ db, network, ranks, audit, executor, logs, logger });
	const members = createMembers({ db, network, ranks, sanctions, audit, executor });
	const moderation = createModeration({ db, network, ranks, audit, executor, settings, members, logs, logger });
	const roleImport = createRoleImport({ db, network, ranks, staffSync, executor, audit });
	const uploads = createUploads({ dir: path.join(config.DATA_DIR, 'uploads') });
	// Template variables shared by every message of the bot; {fivem.*} come from fivemData, created further down
	const variables = createVariables({ executor, logger, fivemVars: discordId => fivemData.discordVars(discordId), fivemEnabled: () => fivemData.settingsView().enabled });
	const announcements = createAnnouncements({ db, network, audit, executor, logs, uploads, variables, logger });
	const tickets = createTickets({ db, network, ranks, audit, executor, logs, variables, logger, dataDir: config.DATA_DIR, fetchImpl });
	const onboarding = createOnboarding({ db, network, audit, executor, uploads, variables, logger, fetchImpl });
	logs.registerCategory('onboarding', 'Accueil (règlement accepté, boosts, réglages)');
	const antiraid = createAntiraid({ db, network, audit, executor, sanctions, logs, logger });
	const stats = createStats({ db, network, audit, executor, logger });
	const voiceRooms = createVoiceRooms({ db, network, audit, executor, logger });
	const liveMessages = createLiveMessages({ db, network, audit, executor, stats, variables, logger });
	const changelog = createChangelog({ db, network, audit, executor, logger });
	logs.registerCategory('changelog', 'Changelog publié');
	const polls = createPolls({ db, network, audit, executor, logger });
	logs.registerCategory('polls', 'Sondages (publiés, fermés)');
	const giveaways = createGiveaways({ db, network, ranks, audit, executor, sanctions, stats, moderation, logger });
	logs.registerCategory('giveaways', 'Giveaways (lancés, gagnants, relances, lots réclamés)');
	const feedback = createFeedback({ db, network, ranks, audit, executor, logger });
	logs.registerCategory('feedback', 'Suggestions et bugs (nouveaux, statuts)');
	const recruitment = createRecruitment({ db, network, ranks, audit, executor, sanctions, stats, variables, logger });
	logs.registerCategory('recruitment', 'Recrutement (candidatures, décisions)');
	const absences = createAbsences({ db, network, ranks, audit, executor, settings, logger });
	const streams = createStreams({ db, network, audit, executor, settings, logs, variables, fetchImpl, logger });
	const feeds = createFeeds({ db, network, audit, executor, logs, variables, fetchImpl, logger });
	const fivem = createFivem({ db, network, audit, executor, settings, logs, fetchImpl, logger });
	stats.addVariables(async () => fivem.variables());
	const fivemEvents = createFivemEvents({ db, settings, audit, logs, executor, network, variables, fivem, logger });
	const memberInsights = createMemberInsights({ db, stats, events });
	const channelFeatures = createChannelFeatures({ db, network, audit, executor, logger });
	logs.registerCategory('channelfeatures', 'Salons automatiques (compteur, un mot, message en bas…)');
	const verification = createVerification({ db, network, audit, settings, executor, logs, logger });
	const embedBuilder = createEmbedBuilder({ db, network, audit, executor });
	logs.registerCategory('embeds', 'Créateur d’embeds (messages postés, modifiés)');
	const appeals = createAppeals({ db, audit, settings, sanctions, executor, logs, logger });
	const channelSchedules = createChannelSchedules({ db, network, audit, executor, logger });
	logs.registerCategory('schedules', 'Horaires des salons (ouverture, fermeture)');
	const archives = createArchives({ db, network, audit, executor, dataDir: config.DATA_DIR });
	logs.registerCategory('archives', 'Archives de salons');
	const meetings = createMeetings({ db, network, ranks, audit, executor, logs, logger });
	// The crossed FiveM stats compare play time with the Discord activity the bot records
	const discordActivity = db.prepare('SELECT user_id, day, SUM(messages) AS messages, SUM(voice_seconds) AS voice_seconds FROM stats_activity WHERE day >= ? GROUP BY user_id, day');
	const fivemData = createFivemData({ audit, settings, logger, discord: {
		activity: sinceDay => discordActivity.all(sinceDay),
		members: async () => {
			const mainId = network.getMainId();
			return mainId ? new Set((await executor.listMembers(mainId)).filter(m => !m.bot).map(m => m.id)) : null;
		},
	} });
	const fivemRoles = createFivemRoles({ fivemData, settings, executor, network, audit, logs, logger });
	const tebex = createTebex({ db, network, audit, executor, settings, logs, variables, fivemData, fetchImpl, logger });
	const dms = createDms({ db, audit, executor, settings, logs, uploads, logger });
	const templates = createTemplates({ db, network, audit, executor, events, automod, tickets, logs, settings, logger });
	const rpEvents = createRpEvents({ db, network, audit, executor, uploads, logger });
	logs.registerCategory('rpevents', 'Événements RP');
	const staffActivity = createStaffActivity({ db, network, ranks, audit, executor, settings, logs, logger });
	const backups = createBackups({ db, network, audit, executor, settings, templates, logs, logger });
	const customCommands = createCustomCommands({ db, network, ranks, audit, executor, logs, members, moderation, sanctions, reservedNames: COMMANDS.map(c => c.name), variables, logger });
	logs.registerCategory('absences', 'Absences du staff');
	const music = createMusic({ db, network, audit, settings, backend: executor.music, resolver: executor.musicResolver, executor, logger });
	logs.registerCategory('music', 'Musique (lancée, arrêtée, réglages)');
	const permissionSync = createPermissionSync({ db, network, ranks, audit, executor, logs, settings });
	const antinuke = createAntinuke({ db, network, ranks, audit, executor, settings, logs, ownerId: config.OWNER_ID, logger });
	// The quarantine posts its own detailed alert
	SELF_LOGGED_ACTIONS.add('antinuke.quarantine');

	// Panel actions become log types (e.g. "sanctions:ban"), each of which can be routed apart
	for (const [category, types] of Object.entries(auditTypes())) logs.registerTypes(category, types);

	// Every audited action is also posted in the log channel of its category
	audit.onRecord((entry) => {
		// These services post a richer message themselves (e.g. the ticket transcript)
		if (SELF_LOGGED_ACTIONS.has(entry.action)) return;
		const category = entry.action.split('.')[0];
		if (!logs.categories().some(c => c.key === category)) return;
		logs.log(entry.guildId, category, describeAuditEntry(entry), entry.action.split('.')[1] ?? null);
	});

	// Rank links point to roles of the main server: changing it invalidates every cached permission
	network.on('mainChanged', () => ranks.invalidate());

	// Any rank change can move staff roles: resync everybody a few seconds later (changes often come in bursts)
	let resync = null;
	audit.onRecord((entry) => {
		if (!entry.action.startsWith('ranks.') && entry.action !== 'staff_sync.links' && entry.action !== 'network.main') return;
		clearTimeout(resync);
		resync = setTimeout(() => staffSync.syncAll().catch(error => logger.error('Staff sync failed:', error)), 5000);
		resync.unref?.();
	});
	network.on('activated', () => {
		clearTimeout(resync);
		resync = setTimeout(() => staffSync.syncAll().catch(error => logger.error('Staff sync failed:', error)), 5000);
		resync.unref?.();
	});

	// A server joining the network gets the network bans and hands over its own ban list
	network.on('activated', (guild) => {
		sanctions.syncGuild(guild.id).catch(error => logger.error(`Ban sync failed on ${guild.name}:`, error));
	});

	const core = { db, config, executor, variables, settings, audit, network, ranks, logs, sessions, apiKeys, sanctions, sanctionTemplates, music, memberInsights, channelFeatures, verification, embedBuilder, appeals, channelSchedules, archives, meetings, fivemData, fivemRoles, restrictions, moderation, events, automod, staffSync, members, tickets, permissionSync, roleImport, announcements, uploads, onboarding, antiraid, stats, voiceRooms, liveMessages, changelog, polls, giveaways, feedback, recruitment, absences, streams, fivem, dms, templates, customCommands, backups, staffActivity, rpEvents, antinuke, fivemEvents, feeds, tebex };

	// Panel notification center: other features call core.notifications.push({ permission, title, body, url, guildId })
	core.notifications = createNotifications({ db });
	attachNotificationSources({ notifications: core.notifications, audit, tickets, network, executor, logger });
	// Public page (no login); the maintenance block shows only when a fivemEvents service exists
	core.publicPage = createPublicPage({ settings, audit, network, ranks, executor, fivem, rpEvents, recruitment, logger, maintenance: () => core.fivemEvents?.publicState?.() ?? null });
	logs.registerCategory('publicpage', 'Page publique (réglages)', auditTypes().publicpage);
	return core;
}
