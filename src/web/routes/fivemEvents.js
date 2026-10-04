import { EVENT_ALIASES, EVENT_TYPES, MAINTENANCE_VARIABLES, RESTART_WARNINGS, TXADMIN_VARIABLES } from '../../core/fivemEvents.js';
import { networkTargets } from './helpers.js';

const str = max => ({ type: 'string', maxLength: max });
// null first: with type coercion, null would otherwise become 0 or ""
const num = { anyOf: [{ type: 'null' }, { type: 'number' }] };

// What the FiveM bridge sends; unknown fields (identifiers, HWIDs…) are dropped by the schema
const eventBody = {
	type: 'object',
	required: ['type'],
	properties: {
		type: { type: 'string', enum: [...Object.keys(EVENT_TYPES), ...Object.keys(EVENT_ALIASES)] },
		server: str(100),
		data: {
			type: 'object',
			additionalProperties: false,
			properties: {
				author: str(200), message: str(4000), reason: str(1000), secondsRemaining: num, delay: num, temporary: { type: 'boolean' },
				target: num, targetNetId: num, targetName: str(200), playerName: str(200), targetDiscord: { type: 'string', pattern: '^\\d{17,20}$' },
				expiration: { anyOf: [{ type: 'null' }, { type: 'number' }, { type: 'boolean' }] }, durationTranslated: str(100), actionId: str(60),
				actionType: str(60), actionReason: str(1000), actionAuthor: str(200), revokedBy: str(200),
			},
		},
	},
};

const payload = { type: 'object' };
const target = { type: 'object' };

// txAdmin bridge (events of the FiveM server) and its settings, maintenance mode
export function registerFivemEventRoutes(app, { core }) {
	const { fivemEvents } = core;

	// Called by fivem/brl-bridge with an API key that has fivem.events
	app.post('/api/fivem/events', { config: { permission: 'fivem.events' }, schema: { body: eventBody } }, async (request) => ({
		ok: true,
		...await fivemEvents.ingest(request.actor, request.body),
	}));

	app.get('/api/fivem-events', { config: { permission: 'fivemevents.view' } }, async (request) => {
		const manage = request.actor.can('fivemevents.manage');
		return {
			config: fivemEvents.config(),
			types: fivemEvents.types(),
			restartWarnings: RESTART_WARNINGS,
			variables: { txadmin: TXADMIN_VARIABLES, maintenance: MAINTENANCE_VARIABLES },
			...fivemEvents.publicState(),
			maintenanceBy: fivemEvents.maintenance().by ?? null,
			events: fivemEvents.recent(50),
			baseUrl: core.config.WEB_PUBLIC_URL ?? '',
			guilds: manage || request.actor.can('fivemevents.maintenance') ? await networkTargets(core) : [],
		};
	});

	app.put('/api/fivem-events/config', {
		config: { permission: 'fivemevents.manage' },
		schema: {
			body: {
				type: 'object',
				required: ['events', 'maintenance'],
				properties: {
					events: { type: 'object' },
					maintenance: { type: 'object', properties: { targets: { type: 'array', items: target, maxItems: 20 }, start: payload, end: payload, statusMessages: { type: 'boolean' }, mutePublic: { type: 'boolean' } } },
				},
			},
		},
	}, async (request) => fivemEvents.saveConfig(request.actor, request.body));

	app.post('/api/fivem-events/maintenance', {
		config: { permission: 'fivemevents.maintenance' },
		schema: { body: { type: 'object', required: ['active'], properties: { active: { type: 'boolean' }, reason: { anyOf: [{ type: 'null' }, str(300)] } } } },
	}, async (request) => fivemEvents.setMaintenance(request.actor, request.body));

	app.post('/api/fivem-events/test', {
		config: { permission: 'fivemevents.manage' },
		schema: { body: { type: 'object', required: ['type'], properties: { type: { type: 'string', enum: Object.keys(EVENT_TYPES) } } } },
	}, async (request) => fivemEvents.test(request.actor, request.body.type));
}
