import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts, loadImage } from '@napi-rs/canvas';
import { ValidationError } from './errors.js';
import { blockedUrl } from './netGuard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FONTS_DIR = path.resolve(__dirname, '..', '..', 'assets', 'fonts');

// Family name shown in the panel -> file
export const FONTS = {
	'Poppins': 'Poppins-Regular.ttf',
	'Poppins SemiBold': 'Poppins-SemiBold.ttf',
	'Poppins Bold': 'Poppins-Bold.ttf',
	'Poppins Black': 'Poppins-Black.ttf',
	'Bebas Neue': 'BebasNeue-Regular.ttf',
	'Pacifico': 'Pacifico-Regular.ttf',
	'Permanent Marker': 'PermanentMarker-Regular.ttf',
};
let fontsReady = false;
export function registerFonts() {
	if (fontsReady) return;
	for (const [family, file] of Object.entries(FONTS)) GlobalFonts.registerFromPath(path.join(FONTS_DIR, file), family);
	fontsReady = true;
}

const COLOR = /^#[0-9a-f]{6}$/i;
const IMAGE_SRC = /^(https:\/\/\S+|upload:[a-f0-9]{32}\.(png|jpg|webp|gif))$/;
const num = (value, min, max, fallback) => (Number.isFinite(value) ? Math.min(Math.max(Math.round(value), min), max) : fallback);
const color = (value, fallback) => (typeof value === 'string' && COLOR.test(value) ? value : fallback);
const src = value => (typeof value === 'string' && IMAGE_SRC.test(value) ? value : null);

export const DEFAULT_CARD = {
	width: 1024,
	height: 450,
	background: { type: 'gradient', color: '#1b1f3b', color2: '#d6a249', angle: 135, image: null, overlay: 0.35 },
	layers: [
		{ id: 'avatar', type: 'avatar', x: 512, y: 150, size: 170, shape: 'circle', borderWidth: 8, borderColor: '#ffffff' },
		{ id: 'title', type: 'text', x: 512, y: 320, text: 'Bienvenue {user.name} !', font: 'Poppins Black', size: 54, color: '#ffffff', align: 'center', maxWidth: 900, shadow: true, uppercase: false },
		{ id: 'subtitle', type: 'text', x: 512, y: 380, text: 'Tu es le membre n°{memberCount} de {server}', font: 'Poppins SemiBold', size: 30, color: '#f5e6c8', align: 'center', maxWidth: 900, shadow: true, uppercase: false },
	],
};

function normalizeLayer(layer, i, { width, height }) {
	const base = { id: typeof layer?.id === 'string' ? layer.id.slice(0, 40) : `layer${i + 1}`, x: num(layer?.x, -width, width * 2, 0), y: num(layer?.y, -height, height * 2, 0) };
	switch (layer?.type) {
	case 'avatar':
		return {
			...base, type: 'avatar', size: num(layer.size, 16, 1024, 160), shape: ['circle', 'rounded', 'square'].includes(layer.shape) ? layer.shape : 'circle',
			borderWidth: num(layer.borderWidth, 0, 40, 0), borderColor: color(layer.borderColor, '#ffffff'),
		};
	case 'text':
		return {
			...base, type: 'text', text: String(layer.text ?? '').slice(0, 200), font: FONTS[layer.font] ? layer.font : 'Poppins Bold', size: num(layer.size, 8, 200, 40),
			color: color(layer.color, '#ffffff'), align: ['left', 'center', 'right'].includes(layer.align) ? layer.align : 'left',
			maxWidth: num(layer.maxWidth, 20, 4096, width), shadow: Boolean(layer.shadow), uppercase: Boolean(layer.uppercase),
		};
	case 'rect':
		return {
			...base, type: 'rect', w: num(layer.w, 1, 4096, 100), h: num(layer.h, 1, 4096, 100), color: color(layer.color, '#000000'),
			opacity: Math.min(Math.max(Number(layer.opacity) || 0, 0), 1), radius: num(layer.radius, 0, 500, 0),
		};
	case 'image':
		return { ...base, type: 'image', w: num(layer.w, 1, 4096, 128), h: num(layer.h, 1, 4096, 128), src: src(layer.src), radius: num(layer.radius, 0, 500, 0) };
	default:
		throw new ValidationError(`Calque ${i + 1} : type inconnu.`);
	}
}

export function normalizeCard(input) {
	if (!input) return structuredClone(DEFAULT_CARD);
	const width = num(input.width, 200, 2048, 1024);
	const height = num(input.height, 100, 2048, 450);
	const bg = input.background ?? {};
	const layers = Array.isArray(input.layers) ? input.layers : [];
	if (layers.length > 20) throw new ValidationError('20 calques maximum.');
	return {
		width,
		height,
		background: {
			type: ['color', 'gradient', 'image'].includes(bg.type) ? bg.type : 'color',
			color: color(bg.color, '#1b1f3b'),
			color2: color(bg.color2, '#d6a249'),
			angle: num(bg.angle, 0, 360, 135),
			image: src(bg.image),
			overlay: Math.min(Math.max(Number(bg.overlay) || 0, 0), 0.9),
		},
		layers: layers.map((l, i) => normalizeLayer(l, i, { width, height })),
	};
}

function roundedRect(ctx, x, y, w, h, r) {
	const radius = Math.min(r, w / 2, h / 2);
	ctx.beginPath();
	ctx.moveTo(x + radius, y);
	ctx.arcTo(x + w, y, x + w, y + h, radius);
	ctx.arcTo(x + w, y + h, x, y + h, radius);
	ctx.arcTo(x, y + h, x, y, radius);
	ctx.arcTo(x, y, x + w, y, radius);
	ctx.closePath();
}

// Draws the image as CSS "object-fit: cover" in the box
function drawCover(ctx, image, x, y, w, h) {
	const scale = Math.max(w / image.width, h / image.height);
	const sw = w / scale;
	const sh = h / scale;
	ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
}

export function fillVars(text, vars) {
	return text.replace(/\{([a-z.]+)\}/gi, (match, key) => (vars[key] !== undefined && vars[key] !== null ? String(vars[key]) : match));
}

// PNG of a card. `loadSource(src)` returns a Buffer for an https URL or "upload:<id>" (null if unavailable).
export async function renderCard(input, vars, { loadSource }) {
	registerFonts();
	const card = normalizeCard(input);
	const canvas = createCanvas(card.width, card.height);
	const ctx = canvas.getContext('2d');
	const images = new Map();
	const load = async (source) => {
		if (!source) return null;
		if (!images.has(source)) {
			const buffer = await loadSource(source).catch(() => null);
			images.set(source, buffer ? await loadImage(buffer).catch(() => null) : null);
		}
		return images.get(source);
	};

	// Background
	const bg = card.background;
	ctx.fillStyle = bg.color;
	ctx.fillRect(0, 0, card.width, card.height);
	if (bg.type === 'gradient') {
		// Same convention as CSS linear-gradient: 0deg goes up, 90deg goes right
		const rad = (bg.angle * Math.PI) / 180;
		const dx = Math.sin(rad);
		const dy = -Math.cos(rad);
		const half = Math.abs(card.width * dx) / 2 + Math.abs(card.height * dy) / 2;
		const cx = card.width / 2;
		const cy = card.height / 2;
		const gradient = ctx.createLinearGradient(cx - dx * half, cy - dy * half, cx + dx * half, cy + dy * half);
		gradient.addColorStop(0, bg.color);
		gradient.addColorStop(1, bg.color2);
		ctx.fillStyle = gradient;
		ctx.fillRect(0, 0, card.width, card.height);
	}
	if (bg.type === 'image') {
		const image = await load(bg.image);
		if (image) drawCover(ctx, image, 0, 0, card.width, card.height);
	}
	if (bg.overlay) {
		ctx.fillStyle = `rgba(0, 0, 0, ${bg.overlay})`;
		ctx.fillRect(0, 0, card.width, card.height);
	}

	for (const layer of card.layers) {
		ctx.save();
		if (layer.type === 'rect') {
			ctx.globalAlpha = layer.opacity;
			ctx.fillStyle = layer.color;
			roundedRect(ctx, layer.x, layer.y, layer.w, layer.h, layer.radius);
			ctx.fill();
		}
		else if (layer.type === 'image') {
			const image = await load(layer.src);
			if (image) {
				roundedRect(ctx, layer.x, layer.y, layer.w, layer.h, layer.radius);
				ctx.clip();
				drawCover(ctx, image, layer.x, layer.y, layer.w, layer.h);
			}
		}
		else if (layer.type === 'avatar') {
			// x, y: centre of the avatar
			const { size } = layer;
			const x = layer.x - size / 2;
			const y = layer.y - size / 2;
			const radius = layer.shape === 'circle' ? size / 2 : layer.shape === 'rounded' ? size / 6 : 0;
			if (layer.borderWidth) {
				ctx.fillStyle = layer.borderColor;
				roundedRect(ctx, x - layer.borderWidth, y - layer.borderWidth, size + layer.borderWidth * 2, size + layer.borderWidth * 2, radius + layer.borderWidth);
				ctx.fill();
			}
			roundedRect(ctx, x, y, size, size, radius);
			ctx.clip();
			const image = await load(vars.avatarUrl);
			if (image) {drawCover(ctx, image, x, y, size, size);}
			else {
				ctx.fillStyle = '#5865f2';
				ctx.fillRect(x, y, size, size);
			}
		}
		else if (layer.type === 'text') {
			let text = fillVars(layer.text, vars);
			if (layer.uppercase) text = text.toUpperCase();
			let size = layer.size;
			ctx.font = `${size}px "${layer.font}"`;
			// Too wide: shrink until it fits (down to 40 % of the size)
			while (ctx.measureText(text).width > layer.maxWidth && size > layer.size * 0.4) {
				size -= 2;
				ctx.font = `${size}px "${layer.font}"`;
			}
			ctx.textAlign = layer.align;
			ctx.textBaseline = 'middle';
			if (layer.shadow) {
				ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
				ctx.shadowBlur = Math.round(size / 5);
				ctx.shadowOffsetY = Math.round(size / 14);
			}
			ctx.fillStyle = layer.color;
			ctx.fillText(text, layer.x, layer.y, layer.maxWidth);
		}
		ctx.restore();
	}
	return canvas.encode('png');
}

// Downloads an https image with a size and time limit
export async function fetchImage(url, { fetchImpl = fetch, maxBytes = 8 * 1024 * 1024, timeoutMs = 5000 } = {}) {
	// Redirects followed by hand: each hop is checked (never the local network or metadata endpoints)
	let target = url;
	let response = null;
	for (let hop = 0; hop < 4; hop++) {
		if (!/^https:\/\//.test(target) || blockedUrl(target)) return null;
		response = await fetchImpl(target, { signal: AbortSignal.timeout(timeoutMs), redirect: 'manual' });
		const next = response.status >= 300 && response.status < 400 ? response.headers?.get?.('location') : null;
		if (!next) break;
		target = new URL(next, target).href;
		response = null;
	}
	if (!response?.ok) return null;
	if (Number(response.headers.get('content-length') ?? 0) > maxBytes) return null;
	const buffer = Buffer.from(await response.arrayBuffer());
	return buffer.length > maxBytes ? null : buffer;
}
