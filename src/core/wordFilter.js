// Word filters of the stream and feed notifications ("must contain one of", "ignore if it contains").
// A plain word is looked for anywhere in the text; a #hashtag only as a whole tag: #brl matches "Live #BRL ce soir"
// but not "#brlife". Case does not matter.

const TAG_CHAR = '[\\p{L}\\p{N}_]';

// List typed in the panel -> at most 20 distinct entries of 50 characters, lower case
export function filterWords(list) {
	return [...new Set((Array.isArray(list) ? list : []).map(w => String(w).trim().toLowerCase()).filter(Boolean))].slice(0, 20).map(w => w.slice(0, 50));
}

export function matchesWord(text, word) {
	if (!word.startsWith('#')) return text.includes(word);
	const tag = word.slice(1);
	if (!tag) return false;
	const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(`(?<!${TAG_CHAR})#${escaped}(?!${TAG_CHAR})`, 'u').test(text);
}

export function passesWords({ requireWords = [], excludeWords = [] }, text) {
	const t = String(text ?? '').toLowerCase();
	if (requireWords.length && !requireWords.some(w => matchesWord(t, w))) return false;
	return !excludeWords.some(w => matchesWord(t, w));
}
