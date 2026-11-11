// Picture of a FiveM server for its status message: name, state, figures, players gauge and the curve of the last hours.
// Everything shown is set per server in the panel (design below)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { registerFonts } from '../cards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAND_DIR = path.resolve(__dirname, '..', '..', '..', 'assets', 'brand');

export const STATUS_IMAGE_NAME = 'fivem-statut.png';
export const HISTORY_MAX = 24 * 3_600_000;
export const CHART_HOURS = [1, 3, 6, 12, 24];
export const BACKGROUNDS = { road: 'bg-road.webp', car: 'bg-car.webp', heli: 'bg-heli.webp' };
const IMAGE_SRC = /^(https:\/\/\S{1,2000}|upload:[a-f0-9]{32}\.(png|jpg|webp|gif))$/;

export const DEFAULT_STATUS_IMAGE = {
	enabled: true,
	title: '',
	background: 'road',
	backgroundImage: null,
	darkness: 80,
	logo: 'brand',
	logoImage: null,
	brackets: true,
	since: true,
	stats: { ping: true, peak: true, fill: true },
	gauge: true,
	chart: true,
	chartHours: 6,
};

const W = 1200;
const PAD = 48;
const MIN_WINDOW = 30 * 60_000;
const TEXT = '#fff3e6';
const MUTED = 'rgba(255, 243, 230, 0.58)';
const FAINT = 'rgba(255, 243, 230, 0.08)';
const STATES = {
	online: { label: 'EN LIGNE', color: '#43d17a' },
	offline: { label: 'HORS LIGNE', color: '#ed4245' },
	maintenance: { label: 'MAINTENANCE', color: '#f0b232' },
	checking: { label: 'VÉRIFICATION', color: '#9a8f86' },
};

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback);
const source = value => (typeof value === 'string' && IMAGE_SRC.test(value.trim()) ? value.trim() : null);

// Whatever comes from the panel (or an older config) becomes a complete, safe design
export function normalizeStatusImage(input = {}) {
	const d = DEFAULT_STATUS_IMAGE;
	const value = input && typeof input === 'object' ? input : {};
	const stats = value.stats && typeof value.stats === 'object' ? value.stats : {};
	const background = [...Object.keys(BACKGROUNDS), 'custom', 'none'].includes(value.background) ? value.background : d.background;
	const logo = ['brand', 'custom', 'none'].includes(value.logo) ? value.logo : d.logo;
	const darkness = Number(value.darkness);
	return {
		enabled: bool(value.enabled, d.enabled),
		title: String(value.title ?? '').trim().slice(0, 40),
		background,
		backgroundImage: source(value.backgroundImage),
		darkness: Number.isFinite(darkness) ? Math.min(100, Math.max(30, Math.round(darkness))) : d.darkness,
		logo,
		logoImage: source(value.logoImage),
		brackets: bool(value.brackets, d.brackets),
		since: bool(value.since, d.since),
		stats: { ping: bool(stats.ping, d.stats.ping), peak: bool(stats.peak, d.stats.peak), fill: bool(stats.fill, d.stats.fill) },
		gauge: bool(value.gauge, d.gauge),
		chart: bool(value.chart, d.chart),
		chartHours: CHART_HOURS.includes(Number(value.chartHours)) ? Number(value.chartHours) : d.chartHours,
	};
}

const brandCache = new Map();
function brandImage(file) {
	if (!brandCache.has(file)) brandCache.set(file, loadImage(path.join(BRAND_DIR, file)).catch(() => null));
	return brandCache.get(file);
}

// `loadSource(src)` gives a picture (or its bytes) for an https address or an "upload:<id>"; null when unavailable
async function pictures(design, loadSource) {
	const custom = async (src) => {
		if (!src || !loadSource) return null;
		try {
			const data = await loadSource(src);
			return data ? (Buffer.isBuffer(data) ? await loadImage(data) : data) : null;
		}
		catch {
			return null;
		}
	};
	const background = design.background === 'none' ? null
		: design.background === 'custom' ? await custom(design.backgroundImage) ?? await brandImage(BACKGROUNDS.road)
			: await brandImage(BACKGROUNDS[design.background]);
	const logo = design.logo === 'none' ? null
		: design.logo === 'custom' ? await custom(design.logoImage) ?? await brandImage('logo.png')
			: await brandImage('logo.png');
	return { background, logo };
}

function rgba(hex, alpha) {
	const n = Number.parseInt(hex.slice(1), 16);
	return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function formatDuration(ms) {
	const minutes = Math.max(0, Math.floor(ms / 60_000));
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
	return `${Math.floor(hours / 24)} j ${hours % 24} h`;
}

function fit(ctx, text, maxWidth) {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let cut = text;
	while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
	return `${cut.trimEnd()}…`;
}

function roundedRect(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function drawCover(ctx, image, w, h) {
	const scale = Math.max(w / image.width, h / image.height);
	ctx.drawImage(image, (w - image.width * scale) / 2, (h - image.height * scale) / 2, image.width * scale, image.height * scale);
}

function drawBackground(ctx, { background, accent, darkness, h, glow }) {
	ctx.fillStyle = '#0d0907';
	ctx.fillRect(0, 0, W, h);
	if (background) drawCover(ctx, background, W, h);
	const k = darkness / 100;
	const side = ctx.createLinearGradient(0, 0, W, 0);
	side.addColorStop(0, `rgba(12, 8, 6, ${Math.min(1, k * 1.19)})`);
	side.addColorStop(0.6, `rgba(12, 8, 6, ${k * 1.02})`);
	side.addColorStop(1, `rgba(12, 8, 6, ${k * 0.75})`);
	ctx.fillStyle = side;
	ctx.fillRect(0, 0, W, h);
	const low = ctx.createLinearGradient(0, h * 0.45, 0, h);
	low.addColorStop(0, 'rgba(12, 8, 6, 0)');
	low.addColorStop(1, `rgba(12, 8, 6, ${Math.min(1, k * 1.15)})`);
	ctx.fillStyle = low;
	ctx.fillRect(0, 0, W, h);
	if (glow) {
		const light = ctx.createRadialGradient(W - 190, 195, 10, W - 190, 195, 380);
		light.addColorStop(0, rgba(accent, 0.22));
		light.addColorStop(1, rgba(accent, 0));
		ctx.fillStyle = light;
		ctx.fillRect(0, 0, W, h);
	}
}

// The corner brackets of the Brothers Life look
function drawBrackets(ctx, accent, h) {
	const m = 18;
	const l = 40;
	ctx.strokeStyle = accent;
	ctx.lineWidth = 5;
	ctx.lineCap = 'square';
	for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, h - m, 1, -1], [W - m, h - m, -1, -1]]) {
		ctx.beginPath();
		ctx.moveTo(x, y + dy * l);
		ctx.lineTo(x, y);
		ctx.lineTo(x + dx * l, y);
		ctx.stroke();
	}
}

function drawHeader(ctx, { logo, name, state, since, right }) {
	let x = PAD;
	if (logo) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(PAD + 48, 92, 48, 0, Math.PI * 2);
		ctx.clip();
		drawCoverIn(ctx, logo, PAD, 44, 96, 96);
		ctx.restore();
		x = PAD + 118;
	}
	ctx.fillStyle = TEXT;
	ctx.font = '92px "Bebas Neue"';
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(fit(ctx, name.toUpperCase(), right - x), x, 122);

	ctx.font = '22px "Poppins SemiBold"';
	const pillWidth = ctx.measureText(state.label).width + 62;
	roundedRect(ctx, x, 142, pillWidth, 44, 22);
	ctx.fillStyle = rgba(state.color, 0.16);
	ctx.fill();
	ctx.strokeStyle = rgba(state.color, 0.55);
	ctx.lineWidth = 1.5;
	ctx.stroke();
	ctx.save();
	ctx.shadowColor = state.color;
	ctx.shadowBlur = 12;
	ctx.fillStyle = state.color;
	ctx.beginPath();
	ctx.arc(x + 24, 164, 8, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
	ctx.fillStyle = state.color;
	ctx.fillText(state.label, x + 42, 172);
	if (since) {
		ctx.fillStyle = MUTED;
		ctx.font = '22px "Poppins"';
		ctx.fillText(since, x + pillWidth + 18, 172);
	}
}

// A logo of any shape fills its circle
function drawCoverIn(ctx, image, x, y, w, h) {
	const scale = Math.max(w / image.width, h / image.height);
	ctx.drawImage(image, x + (w - image.width * scale) / 2, y + (h - image.height * scale) / 2, image.width * scale, image.height * scale);
}

function drawStats(ctx, stats, accent) {
	stats.forEach(([label, value], i) => {
		const x = PAD + i * 250;
		ctx.fillStyle = accent;
		ctx.fillRect(x, 222, 4, 86);
		ctx.fillStyle = MUTED;
		ctx.font = '20px "Poppins SemiBold"';
		ctx.fillText(label, x + 18, 246);
		ctx.fillStyle = TEXT;
		ctx.font = '66px "Bebas Neue"';
		ctx.fillText(value, x + 18, 304);
	});
}

function drawGauge(ctx, { players, max, online, accent }) {
	const cx = W - 190;
	const cy = 195;
	const r = 132;
	ctx.lineWidth = 24;
	ctx.lineCap = 'round';
	ctx.strokeStyle = 'rgba(255, 243, 230, 0.09)';
	ctx.beginPath();
	ctx.arc(cx, cy, r, 0, Math.PI * 2);
	ctx.stroke();
	const ratio = online && max ? Math.min(players / max, 1) : 0;
	if (ratio > 0) {
		ctx.save();
		ctx.shadowColor = accent;
		ctx.shadowBlur = 20;
		ctx.strokeStyle = accent;
		ctx.beginPath();
		ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.max(ratio, 0.015) * Math.PI * 2);
		ctx.stroke();
		ctx.restore();
	}
	ctx.textAlign = 'center';
	ctx.fillStyle = TEXT;
	ctx.font = '132px "Bebas Neue"';
	ctx.fillText(online ? String(players) : '—', cx, cy + 34);
	ctx.fillStyle = MUTED;
	ctx.font = '22px "Poppins SemiBold"';
	ctx.fillText(online && max ? `SUR ${max} PLACES` : 'JOUEURS', cx, cy + 76);
	ctx.textAlign = 'left';
}

function drawChart(ctx, { history, now, accent, window, top: titleY }) {
	const x0 = PAD + 12;
	const x1 = W - PAD - 12;
	const y0 = titleY + 24;
	const y1 = y0 + 136;
	const points = history.filter(p => p.at >= now - window && p.at <= now);
	const start = Math.max(now - window, Math.min(now - Math.min(MIN_WINDOW, window), points[0]?.at ?? now));
	const known = points.filter(p => p.players !== null);
	const peak = known.reduce((best, p) => (p.players > (best?.players ?? -1) ? p : best), null);

	ctx.fillStyle = MUTED;
	ctx.font = '20px "Poppins SemiBold"';
	ctx.fillText(`FRÉQUENTATION · ${formatDuration(now - start).toUpperCase()}`, x0, titleY);
	ctx.strokeStyle = FAINT;
	ctx.lineWidth = 1;
	for (const y of [y0, (y0 + y1) / 2, y1]) {
		ctx.beginPath();
		ctx.moveTo(x0, y);
		ctx.lineTo(x1, y);
		ctx.stroke();
	}
	ctx.font = '18px "Poppins"';
	ctx.fillText(`il y a ${formatDuration(now - start)}`, x0, y1 + 34);
	ctx.textAlign = 'right';
	ctx.fillText('maintenant', x1, y1 + 34);
	ctx.textAlign = 'left';

	if (known.length < 2) {
		ctx.fillStyle = MUTED;
		ctx.font = '22px "Poppins"';
		ctx.textAlign = 'center';
		ctx.fillText('La courbe se remplit au fil des minutes', (x0 + x1) / 2, (y0 + y1) / 2 + 6);
		ctx.textAlign = 'left';
		return;
	}
	const scaleTop = Math.max(10, Math.ceil((peak?.players ?? 0) * 1.25));
	const px = at => x0 + ((at - start) / Math.max(now - start, 1)) * (x1 - x0);
	const py = players => y1 - (players / scaleTop) * (y1 - y0);

	// A gap (server down, bot restarted) cuts the curve
	const segments = [];
	let current = [];
	for (const p of points) {
		if (p.players === null) {
			if (current.length) segments.push(current);
			current = [];
		}
		else {
			current.push(p);
		}
	}
	if (current.length) segments.push(current);

	const fill = ctx.createLinearGradient(0, y0, 0, y1);
	fill.addColorStop(0, rgba(accent, 0.38));
	fill.addColorStop(1, rgba(accent, 0));
	for (const segment of segments) {
		ctx.beginPath();
		ctx.moveTo(px(segment[0].at), y1);
		for (const p of segment) ctx.lineTo(px(p.at), py(p.players));
		ctx.lineTo(px(segment.at(-1).at), y1);
		ctx.closePath();
		ctx.fillStyle = fill;
		ctx.fill();
		ctx.save();
		ctx.shadowColor = accent;
		ctx.shadowBlur = 10;
		ctx.strokeStyle = accent;
		ctx.lineWidth = 4;
		ctx.lineJoin = 'round';
		ctx.beginPath();
		segment.forEach((p, i) => (i ? ctx.lineTo(px(p.at), py(p.players)) : ctx.moveTo(px(p.at), py(p.players))));
		ctx.stroke();
		ctx.restore();
	}

	if (peak) {
		const x = px(peak.at);
		const y = py(peak.players);
		ctx.fillStyle = '#ffffff';
		ctx.beginPath();
		ctx.arc(x, y, 8, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = accent;
		ctx.beginPath();
		ctx.arc(x, y, 5, 0, Math.PI * 2);
		ctx.fill();
		ctx.font = '20px "Poppins SemiBold"';
		ctx.fillStyle = TEXT;
		ctx.textAlign = x > x1 - 80 ? 'right' : x < x0 + 80 ? 'left' : 'center';
		ctx.fillText(`PIC ${peak.players}`, x, Math.max(y - 18, y0 - 8));
		ctx.textAlign = 'left';
	}
}

// PNG of the status. `history`: [{ at, players | null }] oldest first; `design`: see normalizeStatusImage
export async function renderStatusCard({ server, status, history = [], now = Date.now(), design: input = {}, loadSource = null }) {
	registerFonts();
	const design = normalizeStatusImage(input);
	const { logo, background } = await pictures(design, loadSource);
	const accent = /^#[0-9a-f]{6}$/i.test(server.config?.color ?? '') ? server.config.color : '#ff9628';
	const maintenance = server.maintenance ?? null;
	const online = Boolean(status?.online);
	const state = maintenance ? STATES.maintenance : !status ? STATES.checking : online ? STATES.online : STATES.offline;
	const sinceAt = maintenance?.since ?? (online ? status.onlineSince : null);
	const window = design.chartHours * 3_600_000;
	const pings = online ? status.list.map(p => p.ping).filter(Number.isFinite) : [];
	const ping = pings.length ? Math.round(pings.reduce((sum, p) => sum + p, 0) / pings.length) : null;
	const known = history.filter(p => p.at >= now - window && p.players !== null).map(p => p.players);
	const peak = Math.max(online ? status.players : 0, ...known, 0);
	const stats = [
		design.stats.ping && ['PING MOYEN', ping === null ? '—' : `${ping} MS`],
		design.stats.peak && [design.chart ? 'PIC' : `PIC ${design.chartHours} H`, String(peak)],
		design.stats.fill && ['REMPLISSAGE', online && status.max ? `${Math.round(Math.min(status.players / status.max, 1) * 100)} %` : '—'],
	].filter(Boolean);

	// The height follows what is shown: header, then the figures, then the curve
	const chartTop = stats.length ? 368 : 268;
	const contentBottom = design.chart ? chartTop + 24 + 136 + 72 : stats.length ? 340 : 230;
	const h = Math.max(contentBottom, design.gauge ? 380 : 0);

	const canvas = createCanvas(W, h);
	const ctx = canvas.getContext('2d');
	drawBackground(ctx, { background, accent, darkness: design.darkness, h, glow: design.gauge });
	if (design.brackets) drawBrackets(ctx, accent, h);
	drawHeader(ctx, {
		logo,
		name: design.title || server.name,
		state,
		since: design.since && sinceAt ? `depuis ${formatDuration(now - sinceAt)}` : null,
		right: design.gauge ? 800 : W - PAD,
	});
	if (stats.length) drawStats(ctx, stats, accent);
	if (design.gauge) drawGauge(ctx, { players: status?.players ?? 0, max: status?.max ?? 0, online, accent });
	if (design.chart) drawChart(ctx, { history, now, accent, window, top: chartTop });
	return canvas.encode('png');
}
