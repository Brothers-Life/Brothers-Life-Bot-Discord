import path from 'node:path';
import { createSettings } from '../db/index.js';
import { createAudit } from './audit.js';
import { createNetwork } from './network.js';
import { createRankService } from './ranks.js';
import { createLogRouting } from './logRouting.js';
import { createSessions } from './sessions.js';
import { createSanctions } from './sanctions.js';
import { createRestrictions } from './restrictions.js';
import { createModeration } from './moderation.js';
import { createEvents } from './events.js';
import { createAutomod } from './automod/index.js';
import { createStaffSync } from './staffSync.js';
import { createMembers } from './members.js';
import { createRoleImport } from './roleImport.js';
import { createAnnouncements } from './announcements.js';
import { createTickets } from './tickets.js';
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
import { createPermissionSync } from './permissionSync.js';
import { definePermission } from './permissions.js';

definePermission('members.view', { label: 'Rechercher des membres sur le réseau', category: 'Membres' });
definePermission('members.manage', { label: 'Modifier les rôles et pseudos des membres', category: 'Membres' });
import { describeAuditEntry } from './describe.js';

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
	const restrictions = createRestrictions({ db, network, audit, executor, logger });
	const sanctions = createSanctions({ db, audit, network, ranks, executor, restrictions, logger });
	logs.registerCategory('sanctions', 'Sanctions (ban, kick, timeout, warn)');
	const events = createEvents({ db, network, logs, settings });
	const automod = createAutomod({ db, network, sanctions, ranks, audit, executor, logs, logger });
	const staffSync = createStaffSync({ db, network, ranks, audit, executor, logs, logger });
	const members = createMembers({ db, network, ranks, sanctions, audit, executor });
	const moderation = createModeration({ db, network, ranks, audit, executor, settings, members, logs, logger });
	const roleImport = createRoleImport({ db, network, ranks, staffSync, executor, audit });
	const uploads = createUploads({ dir: path.join(config.DATA_DIR, 'uploads') });
	const announcements = createAnnouncements({ db, network, audit, executor, logs, uploads, logger });
	const tickets = createTickets({ db, network, ranks, audit, executor, logs, logger });
	const onboarding = createOnboarding({ db, network, audit, executor, uploads, logger, fetchImpl });
	logs.registerCategory('onboarding', 'Accueil (règlement accepté, boosts, réglages)');
	const antiraid = createAntiraid({ db, network, audit, executor, sanctions, logs, logger });
	const stats = createStats({ db, network, audit, executor, logger });
	const voiceRooms = createVoiceRooms({ db, network, audit, executor, logger });
	logs.registerCategory('voice', 'Vocaux personnels (créés, transférés, fermés)');
	const liveMessages = createLiveMessages({ db, network, audit, executor, stats, logger });
	const changelog = createChangelog({ db, network, audit, executor, logger });
	logs.registerCategory('changelog', 'Changelog publié');
	const polls = createPolls({ db, network, audit, executor, logger });
	logs.registerCategory('polls', 'Sondages (publiés, fermés)');
	const giveaways = createGiveaways({ db, network, ranks, audit, executor, sanctions, stats, moderation, logger });
	logs.registerCategory('giveaways', 'Giveaways (lancés, gagnants, relances, lots réclamés)');
	const feedback = createFeedback({ db, network, ranks, audit, executor, logger });
	logs.registerCategory('feedback', 'Suggestions et bugs (nouveaux, statuts)');
	const recruitment = createRecruitment({ db, network, ranks, audit, executor, sanctions, stats, logger });
	logs.registerCategory('recruitment', 'Recrutement (candidatures, décisions)');
	const absences = createAbsences({ db, network, ranks, audit, executor, settings, logger });
	const streams = createStreams({ db, network, audit, executor, settings, logs, fetchImpl, logger });
	logs.registerCategory('absences', 'Absences du staff');
	const permissionSync = createPermissionSync({ db, network, ranks, audit, executor, logs, settings });

	// Every audited action is also posted in the log channel of its category
	audit.onRecord((entry) => {
		// These services post a richer message themselves (e.g. the ticket transcript)
		if (SELF_LOGGED_ACTIONS.has(entry.action)) return;
		const category = entry.action.split('.')[0];
		if (!logs.categories().some(c => c.key === category)) return;
		logs.log(entry.guildId, category, describeAuditEntry(entry));
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

	return { db, config, executor, settings, audit, network, ranks, logs, sessions, sanctions, restrictions, moderation, events, automod, staffSync, members, tickets, permissionSync, roleImport, announcements, uploads, onboarding, antiraid, stats, voiceRooms, liveMessages, changelog, polls, giveaways, feedback, recruitment, absences, streams };
}
