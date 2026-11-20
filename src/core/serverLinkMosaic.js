import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fetchImage, registerFonts } from './cards.js';

// Always the same width: every category embed then has the same size on Discord, whatever its number of servers
const WIDTH = 1000;
const PER_ROW = 5;
const MARGIN = 34;
const GAP = 14;
const TILE_WIDTH = (WIDTH - MARGIN * 2 - GAP * (PER_ROW - 1)) / PER_ROW;
const TILE_HEIGHT = 168;
const LOGO = 88;
const COLOR = /^#[0-9a-f]{6}$/i;
export const MAX_TILES = 25;

function shorten(ctx, text, maxWidth) {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let out = text;
	while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
	return `${out.trimEnd()}…`;
}

// "Brackets" of the Brothers Life look: an L in each corner
function brackets(ctx, width, height, color) {
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

// One image with the logo and the name of each server (tiles: [{ name, icon }]): a Discord embed shows a
// single image, so the logos of a whole category are drawn together. Warm dark panel: readable in both themes.
export async function renderMosaic(tiles, { fetchImpl = fetch, accent = null } = {}) {
	registerFonts();
	const list = tiles.slice(0, MAX_TILES);
	const tint = COLOR.test(accent ?? '') ? accent : '#ff9628';
	const rows = Math.max(1, Math.ceil(list.length / PER_ROW));
	const height = MARGIN * 2 + rows * TILE_HEIGHT + (rows - 1) * GAP;
	const canvas = createCanvas(WIDTH, height);
	const ctx = canvas.getContext('2d');

	const background = ctx.createLinearGradient(0, 0, WIDTH, height);
	background.addColorStop(0, '#1b1612');
	background.addColorStop(1, '#100d0b');
	ctx.fillStyle = background;
	ctx.beginPath();
	ctx.roundRect(0, 0, WIDTH, height, 22);
	ctx.fill();
	brackets(ctx, WIDTH, height, tint);

	const images = await Promise.all(list.map(async (tile) => {
		if (!tile.icon) return null;
		const buffer = await fetchImage(tile.icon, { fetchImpl }).catch(() => null);
		return buffer ? await loadImage(buffer).catch(() => null) : null;
	}));

	ctx.textAlign = 'center';
	for (const [index, tile] of list.entries()) {
		const row = Math.floor(index / PER_ROW);
		// An incomplete row is centred
		const inRow = Math.min(PER_ROW, list.length - row * PER_ROW);
		const rowWidth = inRow * TILE_WIDTH + (inRow - 1) * GAP;
		const left = (WIDTH - rowWidth) / 2 + (index % PER_ROW) * (TILE_WIDTH + GAP);
		const top = MARGIN + row * (TILE_HEIGHT + GAP);
		const centerX = left + TILE_WIDTH / 2;
		const centerY = top + 22 + LOGO / 2;

		ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
		ctx.beginPath();
		ctx.roundRect(left, top, TILE_WIDTH, TILE_HEIGHT, 16);
		ctx.fill();
		ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.save();
		ctx.beginPath();
		ctx.arc(centerX, centerY, LOGO / 2, 0, Math.PI * 2);
		ctx.clip();
		if (images[index]) {
			ctx.drawImage(images[index], centerX - LOGO / 2, centerY - LOGO / 2, LOGO, LOGO);
		}
		else {
			// No logo: the initials, like Discord does
			ctx.fillStyle = '#2a231d';
			ctx.fillRect(centerX - LOGO / 2, centerY - LOGO / 2, LOGO, LOGO);
			ctx.fillStyle = tint;
			ctx.font = '32px "Poppins Bold"';
			ctx.textBaseline = 'middle';
			ctx.fillText(tile.name.split(/\s+/).map(word => word[0]).join('').slice(0, 3).toUpperCase(), centerX, centerY + 2);
		}
		ctx.restore();
		// Ring in the colour of the category
		ctx.strokeStyle = tint;
		ctx.lineWidth = 3;
		ctx.beginPath();
		ctx.arc(centerX, centerY, LOGO / 2 + 4, 0, Math.PI * 2);
		ctx.stroke();

		ctx.fillStyle = '#f5f1ec';
		ctx.font = '17px "Poppins SemiBold"';
		ctx.textBaseline = 'top';
		ctx.fillText(shorten(ctx, tile.name, TILE_WIDTH - 20), centerX, top + 22 + LOGO + 16);
	}
	return canvas.toBuffer('image/png');
}
