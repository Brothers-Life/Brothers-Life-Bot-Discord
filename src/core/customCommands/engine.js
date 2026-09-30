// Runs the flow of a custom command. Discord effects go through `io`, provided by the service.
//
// ctx: { guildId, channelId, serverName, memberCount, user: { id, name, roleIds, permissions, createdAt, joinedAt, isOwner },
//        options: { name: { type, value, display, userId? } } }

const DAY = 86_400_000;
const MAX_STEPS = 200;

function pad(n) {
	return String(n).padStart(2, '0');
}

// {user}, {option.x}, {counter.key}, {random:1-100}, {choice:a|b}… in a text
export async function fillText(textValue, ctx, io, now = Date.now) {
	if (!textValue) return textValue;
	const d = new Date(now());
	const simple = {
		'user': `<@${ctx.user.id}>`, 'user.mention': `<@${ctx.user.id}>`, 'user.name': ctx.user.name ?? '', 'user.id': ctx.user.id,
		'server': ctx.serverName ?? '', 'server.members': ctx.memberCount ?? '', 'channel': ctx.channelId ? `<#${ctx.channelId}>` : '', 'channel.mention': ctx.channelId ? `<#${ctx.channelId}>` : '',
		'date': `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`, 'time': `${pad(d.getHours())}:${pad(d.getMinutes())}`,
	};
	const tokens = [...new Set(textValue.match(/\{[^{}\n]{1,80}\}/g) ?? [])];
	let out = textValue;
	for (const token of tokens) {
		const key = token.slice(1, -1);
		let value;
		if (key in simple) {
			value = simple[key];
		}
		else if (key.startsWith('option.')) {
			value = ctx.options[key.slice(7)]?.display ?? '';
		}
		else if (key.startsWith('counter.')) {
			const [, name, who] = key.split('.');
			value = await io.counterGet(name, who === 'user' ? ctx.user.id : '');
		}
		else if (key.startsWith('random:')) {
			const m = /^random:(-?\d+)-(-?\d+)$/.exec(key);
			if (m) {
				const [a, b] = [Number(m[1]), Number(m[2])].sort((x, y) => x - y);
				value = a + Math.floor(io.random() * (b - a + 1));
			}
		}
		else if (key.startsWith('choice:')) {
			const items = key.slice(7).split('|');
			value = items[Math.floor(io.random() * items.length)];
		}
		if (value !== undefined) out = out.split(token).join(String(value));
	}
	return out;
}

async function fillMessage(block, ctx, io) {
	return {
		content: await fillText(block.content, ctx, io, io.now),
		embed: block.embed ? {
			...block.embed,
			title: await fillText(block.embed.title, ctx, io, io.now),
			description: await fillText(block.embed.description, ctx, io, io.now),
			footer: await fillText(block.embed.footer, ctx, io, io.now),
		} : null,
	};
}

function compare(op, a, b) {
	if (op === 'gt') return a > b;
	if (op === 'lt') return a < b;
	return a === b;
}

async function check(c, ctx, io) {
	let result;
	switch (c.kind) {
	case 'hasRole':
		result = c.match === 'all' ? c.roleIds.every(id => ctx.user.roleIds.includes(id)) : c.roleIds.some(id => ctx.user.roleIds.includes(id));
		break;
	case 'inChannel': result = c.channelIds.includes(ctx.channelId); break;
	case 'hasPermission': result = ctx.user.permissions.includes('Administrator') || ctx.user.permissions.includes(c.permission); break;
	case 'option': {
		const opt = ctx.options[c.name];
		const raw = opt?.value;
		if (c.op === 'set') {
			result = raw !== undefined && raw !== null && raw !== '';
		}
		else if (c.op === 'notSet') {
			result = raw === undefined || raw === null || raw === '';
		}
		else if (c.op === 'gt' || c.op === 'lt') {
			result = compare(c.op, Number(raw), Number(c.value));
		}
		else {
			const left = String(opt?.userId ?? raw ?? '').toLowerCase();
			const right = String(c.value).toLowerCase();
			result = c.op === 'contains' ? left.includes(right) : c.op === 'startsWith' ? left.startsWith(right) : left === right;
		}
		break;
	}
	case 'accountAge':
	case 'memberAge': {
		const since = c.kind === 'accountAge' ? ctx.user.createdAt : ctx.user.joinedAt;
		result = since ? compare(c.op, (io.now() - since) / DAY, c.days) : false;
		break;
	}
	case 'counter': result = compare(c.op, Number(await io.counterGet(c.key, c.perUser ? ctx.user.id : '')), c.value); break;
	case 'chance': result = io.random() * 100 < c.percent; break;
	case 'userIs': result = c.userIds.includes(ctx.user.id); break;
	default: result = false;
	}
	return c.negate ? !result : result;
}

function targetOf(value, ctx) {
	if (value === 'invoker') return ctx.user.id;
	return ctx.options[value.slice(7)]?.userId ?? null;
}

// Returns { stopped, steps, warnings }
export async function runFlow(blocks, ctx, io, state = { steps: 0, waited: 0, warnings: [] }) {
	for (const b of blocks) {
		if (++state.steps > MAX_STEPS) {
			state.warnings.push('Déroulé arrêté : trop d’étapes.');
			return { ...state, stopped: true };
		}
		try {
			switch (b.type) {
			case 'if': {
				const results = [];
				for (const c of b.conditions) results.push(await check(c, ctx, io));
				const ok = b.match === 'any' ? results.some(Boolean) : results.every(Boolean);
				const branch = await runFlow(ok ? b.then : b.else, ctx, io, state);
				if (branch.stopped) return branch;
				break;
			}
			case 'reply': await io.reply(await fillMessage(b, ctx, io), { ephemeral: b.ephemeral, components: b.components }); break;
			case 'send': await io.send(b.channelId === 'current' ? ctx.channelId : b.channelId, await fillMessage(b, ctx, io), { components: b.components }); break;
			case 'dm': {
				const userId = targetOf(b.target, ctx);
				if (userId) await io.dm(userId, await fillMessage(b, ctx, io));
				break;
			}
			case 'role': {
				const userId = targetOf(b.target, ctx);
				if (!userId) break;
				for (const roleId of b.roleIds) {
					const has = userId === ctx.user.id ? ctx.user.roleIds.includes(roleId) : await io.hasRole(userId, roleId);
					const add = b.mode === 'add' || (b.mode === 'toggle' && !has);
					if (add) await io.addRole(userId, roleId, b.durationMinutes ? b.durationMinutes * 60_000 : null);
					else if (b.mode !== 'add') await io.removeRole(userId, roleId);
				}
				break;
			}
			case 'nickname': {
				const userId = targetOf(b.target, ctx);
				if (userId) await io.nickname(userId, await fillText(b.value, ctx, io, io.now));
				break;
			}
			case 'sanction': {
				const userId = targetOf(b.target, ctx);
				if (userId) await io.sanction(b.kind, userId, await fillText(b.reason, ctx, io, io.now), b.durationMinutes ? b.durationMinutes * 60_000 : null);
				break;
			}
			case 'react': await io.react(b.emoji); break;
			case 'wait': {
				const seconds = Math.min(b.seconds, 30 - state.waited);
				if (seconds > 0) {
					state.waited += seconds;
					await io.wait(seconds * 1000);
				}
				break;
			}
			case 'counter': await io.counterUpdate(b.key, b.perUser ? ctx.user.id : '', b.op, b.value); break;
			case 'log': await io.log(await fillText(b.content, ctx, io, io.now)); break;
			case 'deleteTrigger': await io.deleteTrigger(); break;
			case 'stop': return { ...state, stopped: true };
			default:
			}
		}
		catch (error) {
			// A failing block (missing permission, closed DMs…) is reported and the flow goes on
			state.warnings.push(`${b.type} : ${error.message}`);
		}
	}
	return { ...state, stopped: false };
}
