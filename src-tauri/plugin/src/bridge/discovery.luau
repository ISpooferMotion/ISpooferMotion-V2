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

local function responseLooksLikeAppHealth(decoded: any): boolean
	return type(decoded) == "table" and decoded.app == "ISpooferMotion"
end

--- Makes a single health probe to `url` and stores the result if valid.
--- Decrements `pendingRef[1]` when done so the caller knows when all probes finished.
local function probeUrl(
	url: string,
	results: { { url: string, startedAt: number, health: any } },
	pendingRef: { number },
	cancelledRef: { boolean }
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
			local decodedOk, decoded = decodeJsonResponseBody(response)
			if decodedOk and responseLooksLikeAppHealth(decoded) then
				local startedAt = tonumber(decoded.startedAt) or 0
				table.insert(results, {
					url = url,
					startedAt = startedAt,
					health = decoded,
				})
			end
		end
		pendingRef[1] -= 1
	end
end

--- Sweeps the known port range looking for the desktop daemon.
---
--- If we already have a `BASE_URL`, we probe it first for a fast reconnect path.
--- All probes run concurrently with a per-request 2-second soft deadline so a
--- single stalled connection (firewall/AV intercepting loopback traffic) cannot
--- block the entire scan for 5+ seconds.
local function discoverServer(): (boolean, boolean)
	local results: { { url: string, startedAt: number, health: any } } = {}
	-- pendingRef[1] is a shared counter decremented by each completed probe task.
	local pendingRef = { 0 }
	local cancelledRef = { false }

	-- IMP-8: Fast path - probe the last known URL first. If it responds before
	-- the full scan completes, the sort below will pick it as the best candidate.
	if BASE_URL then
		pendingRef[1] += 1
		task.spawn(probeUrl, BASE_URL, results, pendingRef, cancelledRef)
	end

	-- Full port scan using only loopback addresses. External DNS (e.g. nip.io) adds
	-- latency and is a hard failure point for users without internet access.
	local hosts = { "127.0.0.1", "localhost" }
	for port = PORT_START, PORT_END do
		for _, host in ipairs(hosts) do
			local url = "http://" .. host .. ":" .. port
			-- Skip if already covered by the fast-path probe above.
			if url ~= BASE_URL then
				pendingRef[1] += 1
				task.spawn(probeUrl, url, results, pendingRef, cancelledRef)
			end
		end
	end

	-- Wait for all probes to finish or for the hard deadline (per-request timeout + buffer).
	local hardDeadline = os.clock() + DISCOVERY_REQUEST_TIMEOUT_SECS + 0.5
	while pendingRef[1] > 0 and os.clock() < hardDeadline do
		task.wait(0.05)
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

		-- Update accent color if provided by the health endpoint.
		if best.health and best.health.themeAccent then
			if type(setThemeAccent) == "function" then
				setThemeAccent(best.health.themeAccent)
			end
		end

		return true, changed
	end

	return false, false
end
