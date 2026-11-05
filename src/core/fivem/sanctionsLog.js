// Sanctions given with the in-game admin menu (admindash_sanctions, received through the game copy) are logged on
// Discord, with the member linked to the FiveM account. Log only: nothing is applied on Discord.
const CURSOR = 'fivemSanctions.cursor';
const PER_TICK = 20;

const TYPES = {
	warn: { label: 'Avertissement', color: 'warning' },
	kick: { label: 'Expulsion', color: 'warning' },
	ban: { label: 'Bannissement', color: 'danger' },
	tempban: { label: 'Bannissement temporaire', color: 'danger' },
	jail: { label: 'Prison admin', color: 'warning' },
	mute: { label: 'Mute', color: 'warning' },
	freeze: { label: 'Gel', color: 'neutral' },
};

export function durationText(minutes, type) {
	if (!minutes) return type === 'ban' ? 'définitive' : null;
	if (minutes < 60) return `${minutes} min`;
	if (minutes < 1440) return `${Math.round((minutes / 60) * 10) / 10} h`;
	return `${Math.round((minutes / 1440) * 10) / 10} j`;
}

export function sanctionLogMessage(s) {
	const type = TYPES[String(s.type ?? '').toLowerCase()] ?? { label: s.type ? `Sanction (${s.type})` : 'Sanction', color: 'warning' };
	const field = (name, value, inline = true) => (value ? [{ name, value: String(value).slice(0, 1000), inline }] : []);
	const player = s.discordId ? `${s.targetName ?? s.username ?? 'inconnu'} (<@${s.discordId}>)` : `${s.targetName ?? s.username ?? 'inconnu'} · aucun Discord lié`;
	return {
		title: `${type.label} en jeu`,
		color: type.color,
		thumbnailUserId: s.discordId ?? null,
		fields: [
			...field('Joueur', player),
			...field('Donnée par', s.issuedBy),
			...field('Durée', durationText(s.minutes, String(s.type ?? '').toLowerCase())),
			...field('Raison', s.reason || 'aucune', false),
			...field('Compte FiveM', s.userId ? `#${s.userId}` : null),
		],
		footer: 'Menu admin du serveur FiveM',
	};
}

export function createGameSanctionsLog({ fivemData, settings, logs, logger = console }) {
	logs.registerCategory('fivemsanctions', 'Sanctions prises en jeu (menu admin FiveM)');

	return {
		// New sanctions since the last pass; the very first pass only notes where to start (no flood of old ones)
		async tick() {
			const cursor = await settings.get(CURSOR, null);
			const batch = await fivemData.sanctionsAfter(cursor, { limit: PER_TICK + 1 });
			if (!batch) return 0;
			// First pass, or the game's table was emptied (ids start over): start from its current end
			if (cursor === null || batch.last < cursor) {
				await settings.set(CURSOR, batch.last);
				return 0;
			}
			const rows = batch.rows.slice(0, PER_TICK);
			for (const s of rows) {
				try {
					await logs.log(null, 'fivemsanctions', sanctionLogMessage(s));
				}
				catch (error) {
					logger.warn('In-game sanction log failed:', error.message);
				}
			}
			if (rows.length) await settings.set(CURSOR, rows.at(-1).id);
			return rows.length;
		},
	};
}
