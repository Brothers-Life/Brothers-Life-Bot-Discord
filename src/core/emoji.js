// Emojis typed in the panel: a custom one (<:name:id>, <a:name:id>, name:id or a bare id) or unicode.
// Anything else (":ticket:", plain text…) is refused by Discord and would fail the whole message.

const CUSTOM = /^<?(a)?:?([\w~-]{1,32}):(\d{17,20})>?$/;
const BARE_ID = /^\d{17,20}$/;
// Only emoji code points (with joiners, variation selectors, skin tones, keycaps, flags)
const UNICODE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\p{Regional_Indicator}|[#*0-9]|‍|️|⃣|[\u{e0020}-\u{e007f}])+$/u;
const PICTURE = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u;

// { id, name?, animated? } for a custom emoji, { name } for a unicode one, null when invalid
export function parseEmoji(value) {
	if (typeof value !== 'string') return null;
	const v = value.trim();
	if (!v) return null;
	if (BARE_ID.test(v)) return { id: v };
	const custom = CUSTOM.exec(v);
	if (custom) return { id: custom[3], name: custom[2], animated: Boolean(custom[1]) };
	if (v.length <= 32 && UNICODE.test(v) && PICTURE.test(v)) return { name: v };
	return null;
}

export const isValidEmoji = value => parseEmoji(value) !== null;
