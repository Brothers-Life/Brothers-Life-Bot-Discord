import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import logger from '../utils/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const commandsPath = path.join(__dirname, 'commands');

// Recursively lists .js files, so commands can live at the root of commands/ or in any sub-folder
function listJsFiles(dir) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) return listJsFiles(fullPath);
		return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
	});
}

export async function loadCommands() {
	const commands = [];

	for (const filePath of listJsFiles(commandsPath)) {
		// pathToFileURL handles Windows drive letters and spaces in paths
		const commandModule = await import(pathToFileURL(filePath).href);
		if ('data' in commandModule && 'execute' in commandModule) {
			commands.push({
				data: commandModule.data,
				execute: commandModule.execute,
				cooldown: commandModule.cooldown,
			});
		}
		else {
			logger.error(`The command at ${filePath} is missing a required "data" or "execute" property.`);
		}
	}

	return commands;
}
