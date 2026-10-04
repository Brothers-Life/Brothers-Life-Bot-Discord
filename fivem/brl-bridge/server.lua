-- brl-bridge: forwards the txAdmin events to the Brothers Life bot (POST /api/fivem/events).
-- Event names and fields: docs/events.md of citizenfx/txAdmin.
-- Only a Discord ID is sent for the players: no license, IP, token or HWID ever leaves the server.

local function convar(name, fallback)
	local value = GetConvar(name, '')
	if value == '' then return fallback end
	return value
end

local URL = (convar('brl_bridge_url', Config.Url)):gsub('/+$', '')
local KEY = convar('brl_bridge_key', Config.Key)
local SERVER = convar('brl_bridge_server', Config.ServerName)
local ENDPOINT = URL .. '/api/fivem/events'

local function log(message, color)
	print(('%s[brl-bridge] %s^7'):format(color or '^5', message))
end

if KEY == '' or not KEY:match('^brl_') then
	log('Clé d’API manquante ou invalide : set brl_bridge_key "brl_..." dans server.cfg. Le pont est inactif.', '^1')
	return
end

-- Text fields stay short: the bot refuses very long values
local function cut(value, max)
	if type(value) ~= 'string' then return value end
	if #value > max then return value:sub(1, max) end
	return value
end

local function send(eventType, data, attempt)
	attempt = attempt or 1
	local body = json.encode({ type = eventType, server = SERVER, data = data or {} })
	PerformHttpRequest(ENDPOINT, function(status, response, _, errorData)
		if status >= 200 and status < 300 then
			if Config.Debug then log(('%s envoyé : %s'):format(eventType, response or '')) end
			return
		end
		-- 0: bot unreachable (or certificate refused), 429: rate limit, 5xx: bot error
		if (status == 0 or status == 429 or status >= 500) and attempt < Config.Retries then
			SetTimeout(attempt * 3000, function() send(eventType, data, attempt + 1) end)
			return
		end
		log(('%s non transmis (HTTP %s) : %s'):format(eventType, tostring(status), tostring(response or errorData or 'pas de réponse')), '^1')
	end, 'POST', body, {
		['Content-Type'] = 'application/json',
		['Authorization'] = 'Bearer ' .. KEY,
	})
end

-- "discord:123..." of an online player, as digits
local function discordOf(netId)
	netId = tonumber(netId)
	if not netId or netId < 1 or not GetPlayerName(netId) then return nil end
	for _, id in ipairs(GetPlayerIdentifiers(netId)) do
		local digits = id:match('^discord:(%d+)$')
		if digits then return digits end
	end
	return nil
end

-- Discord ID in a list of identifiers (bans, warns, revoked actions); the rest is not sent
local function discordIn(ids)
	if type(ids) ~= 'table' then return nil end
	for _, id in ipairs(ids) do
		local digits = type(id) == 'string' and id:match('^discord:(%d+)$')
		if digits then return digits end
	end
	return nil
end

local function nameOf(netId)
	netId = tonumber(netId)
	if not netId or netId < 1 then return nil end
	return GetPlayerName(netId)
end

local builders = {
	scheduledRestart = function(e)
		return { secondsRemaining = e.secondsRemaining }
	end,
	scheduledRestartSkipped = function(e)
		return { secondsRemaining = e.secondsRemaining, temporary = e.temporary, author = e.author }
	end,
	serverShuttingDown = function(e)
		return { delay = e.delay, author = e.author, message = cut(e.message, 1500) }
	end,
	announcement = function(e)
		return { author = e.author, message = cut(e.message, 1500) }
	end,
	playerKicked = function(e)
		return { target = e.target, author = e.author, reason = cut(e.reason, 500), targetName = nameOf(e.target), targetDiscord = discordOf(e.target) }
	end,
	playerBanned = function(e)
		return {
			author = e.author, reason = cut(e.reason, 500), actionId = e.actionId, expiration = e.expiration,
			durationTranslated = e.durationTranslated, targetNetId = e.targetNetId, targetName = e.targetName or nameOf(e.targetNetId),
			targetDiscord = discordIn(e.targetIds) or discordOf(e.targetNetId),
		}
	end,
	playerWarned = function(e)
		return {
			author = e.author, reason = cut(e.reason, 500), actionId = e.actionId, targetNetId = e.targetNetId,
			targetName = e.targetName or nameOf(e.targetNetId), targetDiscord = discordIn(e.targetIds) or discordOf(e.targetNetId),
		}
	end,
	playerDirectMessage = function(e)
		return { target = e.target, author = e.author, message = cut(e.message, 1500), targetName = nameOf(e.target), targetDiscord = discordOf(e.target) }
	end,
	playerHealed = function(e)
		return { target = e.target, author = e.author, targetName = nameOf(e.target) }
	end,
	actionRevoked = function(e)
		return {
			actionId = e.actionId, actionType = e.actionType, actionReason = cut(e.actionReason, 500), actionAuthor = e.actionAuthor,
			playerName = e.playerName or nil, revokedBy = e.revokedBy, targetDiscord = discordIn(e.playerIds),
		}
	end,
}

local function listen(txName, eventType)
	AddEventHandler('txAdmin:events:' .. txName, function(e)
		if not Config.Events[eventType] then return end
		local ok, data = pcall(builders[eventType], e or {})
		if not ok then
			log(('%s : données inattendues (%s)'):format(txName, tostring(data)), '^1')
			return
		end
		send(eventType, data)
	end)
end

for eventType in pairs(builders) do listen(eventType, eventType) end
if Config.LegacyEvents then
	listen('healedPlayer', 'playerHealed')
	listen('skippedNextScheduledRestart', 'scheduledRestartSkipped')
end

-- "Server started": the resource starts with the server (not a lone restart of the resource)
AddEventHandler('onResourceStart', function(resource)
	if resource ~= GetCurrentResourceName() then return end
	log(('Pont actif vers %s (serveur « %s »).'):format(ENDPOINT, SERVER))
	if Config.Events.serverStarted and GetGameTimer() < Config.StartedMaxUptime * 1000 then
		-- Let the other resources start first
		SetTimeout(15000, function() send('serverStarted', {}) end)
	end
end)

-- Console only: sends a test announcement to check the URL, the key and the certificate
RegisterCommand('brlbridge_test', function(source)
	if source ~= 0 then return end
	log('Envoi d’une annonce de test…')
	send('announcement', { author = 'brl-bridge', message = 'Test du pont txAdmin → Discord.' })
end, true)
