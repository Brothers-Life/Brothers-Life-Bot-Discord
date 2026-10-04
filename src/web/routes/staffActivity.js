import { csvCell, snowflake } from './helpers.js';

const range = { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } } };

// Staff activity report: per member, over a period
export function registerStaffActivityRoutes(app, { core }) {
	const { staffActivity, network, executor } = core;
	const period = (q) => {
		const to = q.to ?? Date.now();
		return { from: q.from ?? to - 30 * 86_400_000, to };
	};

	app.get('/api/staff-activity', { config: { permission: 'staffactivity.view' }, schema: { querystring: range } }, async (request) => {
		const manage = request.actor.can('staffactivity.manage');
		const guilds = manage ? network.list().filter(g => g.status === 'active' && g.botPresent) : [];
		return {
			...await staffActivity.report(period(request.query)),
			config: manage ? staffActivity.config() : null,
			guilds: await Promise.all(guilds.map(async g => ({ id: g.id, name: g.name, channels: await executor.listTextChannels(g.id) }))),
		};
	});
	app.get('/api/staff-activity/export', { config: { permission: 'staffactivity.view' }, schema: { querystring: range } }, async (request, reply) => {
		const { members } = await staffActivity.report(period(request.query));
		const rows = [['Membre', 'Score', 'Tickets fermés', 'Tickets pris', 'Réponses en ticket', 'Note moyenne', 'Sanctions', 'MP envoyés', 'Actions panel', 'Messages', 'Heures vocal', 'Jours d’absence'],
			...members.map(m => [m.name, m.score, m.ticketsClosed, m.ticketsClaimed, m.ticketReplies, m.rating ?? '', m.sanctions, m.dmReplies, m.panelActions, m.messages, m.voiceHours, m.absentDays])];
		return reply.type('text/csv; charset=utf-8').header('Content-Disposition', 'attachment; filename="activite-staff.csv"')
			.send(`${String.fromCharCode(0xfeff)}${rows.map(r => r.map(csvCell).join(';')).join('\n')}\n`);
	});
	app.put('/api/staff-activity/config', {
		config: { permission: 'staffactivity.manage' },
		schema: { body: { type: 'object', properties: { enabled: { type: 'boolean' }, guildId: { anyOf: [{ type: 'null' }, snowflake] }, channelId: { anyOf: [{ type: 'null' }, snowflake] } } } },
	}, async (request) => staffActivity.setConfig(request.actor, request.body));
}
