// Picture of a FiveM server for its status message: name, state, players gauge and the curve of the last hours
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { registerFonts } from '../cards.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRAND_DIR = path.resolve(__dirname, '..', '..', '..', 'assets', 'brand');

export const STATUS_IMAGE_NAME = 'fivem-statut.png';
export const HISTORY_WINDOW = 6 * 3_600_000;
const MIN_WINDOW = 30 * 60_000;

const W = 1200;
const H = 600;
const PAD = 48;
const TEXT = '#fff3e6';
const MUTED = 'rgba(255, 243, 230, 0.58)';
const FAINT = 'rgba(255, 243, 230, 0.08)';
const STATES = {
	online: { label: 'EN LIGNE', color: '#43d17a' },
	offline: { label: 'HORS LIGNE', color: '#ed4245' },
	maintenance: { label: 'MAINTENANCE', color: '#f0b232' },
	checking: { label: 'VÉRIFICATION', color: '#9a8f86' },
};

let brand = null;
function brandImages() {
	brand ??= Promise.all([
		loadImage(path.join(BRAND_DIR, 'logo.png')).catch(() => null),
		loadImage(path.join(BRAND_DIR, 'status-background.webp')).catch(() => null),
	]).then(([logo, background]) => ({ logo, background }));
	return brand;
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

function drawBackground(ctx, background, accent) {
	ctx.fillStyle = '#0d0907';
	ctx.fillRect(0, 0, W, H);
	if (background) drawCover(ctx, background, W, H);
	const side = ctx.createLinearGradient(0, 0, W, 0);
	side.addColorStop(0, 'rgba(12, 8, 6, 0.95)');
	side.addColorStop(0.6, 'rgba(12, 8, 6, 0.82)');
	side.addColorStop(1, 'rgba(12, 8, 6, 0.6)');
	ctx.fillStyle = side;
	ctx.fillRect(0, 0, W, H);
	const low = ctx.createLinearGradient(0, H * 0.45, 0, H);
	low.addColorStop(0, 'rgba(12, 8, 6, 0)');
	low.addColorStop(1, 'rgba(12, 8, 6, 0.92)');
	ctx.fillStyle = low;
	ctx.fillRect(0, 0, W, H);
	const glow = ctx.createRadialGradient(W - 190, 195, 10, W - 190, 195, 380);
	glow.addColorStop(0, rgba(accent, 0.22));
	glow.addColorStop(1, rgba(accent, 0));
	ctx.fillStyle = glow;
	ctx.fillRect(0, 0, W, H);
}

// The corner brackets of the Brothers Life look
function drawBrackets(ctx, accent) {
	const m = 18;
	const l = 40;
	ctx.strokeStyle = accent;
	ctx.lineWidth = 5;
	ctx.lineCap = 'square';
	for (const [x, y, dx, dy] of [[m, m, 1, 1], [W - m, m, -1, 1], [m, H - m, 1, -1], [W - m, H - m, -1, -1]]) {
		ctx.beginPath();
		ctx.moveTo(x, y + dy * l);
		ctx.lineTo(x, y);
		ctx.lineTo(x + dx * l, y);
		ctx.stroke();
	}
}

function drawHeader(ctx, { logo, name, state, since }) {
	let x = PAD;
	if (logo) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(PAD + 48, 92, 48, 0, Math.PI * 2);
		ctx.clip();
		ctx.drawImage(logo, PAD, 44, 96, 96);
		ctx.restore();
		x = PAD + 118;
	}
	ctx.fillStyle = TEXT;
	ctx.font = '92px "Bebas Neue"';
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(fit(ctx, name.toUpperCase(), 800 - x), x, 122);

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

function drawChart(ctx, { history, now, accent }) {
	const x0 = PAD + 12;
	const x1 = W - PAD - 12;
	const y0 = 392;
	const y1 = 528;
	const points = history.filter(p => p.at >= now - HISTORY_WINDOW && p.at <= now);
	const start = Math.max(now - HISTORY_WINDOW, Math.min(now - MIN_WINDOW, points[0]?.at ?? now));
	const known = points.filter(p => p.players !== null);
	const peak = known.reduce((best, p) => (p.players > (best?.players ?? -1) ? p : best), null);

	ctx.fillStyle = MUTED;
	ctx.font = '20px "Poppins SemiBold"';
	ctx.fillText(`FRÉQUENTATION · ${formatDuration(now - start).toUpperCase()}`, x0, 368);
	ctx.strokeStyle = FAINT;
	ctx.lineWidth = 1;
	for (const y of [y0, (y0 + y1) / 2, y1]) {
		ctx.beginPath();
		ctx.moveTo(x0, y);
		ctx.lineTo(x1, y);
		ctx.stroke();
	}
	ctx.font = '18px "Poppins"';
	ctx.fillText(`il y a ${formatDuration(now - start)}`, x0, 562);
	ctx.textAlign = 'right';
	ctx.fillText('maintenant', x1, 562);
	ctx.textAlign = 'left';

	if (known.length < 2) {
		ctx.fillStyle = MUTED;
		ctx.font = '22px "Poppins"';
		ctx.textAlign = 'center';
		ctx.fillText('La courbe se remplit au fil des minutes', (x0 + x1) / 2, (y0 + y1) / 2 + 6);
		ctx.textAlign = 'left';
		return;
	}
	const top = Math.max(10, Math.ceil((peak?.players ?? 0) * 1.25));
	const px = at => x0 + ((at - start) / Math.max(now - start, 1)) * (x1 - x0);
	const py = players => y1 - (players / top) * (y1 - y0);

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

// PNG of the status. `history`: [{ at, players | null }] of the last hours, oldest first
export async function renderStatusCard({ server, status, history = [], now = Date.now() }) {
	registerFonts();
	const { logo, background } = await brandImages();
	const accent = /^#[0-9a-f]{6}$/i.test(server.config?.color ?? '') ? server.config.color : '#ff9628';
	const maintenance = server.maintenance ?? null;
	const online = Boolean(status?.online);
	const state = maintenance ? STATES.maintenance : !status ? STATES.checking : online ? STATES.online : STATES.offline;
	const sinceAt = maintenance?.since ?? (online ? status.onlineSince : null);
	const pings = online ? status.list.map(p => p.ping).filter(Number.isFinite) : [];
	const ping = pings.length ? Math.round(pings.reduce((sum, p) => sum + p, 0) / pings.length) : null;
	const known = history.filter(p => p.at >= now - HISTORY_WINDOW && p.players !== null).map(p => p.players);
	const peak = Math.max(online ? status.players : 0, ...known, 0);

	const canvas = createCanvas(W, H);
	const ctx = canvas.getContext('2d');
	drawBackground(ctx, background, accent);
	drawBrackets(ctx, accent);
	drawHeader(ctx, { logo, name: server.name, state, since: sinceAt ? `depuis ${formatDuration(now - sinceAt)}` : null });
	drawStats(ctx, [
		['PING MOYEN', ping === null ? '—' : `${ping} MS`],
		['PIC', String(peak)],
		['REMPLISSAGE', online && status.max ? `${Math.round(Math.min(status.players / status.max, 1) * 100)} %` : '—'],
	], accent);
	drawGauge(ctx, { players: status?.players ?? 0, max: status?.max ?? 0, online, accent });
	drawChart(ctx, { history, now, accent });
	return canvas.encode('png');
}
