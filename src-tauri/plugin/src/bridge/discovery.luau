--!nocheck
--!nolint
-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Handles finding the active desktop daemon instance.
---
--- The desktop app binds to an ephemeral port to avoid collisions. We scan
--- the localhost port range (`PORT_START` to `PORT_END`) and pick the daemon
--- that was started most recently.

--- The per-request deadline (seconds). Prevents a single stalled connection from
--- blocking the entire discovery scan. TCP RST is near-instant on localhost, but
--- antivirus/firewall intercepts can cause longer stalls.
local DISCOVERY_REQUEST_TIMEOUT_SECS = 2

-- Roblox's HttpService rejects more than ~10 concurrent RequestAsync calls
-- with "Number of requests exceeded limit". Every probe in an over-limit
-- batch dies silently inside its pcall, so the plugin reports "no desktop
-- app found" even though the app is running fine. 8 keeps us safely under
-- the cap while still parallelising the scan.
local MAX_CONCURRENT_PROBES = 8

local function responseLooksLikeAppHealth(decoded: any): boolean
	return type(decoded) == "table" and decoded.app == "ISpooferMotion"
end

--- Makes a single health probe to `url` and stores the result if valid.
--- Decrements `pendingRef[1]` when done so the caller knows when all probes finished.
-- statsRef tallies why probes failed so discoverServer can explain a failed
-- connect: `responded` = got any HTTP reply, `wrongApp` = replied but wasn't us.
local function probeUrl(
	url: string,
	results: { { url: string, startedAt: number, health: any } },
	pendingRef: { number },
	cancelledRef: { boolean },
	statsRef: { responded: number, wrongApp: number }
)
	-- Soft timeout: if this probe is not done within DISCOVERY_REQUEST_TIMEOUT_SECS,
	-- the deadline task decrements pending so the scan can proceed without it.
	-- Roblox does not expose task.cancel, so we use a shared "done" flag to make the
	-- deadline a no-op if the request already finished.
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

--- Sweeps the known port range looking for the desktop daemon.
---
--- If we already have a `BASE_URL`, we probe it first for a fast reconnect path.
--- Probes run in batches of `MAX_CONCURRENT_PROBES` with a per-request 2-second
--- soft deadline, so a single stalled connection (firewall/AV intercepting
--- loopback traffic) cannot block the entire scan.
local function discoverServer(): (boolean, boolean, string?)
	-- Guard: when HttpService is disabled, every RequestAsync call throws
	-- inside its pcall and the scan reports "no desktop app found" even though
	-- the app is running fine. Detect this up front so the user gets a clear,
	-- actionable message instead of a confusing port-range error.
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

	-- Read the port range live each cycle so changing it in Settings takes effect
	-- without a plugin reload (the module-level PORT_START/PORT_END are read only
	-- once at load). Falls back to those defaults if the setting is missing.
	local portStart = tonumber(plugin:GetSetting("ISpooferMotion_PORT_START")) or PORT_START
	local portEnd = tonumber(plugin:GetSetting("ISpooferMotion_PORT_END")) or PORT_END
	if portStart > portEnd then
		portStart, portEnd = portEnd, portStart
	end

	-- Build the probe list. The last known BASE_URL goes first (fast reconnect),
	-- then 127.0.0.1 ports, then localhost. 127.0.0.1 is tried first because the
	-- app binds to it directly; localhost is a fallback for unusual DNS setups.
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

	-- Probe in batches of MAX_CONCURRENT_PROBES to stay under Roblox's
	-- HttpService concurrency limit. Each batch waits for its probes to
	-- finish (or time out) before starting the next. On localhost the app
	-- responds in <100ms, so the matching batch finishes almost instantly.
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

		-- Early exit: no need to scan more ports if we already found the app.
		if #results > 0 then
			break
		end

		idx += batchSize
	end
	-- Signal any in-flight deadline tasks they should no-op.
	cancelledRef[1] = true

	-- Pick the most recently started daemon (handles multiple Studio sessions).
	table.sort(results, function(a, b)
		return a.startedAt > b.startedAt
	end)

	if #results > 0 then
		local best = results[1]
		local changed = BASE_URL ~= best.url
		BASE_URL = best.url

		-- Update accent color and batch size if provided by the health endpoint.
		if best.health and best.health.themeAccent then
			if type(setThemeAccent) == "function" then
				setThemeAccent(best.health.themeAccent)
			end
		end
		if best.health and best.health.batchSize then
			if type(setPluginBatchSize) == "function" then
				setPluginBatchSize(best.health.batchSize)
			end
		end

		return true, changed
	end

	-- No daemon found: explain why using what the probes observed.
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
