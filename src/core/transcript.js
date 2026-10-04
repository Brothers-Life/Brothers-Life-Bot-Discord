// Ticket transcripts as one self-contained HTML page in Discord's look (no script, images inlined)

const DISCORD_CDN = /^https:\/\/(cdn|media)\.discordapp\.(com|net)\//;
const GROUP_MS = 7 * 60_000;
const PARIS = { timeZone: 'Europe/Paris' };

export const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' })[c]);
// Only web and inlined image addresses go into src/href
const safeUrl = url => (/^(https?:\/\/|data:image\/)/i.test(String(url ?? '')) ? escape(url) : '');
const time = at => new Date(at).toLocaleTimeString('fr-FR', { ...PARIS, hour: '2-digit', minute: '2-digit' });
const dateTime = at => new Date(at).toLocaleString('fr-FR', { ...PARIS, dateStyle: 'long', timeStyle: 'short' });
const day = at => new Date(at).toLocaleDateString('fr-FR', { ...PARIS, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const isImage = a => /^image\//.test(a.contentType ?? '') || /\.(png|jpe?g|gif|webp)$/i.test(a.name ?? '');

function duration(ms) {
	const minutes = Math.round(ms / 60_000);
	if (minutes < 60) return `${minutes} min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, '0')}`;
	return `${Math.floor(hours / 24)} jours`;
}

function sizeText(bytes) {
	if (!bytes) return '';
	return bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} Mo` : `${Math.ceil(bytes / 1024)} Ko`;
}

// Discord's attachment links expire: images are copied into the page, up to `maxTotal` bytes
export async function inlineImages(messages, { fetchImpl = fetch, maxImage = 3 * 1024 * 1024, maxTotal = 40 * 1024 * 1024 } = {}) {
	let total = 0;
	for (const m of messages) {
		for (const a of m.attachments ?? []) {
			if (!isImage(a) || !DISCORD_CDN.test(a.url) || (a.size ?? 0) > maxImage || total + (a.size ?? 0) > maxTotal) continue;
			try {
				const response = await fetchImpl(a.url);
				if (!response.ok) continue;
				const buffer = Buffer.from(await response.arrayBuffer());
				if (buffer.length > maxImage || total + buffer.length > maxTotal) continue;
				total += buffer.length;
				a.url = `data:${a.contentType ?? 'image/png'};base64,${buffer.toString('base64')}`;
			}
			catch {
				// kept as a link
			}
		}
	}
	return total;
}

// Discord Markdown: code, bold, italic, underline, strike, spoiler, quotes, titles, links,
// mentions (names from `mentions`), server emojis and <t:…> timestamps. Text is escaped first.
export function markdown(text, mentions = {}) {
	if (!text) return '';
	const users = mentions.users ?? {};
	const roles = mentions.roles ?? {};
	const channels = mentions.channels ?? {};
	const blocks = [];
	// Block elements (code, titles, quotes) eat their line break: no blank line after them
	let out = escape(text).replace(/```(?:[\w-]+\n)?([\s\S]*?)```\n?/g, (_, code) => {
		blocks.push(`<pre><code>${code.replace(/^\n|\n$/g, '')}</code></pre>`);
		return `${blocks.length - 1}`;
	});
	out = out
		.replace(/`([^`\n]+)`/g, '<code>$1</code>')
		.replace(/^(#{1,3}) (.+)\n?/gm, (_, h, t) => `<span class="h${h.length}">${t}</span>`)
		.replace(/^-# (.+)\n?/gm, '<span class="sub">$1</span>')
		.replace(/^&gt; (.+)\n?/gm, '<span class="quote">$1</span>')
		.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
		.replace(/__([^_\n]+)__/g, '<u>$1</u>')
		.replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
		.replace(/(^|\W)_([^_\n]+)_(?=\W|$)/g, '$1<em>$2</em>')
		.replace(/~~([^~\n]+)~~/g, '<s>$1</s>')
		.replace(/\|\|([^|\n]+)\|\|/g, '<span class="spoiler">$1</span>')
		.replace(/&lt;(a?):(\w{2,32}):(\d{17,20})&gt;/g, (_, a, name, id) => `<img class="emoji" src="https://cdn.discordapp.com/emojis/${id}.${a ? 'gif' : 'webp'}?size=48" alt=":${name}:" title=":${name}:">`)
		.replace(/&lt;@!?(\d{17,20})&gt;/g, (_, id) => `<span class="mention">@${escape(users[id] ?? 'membre')}</span>`)
		.replace(/&lt;@&amp;(\d{17,20})&gt;/g, (_, id) => {
			const role = roles[id];
			return `<span class="mention role"${role?.color ? ` style="color:${escape(role.color)};background:${escape(role.color)}26"` : ''}>@${escape(role?.name ?? 'rôle')}</span>`;
		})
		.replace(/&lt;#(\d{17,20})&gt;/g, (_, id) => `<span class="mention">#${escape(channels[id] ?? 'salon')}</span>`)
		.replace(/&lt;t:(\d{1,13})(?::\w)?&gt;/g, (_, s) => `<span class="stamp">${dateTime(Number(s) * 1000)}</span>`)
		.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
		.replace(/(^|[\s(])(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
		.replace(/@(everyone|here)/g, '<span class="mention">@$1</span>')
		.replace(/\n/g, '<br>');
	return out.replace(/(\d+)/g, (_, i) => blocks[Number(i)] ?? '');
}

function embedHtml(e, mentions) {
	const fields = (e.fields ?? []).map(f => `<div class="field${f.inline ? ' inline' : ''}"><div class="fname">${markdown(f.name, mentions)}</div><div>${markdown(f.value, mentions)}</div></div>`).join('');
	const title = e.title ? (e.url && safeUrl(e.url) ? `<a class="etitle" href="${safeUrl(e.url)}" target="_blank" rel="noreferrer">${markdown(e.title, mentions)}</a>` : `<div class="etitle">${markdown(e.title, mentions)}</div>`) : '';
	const footer = [e.footer ? escape(e.footer) : '', e.timestamp ? dateTime(e.timestamp) : ''].filter(Boolean).join(' • ');
	return `<div class="embed" style="border-color:${escape(e.color && e.color !== '#000000' ? e.color : '#1e1f22')}"><div class="ebody"><div class="emain">
${e.author ? `<div class="eauthor">${e.authorIcon && safeUrl(e.authorIcon) ? `<img src="${safeUrl(e.authorIcon)}" alt="">` : ''}${escape(e.author)}</div>` : ''}
${title}${e.description ? `<div class="edesc">${markdown(e.description, mentions)}</div>` : ''}${fields ? `<div class="fields">${fields}</div>` : ''}
</div>${e.thumbnail && safeUrl(e.thumbnail) ? `<img class="ethumb" src="${safeUrl(e.thumbnail)}" alt="" loading="lazy">` : ''}</div>
${e.image && safeUrl(e.image) ? `<img class="eimage" src="${safeUrl(e.image)}" alt="" loading="lazy">` : ''}
${footer ? `<div class="efooter">${footer}</div>` : ''}</div>`;
}

function messageHtml(m, { grouped, mentions, openerId }) {
	const images = (m.attachments ?? []).filter(isImage);
	const files = (m.attachments ?? []).filter(a => !isImage(a));
	const tags = [
		m.bot ? '<span class="tag">APP</span>' : '',
		m.internal ? '<span class="tag note">NOTE INTERNE</span>' : '',
		!m.bot && m.authorId && m.authorId === openerId ? '<span class="tag opener">AUTEUR</span>' : '',
		m.panelUser ? '<span class="tag panel">PANEL</span>' : '',
	].join('');
	const body = [
		m.replyTo ? `<div class="reply"><span class="replyto">@${escape(m.replyTo)}</span> ${escape(m.replyText ?? '')}</div>` : '',
		m.content ? `<div class="content">${markdown(m.content, mentions)}${m.editedAt ? ' <span class="edited">(modifié)</span>' : ''}</div>` : '',
		...(m.embeds ?? []).map(e => embedHtml(e, mentions)),
		images.length ? `<div class="images">${images.map(a => `<a href="${safeUrl(a.url)}" target="_blank" rel="noreferrer"><img src="${safeUrl(a.url)}" alt="${escape(a.name)}" loading="lazy"></a>`).join('')}</div>` : '',
		...files.map(a => `<div class="file"><span class="ficon">📄</span><div><a href="${safeUrl(a.url)}" target="_blank" rel="noreferrer">${escape(a.name)}</a><div class="fsize">${sizeText(a.size)}</div></div></div>`),
		...(m.stickers ?? []).map(s => (s.format === 3 ? `<div class="sticker lottie">${escape(s.name)}</div>` : `<img class="sticker" src="https://media.discordapp.net/stickers/${escape(s.id)}.${s.format === 4 ? 'gif' : 'png'}?size=160" alt="${escape(s.name)}" title="${escape(s.name)}">`)),
		m.components?.length ? `<div class="buttons">${m.components.map(c => (c.url && safeUrl(c.url) ? `<a class="button" href="${safeUrl(c.url)}" target="_blank" rel="noreferrer">${escape(c.label)} ↗</a>` : `<span class="button">${escape(c.label)}</span>`)).join('')}</div>` : '',
		m.reactions?.length ? `<div class="reactions">${m.reactions.map(r => `<span class="reaction">${markdown(r.emoji)} ${r.count}</span>`).join('')}</div>` : '',
	].join('');
	const color = m.authorColor ? ` style="color:${escape(m.authorColor)}"` : '';
	if (grouped) {
		return `<div class="msg cont${m.internal ? ' internal' : ''}" id="m${escape(m.id)}"><span class="hover-time">${time(m.createdAt)}</span><div class="body">${body}</div></div>`;
	}
	return `<div class="msg${m.internal ? ' internal' : ''}" id="m${escape(m.id)}">
<img class="avatar" src="${safeUrl(m.authorAvatar) || 'https://cdn.discordapp.com/embed/avatars/0.png'}" alt="" loading="lazy">
<div class="body"><div class="head"><span class="author"${color}>${escape(m.authorName)}</span>${tags}<span class="time" title="${dateTime(m.createdAt)}">${dateTime(m.createdAt)}</span></div>${body}</div></div>`;
}

const CSS = `
:root{color-scheme:dark;--bg:#313338;--bg2:#2b2d31;--bg3:#1e1f22;--text:#dbdee1;--muted:#949ba4;--white:#f2f3f5;--link:#00a8fc;--blurple:#5865f2;--amber:#ff9628}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.375 "gg sans","Noto Sans","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
a{color:var(--link);text-decoration:none}a:hover{text-decoration:underline}
.top{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:10px;height:48px;padding:0 16px;background:var(--bg);border-bottom:1px solid var(--bg3);box-shadow:0 1px 0 rgba(4,4,5,.2)}
.top .hash{color:var(--muted);font-size:24px;font-weight:300}.top b{color:var(--white);font-size:16px}
.top .sep{width:1px;height:24px;background:#3f4147}.top .topic{color:var(--muted);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.card{margin:16px;padding:16px 18px;background:var(--bg2);border-radius:8px;border-left:4px solid var(--amber)}
.card .guild{display:flex;align-items:center;gap:10px;color:var(--muted);font-size:13px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.card .guild img{width:24px;height:24px;border-radius:8px}
.card h1{margin:8px 0 12px;color:var(--white);font-size:24px;line-height:1.2}
.facts{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px 18px;margin:0}
.facts dt{color:var(--muted);font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.02em}.facts dd{margin:2px 0 0;color:var(--white);font-size:14px;overflow-wrap:anywhere}
.answers{margin-top:14px;padding-top:12px;border-top:1px solid #3f4147}.answers h2,.reason h2{margin:0 0 8px;color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.02em}
.answer{margin-bottom:8px}.answer b{display:block;color:var(--white);font-size:14px}.answer div{font-size:14px;white-space:pre-wrap;overflow-wrap:anywhere}
.reason{margin-top:12px;padding-top:12px;border-top:1px solid #3f4147;font-size:14px}
.pill{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;background:#3f4147;color:var(--white)}
main{padding:0 0 32px}
.day{display:flex;align-items:center;gap:8px;margin:24px 16px 8px;color:var(--muted);font-size:12px;font-weight:600}.day:before,.day:after{content:"";flex:1;height:1px;background:#3f4147}
.msg{position:relative;display:flex;gap:16px;padding:2px 48px 2px 16px;margin-top:17px}.msg.cont{margin-top:0;padding-left:72px}
.msg:hover{background:#2e3035}
.msg.internal{background:rgba(250,166,26,.08);border-left:2px solid #f0b232}.msg.internal:hover{background:rgba(250,166,26,.12)}
.avatar{width:40px;height:40px;border-radius:50%;flex:none;margin-top:2px;background:var(--bg3)}
.body{min-width:0;flex:1}
.head{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 6px}.author{color:var(--white);font-weight:500}
.time{color:var(--muted);font-size:12px}
.hover-time{position:absolute;left:16px;width:48px;top:4px;text-align:right;color:var(--muted);font-size:11px;visibility:hidden}.msg.cont:hover .hover-time{visibility:visible}
.tag{display:inline-flex;align-items:center;height:15px;padding:0 4px;border-radius:3px;background:var(--blurple);color:#fff;font-size:10px;font-weight:600;position:relative;top:-1px}
.tag.note{background:#f0b232;color:#1e1f22}.tag.opener{background:#23a55a}.tag.panel{background:var(--amber);color:#1e1f22}
.content{white-space:normal;overflow-wrap:anywhere}.edited{color:var(--muted);font-size:10px}
.reply{display:flex;gap:4px;align-items:center;color:var(--muted);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.reply:before{content:"";width:28px;height:10px;margin-left:-36px;border-left:2px solid #4e5058;border-top:2px solid #4e5058;border-top-left-radius:6px;flex:none;align-self:flex-end;margin-bottom:-2px}
.replyto{color:var(--white);font-weight:500}
.mention{padding:0 2px;border-radius:3px;background:rgba(88,101,242,.3);color:#c9cdfb;font-weight:500}
.emoji{width:1.375em;height:1.375em;vertical-align:bottom;object-fit:contain}
code{padding:.1em .3em;border-radius:4px;background:var(--bg2);font-size:85%;font-family:Consolas,"Andale Mono WT","Andale Mono",monospace}
pre{margin:4px 0;padding:8px;border:1px solid var(--bg3);border-radius:4px;background:var(--bg2);white-space:pre-wrap;max-width:90%}pre code{padding:0;background:none}
.quote{display:block;padding-left:12px;border-left:4px solid #4e5058}
.h1{display:block;margin:8px 0 4px;color:var(--white);font-size:24px;font-weight:700}.h2{display:block;margin:8px 0 4px;color:var(--white);font-size:20px;font-weight:700}.h3{display:block;margin:8px 0 4px;color:var(--white);font-size:16px;font-weight:700}
.sub{display:block;color:var(--muted);font-size:12px}
.spoiler{background:#1e1f22;color:transparent;border-radius:3px}.spoiler:hover{background:#3f4147;color:inherit}
.stamp{padding:0 2px;border-radius:3px;background:rgba(255,255,255,.06)}
.embed{max-width:520px;margin-top:4px;padding:8px 16px 16px 12px;border-left:4px solid;border-radius:4px;background:var(--bg2);display:grid}
.ebody{display:flex;gap:16px}.emain{min-width:0;flex:1}
.eauthor{display:flex;align-items:center;gap:8px;margin-top:8px;color:var(--white);font-size:14px;font-weight:600}.eauthor img{width:24px;height:24px;border-radius:50%}
.etitle{display:block;margin-top:8px;color:var(--white);font-weight:600}a.etitle{color:var(--link)}
.edesc{margin-top:8px;font-size:14px;overflow-wrap:anywhere}
.fields{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}.field{grid-column:1/-1;font-size:14px}.field.inline{grid-column:auto}.fname{color:var(--white);font-weight:600;margin-bottom:2px}
.ethumb{width:80px;height:80px;margin-top:8px;border-radius:4px;object-fit:cover;flex:none}
.eimage{max-width:100%;max-height:300px;margin-top:16px;border-radius:4px}
.efooter{margin-top:8px;color:var(--muted);font-size:12px}
.images{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.images img{max-width:min(400px,100%);max-height:300px;border-radius:8px;display:block}
.file{display:flex;align-items:center;gap:10px;max-width:432px;margin-top:4px;padding:10px;border:1px solid var(--bg3);border-radius:8px;background:var(--bg2)}.ficon{font-size:28px}.fsize{color:var(--muted);font-size:12px}
.sticker{display:block;width:160px;height:160px;margin-top:4px;object-fit:contain}.sticker.lottie{display:grid;place-items:center;border-radius:8px;background:var(--bg2);color:var(--muted);font-size:13px}
.buttons{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}.button{padding:4px 16px;border-radius:3px;background:#4e5058;color:#fff;font-size:14px;font-weight:500}
.reactions{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}.reaction{display:inline-flex;align-items:center;gap:6px;padding:2px 6px;border:1px solid transparent;border-radius:8px;background:var(--bg2);font-size:14px}
.end{margin:24px 16px 0;padding:16px;border-radius:8px;background:var(--bg2);color:var(--muted);font-size:13px;text-align:center}
.empty{padding:24px 16px;color:var(--muted)}
@media (max-width:600px){.msg{padding-right:12px;gap:12px}.msg.cont{padding-left:64px}.top .topic,.top .sep{display:none}.fields{grid-template-columns:1fr}.field.inline{grid-column:1/-1}.card{margin:12px}}
@media print{.top{position:static}.msg:hover{background:none}body{background:#fff;color:#000}}
`;

// audience 'staff' shows the internal notes of the panel; 'member' never does
export function renderTicketTranscript({ guild, ticket, category, status, opener, claimer, closer, closedAt, reason, messages, mentions = {}, notes = [], audience = 'staff' }) {
	const all = [...messages, ...(audience === 'staff' ? notes.map(n => ({ ...n, internal: true })) : [])].sort((a, b) => a.createdAt - b.createdAt);
	const rows = [];
	let previous = null;
	for (const m of all) {
		if (!previous || day(previous.createdAt) !== day(m.createdAt)) {
			rows.push(`<div class="day">${day(m.createdAt)}</div>`);
			previous = null;
		}
		const grouped = previous && previous.authorId === m.authorId && previous.authorName === m.authorName && !m.replyTo
			&& Boolean(previous.internal) === Boolean(m.internal) && m.createdAt - previous.createdAt < GROUP_MS;
		rows.push(messageHtml(m, { grouped, mentions, openerId: ticket.openerId }));
		previous = m;
	}
	const number = String(ticket.number).padStart(4, '0');
	const facts = [
		['Type', `${category?.emoji && !String(category.emoji).startsWith('<') ? `${escape(category.emoji)} ` : ''}${escape(category?.name ?? 'Ticket')}`],
		['Ouvert par', escape(opener ?? ticket.openerName ?? ticket.openerId)],
		['Ouvert le', dateTime(ticket.createdAt)],
		['Pris en charge par', escape(claimer ?? 'personne')],
		['Fermé par', escape(closer ?? 'le bot')],
		['Fermé le', dateTime(closedAt)],
		['Durée', duration(closedAt - ticket.createdAt)],
		['Statut', `<span class="pill">${escape(status ?? 'Fermé')}</span>`],
		...(ticket.priority && ticket.priority !== 'normal' ? [['Priorité', escape({ low: 'Basse', high: 'Haute', urgent: 'Urgente' }[ticket.priority] ?? ticket.priority)]] : []),
		['Messages', String(messages.length)],
	];
	const answers = (ticket.answers ?? []).map(a => `<div class="answer"><b>${escape(a.label)}</b><div>${escape(a.value)}</div></div>`).join('');
	const topic = ticket.subject ? escape(ticket.subject) : `Ticket ${escape(category?.name ?? '')}`;
	return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Ticket #${number} · ${escape(guild?.name ?? '')}</title>
<style>${CSS}</style></head><body>
<div class="top"><span class="hash">#</span><b>ticket-${number}</b><span class="sep"></span><span class="topic">${topic}</span></div>
<section class="card">
<div class="guild">${guild?.icon && safeUrl(guild.icon) ? `<img src="${safeUrl(guild.icon)}" alt="">` : ''}${escape(guild?.name ?? '')}${audience === 'staff' ? ' · copie du staff' : ''}</div>
<h1>Ticket #${number}${ticket.subject ? ` · ${escape(ticket.subject)}` : ''}</h1>
<dl class="facts">${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>
${reason ? `<div class="reason"><h2>Raison de la fermeture</h2>${escape(reason)}</div>` : ''}
${answers ? `<div class="answers"><h2>Formulaire</h2>${answers}</div>` : ''}
</section>
<main>
${rows.join('\n') || '<p class="empty">Aucun message dans ce ticket.</p>'}
<div class="end">Fin du ticket #${number} · transcript généré le ${dateTime(closedAt)} par le bot Brothers Life</div>
</main></body></html>`;
}

// Plain text version, kept in the database (search, panel)
export function transcriptText(messages, mentions = {}) {
	const users = mentions.users ?? {};
	return messages.map((m) => {
		const at = new Date(m.createdAt).toLocaleString('fr-FR', { ...PARIS, dateStyle: 'short', timeStyle: 'short' });
		const content = String(m.content ?? '').replace(/<@!?(\d{17,20})>/g, (_, id) => `@${users[id] ?? id}`);
		const embeds = (m.embeds ?? []).map(e => [e.title, e.description].filter(Boolean).join(' — ')).filter(Boolean);
		return `[${at}] ${m.authorName}: ${[content, ...embeds.map(e => `[embed] ${e}`), ...(m.attachments ?? []).map(a => a.name ?? a.url)].filter(Boolean).join(' ')}`;
	}).join('\n');
}
