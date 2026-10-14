// Periodic work of the bot (the process connected to Discord)
const HOUR = 3600_000;

export function startTasks({ core, every }) {
	return [
		every(HOUR, () => core.sessions.purgeExpired(), 'Session purge failed'),
		// Temporary bans reaching their end
		every(30_000, () => core.sanctions.expireDue(), 'Ban expiry failed'),
		// Scheduled announcements
		every(30_000, () => core.announcements.sendDue(), 'Announcements failed'),
		// Statistics collected in memory, counter channels, old statistics
		every(60_000, () => core.stats.flush(), 'Stats flush failed'),
		every(10 * 60_000, () => core.stats.updateCounters(), 'Counters failed'),
		every(24 * HOUR, () => core.stats.purge(), 'Stats purge failed'),
		// Dynamic messages whose variables need a refresh
		every(60_000, () => core.liveMessages.tick(), 'Live messages failed'),
		// Scheduled polls to open, open polls reaching their end
		every(30_000, () => core.polls.tick(), 'Polls failed'),
		// Giveaways to open, to draw, unclaimed prizes to reroll
		every(30_000, () => core.giveaways.tick(), 'Giveaways failed'),
		// Staff bugs still unassigned after their urgency delay
		every(60_000, () => core.feedback.tick(), 'Feedback reminders failed'),
		// RP events: reminders, start and end
		every(60_000, () => core.rpEvents.tick(), 'RP events failed'),
		// Monthly staff activity report
		every(10 * 60_000, () => core.staffActivity.tick(), 'Staff report failed'),
		// Nightly server backups
		every(10 * 60_000, () => core.backups.tick(), 'Backups failed'),
		// FiveM servers (status messages) and the bot status
		every(60_000, () => core.fivem.tick(), 'FiveM failed'),
		every(30_000, () => core.fivem.presenceTick(), 'Bot status failed'),
		// Tebex store: new payments (roles, logs, thanks), refunds and chargebacks
		every(2 * 60_000, () => core.tebex.tick(), 'Tebex poll failed', 'warn'),
		// Streams and videos to announce
		every(60_000, () => core.streams.tick(), 'Streams failed'),
		// RSS / Atom feeds and TikTok (each feed has its own interval)
		every(60_000, () => core.feeds.tick(), 'Feeds failed'),
		// Music: leaves when alone or with nothing to play, refreshes the now-playing message
		every(30_000, () => core.music.tick(), 'Music tick failed'),
		// Staff meetings: reminders, start, end
		every(60_000, () => core.meetings.tick(), 'Meetings tick failed'),
		// Channels opening or closing at set hours
		every(60_000, () => core.channelSchedules.tick(), 'Channel schedules failed'),
		// Newcomers not verified in time
		every(60_000, () => core.verification.tick(), 'Verification tick failed'),
		// Staff absences that start or end
		every(60_000, () => core.absences.tick(), 'Absences failed'),
		// Raids that are over
		every(30_000, () => core.antiraid.tick(), 'Anti-raid tick failed'),
		// Temporary roles reaching their end
		every(30_000, () => core.moderation.expireTempRoles(), 'Temporary roles failed'),
		// Inactive tickets: reminder, then automatic close
		every(5 * 60_000, () => core.tickets.sweep(), 'Ticket sweep failed'),
		// Server events older than the retention period
		every(6 * HOUR, () => core.events.purge(), 'Events purge failed'),
		// Roles whose Discord permissions drifted from their rank profile (reported, not fixed)
		every(6 * HOUR, () => core.permissionSync.checkDrift(), 'Permission check failed', 'warn'),
		// FiveM telemetry: server status and console, alerts, old rows
		every(15_000, () => core.telemetry.scrapeTick(), 'Telemetry scrape failed', 'warn'),
		every(60_000, () => core.telemetry.alertsTick(), 'Telemetry alerts failed'),
		every(24 * HOUR, () => core.telemetry.purgeTick(), 'Telemetry purge failed'),
	];
}

// GitHub releases: tells the panel when a new version is out
export function startUpdateCheck({ config, versions, logger }) {
	if (!config.GITHUB_REPO) return [];
	const check = () => versions.checkForUpdate().catch(error => logger.warn('Version check failed:', error.message));
	return [setTimeout(check, 60_000), setInterval(check, 6 * HOUR)];
}
