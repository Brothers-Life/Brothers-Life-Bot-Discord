// Turns what happens in the other services (audit entries, ticket messages) into panel notifications
const MENTION = /^<@!?(\d{17,20})>$/;
// One "new reply" notification per ticket in this window, however many messages the member sends
const REPLY_COOLDOWN_MS = 5 * 60_000;

export function attachNotificationSources({ notifications, audit, tickets, network, executor, logger = console, now = Date.now }) {
	const guildName = id => (id ? network.find(id)?.name ?? null : null);
	const idOf = mention => MENTION.exec(String(mention ?? ''))?.[1] ?? null;
	async function nameOf(userId) {
		if (!userId) return null;
		const user = await executor.getUser(userId).catch(() => null);
		return user ? user.globalName ?? user.username : null;
	}
	const join = (...parts) => parts.filter(Boolean).join(' · ') || null;

	// action -> async entry => notification fields (or null)
	const FROM_AUDIT = {
		'tickets.open': async e => ({
			type: 'ticket_new',
			title: `Nouveau ticket #${e.details?.number ?? e.target}`,
			body: join(e.details?.opener, e.details?.category, e.details?.subject, guildName(e.guildId)),
			url: `/ticket/${e.target}`,
		}),
		'tickets.transfer': async (e) => {
			const to = idOf(e.details?.to);
			if (!to) return null;
			const by = await nameOf(e.actorId);
			return {
				type: 'ticket_assigned',
				userId: to,
				title: `Ticket #${e.details?.number ?? e.target} transféré à toi`,
				body: join(by && `par ${by}`, e.details?.opener, guildName(e.guildId)),
				url: `/ticket/${e.target}`,
			};
		},
		'recruitment.apply': async e => ({
			type: 'application_new',
			title: `Nouvelle candidature : ${e.details?.position ?? 'poste'}`,
			body: join(await nameOf(e.actorId), guildName(e.guildId)),
			url: '/recruitment',
		}),
		'feedback.create': async e => ({
			type: 'feedback_new',
			title: `${e.details?.box ?? 'Suggestion'} #${e.details?.number ?? ''} : ${e.details?.title ?? ''}`.trim(),
			body: join(await nameOf(e.actorId), guildName(e.guildId)),
			url: '/feedback',
		}),
		'appeals.submit': async e => ({
			type: 'appeal_new',
			title: `Nouvel appel de sanction #${e.details?.sanction ?? e.target}`,
			body: await nameOf(idOf(e.details?.member) ?? e.actorId),
			url: '/appeals',
		}),
		'absences.declare': async (e) => {
			if (!e.details?.pending) return null;
			const until = e.details?.until ? new Date(e.details.until).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : null;
			return {
				type: 'absence_request',
				title: 'Absence à valider',
				body: join(await nameOf(idOf(e.details?.member) ?? e.target), until && `jusqu’au ${until}`, e.details?.reason),
				url: '/absences',
			};
		},
		'antiraid.start': async e => ({
			type: 'antiraid',
			title: 'Mode raid activé',
			body: join(guildName(e.guildId), e.details?.trigger && `déclenchement ${e.details.trigger}`),
			url: '/antiraid',
		}),
	};

	const unsubscribe = [];
	unsubscribe.push(audit.onRecord((entry) => {
		const build = FROM_AUDIT[entry.action];
		if (!build) return;
		build(entry)
			.then(fields => fields && notifications.push({ actorId: entry.actorId, guildId: entry.guildId, ...fields }))
			.catch(error => logger.warn?.('Notification failed:', error?.message));
	}));

	// The member writes in a claimed ticket: its handler is told (once per few minutes)
	const lastReply = new Map();
	if (tickets?.subscribe) {
		unsubscribe.push(tickets.subscribe((event) => {
			if (event.type !== 'message') return;
			const m = event.message;
			if (m.bot || m.internal || m.panelUser || !m.authorId) return;
			let ticket;
			try {
				ticket = tickets.get(m.ticketId);
			}
			catch {
				return;
			}
			if (!ticket?.claimedBy || ticket.status !== 'open' || m.authorId !== ticket.openerId) return;
			const last = lastReply.get(ticket.id) ?? 0;
			if (now() - last < REPLY_COOLDOWN_MS) return;
			lastReply.set(ticket.id, now());
			if (lastReply.size > 2000) lastReply.clear();
			try {
				notifications.push({
					type: 'ticket_reply',
					userId: ticket.claimedBy,
					actorId: m.authorId,
					guildId: ticket.guildId,
					title: `Nouvelle réponse dans le ticket #${ticket.number}`,
					body: join(m.authorName, String(m.content ?? '').slice(0, 140)),
					url: `/ticket/${ticket.id}`,
				});
			}
			catch (error) {
				logger.warn?.('Notification failed:', error?.message);
			}
		}));
	}

	return () => unsubscribe.forEach(fn => fn());
}
