import fs from 'node:fs';
import path from 'node:path';
import { definePermission } from './permissions.js';
import { ForbiddenError, NotFoundError, ValidationError } from './errors.js';

definePermission('archives.view', { label: 'Voir et télécharger les archives de salons', category: 'Logs' });
definePermission('archives.manage', { label: 'Archiver des salons', category: 'Logs' });

const MAX_MESSAGES = 10_000;
const MAX_IMAGE = 3 * 1024 * 1024;
const MAX_IMAGES_TOTAL = 40 * 1024 * 1024;
const DISCORD_CDN = /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//;
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
const time = at => new Date(at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

// Light Markdown of Discord: bold, italic, code, mentions, links (text already escaped)
function format(text) {
	return escape(text)
		.replace(/```([\s\S]*?)```/g, '<pre>$1</pre>')
		.replace(/`([^`]+)`/g, '<code>$1</code>')
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/\*([^*]+)\*/g, '<em>$1</em>')
		.replace(/__([^_]+)__/g, '<u>$1</u>')
		.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention">@$1</span>')
		.replace(/&lt;#(\d+)&gt;/g, '<span class="mention">#$1</span>')
		.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noreferrer">$1</a>')
		.replace(/\n/g, '<br>');
}

// One HTML file that opens anywhere, in Discord's dark style
export function renderArchive({ guildName, channelName, messages, createdAt, createdBy }) {
	const rows = messages.map((m) => {
		const images = m.attachments.filter(a => /^image\//.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name));
		const files = m.attachments.filter(a => !images.includes(a));
		return `<div class="msg">
<img class="avatar" src="${escape(m.authorAvatar)}" alt="" loading="lazy">
<div class="body">
<div class="head"><span class="author">${escape(m.authorName)}</span>${m.bot ? '<span class="tag">BOT</span>' : ''}<span class="time">${time(m.createdAt)}${m.editedAt ? ' (modifié)' : ''}</span></div>
${m.replyTo ? `<div class="reply">↪ en réponse à ${escape(m.replyTo)}</div>` : ''}
${m.content ? `<div class="content">${format(m.content)}</div>` : ''}
${m.embeds.map(e => `<div class="embed" style="border-color:${escape(e.color ?? '#4f545c')}">${e.title ? `<div class="etitle">${escape(e.title)}</div>` : ''}${e.description ? `<div>${format(e.description)}</div>` : ''}</div>`).join('')}
${images.map(a => `<a href="${escape(a.url)}" target="_blank" rel="noreferrer"><img class="image" src="${escape(a.url)}" alt="${escape(a.name)}" loading="lazy"></a>`).join('')}
${files.map(a => `<div class="file">📎 <a href="${escape(a.url)}" target="_blank" rel="noreferrer">${escape(a.name)}</a></div>`).join('')}
</div></div>`;
	}).join('\n');
	return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>#${escape(channelName)} · ${escape(guildName)}</title>
<style>
body{margin:0;background:#313338;color:#dbdee1;font:15px/1.4 system-ui,sans-serif}
header{position:sticky;top:0;background:#2b2d31;padding:14px 20px;border-bottom:1px solid #1e1f22}
header h1{margin:0;font-size:18px;color:#fff}header p{margin:4px 0 0;color:#949ba4;font-size:13px}
main{padding:8px 0 40px}.msg{display:flex;gap:14px;padding:6px 20px}.msg:hover{background:#2e3035}
.avatar{width:40px;height:40px;border-radius:50%;flex:none;background:#1e1f22}.body{min-width:0;flex:1}
.author{color:#fff;font-weight:600}.tag{background:#5865f2;color:#fff;font-size:10px;padding:1px 4px;border-radius:3px;margin-left:6px}
.time{color:#949ba4;font-size:12px;margin-left:8px}.content{white-space:normal;overflow-wrap:anywhere}
.reply{color:#949ba4;font-size:13px}.embed{border-left:4px solid;background:#2b2d31;border-radius:4px;padding:8px 12px;margin-top:4px;max-width:520px}
.etitle{color:#fff;font-weight:600}.image{max-width:400px;max-height:300px;border-radius:6px;margin-top:4px;display:block}
.file{margin-top:4px}a{color:#00a8fc}.mention{background:#5865f233;color:#c9cdfb;border-radius:3px;padding:0 2px}
pre{background:#2b2d31;padding:8px;border-radius:4px;white-space:pre-wrap}code{background:#2b2d31;padding:1px 4px;border-radius:3px}
</style></head><body>
<header><h1>#${escape(channelName)}</h1><p>${escape(guildName)} · ${messages.length} message${messages.length > 1 ? 's' : ''} · archivé le ${time(createdAt)} par ${escape(createdBy)}</p></header>
<main>
${rows || '<p style="padding:20px">Aucun message.</p>'}
</main></body></html>`;
}

// Channel exports: the messages of a channel (or of a period) saved as a readable HTML page
export function createArchives({ db, network, audit, executor, dataDir, fetchImpl = fetch, now = Date.now }) {
	const dir = path.join(dataDir, 'archives');
	const q = {
		insert: db.prepare(`
			INSERT INTO channel_archives (guild_id, channel_id, channel_name, created_by, message_count, first_at, last_at, file, size, created_at)
			VALUES (@guildId, @channelId, @channelName, @createdBy, @count, @firstAt, @lastAt, @file, @size, @at)
		`),
		list: db.prepare('SELECT * FROM channel_archives ORDER BY created_at DESC LIMIT 500'),
		get: db.prepare('SELECT * FROM channel_archives WHERE id = ?'),
		remove: db.prepare('DELETE FROM channel_archives WHERE id = ?'),
	};
	const toArchive = row => row && ({
		id: row.id, guildId: row.guild_id, channelId: row.channel_id, channelName: row.channel_name, createdBy: row.created_by,
		messageCount: row.message_count, firstAt: row.first_at, lastAt: row.last_at, file: row.file, size: row.size, createdAt: row.created_at,
	});

	// Discord's attachment links expire after a while: images are copied into the file (within limits)
	async function inlineImages(messages) {
		let total = 0;
		for (const m of messages) {
			for (const a of m.attachments) {
				const image = /^image\//.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name);
				if (!image || !DISCORD_CDN.test(a.url) || (a.size ?? 0) > MAX_IMAGE || total + (a.size ?? 0) > MAX_IMAGES_TOTAL) continue;
				try {
					const response = await fetchImpl(a.url);
					if (!response.ok) continue;
					const buffer = Buffer.from(await response.arrayBuffer());
					if (buffer.length > MAX_IMAGE) continue;
					total += buffer.length;
					a.url = `data:${a.contentType ?? 'image/png'};base64,${buffer.toString('base64')}`;
				}
				catch {
					// kept as a link
				}
			}
		}
	}

	const service = {
		list: () => q.list.all().map(toArchive),

		get(id) {
			const archive = toArchive(q.get.get(id));
			if (!archive) throw new NotFoundError('Archive introuvable.');
			return archive;
		},

		// Full path of the HTML file (to download it)
		pathOf(archive) {
			return path.join(dir, path.basename(archive.file));
		},

		// limit: last N messages; from/to: only that period
		async create(actor, { guildId, channelId, limit = 1000, from = null, to = null }) {
			if (!actor.can('archives.manage')) throw new ForbiddenError('Permission manquante : archives.manage');
			const guild = network.find(guildId);
			if (guild?.status !== 'active') throw new ValidationError('Ce serveur ne fait pas partie du réseau.');
			const max = Math.min(MAX_MESSAGES, Math.max(1, Math.round(Number(limit) || 1000)));
			if (from && to && to <= from) throw new ValidationError('La fin de la période est avant son début.');
			const { channelName, messages } = await executor.fetchChannelHistory(channelId, { limit: max, from, to });
			await inlineImages(messages);
			const at = now();
			const html = renderArchive({ guildName: guild.name, channelName, messages, createdAt: at, createdBy: actor.name ?? actor.id });
			const file = `${guildId}-${channelId}-${at}.html`;
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, file), html);
			const id = Number(q.insert.run({
				guildId, channelId, channelName, createdBy: actor.id, count: messages.length,
				firstAt: messages[0]?.createdAt ?? null, lastAt: messages.at(-1)?.createdAt ?? null, file, size: Buffer.byteLength(html), at,
			}).lastInsertRowid);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'archives.create', guildId, target: channelId, details: { salon: `#${channelName}`, messages: messages.length } });
			return service.get(id);
		},

		remove(actor, id) {
			if (!actor.can('archives.manage')) throw new ForbiddenError('Permission manquante : archives.manage');
			const archive = service.get(id);
			fs.rmSync(service.pathOf(archive), { force: true });
			q.remove.run(id);
			audit.record({ actorId: actor.id, source: actor.source ?? 'panel', action: 'archives.delete', guildId: archive.guildId, target: archive.channelId, details: { salon: `#${archive.channelName}` } });
		},
	};
	return service;
}
