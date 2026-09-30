import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import config from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const localesPath = path.join(__dirname, '..', 'locales');

const useCache = config.useCacheForTranslations;

let localesCache;
if (useCache) {
	localesCache = {};
}

function loadLocale(locale) {
	if (useCache && localesCache[locale]) return localesCache[locale];

	const localePath = path.join(localesPath, locale);

	if (!fs.existsSync(localePath)) {
		logger.warn(`Locale directory not found: ${localePath}`);
		if (useCache) localesCache[locale] = {};
		return {};
	}

	const translations = {};
	const files = fs.readdirSync(localePath).filter(file => file.endsWith('.json'));

	for (const file of files) {
		try {
			const category = path.basename(file, '.json');
			const content = fs.readFileSync(path.join(localePath, file), 'utf8');
			translations[category] = JSON.parse(content);
		}
		catch (err) {
			logger.error(`Error loading translation file ${file}:`, err);
		}
	}

	if (useCache) localesCache[locale] = translations;
	return translations;
}

// Mini mapping of locales used in this project.
// For the complete list of Discord locales and their ISO 639-1 equivalents, see localeMap.full.md
const localeMap = { 'en-GB': 'en', 'en-US': 'en', 'en': 'en', 'fr': 'fr' };

function getTranslation(key, locale = 'en') {
	if (!localeMap[locale]) {
		logger.warn(`Locale ${locale} not found, falling back to en`);
		locale = 'en';
	}

	const mappedLocale = localeMap[locale] || 'en';
	const translations = loadLocale(mappedLocale);
	const keys = key.split('.');
	let current = translations;

	for (const k of keys) {
		if (current && typeof current === 'object' && k in current) {
			current = current[k];
		}
		else {
			if (locale !== 'en') {
				return getTranslation(key, 'en');
			}
			return key;
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

export function t(key, locale = 'en', replacements = {}) {
	const message = getTranslation(key, locale);
	return replaceArgs(message, replacements);
}

export function detectLocale(interaction) {
	return interaction?.locale || interaction?.guild?.preferredLocale || 'en';
}