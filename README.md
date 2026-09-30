Discord.js Bot Template
=======================

A clean and modern Discord bot template built with **discord.js** (JavaScript). This template includes command and event handlers, slash command support, environment configuration, and a modular structure designed to help you build scalable Discord bots quickly. Perfect for both beginners and advanced developers.

![License MIT](https://img.shields.io/badge/License-MIT-yellow.svg)


Features
--------

*   **Modular Architecture** – Well-organized project structure for easy scalability
    
*   **Command & Event Handlers** – Automatically loads commands and events from their respective directories
    
*   **Slash Command Support** – Built-in support for Discord's application commands (slash commands)
    
*   **Environment Configuration** – Uses .json files for secure and flexible configuration
    
*   **Colorized Logging System** – Console output with daily file storage for persistent logs
    
*   **Full i18n (Internationalization)** – Ready-to-use translation system for multi-language support
    
*   **MIT Licensed** – Free to use, modify, and distribute
    

Project Structure
--------------------

```plaintext
discordjs-bot-template/
├── src/
│   ├── commands/           # Slash and text commands
│   ├── config/             # Configuration files
│   ├── events/             # Discord event handlers
│   ├── locales/            # Translation files
│   ├── tools/              # Some tools for you to build faster
│   ├── utils/              # Utilities and helpers
│   └── index.js            # Main bot entry point
├── logs/                   # Daily log files
├── nodemon.json            # Auto-restart during development
├── package.json
└── README.md
```


Getting Started
------------------

### Prerequisites

*   [Node.js](https://nodejs.org/) (v16.9.0 or higher)
    
*   A Discord Bot Token from the [Discord Developer Portal](https://discord.com/developers/applications)
    

### Installation

1.  **Clone the repository**

```bash
git clone https://github.com/arthurcorberes/discordjs-bot-template.git
cd discordjs-bot-template 
```

2.  **Install dependencies**

```bash
npm install
```

3.  **Configure environment**

*   Copy `config.example.json` to `config.dev.json` and `config.prod.json`
    
*   Fill in your Discord bot token and other settings

4.  **Start the bot**

```bash
npm run start
```

For development with auto-reload (using nodemon):
```bash
npm run dev
```


Usage
--------

### Creating Commands

Add new commands in `src/commands/`. Each command file should export a data object (for slash commands) and an execute function.

Example (ping.js):

```javascript
import { SlashCommandBuilder } from 'discord.js';

export const cooldown = 1;

export const data = new SlashCommandBuilder()
	.setName('ping')
	.setDescription('Replies with Pong!');

export async function execute(interaction) {
	await interaction.reply('Pong!');
}
```

### Creating Events

Add new event handlers in `src/events/`. File names should match Discord.js event names.

Example (ready.js):

```javascript
import { Events } from 'discord.js';

export const name = Events.ClientReady;
export const once = true;
export function execute(client) {
	console.log(`Ready! Logged in as ${client.user.tag}`);
}
```

### Using i18n (Translations)

The template includes a translation system. Add locale files in `src/locales` and use them in your code.

### Logging

Use the built-in logger for consistent output:

```javascript
import logger from './src/utils/logger.js';
logger.info('Bot is starting...');
logger.error('Something went wrong!');
```


License
----------

This project is licensed under the MIT License. See the LICENSE file for details.


Contributing
---------------

Contributions, issues, and feature requests are welcome! Feel free to check the [issues page](https://github.com/arthurcorberes/discordjs-bot-template/issues).

1.  Fork the project
    
2.  Create your feature branch (`git checkout -b feature/AmazingFeature`)
    
3.  Commit your changes (`git commit -m 'Add some AmazingFeature'`)
    
4.  Push to the branch (`git push origin feature/AmazingFeature`)
    
5.  Open a Pull Request
    

Acknowledgments
------------------

*   [discord.js](https://discord.js.org/) for the powerful Discord API library
    
*   All contributors and users of this template
    

Support
----------

For support, please open an issue in the GitHub repository.