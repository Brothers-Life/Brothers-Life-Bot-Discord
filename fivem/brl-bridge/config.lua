-- Settings of the bridge. The URL and the key are better set as convars in server.cfg
-- (see README.md): never write the API key in a file shared with other people.
Config = {}

-- Address of the bot panel, without a trailing slash (convar: brl_bridge_url)
Config.Url = 'https://127.0.0.1:3000'

-- API key "brl_..." limited to the fivem.events permission (convar: brl_bridge_key)
Config.Key = ''

-- Name shown in the Discord messages as {txadmin.server} (convar: brl_bridge_server)
Config.ServerName = 'Brothers Life'

-- Events sent to the bot (what is done with them is chosen in the panel, page "Annonces FiveM")
Config.Events = {
	serverStarted = true,
	scheduledRestart = true,
	scheduledRestartSkipped = true,
	serverShuttingDown = true,
	announcement = true,
	playerKicked = true,
	playerBanned = true,
	playerWarned = true,
	playerDirectMessage = false,
	playerHealed = false,
	actionRevoked = true,
}

-- Also listen to the names txAdmin deprecated in v8 (healedPlayer, skippedNextScheduledRestart).
-- Only for an old txAdmin: with v8 both names may be sent for the same action.
Config.LegacyEvents = false

-- "Server started" only when the resource starts with the server, not when it is restarted alone
-- (uptime of the server below this many seconds)
Config.StartedMaxUptime = 300

-- Retries when the bot cannot be reached (network, restart of the bot)
Config.Retries = 3

-- Prints every event sent in the server console
Config.Debug = false
