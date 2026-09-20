--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global

local DISCOVERY_REQUEST_TIMEOUT_SECS = 2

local MAX_CONCURRENT_PROBES = 8

local function responseLooksLikeAppHealth(decoded: any): boolean
	return type(decoded) == "table" and decoded.app == "ISpooferMotion"
end

local function probeUrl(
	url: string,
	results: { { url: string, startedAt: number, health: any } },
	pendingRef: { number },
	cancelledRef: { boolean },
	statsRef: { responded: number, wrongApp: number }
)
	local done = false

	task.delay(DISCOVERY_REQUEST_TIMEOUT_SECS, function()
		if not done then
			done = true
			pendingRef[1] -= 1
		end
	end)

	if cancelledRef[1] then
		if not done then
			done = true
			pendingRef[1] -= 1
		end
		return
	end

	local ok, response = pcall(function()
		return HttpService:RequestAsync({
			Url = url .. "/health",
			Method = "GET",
		})
	end)

	if not done then
		done = true
		if ok and response and response.Success and not cancelledRef[1] then
			statsRef.responded += 1
			local decodedOk, decoded = decodeJsonResponseBody(response)
			if decodedOk and responseLooksLikeAppHealth(decoded) then
				local startedAt = tonumber(decoded.startedAt) or 0
				table.insert(results, {
					url = url,
					startedAt = startedAt,
					health = decoded,
				})
			else
				statsRef.wrongApp += 1
			end
		end
		pendingRef[1] -= 1
	end
end

local function discoverServer(): (boolean, boolean, string?)
	local httpOk, httpEnabled = pcall(function()
		return (HttpService :: any).HttpEnabled
	end)
	if httpOk and not httpEnabled then
		return false,
			false,
			"Roblox HttpService is disabled. Enable 'Allow HTTP Requests' "
				.. "in Game Settings > Security, then the plugin will connect automatically."
	end

	local results: { { url: string, startedAt: number, health: any } } = {}
	local cancelledRef = { false }
	local statsRef = { responded = 0, wrongApp = 0 }

	local portStart = PORT_START
	local portEnd = PORT_END
	if portStart > portEnd then
		portStart, portEnd = portEnd, portStart
	end

	local urls: { string } = {}
	if BASE_URL then
		table.insert(urls, BASE_URL)
	end
	for port = portStart, portEnd do
		local url = "http://127.0.0.1:" .. port
		if url ~= BASE_URL then
			table.insert(urls, url)
		end
	end
	for port = portStart, portEnd do
		local url = "http://localhost:" .. port
		if url ~= BASE_URL then
			table.insert(urls, url)
		end
	end

	local idx = 1
	while idx <= #urls do
		local batchPending = { 0 }
		local batchSize = math.min(MAX_CONCURRENT_PROBES, #urls - idx + 1)

		for j = idx, idx + batchSize - 1 do
			batchPending[1] += 1
			task.spawn(probeUrl, urls[j], results, batchPending, cancelledRef, statsRef)
		end

		local batchDeadline = os.clock() + DISCOVERY_REQUEST_TIMEOUT_SECS + 0.5
		while batchPending[1] > 0 and os.clock() < batchDeadline do
			task.wait(0.05)
		end

		if #results > 0 then
			break
		end

		idx += batchSize
	end

	cancelledRef[1] = true

	table.sort(results, function(a, b)
		return a.startedAt > b.startedAt
	end)

	if #results > 0 then
		local best = results[1]
		local changed = BASE_URL ~= best.url
		BASE_URL = best.url

		if best.health and best.health.batchSize then
			if type(setPluginBatchSize) == "function" then
				setPluginBatchSize(best.health.batchSize)
			end
		end

		return true, changed
	end

	local reason
	if statsRef.wrongApp > 0 then
		reason = string.format(
			"Found a server on ports %d-%d but it isn't ISpooferMotion. Close other apps using these ports.",
			portStart,
			portEnd
		)
	else
		reason = string.format(
			"No desktop app found on ports %d-%d. Make sure it's running. If it is, the app uses 14285-14289 by default -- check the Daemon Port range in Settings covers those.",
			portStart,
			portEnd
		)
	end
	return false, false, reason
end
