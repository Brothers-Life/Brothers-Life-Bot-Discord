// JSON encoding of what travels between the bot and the API: buffers (files, images), dates, maps, sets,
// big integers (Discord permissions), errors, and actors (the panel user doing an action, with their permissions).
import { AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../core/errors.js';

const TAG = '__rpc';

function isActor(value) {
	return value && typeof value === 'object' && typeof value.can === 'function' && typeof value.id === 'string';
}

function encodeValue(value) {
	if (Buffer.isBuffer(value)) return { [TAG]: 'buffer', data: value.toString('base64') };
	if (value instanceof Uint8Array) return { [TAG]: 'buffer', data: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64') };
	if (value instanceof Date) return { [TAG]: 'date', at: value.getTime() };
	if (value instanceof Map) return { [TAG]: 'map', entries: [...value] };
	if (value instanceof Set) return { [TAG]: 'set', values: [...value] };
	if (typeof value === 'bigint') return { [TAG]: 'bigint', value: value.toString() };
	if (value instanceof Error) {
		return { [TAG]: 'error', name: value.constructor?.name && value.constructor.name !== 'Error' ? value.constructor.name : value.name, message: value.message, code: value.code ?? null, status: value.status ?? null };
	}
	if (isActor(value)) {
		return {
			[TAG]: 'actor',
			id: value.id,
			isOwner: Boolean(value.isOwner),
			level: Number.isFinite(value.level) ? value.level : null,
			permissions: value.permissions ?? [],
			ranks: value.ranks ?? [],
			source: value.source ?? null,
			apiKey: value.apiKey ?? null,
		};
	}
	if (typeof value === 'function') throw new TypeError('Functions cannot be sent between the bot and the API.');
	if (value === Infinity || value === -Infinity) return { [TAG]: 'infinity', sign: Math.sign(value) };
	return value;
}

export function encode(value) {
	return JSON.stringify(value, function replacer(key) {
		// JSON.stringify calls toJSON (Buffer, Date) before the replacer: take the original value
		return encodeValue(this[key]);
	});
}

const ERRORS = { ValidationError, ForbiddenError, NotFoundError, ConflictError };

export function reviveError(data) {
	let error;
	if (ERRORS[data.name]) {error = new ERRORS[data.name](data.message);}
	else if (data.status) {error = new AppError(data.code, data.message, data.status);}
	else {
		error = new Error(data.message);
		error.name = data.name ?? 'Error';
		if (data.code !== null && data.code !== undefined) error.code = data.code;
	}
	return error;
}

function reviveActor(data) {
	const granted = new Set(data.permissions);
	return {
		id: data.id,
		isOwner: data.isOwner,
		level: data.isOwner ? Infinity : data.level ?? 0,
		permissions: data.permissions,
		ranks: data.ranks,
		...(data.source ? { source: data.source } : {}),
		...(data.apiKey ? { apiKey: data.apiKey } : {}),
		// The owner can do everything, unless an API key narrowed it down (its permissions are then listed)
		can: permission => (data.isOwner && !data.apiKey) || granted.has(permission),
	};
}

export function decode(text) {
	return JSON.parse(text, (key, value) => {
		if (!value || typeof value !== 'object' || !(TAG in value)) return value;
		switch (value[TAG]) {
		case 'buffer': return Buffer.from(value.data, 'base64');
		case 'date': return new Date(value.at);
		case 'map': return new Map(value.entries);
		case 'set': return new Set(value.values);
		case 'bigint': return BigInt(value.value);
		case 'error': return reviveError(value);
		case 'actor': return reviveActor(value);
		case 'infinity': return value.sign * Infinity;
		default: return value;
		}
	});
}
