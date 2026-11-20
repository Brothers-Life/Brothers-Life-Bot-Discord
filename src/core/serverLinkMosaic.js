import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fetchImage, registerFonts } from './cards.js';

// Images of the links between servers. A Discord embed shows a single image, so the logos of a whole category
// are drawn together. Always the same width: every embed then has the same size, whatever its content.
const WIDTH = 1000;
const COLOR = /^#[0-9a-f]{6}$/i;
const INK = '#f5f1ec';
const MUTED = '#a89f95';
export const MAX_TILES = 25;
export const IMAGE_STYLES = ['tiles', 'slices', 'rows', 'banner'];

const initials = name => name.split(/\s+/).map(word => word[0]).join('').slice(0, 3).toUpperCase();
const number = value => Number(value).toLocaleString('fr-FR').replace(/\s/g, ' ');

// What is known of a server, as short texts ("1 234 membres")
function statsOf(tile) {
	const out = [];
	if (Number.isFinite(tile.members)) out.push(`${number(tile.members)} membre${tile.members > 1 ? 's' : ''}`);
	if (Number.isFinite(tile.voice) && tile.voice > 0) out.push(`${number(tile.voice)} en vocal`);
	if (Number.isFinite(tile.boosts) && tile.boosts > 0) out.push(`${number(tile.boosts)} boost${tile.boosts > 1 ? 's' : ''}`);
	return out;
}

// A text on at most `maxLines` lines of `maxWidth`: the font shrinks before anything is cut
export function fitText(ctx, text, { family, size, minSize, maxWidth, maxLines }) {
	const words = text.split(/\s+/).filter(Boolean);
	for (let current = size; current >= minSize; current -= 1) {
		ctx.font = `${current}px "${family}"`;
		const lines = [];
		let line = '';
		for (const word of words) {
			const next = line ? `${line} ${word}` : word;
			if (line && ctx.measureText(next).width > maxWidth) {
				lines.push(line);
				line = word;
			}
			else {
				line = next;
			}
		}
		if (line) lines.push(line);
		if (lines.length <= maxLines && lines.every(l => ctx.measureText(l).width <= maxWidth)) return { lines, size: current };
	}
	// Still too long at the smallest size: cut with an ellipsis
	ctx.font = `${minSize}px "${family}"`;
	const lines = [];
	let rest = text;
	while (rest && lines.length < maxLines) {
		let cut = rest.length;
		while (cut > 1 && ctx.measureText(rest.slice(0, cut)).width > maxWidth) cut -= 1;
		const last = lines.length === maxLines - 1 && cut < rest.length;
		lines.push(last ? `${rest.slice(0, Math.max(1, cut - 1)).trimEnd()}…` : rest.slice(0, cut).trimEnd());
		rest = rest.slice(cut).trimStart();
	}
	return { lines, size: minSize };
}

export function drawLines(ctx, fitted, x, y, { family, lineHeight = 1.2, color = INK }) {
	ctx.font = `${fitted.size}px "${family}"`;
	ctx.fillStyle = color;
	ctx.textBaseline = 'top';
	fitted.lines.forEach((line, index) => ctx.fillText(line, x, y + index * fitted.size * lineHeight));
	return fitted.lines.length * fitted.size * lineHeight;
}

// "Brackets" of the Brothers Life look: an L in each corner
export function brackets(ctx, width, height, color) {
	const inset = 12;
	const length = 26;
	ctx.strokeStyle = color;
	ctx.lineWidth = 3;
	ctx.lineCap = 'square';
	for (const [x, y, dx, dy] of [[inset, inset, 1, 1], [width - inset, inset, -1, 1], [inset, height - inset, 1, -1], [width - inset, height - inset, -1, -1]]) {
		ctx.beginPath();
		ctx.moveTo(x + dx * length, y);
		ctx.lineTo(x, y);
		ctx.lineTo(x, y + dy * length);
		ctx.stroke();
	}
}

export function panel(width, height) {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	const background = ctx.createLinearGradient(0, 0, width, height);
	background.addColorStop(0, '#1b1612');
	background.addColorStop(1, '#100d0b');
	ctx.fillStyle = background;
	ctx.beginPath();
	ctx.roundRect(0, 0, width, height, 22);
	ctx.fill();
	ctx.clip();
	return { canvas, ctx };
}

// Logo in a circle with a ring, or the initials when the server has none
export function drawLogo(ctx, image, tile, centerX, centerY, size, tint) {
	ctx.save();
	ctx.beginPath();
	ctx.arc(centerX, centerY, size / 2, 0, Math.PI * 2);
	ctx.clip();
	if (image) {
		ctx.drawImage(image, centerX - size / 2, centerY - size / 2, size, size);
	}
	else {
		ctx.fillStyle = '#2a231d';
		ctx.fillRect(centerX - size / 2, centerY - size / 2, size, size);
		ctx.fillStyle = tint;
		ctx.font = `${Math.round(size * 0.36)}px "Poppins Bold"`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(initials(tile.name), centerX, centerY + 2);
	}
	ctx.restore();
	ctx.strokeStyle = tint;
	ctx.lineWidth = Math.max(2, size / 30);
	ctx.beginPath();
	ctx.arc(centerX, centerY, size / 2 + 4, 0, Math.PI * 2);
	ctx.stroke();
}

// An image covering a box (cropped, never stretched)
export function cover(ctx, image, x, y, width, height) {
	const scale = Math.max(width / image.width, height / image.height);
	const w = image.width * scale;
	const h = image.height * scale;
	ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
}

// --- tiles: a grid of cards, logo above the full name -----------------------------------------------------------
function renderTiles(list, images, { tint, columns, names, stats }) {
	const margin = 34;
	const gap = 14;
	const tileWidth = (WIDTH - margin * 2 - gap * (columns - 1)) / columns;
	const logo = Math.min(120, tileWidth - 70);
	const measure = createCanvas(10, 10).getContext('2d');
	const fitted = list.map(tile => (names ? fitText(measure, tile.name, { family: 'Poppins SemiBold', size: 18, minSize: 12, maxWidth: tileWidth - 22, maxLines: 3 }) : null));
	const nameHeight = names ? Math.max(...fitted.map(f => f.lines.length * f.size * 1.2)) : 0;
	const statHeight = stats ? 24 : 0;
	const tileHeight = 22 + logo + (names ? 16 + nameHeight : 0) + statHeight + 20;
	const rows = Math.max(1, Math.ceil(list.length / columns));
	const height = margin * 2 + rows * tileHeight + (rows - 1) * gap;
	const { canvas, ctx } = panel(WIDTH, height);
	brackets(ctx, WIDTH, height, tint);

	for (const [index, tile] of list.entries()) {
		const row = Math.floor(index / columns);
		// An incomplete row is centred
		const inRow = Math.min(columns, list.length - row * columns);
		const rowWidth = inRow * tileWidth + (inRow - 1) * gap;
		const left = (WIDTH - rowWidth) / 2 + (index % columns) * (tileWidth + gap);
		const top = margin + row * (tileHeight + gap);
		const centerX = left + tileWidth / 2;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
		ctx.beginPath();
		ctx.roundRect(left, top, tileWidth, tileHeight, 16);
		ctx.fill();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
		ctx.lineWidth = 1;
		ctx.stroke();
		drawLogo(ctx, images[index], tile, centerX, top + 22 + logo / 2, logo, tint);
		ctx.textAlign = 'center';
		if (names) {
			// Shorter names are centred in the space of the longest one
			const own = fitted[index].lines.length * fitted[index].size * 1.2;
			drawLines(ctx, fitted[index], centerX, top + 22 + logo + 16 + (nameHeight - own) / 2, { family: 'Poppins SemiBold' });
		}
		if (stats) {
			ctx.font = '14px "Poppins"';
			ctx.fillStyle = tint;
			ctx.textBaseline = 'top';
			ctx.fillText(statsOf(tile)[0] ?? '', centerX, top + tileHeight - 20 - 16);
		}
	}
	return canvas;
}

// --- slices: the logos in large, cut along diagonals -----------------------------------------------------------
function renderSlices(list, images, { tint, columns, names, stats }) {
	const perRow = Math.max(2, Math.min(columns, 6));
	const rowCount = Math.max(1, Math.ceil(list.length / perRow));
	// Rows of the same length (7 servers: 4 + 3, not 5 + 2)
	const base = Math.ceil(list.length / rowCount);
	const rowHeight = rowCount === 1 ? 340 : 280;
	const gapY = 8;
	const height = rowCount * rowHeight + (rowCount - 1) * gapY;
	const { canvas, ctx } = panel(WIDTH, height);
	const skew = 70;

	let index = 0;
	for (let row = 0; row < rowCount; row++) {
		const count = Math.min(base, list.length - index);
		const top = row * (rowHeight + gapY);
		const step = (WIDTH + skew) / Math.max(count, 1);
		for (let i = 0; i < count; i++, index++) {
			const tile = list[index];
			const x0 = i * step - skew;
			// Parallelogram leaning to the right; the first and the last reach the edges of the image
			const path = () => {
				ctx.beginPath();
				ctx.moveTo(i === 0 ? 0 : x0 + skew, top);
				ctx.lineTo(i === count - 1 ? WIDTH : x0 + step + skew, top);
				ctx.lineTo(i === count - 1 ? WIDTH : x0 + step, top + rowHeight);
				ctx.lineTo(i === 0 ? 0 : x0, top + rowHeight);
				ctx.closePath();
			};
			ctx.save();
			path();
			ctx.clip();
			const boxX = Math.max(0, x0);
			const boxWidth = step + skew;
			if (images[index]) {
				cover(ctx, images[index], boxX - 10, top, boxWidth + 20, rowHeight);
			}
			else {
				const fill = ctx.createLinearGradient(boxX, top, boxX + boxWidth, top + rowHeight);
				fill.addColorStop(0, '#2c241d');
				fill.addColorStop(1, '#17120f');
				ctx.fillStyle = fill;
				ctx.fillRect(boxX - 10, top, boxWidth + 20, rowHeight);
				ctx.fillStyle = tint;
				ctx.globalAlpha = 0.9;
				ctx.font = `${Math.round(rowHeight * 0.3)}px "Bebas Neue"`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'middle';
				ctx.fillText(initials(tile.name), x0 + skew / 2 + step / 2 + (i === 0 ? skew / 4 : 0), top + rowHeight * 0.42);
				ctx.globalAlpha = 1;
			}
			// Shade at the bottom for the name
			if (names || stats) {
				const shade = ctx.createLinearGradient(0, top + rowHeight * 0.45, 0, top + rowHeight);
				shade.addColorStop(0, 'rgba(10, 8, 6, 0)');
				shade.addColorStop(0.55, 'rgba(10, 8, 6, 0.78)');
				shade.addColorStop(1, 'rgba(10, 8, 6, 0.95)');
				ctx.fillStyle = shade;
				ctx.fillRect(boxX - 10, top + rowHeight * 0.45, boxWidth + 20, rowHeight * 0.55);
				// The text sits in the part of the slice that is never cut by its neighbours at the bottom
				// (the cut leans: at the height of the text it is further right than at the very bottom)
				const textLeft = i === 0 ? 18 : x0 + skew * 0.42 + 16;
				const textWidth = Math.max(60, (i === count - 1 ? WIDTH - 18 : x0 + step - 14) - textLeft);
				const stat = stats ? statsOf(tile)[0] : null;
				const fitted = names ? fitText(ctx, tile.name, { family: 'Bebas Neue', size: 34, minSize: 17, maxWidth: textWidth, maxLines: 2 }) : { lines: [], size: 0 };
				const block = fitted.lines.length * fitted.size * 1.05 + (stat ? 22 : 0);
				ctx.textAlign = 'left';
				let y = top + rowHeight - 16 - block;
				if (names) y += drawLines(ctx, fitted, textLeft, y, { family: 'Bebas Neue', lineHeight: 1.05 });
				if (stat) {
					ctx.font = '15px "Poppins SemiBold"';
					ctx.fillStyle = tint;
					ctx.textBaseline = 'top';
					ctx.fillText(stat, textLeft, y + 2);
				}
			}
			ctx.restore();
			// Bright edge along the cut
			if (i > 0) {
				ctx.strokeStyle = tint;
				ctx.lineWidth = 5;
				ctx.beginPath();
				ctx.moveTo(x0 + skew, top);
				ctx.lineTo(x0, top + rowHeight);
				ctx.stroke();
			}
		}
	}
	return canvas;
}

// --- rows: one line per server, logo, full name and statistics ---------------------------------------------------
function renderRows(list, images, { tint, names, stats }) {
	const margin = 30;
	const rowHeight = 84;
	const gap = 10;
	const height = margin * 2 + list.length * rowHeight + Math.max(0, list.length - 1) * gap;
	const { canvas, ctx } = panel(WIDTH, Math.max(height, margin * 2 + rowHeight));
	brackets(ctx, WIDTH, canvas.height, tint);
	for (const [index, tile] of list.entries()) {
		const top = margin + index * (rowHeight + gap);
		ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
		ctx.beginPath();
		ctx.roundRect(margin, top, WIDTH - margin * 2, rowHeight, 14);
		ctx.fill();
		ctx.fillStyle = tint;
		ctx.beginPath();
		ctx.roundRect(margin, top + 14, 5, rowHeight - 28, 3);
		ctx.fill();
		drawLogo(ctx, images[index], tile, margin + 58, top + rowHeight / 2, 54, tint);
		const info = stats ? statsOf(tile).join('  ·  ') : '';
		ctx.font = '16px "Poppins SemiBold"';
		const infoWidth = info ? ctx.measureText(info).width + 30 : 0;
		const textLeft = margin + 104;
		const textWidth = WIDTH - margin - 24 - infoWidth - textLeft;
		if (names) {
			const fitted = fitText(ctx, tile.name, { family: 'Poppins SemiBold', size: 24, minSize: 14, maxWidth: textWidth, maxLines: tile.description ? 1 : 2 });
			const sub = tile.description ? fitText(ctx, tile.description, { family: 'Poppins', size: 15, minSize: 13, maxWidth: textWidth, maxLines: 1 }) : null;
			const block = fitted.lines.length * fitted.size * 1.2 + (sub ? sub.size * 1.3 : 0);
			ctx.textAlign = 'left';
			let y = top + (rowHeight - block) / 2;
			y += drawLines(ctx, fitted, textLeft, y, { family: 'Poppins SemiBold' });
			if (sub) drawLines(ctx, sub, textLeft, y, { family: 'Poppins', color: MUTED });
		}
		if (info) {
			ctx.font = '16px "Poppins SemiBold"';
			ctx.fillStyle = tint;
			ctx.textAlign = 'right';
			ctx.textBaseline = 'middle';
			ctx.fillText(info, WIDTH - margin - 22, top + rowHeight / 2 + 1);
		}
	}
	return canvas;
}

// --- banner: one server, its logo in large behind a diagonal cut, name, description and statistics ----------------
function renderBanner(tile, image, { tint, stats }) {
	const height = 250;
	const { canvas, ctx } = panel(WIDTH, height);
	// Right part: the logo in large, cut along a diagonal
	ctx.save();
	ctx.beginPath();
	ctx.moveTo(620, 0);
	ctx.lineTo(WIDTH, 0);
	ctx.lineTo(WIDTH, height);
	ctx.lineTo(520, height);
	ctx.closePath();
	ctx.clip();
	if (image) {
		cover(ctx, image, 520, 0, WIDTH - 520, height);
		ctx.fillStyle = 'rgba(12, 9, 7, 0.28)';
		ctx.fillRect(520, 0, WIDTH - 520, height);
	}
	else {
		const fill = ctx.createLinearGradient(520, 0, WIDTH, height);
		fill.addColorStop(0, '#2c241d');
		fill.addColorStop(1, '#17120f');
		ctx.fillStyle = fill;
		ctx.fillRect(520, 0, WIDTH - 520, height);
		ctx.fillStyle = tint;
		ctx.font = '150px "Bebas Neue"';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(initials(tile.name), 790, height / 2 + 8);
	}
	ctx.restore();
	ctx.strokeStyle = tint;
	ctx.lineWidth = 6;
	ctx.beginPath();
	ctx.moveTo(620, 0);
	ctx.lineTo(520, height);
	ctx.stroke();
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
	ctx.lineWidth = 2;
	ctx.beginPath();
	ctx.moveTo(598, 0);
	ctx.lineTo(498, height);
	ctx.stroke();

	// Left part: the texts
	const left = 44;
	const maxWidth = 440;
	const lines = stats ? statsOf(tile) : [];
	const name = fitText(ctx, tile.name, { family: 'Bebas Neue', size: 64, minSize: 30, maxWidth, maxLines: 2 });
	const description = tile.description ? fitText(ctx, tile.description, { family: 'Poppins', size: 18, minSize: 14, maxWidth, maxLines: 2 }) : null;
	const block = name.lines.length * name.size * 1.02 + (description ? 8 + description.lines.length * description.size * 1.3 : 0) + (lines.length ? 50 : 0);
	ctx.textAlign = 'left';
	let y = (height - block) / 2;
	ctx.fillStyle = tint;
	ctx.fillRect(left - 20, y + 4, 5, block - 8);
	y += drawLines(ctx, name, left, y, { family: 'Bebas Neue', lineHeight: 1.02 });
	if (description) y += 8 + drawLines(ctx, description, left, y + 8, { family: 'Poppins', lineHeight: 1.3, color: MUTED });
	if (lines.length) {
		// Statistics as small chips
		let x = left;
		y += 16;
		ctx.font = '15px "Poppins SemiBold"';
		ctx.textBaseline = 'middle';
		for (const text of lines) {
			const width = ctx.measureText(text).width + 26;
			if (x + width > left + maxWidth + 40) break;
			ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
			ctx.beginPath();
			ctx.roundRect(x, y, width, 32, 16);
			ctx.fill();
			ctx.fillStyle = tint;
			ctx.fillText(text, x + 13, y + 17);
			x += width + 10;
		}
	}
	return canvas;
}

// tiles: [{ name, icon, description, members, voice, boosts }]
// options: style ('tiles' | 'slices' | 'rows' | 'banner': the first server only), columns (2 to 6), names, stats, accent
export async function renderMosaic(tiles, { fetchImpl = fetch, accent = null, style = 'tiles', columns = 5, names = true, stats = false } = {}) {
	registerFonts();
	const list = tiles.slice(0, style === 'banner' ? 1 : MAX_TILES);
	const images = await Promise.all(list.map(async (tile) => {
		if (!tile.icon) return null;
		const buffer = await fetchImage(tile.icon, { fetchImpl }).catch(() => null);
		return buffer ? await loadImage(buffer).catch(() => null) : null;
	}));
	const options = {
		tint: COLOR.test(accent ?? '') ? accent : '#ff9628',
		columns: Math.min(6, Math.max(2, Number.isInteger(columns) ? columns : 5)),
		names: names !== false,
		stats: Boolean(stats),
	};
	const canvas = style === 'banner' ? renderBanner(list[0] ?? { name: '' }, images[0], options)
		: style === 'slices' ? renderSlices(list, images, options)
			: style === 'rows' ? renderRows(list, images, options)
				: renderTiles(list, images, options);
	return canvas.toBuffer('image/png');
}
