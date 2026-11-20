import { loadImage } from '@napi-rs/canvas';
import { fetchImage, registerFonts } from './cards.js';
import { brackets, cover, drawLines, drawLogo, fitText, panel } from './serverLinkMosaic.js';

const WIDTH = 1000;
const TINT = '#ff9628';
const INK = '#f5f1ec';
const MUTED = '#a89f95';
const DANGER = '#e5484d';
const COLOR = /^#[0-9a-f]{6}$/i;

const date = at => new Date(at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });

// "il y a 3 ans", "il y a 2 mois", "il y a 5 jours", "aujourd’hui"
export function since(at, now = Date.now()) {
	const days = Math.floor((now - at) / 86_400_000);
	if (days < 1) return 'aujourd’hui';
	if (days < 31) return `il y a ${days} jour${days > 1 ? 's' : ''}`;
	if (days < 365) return `il y a ${Math.floor(days / 30)} mois`;
	const years = Math.floor(days / 365);
	return `il y a ${years} an${years > 1 ? 's' : ''}`;
}

// Small labels side by side, wrapped on several lines; returns the height used
function chips(ctx, items, x, y, maxWidth) {
	let left = x;
	let top = y;
	ctx.font = '15px "Poppins SemiBold"';
	ctx.textBaseline = 'middle';
	ctx.textAlign = 'left';
	for (const item of items) {
		const text = item.label.length > 34 ? `${item.label.slice(0, 33)}…` : item.label;
		const width = ctx.measureText(text).width + 28;
		if (left + width > x + maxWidth && left > x) {
			left = x;
			top += 42;
		}
		ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
		ctx.beginPath();
		ctx.roundRect(left, top, width, 32, 16);
		ctx.fill();
		ctx.fillStyle = COLOR.test(item.color ?? '') && item.color !== '#000000' ? item.color : INK;
		ctx.fillText(text, left + 14, top + 17);
		left += width + 10;
	}
	return top + 32 - y;
}

function label(ctx, text, x, y) {
	ctx.font = '14px "Poppins SemiBold"';
	ctx.fillStyle = MUTED;
	ctx.textAlign = 'left';
	ctx.textBaseline = 'top';
	ctx.fillText(text.toUpperCase(), x, y);
}

function figure(ctx, x, y, width, title, value, sub, color) {
	ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
	ctx.beginPath();
	ctx.roundRect(x, y, width, 104, 16);
	ctx.fill();
	label(ctx, title, x + 18, y + 16);
	const fitted = fitText(ctx, value, { family: 'Poppins SemiBold', size: 22, minSize: 14, maxWidth: width - 36, maxLines: 1 });
	drawLines(ctx, fitted, x + 18, y + 42, { family: 'Poppins SemiBold', color });
	if (sub) {
		ctx.font = '14px "Poppins"';
		ctx.fillStyle = MUTED;
		ctx.textBaseline = 'top';
		ctx.fillText(sub, x + 18, y + 74);
	}
}

// The network file of a member as a picture.
// file: { name, username, id, avatar, createdAt, joinedAt, isOwner, ranks: [{ name, color }], guilds: [name],
//         sanctions: { total, warns, active, banned }, tempRoles: [{ name, expiresAt }] }
export async function renderMemberFile(file, { fetchImpl = fetch, accent = null, now = Date.now() } = {}) {
	registerFonts();
	const tint = COLOR.test(accent ?? '') ? accent : TINT;
	const measure = panel(10, 10).ctx;
	const ranks = file.isOwner ? [{ label: 'Chef du réseau', color: tint }] : file.ranks.map(r => ({ label: r.name, color: r.color }));
	const guilds = file.guilds.map(name => ({ label: name }));
	const temp = (file.tempRoles ?? []).slice(0, 6).map(t => ({ label: `${t.name} · fin ${since(now - (t.expiresAt - now), now).replace('il y a', 'dans')}` }));
	const rankRows = ranks.length ? chips(measure, ranks, 0, 0, WIDTH - 88) : 32;
	const guildRows = guilds.length ? chips(measure, guilds, 0, 0, WIDTH - 88) : 32;
	const tempRows = temp.length ? chips(measure, temp, 0, 0, WIDTH - 88) : 0;
	const height = 308 + 34 + rankRows + 20 + 34 + guildRows + (temp.length ? 20 + 34 + tempRows : 0) + 40;

	const { canvas, ctx } = panel(WIDTH, height);
	const avatar = file.avatar ? await fetchImage(file.avatar, { fetchImpl }).then(buffer => (buffer ? loadImage(buffer) : null)).catch(() => null) : null;
	if (avatar) {
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(740, 0);
		ctx.lineTo(WIDTH, 0);
		ctx.lineTo(WIDTH, 160);
		ctx.lineTo(676, 160);
		ctx.closePath();
		ctx.clip();
		cover(ctx, avatar, 676, -70, 324, 300);
		ctx.fillStyle = 'rgba(12, 9, 7, 0.45)';
		ctx.fillRect(676, 0, 324, 160);
		ctx.restore();
		ctx.strokeStyle = file.sanctions.banned ? DANGER : tint;
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(740, 0);
		ctx.lineTo(676, 160);
		ctx.stroke();
	}
	brackets(ctx, WIDTH, height, file.sanctions.banned ? DANGER : tint);
	drawLogo(ctx, avatar, file, 100, 88, 100, file.sanctions.banned ? DANGER : tint);
	ctx.textAlign = 'left';
	drawLines(ctx, fitText(ctx, file.name, { family: 'Bebas Neue', size: 56, minSize: 26, maxWidth: 480, maxLines: 1 }), 174, 40, { family: 'Bebas Neue', lineHeight: 1 });
	ctx.font = '16px "Poppins"';
	ctx.fillStyle = MUTED;
	ctx.textBaseline = 'top';
	ctx.fillText(`@${file.username} · ID ${file.id}`, 174, 98);
	if (file.sanctions.banned) {
		ctx.font = '15px "Poppins Bold"';
		const text = 'BANNI DU RÉSEAU';
		const width = ctx.measureText(text).width + 24;
		ctx.fillStyle = DANGER;
		ctx.beginPath();
		ctx.roundRect(174, 124, width, 28, 14);
		ctx.fill();
		ctx.fillStyle = '#ffffff';
		ctx.textBaseline = 'middle';
		ctx.fillText(text, 186, 139);
	}

	const gap = 14;
	const width = (WIDTH - 80 - gap * 2) / 3;
	figure(ctx, 40, 184, width, 'Compte créé', date(file.createdAt), since(file.createdAt, now), INK);
	figure(ctx, 40 + width + gap, 184, width, 'Arrivé ici', file.joinedAt ? date(file.joinedAt) : 'Pas sur ce serveur', file.joinedAt ? since(file.joinedAt, now) : '', INK);
	const s = file.sanctions;
	const risky = s.banned || s.active > 0;
	figure(ctx, 40 + (width + gap) * 2, 184, width, 'Sanctions', `${s.total} au total`, [s.warns ? `${s.warns} avertissement${s.warns > 1 ? 's' : ''} actif${s.warns > 1 ? 's' : ''}` : null, s.active ? `${s.active} en cours` : null].filter(Boolean).join(' · ') || 'Rien en cours', risky ? DANGER : s.total ? tint : INK);

	let y = 308;
	label(ctx, 'Rangs', 44, y);
	y += 28;
	if (ranks.length) {y += chips(ctx, ranks, 44, y, WIDTH - 88);}
	else {
		ctx.font = '15px "Poppins"';
		ctx.fillStyle = MUTED;
		ctx.fillText('Aucun rang', 44, y + 6);
		y += 32;
	}
	y += 20;
	label(ctx, `Serveurs du réseau (${guilds.length})`, 44, y);
	y += 28;
	if (guilds.length) {y += chips(ctx, guilds, 44, y, WIDTH - 88);}
	else {
		ctx.font = '15px "Poppins"';
		ctx.fillStyle = MUTED;
		ctx.fillText('Sur aucun serveur du réseau', 44, y + 6);
		y += 32;
	}
	if (temp.length) {
		y += 20;
		label(ctx, 'Rôles temporaires', 44, y);
		chips(ctx, temp, 44, y + 28, WIDTH - 88);
	}
	return canvas.toBuffer('image/png');
}
