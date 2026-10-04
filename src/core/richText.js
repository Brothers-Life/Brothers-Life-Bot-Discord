// A small, safe subset of Markdown for texts shown on the public page (rules).
// The result is a tree of plain objects the browser renders as elements: no HTML ever goes through,
// and links are kept only when they point to http(s).

const INLINE = /\*\*(.+?)\*\*|\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)|\*([^*\n]+?)\*|_([^_\n]+?)_/g;
const SAFE_LINK = /^https?:\/\/[^\s<>"']+$/i;

export function parseInline(text) {
	const out = [];
	let last = 0;
	for (const m of String(text).matchAll(INLINE)) {
		if (m.index > last) out.push({ t: 'text', v: text.slice(last, m.index) });
		if (m[1] !== undefined) out.push({ t: 'b', v: m[1] });
		else if (m[2] !== undefined) out.push(SAFE_LINK.test(m[3]) ? { t: 'link', v: m[2], href: m[3] } : { t: 'text', v: m[2] });
		else out.push({ t: 'i', v: m[4] ?? m[5] });
		last = m.index + m[0].length;
	}
	if (last < text.length) out.push({ t: 'text', v: text.slice(last) });
	return out;
}

// Blocks: { type: 'h', level: 1-3, inline } | { type: 'p', lines: [inline] } | { type: 'ul' | 'ol', items: [inline] } | { type: 'hr' }
export function parseRichText(source, { maxLength = 20_000 } = {}) {
	const lines = String(source ?? '').slice(0, maxLength).replace(/\r\n?/g, '\n').split('\n');
	const blocks = [];
	let paragraph = null;
	let list = null;
	const flush = () => {
		paragraph = null;
		list = null;
	};

	for (const raw of lines) {
		const line = raw.trimEnd();
		if (!line.trim()) {
			flush();
			continue;
		}
		const heading = /^(#{1,3})\s+(.*)$/.exec(line);
		if (heading) {
			flush();
			blocks.push({ type: 'h', level: heading[1].length, inline: parseInline(heading[2].trim()) });
			continue;
		}
		if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
			flush();
			blocks.push({ type: 'hr' });
			continue;
		}
		const bullet = /^\s*[-*•]\s+(.*)$/.exec(line);
		const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
		if (bullet || numbered) {
			const type = bullet ? 'ul' : 'ol';
			if (!list || list.type !== type) {
				paragraph = null;
				list = { type, items: [] };
				blocks.push(list);
			}
			list.items.push(parseInline((bullet ?? numbered)[1]));
			continue;
		}
		if (!paragraph) {
			list = null;
			paragraph = { type: 'p', lines: [] };
			blocks.push(paragraph);
		}
		paragraph.lines.push(parseInline(line.trim()));
	}
	return blocks;
}
