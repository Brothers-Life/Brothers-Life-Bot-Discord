import { createCanvas, loadImage } from '@napi-rs/canvas';
import { fetchImage, registerFonts } from './cards.js';

const PER_ROW = 5;
const TILE_WIDTH = 150;
const TILE_HEIGHT = 150;
const LOGO = 92;
const PADDING = 14;
export const MAX_TILES = 25;

function shorten(ctx, text, maxWidth) {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let out = text;
	while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
	return `${out.trimEnd()}…`;
}

// One image with the logo and the name of each server (tiles: [{ name, icon }]): a Discord embed shows a
// single image, so the logos of a whole category are drawn together. Dark panel: readable in both themes.
export async function renderMosaic(tiles, { fetchImpl = fetch } = {}) {
	registerFonts();
	const list = tiles.slice(0, MAX_TILES);
	const columns = Math.max(1, Math.min(list.length, PER_ROW));
	const rows = Math.max(1, Math.ceil(list.length / PER_ROW));
	const canvas = createCanvas(columns * TILE_WIDTH + PADDING * 2, rows * TILE_HEIGHT + PADDING * 2);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = '#1e1f22';
	ctx.beginPath();
	ctx.roundRect(0, 0, canvas.width, canvas.height, 18);
	ctx.fill();

	const images = await Promise.all(list.map(async (tile) => {
		if (!tile.icon) return null;
		const buffer = await fetchImage(tile.icon, { fetchImpl }).catch(() => null);
		return buffer ? await loadImage(buffer).catch(() => null) : null;
	}));

	ctx.textAlign = 'center';
	for (const [index, tile] of list.entries()) {
		const centerX = PADDING + (index % PER_ROW) * TILE_WIDTH + TILE_WIDTH / 2;
		const top = PADDING + Math.floor(index / PER_ROW) * TILE_HEIGHT + 10;
		const centerY = top + LOGO / 2;
		ctx.save();
		ctx.beginPath();
		ctx.arc(centerX, centerY, LOGO / 2, 0, Math.PI * 2);
		ctx.clip();
		if (images[index]) {
			ctx.drawImage(images[index], centerX - LOGO / 2, top, LOGO, LOGO);
		}
		else {
			// No logo: the initials, like Discord does
			ctx.fillStyle = '#35373c';
			ctx.fillRect(centerX - LOGO / 2, top, LOGO, LOGO);
			ctx.fillStyle = '#dbdee1';
			ctx.font = '34px "Poppins SemiBold"';
			ctx.textBaseline = 'middle';
			ctx.fillText(tile.name.split(/\s+/).map(word => word[0]).join('').slice(0, 3).toUpperCase(), centerX, centerY + 2);
		}
		ctx.restore();
		ctx.fillStyle = '#f2f3f5';
		ctx.font = '15px "Poppins SemiBold"';
		ctx.textBaseline = 'top';
		ctx.fillText(shorten(ctx, tile.name, TILE_WIDTH - 14), centerX, top + LOGO + 10);
	}
	return canvas.toBuffer('image/png');
}
