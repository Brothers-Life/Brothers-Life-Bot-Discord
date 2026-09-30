import { networkTargets, resolveNames, snowflake } from './helpers.js';

const idParam = { type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] };
const targets = { type: 'array', maxItems: 50, items: { type: 'object', properties: { guildId: snowflake, channelId: snowflake } } };
const body = {
	type: 'object',
	required: ['name', 'payload'],
	properties: {
		name: { type: 'string', maxLength: 100 },
		payload: { type: 'object' },
		refreshMinutes: { type: 'integer' },
		variables: { type: 'object' },
		repost: { type: 'boolean' },
		targets,
	},
};

// Dynamic / synced messages and the changelog
export function registerMessageRoutes(app, { core }) {
	const { liveMessages, changelog, executor } = core;

	async function withAuthors(list) {
		const names = await resolveNames(executor, list.map(m => m.createdBy));
		return list.map(m => ({ ...m, author: names.get(m.createdBy) ?? null }));
	}

	app.get('/api/messages', { config: { permission: 'messages.view' } }, async () => withAuthors(liveMessages.list()));
	app.get('/api/messages/targets', { config: { permission: 'messages.view' } }, async () => networkTargets(core));
	app.get('/api/messages/variables/:guildId', { config: { permission: 'messages.view' }, schema: { params: { type: 'object', properties: { guildId: snowflake } } } }, async (request) => {
		return liveMessages.variablesPreview(request.params.guildId);
	});
	app.get('/api/messages/:id', { config: { permission: 'messages.view' }, schema: { params: idParam } }, async (request) => liveMessages.get(request.params.id));
	app.post('/api/messages', { config: { permission: 'messages.manage' }, schema: { body } }, async (request, reply) => {
		reply.code(201);
		return liveMessages.create(request.actor, request.body);
	});
	app.put('/api/messages/:id', { config: { permission: 'messages.manage' }, schema: { params: idParam, body } }, async (request) => liveMessages.update(request.actor, request.params.id, request.body));
	app.post('/api/messages/:id/publish', { config: { permission: 'messages.manage' }, schema: { params: idParam } }, async (request) => liveMessages.publish(request.actor, request.params.id));
	app.put('/api/messages/:id/variables', { config: { permission: 'messages.manage' }, schema: { params: idParam, body: { type: 'object' } } }, async (request) => {
		return liveMessages.setVariables(request.actor, request.params.id, request.body);
	});
	app.delete('/api/messages/:id', { config: { permission: 'messages.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await liveMessages.remove(request.actor, request.params.id);
		return { ok: true };
	});

	// --- Changelog -------------------------------------------------------------------------------
	const entryBody = {
		type: 'object',
		required: ['title'],
		properties: {
			version: { type: ['string', 'null'], maxLength: 30 },
			title: { type: 'string', maxLength: 150 },
			intro: { type: 'string', maxLength: 1500 },
			items: { type: 'array', maxItems: 60 },
			image: { type: ['string', 'null'], maxLength: 500 },
			color: { type: 'string', maxLength: 7 },
			targets,
		},
	};
	app.get('/api/changelog', { config: { permission: 'changelog.view' } }, async () => withAuthors(changelog.list()));
	app.get('/api/changelog/targets', { config: { permission: 'changelog.view' } }, async () => networkTargets(core));
	app.post('/api/changelog', { config: { permission: 'changelog.manage' }, schema: { body: entryBody } }, async (request, reply) => {
		reply.code(201);
		return changelog.create(request.actor, request.body);
	});
	app.put('/api/changelog/:id', { config: { permission: 'changelog.manage' }, schema: { params: idParam, body: entryBody } }, async (request) => changelog.update(request.actor, request.params.id, request.body));
	app.post('/api/changelog/:id/publish', { config: { permission: 'changelog.manage' }, schema: { params: idParam } }, async (request) => changelog.publish(request.actor, request.params.id));
	app.delete('/api/changelog/:id', { config: { permission: 'changelog.manage', confirm: true }, schema: { params: idParam } }, async (request) => {
		await changelog.remove(request.actor, request.params.id);
		return { ok: true };
	});
}
