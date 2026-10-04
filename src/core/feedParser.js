// Small tolerant XML reader for RSS 2.0, RSS 1.0 (RDF) and Atom feeds (YouTube's feed is Atom).
// No dependency: a forgiving tokenizer builds a tree, then the items are read from it.

const MAX_XML = 2_000_000;
const MAX_ITEMS = 50;

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'', nbsp: ' ', hellip: '…', laquo: '«', raquo: '»', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', euml: 'ë', Eacute: 'É', copy: '©', reg: '®', trade: '™', euro: '€' };

export function decodeEntities(text) {
	return String(text ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, code) => {
		if (code[0] === '#') {
			const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
			return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
		}
		return NAMED[code] ?? NAMED[code.toLowerCase()] ?? match;
	});
}

function parseAttributes(text) {
	const attrs = {};
	for (const m of text.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
	return attrs;
}

// XML -> { name, attrs, children: [node | string] }; mismatched closing tags are forgiven
export function parseXml(xml) {
	const source = String(xml ?? '').slice(0, MAX_XML);
	const root = { name: '#root', attrs: {}, children: [] };
	const stack = [root];
	const top = () => stack[stack.length - 1];
	let i = 0;
	while (i < source.length) {
		const lt = source.indexOf('<', i);
		if (lt === -1) {
			top().children.push(decodeEntities(source.slice(i)));
			break;
		}
		if (lt > i) top().children.push(decodeEntities(source.slice(i, lt)));
		if (source.startsWith('<![CDATA[', lt)) {
			const end = source.indexOf(']]>', lt + 9);
			top().children.push(source.slice(lt + 9, end === -1 ? source.length : end));
			i = end === -1 ? source.length : end + 3;
			continue;
		}
		if (source.startsWith('<!--', lt)) {
			const end = source.indexOf('-->', lt + 4);
			i = end === -1 ? source.length : end + 3;
			continue;
		}
		if (source[lt + 1] === '?' || source[lt + 1] === '!') {
			const end = source.indexOf('>', lt);
			i = end === -1 ? source.length : end + 1;
			continue;
		}
		const end = source.indexOf('>', lt);
		if (end === -1) break;
		const raw = source.slice(lt + 1, end);
		i = end + 1;
		if (raw[0] === '/') {
			const name = raw.slice(1).trim();
			const at = stack.map(n => n.name).lastIndexOf(name);
			if (at > 0) stack.length = at;
			continue;
		}
		const selfClosing = raw.endsWith('/');
		const body = selfClosing ? raw.slice(0, -1) : raw;
		const name = /^[^\s/>]+/.exec(body)?.[0];
		if (!name) continue;
		const node = { name, attrs: parseAttributes(body.slice(name.length)), children: [] };
		top().children.push(node);
		if (!selfClosing) stack.push(node);
	}
	return root;
}

const local = name => name.slice(name.indexOf(':') + 1);
const elements = node => node.children.filter(c => typeof c !== 'string');

// Direct child by qualified name ("media:thumbnail") or by local name for unprefixed tags ("title")
function child(node, name) {
	return elements(node).find(c => c.name === name || (!name.includes(':') && local(c.name) === name && !c.name.includes(':')));
}
function childrenNamed(node, name) {
	return elements(node).filter(c => c.name === name || (!name.includes(':') && local(c.name) === name && !c.name.includes(':')));
}
function descendant(node, name) {
	for (const c of elements(node)) {
		if (c.name === name) return c;
		const deep = descendant(c, name);
		if (deep) return deep;
	}
	return null;
}
function findAll(node, name, out = []) {
	for (const c of elements(node)) {
		if (local(c.name) === name) out.push(c);
		else findAll(c, name, out);
	}
	return out;
}

export function textOf(node) {
	if (!node) return '';
	return node.children.map(c => (typeof c === 'string' ? c : textOf(c))).join('').trim();
}

// HTML of a description -> plain text (feeds often escape their HTML)
export function htmlToText(html) {
	return decodeEntities(String(html ?? '')
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
		.replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
		.replace(/<[^>]+>/g, ''))
		.replace(/[ \t\r\f\v]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

const httpUrl = value => (/^https?:\/\//i.test(String(value ?? '').trim()) ? String(value).trim() : null);

function imageOf(node, html) {
	const candidates = [
		descendant(node, 'media:thumbnail')?.attrs.url,
		...findAll(node, 'content').filter(c => c.name.startsWith('media:') && (c.attrs.medium === 'image' || /^image\//.test(c.attrs.type ?? '') || (!c.attrs.medium && !c.attrs.type))).map(c => c.attrs.url),
		...childrenNamed(node, 'enclosure').filter(c => /^image\//.test(c.attrs.type ?? '') || /\.(jpe?g|png|gif|webp)(\?|$)/i.test(c.attrs.url ?? '')).map(c => c.attrs.url),
		...childrenNamed(node, 'link').filter(c => c.attrs.rel === 'enclosure' && /^image\//.test(c.attrs.type ?? '')).map(c => c.attrs.href),
		descendant(node, 'itunes:image')?.attrs.href,
		/<img[^>]+src=["']([^"']+)["']/i.exec(html)?.[1],
	];
	return candidates.map(httpUrl).find(Boolean) ?? null;
}

function atomLink(node) {
	const links = childrenNamed(node, 'link');
	const pick = links.find(l => (l.attrs.rel ?? 'alternate') === 'alternate') ?? links[0];
	return httpUrl(pick?.attrs.href) ?? httpUrl(textOf(pick));
}

function dateOf(...values) {
	for (const v of values) {
		const ms = Date.parse(textOf(v));
		if (Number.isFinite(ms)) return ms;
	}
	return null;
}

function authorOf(node) {
	const author = child(node, 'author');
	return (author && (textOf(child(author, 'name')) || textOf(author))) || textOf(child(node, 'dc:creator')) || '';
}

// -> { kind: 'rss' | 'atom', title, link, items: [{ id, title, link, description, image, author, publishedAt, raw }] } (newest first)
export function parseFeed(xml) {
	const root = parseXml(xml);
	const atom = descendant(root, 'feed');
	const rss = atom ? null : (descendant(root, 'rss') ?? descendant(root, 'rdf:RDF') ?? findAll(root, 'RDF')[0]);
	if (!atom && !rss) throw new Error('Ce lien ne renvoie pas un flux RSS ou Atom.');
	const channel = atom ?? child(rss, 'channel') ?? rss;
	const entries = atom ? childrenNamed(atom, 'entry') : [...childrenNamed(channel, 'item'), ...(channel === rss ? [] : childrenNamed(rss, 'item'))];
	const items = entries.slice(0, MAX_ITEMS).map((node, index) => {
		const contentHtml = textOf(child(node, 'content:encoded')) || textOf(child(node, 'content'));
		const summaryHtml = textOf(child(node, 'description')) || textOf(child(node, 'summary')) || textOf(descendant(node, 'media:description')) || contentHtml;
		const link = atom ? atomLink(node) : (httpUrl(textOf(child(node, 'link'))) ?? httpUrl(child(node, 'link')?.attrs.href) ?? httpUrl(node.attrs['rdf:about']) ?? httpUrl(textOf(child(node, 'guid'))));
		const title = htmlToText(textOf(child(node, 'title')) || textOf(descendant(node, 'media:title')));
		return {
			id: textOf(child(node, 'guid')) || textOf(child(node, 'id')) || link || (title ? `${title}|${textOf(child(node, 'pubDate'))}` : `#${index}`),
			title, link, author: authorOf(node),
			description: htmlToText(summaryHtml),
			image: imageOf(node, `${summaryHtml}\n${contentHtml}`),
			publishedAt: dateOf(child(node, 'published'), child(node, 'pubDate'), child(node, 'dc:date'), child(node, 'updated')),
			node,
		};
	});
	return {
		kind: atom ? 'atom' : 'rss',
		title: htmlToText(textOf(child(channel, 'title'))),
		link: atom ? atomLink(atom) : httpUrl(textOf(child(channel, 'link'))),
		author: authorOf(channel),
		items,
	};
}

export { descendant as findNode, textOf as nodeText };
