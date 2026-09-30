import { createSettings } from '../db/index.js';
import { createAudit } from './audit.js';
import { createNetwork } from './network.js';
import { createRankService } from './ranks.js';
import { createLogRouting } from './logRouting.js';
import { createSessions } from './sessions.js';
import { describeAuditEntry } from './describe.js';

// Wires every core service together. `executor` is the only door to Discord:
// the real one lives in src/bot/executor.js, tests use a fake.
export function createCore({ db, config, executor, logger = console }) {
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

	// Every audited action is also posted in the log channel of its category
	audit.onRecord((entry) => {
		const category = entry.action.split('.')[0];
		if (!logs.categories().some(c => c.key === category)) return;
		logs.log(entry.guildId, category, describeAuditEntry(entry));
	});

	// Rank links point to roles of the main server: changing it invalidates every cached permission
	network.on('mainChanged', () => ranks.invalidate());

	return { db, config, executor, settings, audit, network, ranks, logs, sessions };
}
