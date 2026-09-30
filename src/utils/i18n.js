import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import logger from './logger.js';
import config from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const localesPath = path.join(__dirname, '..', 'locales');

const DEFAULT_LOCALE = 'en';
const useCache = config.USE_TRANSLATION_CACHE;
const localesCache = {};

// Locales that actually have a folder in src/locales
const availableLocales = new Set(
	fs.readdirSync(localesPath, { withFileTypes: true })
		.filter(entry => entry.isDirectory())
		.map(entry => entry.name),
);

// Discord locales that don't map to their language prefix.
// For the complete list of Discord locales and their ISO 639-1 equivalents, see localeMap.full.md
const localeOverrides = {};

const warnedLocales = new Set();

function resolveLocale(locale) {
	if (!locale) return DEFAULT_LOCALE;
	if (localeOverrides[locale]) return localeOverrides[locale];
	if (availableLocales.has(locale)) return locale;

	// 'en-US' -> 'en', 'pt-BR' -> 'pt'...
	const language = locale.split('-')[0];
	if (availableLocales.has(language)) return language;

	// Warn once per locale, not on every translation
	if (!warnedLocales.has(locale)) {
		warnedLocales.add(locale);
		logger.warn(`Locale ${locale} not available, falling back to ${DEFAULT_LOCALE}`);
	}
	return DEFAULT_LOCALE;
}

function loadLocale(locale) {
	if (useCache && localesCache[locale]) return localesCache[locale];

	const localePath = path.join(localesPath, locale);
	const translations = {};

	for (const file of fs.readdirSync(localePath).filter(f => f.endsWith('.json'))) {
		try {
			const category = path.basename(file, '.json');
			translations[category] = JSON.parse(fs.readFileSync(path.join(localePath, file), 'utf8'));
		}
		catch (err) {
			logger.error(`Error loading translation file ${locale}/${file}:`, err);
		}
	}

	if (useCache) localesCache[locale] = translations;
	return translations;
}

function getTranslation(key, locale) {
	let current = loadLocale(locale);

	for (const k of key.split('.')) {
		if (current && typeof current === 'object' && k in current) {
			current = current[k];
		}
		else {
			return locale !== DEFAULT_LOCALE ? getTranslation(key, DEFAULT_LOCALE) : key;
		}
	}

	return current;
}

function replaceArgs(message, replacements = {}) {
	if (typeof message !== 'string') return message;
	return message.replace(/{([^{}]*)}/g, (_, name) =>
		replacements[name] !== undefined ? String(replacements[name]) : `{${name}}`,
	);
}

export function t(key, locale = DEFAULT_LOCALE, replacements = {}) {
	return replaceArgs(getTranslation(key, resolveLocale(locale)), replacements);
}

export function detectLocale(interaction) {
	return interaction?.locale || interaction?.guild?.preferredLocale || DEFAULT_LOCALE;
}
