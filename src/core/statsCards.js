import { loadImage } from '@napi-rs/canvas';
import { fetchImage, registerFonts } from './cards.js';
import { brackets, cover, drawLines, drawLogo, fitText, panel } from './serverLinkMosaic.js';

// Images of the /stats command, in the look of the network: warm dark panel, amber accents, corner brackets
const WIDTH = 1000;
const TINT = '#ff9628';
const INK = '#f5f1ec';
const MUTED = '#a89f95';
const MEDALS = ['#f6c453', '#c9d1d9', '#d08a4e'];
const COLOR = /^#[0-9a-f]{6}$/i;

const number = value => Number(value ?? 0).toLocaleString('fr-FR').replace(/\s/g, ' ');

async function load(url, fetchImpl) {
	if (!url) return null;
	const buffer = await fetchImage(url, { fetchImpl }).catch(() => null);
	return buffer ? await loadImage(buffer).catch(() => null) : null;
}

function heading(ctx, title, subtitle, tint) {
	ctx.fillStyle = tint;
	ctx.fillRect(40, 44, 6, 62);
	ctx.textAlign = 'left';
	drawLines(ctx, fitText(ctx, title.toUpperCase(), { family: 'Bebas Neue', size: 50, minSize: 26, maxWidth: WIDTH - 120, maxLines: 1 }), 62, 40, { family: 'Bebas Neue', lineHeight: 1 });
	if (subtitle) drawLines(ctx, fitText(ctx, subtitle, { family: 'Poppins', size: 17, minSize: 13, maxWidth: WIDTH - 120, maxLines: 1 }), 62, 88, { family: 'Poppins', color: MUTED });
}

function tile(ctx, x, y, width, height) {
	ctx.fillStyle = 'rgba(255, 255, 255, 0.045)';
	ctx.beginPath();
	ctx.roundRect(x, y, width, height, 16);
	ctx.fill();
	ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
	ctx.lineWidth = 1;
	ctx.stroke();
}

// A figure with its label under it
function figure(ctx, x, y, width, height, label, value, tint) {
	tile(ctx, x, y, width, height);
	ctx.textAlign = 'center';
	const fitted = fitText(ctx, String(value), { family: 'Bebas Neue', size: 46, minSize: 22, maxWidth: width - 24, maxLines: 1 });
	ctx.font = `${fitted.size}px "Bebas Neue"`;
	ctx.fillStyle = tint;
	ctx.textBaseline = 'middle';
	ctx.fillText(fitted.lines[0] ?? '', x + width / 2, y + height / 2 - 10);
	ctx.font = '14px "Poppins"';
	ctx.fillStyle = MUTED;
	ctx.fillText(label, x + width / 2, y + height - 22);
}

// entries: [{ name, avatar, value, label }] sorted, the best first (10 at most); label: "1 234 messages"
export async function renderLeaderboard({ title, subtitle = '', entries, accent = null }, { fetchImpl = fetch } = {}) {
	registerFonts();
	const tint = COLOR.test(accent ?? '') ? accent : TINT;
	const list = entries.slice(0, 10);
	const top = list.slice(0, 3);
	const rest = list.slice(3);
	const podiumTop = 136;
	const podiumHeight = top.length ? 236 : 0;
	const rowHeight = 58;
	const height = podiumTop + podiumHeight + (rest.length ? 20 + rest.length * (rowHeight + 8) : 0) + 40 + (list.length ? 0 : 80);
	const { canvas, ctx } = panel(WIDTH, height);
	brackets(ctx, WIDTH, height, tint);
	heading(ctx, title, subtitle, tint);
	const avatars = await Promise.all(list.map(entry => load(entry.avatar, fetchImpl)));

	if (!list.length) {
		ctx.textAlign = 'center';
		ctx.font = '20px "Poppins"';
		ctx.fillStyle = MUTED;
		ctx.textBaseline = 'middle';
		ctx.fillText('Pas encore de données sur cette période.', WIDTH / 2, podiumTop + 40);
		return canvas.toBuffer('image/png');
	}

	// Podium: the first in the middle and taller, as on a real one
	const order = top.length === 3 ? [1, 0, 2] : top.map((_, i) => i);
	const gap = 16;
	const cardWidth = (WIDTH - 80 - gap * (order.length - 1)) / Math.max(order.length, 1);
	order.forEach((rank, slot) => {
		const entry = top[rank];
		const lift = rank === 0 ? 0 : 26;
		const x = 40 + slot * (cardWidth + gap);
		const y = podiumTop + lift;
		const cardHeight = podiumHeight - lift;
		tile(ctx, x, y, cardWidth, cardHeight);
		ctx.fillStyle = MEDALS[rank];
		ctx.beginPath();
		ctx.roundRect(x, y, cardWidth, 6, [16, 16, 0, 0]);
		ctx.fill();
		const size = rank === 0 ? 96 : 80;
		const centerX = x + cardWidth / 2;
		drawLogo(ctx, avatars[rank], entry, centerX, y + 30 + size / 2, size, MEDALS[rank]);
		// Rank in a small disc on the avatar
		ctx.fillStyle = MEDALS[rank];
		ctx.beginPath();
		ctx.arc(centerX + size / 2 - 6, y + 30 + size - 8, 16, 0, Math.PI * 2);
		ctx.fill();
		ctx.fillStyle = '#17120f';
		ctx.font = '20px "Poppins Bold"';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(String(rank + 1), centerX + size / 2 - 6, y + 30 + size - 7);
		ctx.textAlign = 'center';
		const name = fitText(ctx, entry.name, { family: 'Poppins SemiBold', size: 20, minSize: 13, maxWidth: cardWidth - 24, maxLines: 1 });
		drawLines(ctx, name, centerX, y + 30 + size + 16, { family: 'Poppins SemiBold' });
		ctx.font = '26px "Bebas Neue"';
		ctx.fillStyle = tint;
		ctx.textBaseline = 'top';
		ctx.fillText(entry.label, centerX, y + 30 + size + 46);
	});

	// The others: rank, avatar, name, a bar against the best of them, the value
	const best = Math.max(...list.map(e => e.value), 1);
	rest.forEach((entry, index) => {
		const y = podiumTop + podiumHeight + 20 + index * (rowHeight + 8);
		tile(ctx, 40, y, WIDTH - 80, rowHeight);
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'center';
		ctx.font = '24px "Bebas Neue"';
		ctx.fillStyle = MUTED;
		ctx.fillText(String(index + 4), 72, y + rowHeight / 2 + 1);
		drawLogo(ctx, avatars[index + 3], entry, 124, y + rowHeight / 2, 38, tint);
		ctx.textAlign = 'left';
		const name = fitText(ctx, entry.name, { family: 'Poppins SemiBold', size: 19, minSize: 13, maxWidth: 300, maxLines: 1 });
		ctx.font = `${name.size}px "Poppins SemiBold"`;
		ctx.fillStyle = INK;
		ctx.fillText(name.lines[0] ?? '', 158, y + rowHeight / 2 + 1);
		const barLeft = 480;
		const barWidth = 300;
		ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
		ctx.beginPath();
		ctx.roundRect(barLeft, y + rowHeight / 2 - 5, barWidth, 10, 5);
		ctx.fill();
		ctx.fillStyle = tint;
		ctx.beginPath();
		ctx.roundRect(barLeft, y + rowHeight / 2 - 5, Math.max(10, barWidth * (entry.value / best)), 10, 5);
		ctx.fill();
		ctx.textAlign = 'right';
		ctx.font = '17px "Poppins SemiBold"';
		ctx.fillStyle = INK;
		ctx.fillText(entry.label, WIDTH - 62, y + rowHeight / 2 + 1);
	});
	return canvas.toBuffer('image/png');
}

// member: { name, avatar, messages, voiceHours, days, periodDays, rank, channels: [{ name, messages }] }
export async function renderMemberStats(member, { fetchImpl = fetch, accent = null } = {}) {
	registerFonts();
	const tint = COLOR.test(accent ?? '') ? accent : TINT;
	const channels = (member.channels ?? []).slice(0, 4);
	const height = 300 + (channels.length ? 50 + channels.length * 38 : 0);
	const { canvas, ctx } = panel(WIDTH, height);
	// The avatar in large on the right, behind a diagonal cut
	const avatar = await load(member.avatar, fetchImpl);
	if (avatar) {
		ctx.save();
		ctx.beginPath();
		ctx.moveTo(760, 0);
		ctx.lineTo(WIDTH, 0);
		ctx.lineTo(WIDTH, 150);
		ctx.lineTo(700, 150);
		ctx.closePath();
		ctx.clip();
		cover(ctx, avatar, 700, -60, 300, 270);
		ctx.fillStyle = 'rgba(12, 9, 7, 0.45)';
		ctx.fillRect(700, 0, 300, 150);
		ctx.restore();
		ctx.strokeStyle = tint;
		ctx.lineWidth = 5;
		ctx.beginPath();
		ctx.moveTo(760, 0);
		ctx.lineTo(700, 150);
		ctx.stroke();
	}
	brackets(ctx, WIDTH, height, tint);
	drawLogo(ctx, avatar, member, 98, 82, 96, tint);
	ctx.textAlign = 'left';
	drawLines(ctx, fitText(ctx, member.name, { family: 'Bebas Neue', size: 54, minSize: 26, maxWidth: 500, maxLines: 1 }), 168, 42, { family: 'Bebas Neue', lineHeight: 1 });
	drawLines(ctx, fitText(ctx, `Activité des ${member.periodDays} derniers jours`, { family: 'Poppins', size: 17, minSize: 13, maxWidth: 500, maxLines: 1 }), 168, 96, { family: 'Poppins', color: MUTED });

	const figures = [
		['Messages', number(member.messages)],
		['Heures en vocal', number(member.voiceHours)],
		['Jours actifs', `${member.days}/${member.periodDays}`],
		['Classement', member.messages ? `#${member.rank}` : '—'],
	];
	const gap = 14;
	const width = (WIDTH - 80 - gap * 3) / 4;
	figures.forEach(([label, value], i) => figure(ctx, 40 + i * (width + gap), 164, width, 110, label, value, tint));

	if (channels.length) {
		ctx.textAlign = 'left';
		ctx.font = '15px "Poppins SemiBold"';
		ctx.fillStyle = MUTED;
		ctx.textBaseline = 'top';
		ctx.fillText('SALONS PRÉFÉRÉS', 44, 298);
		const best = Math.max(...channels.map(c => c.messages), 1);
		channels.forEach((channel, i) => {
			const y = 330 + i * 38;
			ctx.textBaseline = 'middle';
			ctx.textAlign = 'left';
			const name = fitText(ctx, `# ${channel.name}`, { family: 'Poppins SemiBold', size: 17, minSize: 13, maxWidth: 300, maxLines: 1 });
			ctx.font = `${name.size}px "Poppins SemiBold"`;
			ctx.fillStyle = INK;
			ctx.fillText(name.lines[0] ?? '', 44, y + 12);
			ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
			ctx.beginPath();
			ctx.roundRect(370, y + 7, 460, 10, 5);
			ctx.fill();
			ctx.fillStyle = tint;
			ctx.beginPath();
			ctx.roundRect(370, y + 7, Math.max(10, 460 * (channel.messages / best)), 10, 5);
			ctx.fill();
			ctx.textAlign = 'right';
			ctx.font = '16px "Poppins SemiBold"';
			ctx.fillStyle = INK;
			ctx.fillText(number(channel.messages), WIDTH - 44, y + 12);
		});
	}
	return canvas.toBuffer('image/png');
}

// server: { name, icon, periodDays, totals: { messages, voiceHours, active, joins, leaves, memberCount, memberGrowth }, days: [{ messages }] }
export async function renderServerStats(server, { fetchImpl = fetch, accent = null } = {}) {
	registerFonts();
	const tint = COLOR.test(accent ?? '') ? accent : TINT;
	const days = (server.days ?? []).slice(-90);
	const chartHeight = days.length > 1 ? 190 : 0;
	const height = 400 + chartHeight + (chartHeight ? 24 : 0);
	const { canvas, ctx } = panel(WIDTH, height);
	brackets(ctx, WIDTH, height, tint);
	const icon = await load(server.icon, fetchImpl);
	drawLogo(ctx, icon, server, 92, 80, 84, tint);
	ctx.textAlign = 'left';
	drawLines(ctx, fitText(ctx, server.name.toUpperCase(), { family: 'Bebas Neue', size: 50, minSize: 24, maxWidth: 760, maxLines: 1 }), 156, 42, { family: 'Bebas Neue', lineHeight: 1 });
	drawLines(ctx, fitText(ctx, `Activité des ${server.periodDays} derniers jours`, { family: 'Poppins', size: 17, minSize: 13, maxWidth: 760, maxLines: 1 }), 156, 92, { family: 'Poppins', color: MUTED });

	const t = server.totals;
	const growth = t.memberGrowth ? ` (${t.memberGrowth > 0 ? '+' : ''}${number(t.memberGrowth)})` : '';
	const figures = [
		['Messages', number(t.messages)],
		['Heures en vocal', number(t.voiceHours)],
		['Membres actifs', number(t.active)],
		['Arrivées', number(t.joins)],
		['Départs', number(t.leaves)],
		['Membres', t.memberCount === null || t.memberCount === undefined ? '—' : `${number(t.memberCount)}${growth}`],
	];
	const gap = 14;
	const width = (WIDTH - 80 - gap * 2) / 3;
	figures.forEach(([label, value], i) => figure(ctx, 40 + (i % 3) * (width + gap), 150 + Math.floor(i / 3) * 124, width, 110, label, value, tint));

	if (chartHeight) {
		// Messages per day
		const top = 410;
		const chart = { x: 44, y: top + 30, width: WIDTH - 88, height: chartHeight - 64 };
		ctx.textAlign = 'left';
		ctx.font = '15px "Poppins SemiBold"';
		ctx.fillStyle = MUTED;
		ctx.textBaseline = 'top';
		ctx.fillText('MESSAGES PAR JOUR', 44, top);
		const best = Math.max(...days.map(d => d.messages), 1);
		const slot = chart.width / days.length;
		const bar = Math.max(2, Math.min(26, slot - 3));
		days.forEach((day, i) => {
			const h = Math.max(3, chart.height * (day.messages / best));
			ctx.fillStyle = day.messages === best ? tint : 'rgba(255, 150, 40, 0.5)';
			ctx.beginPath();
			ctx.roundRect(chart.x + i * slot + (slot - bar) / 2, chart.y + chart.height - h, bar, h, Math.min(4, bar / 2));
			ctx.fill();
		});
		ctx.font = '13px "Poppins"';
		ctx.fillStyle = MUTED;
		ctx.textBaseline = 'top';
		ctx.fillText(`Record : ${number(best)} messages`, 44, chart.y + chart.height + 8);
	}
	return canvas.toBuffer('image/png');
}
