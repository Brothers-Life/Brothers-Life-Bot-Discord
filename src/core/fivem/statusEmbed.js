// What the embed of a FiveM status message shows, set per server in the panel (the picture has its own design)

export const DEFAULT_STATUS_EMBED = {
	enabled: true,
	title: '🎮 {name}',
	description: '',
	fields: true,
	footer: true,
	thumbnail: true,
	button: true,
	buttonLabel: 'Se connecter',
};

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);

export function normalizeStatusEmbed(input = {}) {
	const d = DEFAULT_STATUS_EMBED;
	const value = input && typeof input === 'object' ? input : {};
	return {
		enabled: bool(value.enabled, d.enabled),
		title: String(value.title ?? d.title).trim().slice(0, 200) || d.title,
		description: String(value.description ?? '').trim().slice(0, 1000),
		fields: bool(value.fields, d.fields),
		footer: bool(value.footer, d.footer),
		thumbnail: bool(value.thumbnail, d.thumbnail),
		button: bool(value.button, d.button),
		buttonLabel: String(value.buttonLabel ?? '').trim().slice(0, 40) || d.buttonLabel,
	};
}

// Variables of the title and the text: {name} {players} {max} {status}
export function statusVars(server, status) {
	const online = Boolean(status?.online);
	return {
		name: server.name,
		players: online ? status.players : 0,
		max: status?.max ?? 0,
		status: server.maintenance ? 'Maintenance' : !status ? 'Vérification' : online ? 'En ligne' : 'Hors ligne',
	};
}
