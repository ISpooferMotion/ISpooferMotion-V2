--!nolint UnknownGlobal
--!nocheck
--!nolint

-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global
--- Handles the in-Studio graphical interface for the plugin.
---
--- Since Roblox plugins cannot easily use HTML or standard desktop UIs, we
--- build a custom ScreenGui that renders inside the Studio viewport. This shows
--- connection status and live logs so the user knows what the daemon is doing.
local CoreGui = game:GetService("CoreGui")
local gui = nil
local statusText = nil
local logsScrollingFrame = nil
local connectionStatusText = nil
--- Number of log lines ever added, used both for eviction and for naming labels.
--- It must be declared up here with the rest of the module state: the header's
--- Clear button lives inside `createPluginGui`, and a local declared further down
--- (beside the LogService listener) would not be in scope there - the button would
--- silently read and write a global of the same name instead.
local logCounter = 0

local currentAccentColor = Color3.fromHex("#10b981")
local activeTabIndicators = {}
local updateBatchUIFunc = nil

--- Removes every log line from the panel and resets the eviction counter.
---
--- Purely local to Studio - it clears what the panel is showing and does not need
--- the desktop app, so it works while disconnected.
local function clearPluginLogs()
	if not logsScrollingFrame then
		return
	end

	for _, child in ipairs(logsScrollingFrame:GetChildren()) do
		if child:IsA("TextLabel") then
			child:Destroy()
		end
	end

	logCounter = 0
end

--- Bootstraps the ScreenGui and injects it into CoreGui.
---
--- We prefer CoreGui so our panel renders above the game viewport and does
--- not get accidentally deleted by the user, but we fall back to StarterGui
--- if we do not have permission.
local function createPluginGui()
	if gui then
		return
	end

	gui = Instance.new("ScreenGui")
	gui.Name = "ISpooferMotionPluginGui"
	gui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

	local success = pcall(function()
		gui.Parent = CoreGui
	end)
	if not success then
		gui.Parent = game:GetService("StarterGui")
	end

	local container = Instance.new("Frame")
	container.Name = "MainPanel"
	container.Size = UDim2.fromOffset(680, 420)
	container.Position = UDim2.fromScale(0.5, 0.5)
	container.AnchorPoint = Vector2.new(0.5, 0.5)
	container.BackgroundColor3 = Color3.fromHex("#09090b")
	container.BorderSizePixel = 0
	container.Parent = gui

	local panelCorner = Instance.new("UICorner")
	panelCorner.CornerRadius = UDim.new(0, 8)
	panelCorner.Parent = container

	local panelStroke = Instance.new("UIStroke")
	panelStroke.Color = Color3.fromHex("#27272a")
	panelStroke.Thickness = 1
	panelStroke.Parent = container

	local containerGradient = Instance.new("UIGradient")
	containerGradient.Color = ColorSequence.new({
		ColorSequenceKeypoint.new(0, Color3.fromHex("#111113")),
		ColorSequenceKeypoint.new(1, Color3.fromHex("#09090b")),
	})
	containerGradient.Rotation = 45
	containerGradient.Parent = container

	local header = Instance.new("Frame")
	header.Name = "Header"
	header.Size = UDim2.new(1, 0, 0, 56)
	header.BackgroundTransparency = 1
	header.Active = true
	header.Parent = container

	-- Dragging Logic
	local dragging = false
	local dragInput = nil
	local dragStart = nil
	local startPos = nil

	local function update(input)
		local delta = input.Position - dragStart
		container.Position = UDim2.new(
			startPos.X.Scale,
			startPos.X.Offset + delta.X,
			startPos.Y.Scale,
			startPos.Y.Offset + delta.Y
		)
	end

	header.InputBegan:Connect(function(input)
		if
			input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch
		then
			dragging = true
			dragStart = input.Position
			startPos = container.Position

			input.Changed:Connect(function()
				if input.UserInputState == Enum.UserInputState.End then
					dragging = false
				end
			end)
		end
	end)

	header.InputChanged:Connect(function(input)
		if
			input.UserInputType == Enum.UserInputType.MouseMovement
			or input.UserInputType == Enum.UserInputType.Touch
		then
			dragInput = input
		end
	end)

	game:GetService("UserInputService").InputChanged:Connect(function(input)
		if input == dragInput and dragging then
			update(input)
		end
	end)

	-- TweenService for animations
	local TweenService = game:GetService("TweenService")
	local tweenInfo = TweenInfo.new(0.15, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)
	local rippleTweenInfo = TweenInfo.new(0.35, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

	--- Plays a ripple animation from the click position on a button.
	--- The button must have ClipsDescendants = true to contain the circle.
	local function ripple(button, x, y)
		button.ClipsDescendants = true
		local circle = Instance.new("Frame")
		circle.Name = "Ripple"
		circle.Size = UDim2.fromOffset(0, 0)

		local localX = button.AbsoluteSize.X / 2
		local localY = button.AbsoluteSize.Y / 2
		if x and y then
			localX = x - button.AbsolutePosition.X
			localY = y - button.AbsolutePosition.Y
		end

		circle.Position = UDim2.fromOffset(localX, localY)
		circle.AnchorPoint = Vector2.new(0.5, 0.5)
		circle.BackgroundColor3 = Color3.fromRGB(255, 255, 255)
		circle.BackgroundTransparency = 0.75
		circle.BorderSizePixel = 0
		circle.ZIndex = button.ZIndex + 10
		local circleCorner = Instance.new("UICorner")
		circleCorner.CornerRadius = UDim.new(1, 0)
		circleCorner.Parent = circle
		circle.Parent = button
		local targetSize = math.max(button.AbsoluteSize.X, button.AbsoluteSize.Y) * 2.5
		TweenService:Create(circle, rippleTweenInfo, {
			Size = UDim2.fromOffset(targetSize, targetSize),
			BackgroundTransparency = 1,
		}):Play()
		task.delay(0.4, function()
			circle:Destroy()
		end)
	end

	--- Tweens a button's background color smoothly.
	local function tweenBg(btn, color)
		TweenService:Create(btn, tweenInfo, { BackgroundColor3 = color }):Play()
	end

	local icon = Instance.new("ImageLabel")
	icon.Name = "Icon"
	icon.Size = UDim2.fromOffset(36, 36)
	icon.Position = UDim2.new(0, 16, 0.5, 0)
	icon.AnchorPoint = Vector2.new(0, 0.5)
	icon.BackgroundTransparency = 1
	icon.Image = "rbxassetid://137844667859456"
	icon.Parent = header

	local title = Instance.new("TextLabel")
	title.Name = "Title"
	title.Size = UDim2.fromOffset(200, 20)
	title.Position = UDim2.new(0, 64, 0.5, -8)
	title.AnchorPoint = Vector2.new(0, 0.5)
	title.BackgroundTransparency = 1
	title.Font = Enum.Font.BuilderSansExtraBold
	title.TextSize = 14
	title.TextColor3 = Color3.fromHex("#fafafa")
	title.TextXAlignment = Enum.TextXAlignment.Left
	title.Text = "ISpooferMotion"
	title.Parent = header

	local versionLabel = Instance.new("TextLabel")
	versionLabel.Name = "VersionWatermark"
	versionLabel.Size = UDim2.fromOffset(100, 14)
	versionLabel.Position = UDim2.new(0, 64, 0.5, 10)
	versionLabel.AnchorPoint = Vector2.new(0, 0.5)
	versionLabel.BackgroundTransparency = 1
	versionLabel.Font = Enum.Font.BuilderSansMedium
	versionLabel.TextSize = 12
	versionLabel.TextColor3 = Color3.fromHex("#a1a1aa")
	versionLabel.TextXAlignment = Enum.TextXAlignment.Left
	versionLabel.Text = "v" .. (PLUGIN_VERSION or "Unknown")
	versionLabel.Parent = header

	statusText = Instance.new("TextLabel")
	statusText.Name = "StatusText"
	statusText.Size = UDim2.new(0, 250, 1, 0)
	statusText.Position = UDim2.fromScale(0.5, 0.5)
	statusText.AnchorPoint = Vector2.new(0.5, 0.5)
	statusText.BackgroundTransparency = 1
	statusText.Font = Enum.Font.BuilderSansMedium
	statusText.TextSize = 13
	statusText.TextColor3 = Color3.fromHex("#fafafa")
	statusText.TextXAlignment = Enum.TextXAlignment.Center
	statusText.Text = "Waiting for Desktop App..."
	statusText.Parent = header

	local openLogsButton = Instance.new("TextButton")
	openLogsButton.Name = "OpenLogsButton"
	openLogsButton.Size = UDim2.fromOffset(92, 28)
	openLogsButton.Position = UDim2.new(1, -52, 0.5, 0)
	openLogsButton.AnchorPoint = Vector2.new(1, 0.5)
	openLogsButton.BackgroundTransparency = 1
	openLogsButton.BorderSizePixel = 0
	openLogsButton.Font = Enum.Font.BuilderSansMedium
	openLogsButton.TextSize = 12
	openLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
	openLogsButton.Text = "Open Logs"
	openLogsButton.AutoButtonColor = false
	openLogsButton.ClipsDescendants = true
	openLogsButton.Parent = header

	openLogsButton.MouseEnter:Connect(function()
		openLogsButton.TextColor3 = Color3.fromHex("#fafafa")
	end)
	openLogsButton.MouseLeave:Connect(function()
		openLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
	end)
	openLogsButton.MouseButton1Click:Connect(function()
		ripple(openLogsButton)
		local logs = {}
		if logsScrollingFrame then
			for _, child in ipairs(logsScrollingFrame:GetChildren()) do
				if child:IsA("TextLabel") then
					table.insert(logs, { order = child.LayoutOrder, text = child.Text })
				end
			end
			table.sort(logs, function(a, b)
				return a.order < b.order
			end)
			local logStrings = {}
			for _, logItem in ipairs(logs) do
				table.insert(logStrings, logItem.text)
			end
			local finalString = table.concat(logStrings, "\n")
			if finalString == "" then
				finalString = "(No logs generated yet)"
			end

			local serverStorage = game:GetService("ServerStorage")

			-- Replace the previous export rather than stacking another script in
			-- ServerStorage: those are saved with the place, so repeated exports
			-- used to leave a pile of "ISpooferMotion_Logs" copies behind.
			local previousExport = serverStorage:FindFirstChild("ISpooferMotion_Logs")
			if previousExport then
				previousExport:Destroy()
			end

			local logScript = Instance.new("Script")
			logScript.Name = "ISpooferMotion_Logs"
			logScript.Source = "-- ISpooferMotion Logs\n-- Copy the contents below:\n\n--[[\n"
				.. finalString
				.. "\n]]"
			logScript.Parent = serverStorage

			local exportSuccess, err = pcall(function()
				-- selene: allow(deprecated)
				plugin:OpenScript(logScript)
			end)

			if exportSuccess then
				openLogsButton.Text = "Opened!"
			else
				warn("ISpooferMotion Open Logs Failed: " .. tostring(err))
				openLogsButton.Text = "Error"
			end

			task.delay(1.5, function()
				if openLogsButton then
					openLogsButton.Text = "Open Logs"
					openLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
				end
			end)
		end
	end)

	local clearLogsButton = Instance.new("TextButton")
	clearLogsButton.Name = "ClearLogsButton"
	clearLogsButton.Size = UDim2.fromOffset(56, 28)
	clearLogsButton.Position = UDim2.new(1, -148, 0.5, 0)
	clearLogsButton.AnchorPoint = Vector2.new(1, 0.5)
	clearLogsButton.BackgroundTransparency = 1
	clearLogsButton.BorderSizePixel = 0
	clearLogsButton.Font = Enum.Font.BuilderSansMedium
	clearLogsButton.TextSize = 12
	clearLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
	clearLogsButton.Text = "Clear"
	clearLogsButton.AutoButtonColor = false
	clearLogsButton.ClipsDescendants = true
	clearLogsButton.Parent = header

	clearLogsButton.MouseEnter:Connect(function()
		clearLogsButton.TextColor3 = Color3.fromHex("#fafafa")
	end)
	clearLogsButton.MouseLeave:Connect(function()
		clearLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
	end)
	clearLogsButton.MouseButton1Click:Connect(function()
		ripple(clearLogsButton)
		clearPluginLogs()
		clearLogsButton.Text = "Cleared"

		task.delay(1.5, function()
			if clearLogsButton and clearLogsButton.Parent then
				clearLogsButton.Text = "Clear"
				clearLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
			end
		end)
	end)

	-- Removed header separator line per user request

	local closeButton = Instance.new("TextButton")
	closeButton.Name = "CloseButton"
	closeButton.Size = UDim2.fromOffset(32, 32)
	closeButton.Position = UDim2.new(1, -16, 0.5, 0)
	closeButton.AnchorPoint = Vector2.new(1, 0.5)
	closeButton.BackgroundTransparency = 1
	closeButton.BorderSizePixel = 0
	closeButton.Font = Enum.Font.BuilderSansExtraBold
	closeButton.TextSize = 14
	closeButton.TextColor3 = Color3.fromHex("#52525b")
	closeButton.Text = "X"
	closeButton.AutoButtonColor = false
	closeButton.ClipsDescendants = true
	closeButton.Parent = header

	closeButton.MouseEnter:Connect(function()
		TweenService:Create(closeButton, tweenInfo, { TextColor3 = Color3.fromHex("#ef4444") })
			:Play()
	end)
	closeButton.MouseLeave:Connect(function()
		TweenService:Create(closeButton, tweenInfo, { TextColor3 = Color3.fromHex("#52525b") })
			:Play()
	end)
	closeButton.MouseButton1Click:Connect(function()
		ripple(closeButton)
		task.delay(0.1, function()
			if gui then
				gui.Enabled = false
			end
		end)
	end)

	-- Tab Bar
	local tabBar = Instance.new("Frame")
	tabBar.Name = "TabBar"
	tabBar.Size = UDim2.new(1, -32, 0, 32)
	tabBar.Position = UDim2.fromOffset(16, 56)
	tabBar.BackgroundTransparency = 1
	tabBar.Parent = container

	local tabListLayout = Instance.new("UIListLayout")
	tabListLayout.FillDirection = Enum.FillDirection.Horizontal
	tabListLayout.SortOrder = Enum.SortOrder.LayoutOrder
	tabListLayout.Padding = UDim.new(0, 8)
	tabListLayout.Parent = tabBar

	local function createTabButton(name, text, order, isActive)
		local btn = Instance.new("TextButton")
		btn.Name = name
		btn.Size = UDim2.fromOffset(120, 32)
		btn.BackgroundColor3 = isActive and Color3.fromHex("#18181b") or Color3.fromHex("#09090b")
		btn.BorderSizePixel = 0
		btn.Font = Enum.Font.BuilderSansMedium
		btn.TextSize = 13
		btn.TextColor3 = isActive and Color3.fromHex("#ffffff") or Color3.fromHex("#71717a")
		btn.Text = text
		btn.AutoButtonColor = false
		btn.LayoutOrder = order
		btn.ClipsDescendants = true

		local corner = Instance.new("UICorner")
		corner.CornerRadius = UDim.new(0, 6)
		corner.Parent = btn

		local stroke = Instance.new("UIStroke")
		stroke.Color = Color3.fromHex("#27272a")
		stroke.Thickness = 1
		stroke.Parent = btn

		-- Active underline indicator
		local indicator = Instance.new("Frame")
		indicator.Name = "ActiveIndicator"
		indicator.Size = UDim2.new(0.6, 0, 0, 2)
		indicator.Position = UDim2.new(0.2, 0, 1, -3)
		indicator.BackgroundColor3 = currentAccentColor
		indicator.BackgroundTransparency = isActive and 0 or 1
		indicator.BorderSizePixel = 0
		local indCorner = Instance.new("UICorner")
		indCorner.CornerRadius = UDim.new(1, 0)
		indCorner.Parent = indicator
		indicator.Parent = btn
		table.insert(activeTabIndicators, indicator)

		btn.MouseEnter:Connect(function()
			if btn.BackgroundColor3 ~= Color3.fromHex("#18181b") then
				tweenBg(btn, Color3.fromHex("#111114"))
			end
		end)
		btn.MouseLeave:Connect(function()
			if btn.BackgroundColor3 ~= Color3.fromHex("#18181b") then
				tweenBg(btn, Color3.fromHex("#09090b"))
			end
		end)
		btn.MouseButton1Click:Connect(function()
			ripple(btn)
		end)

		return btn, indicator
	end

	local consoleTabBtn, consoleIndicator = createTabButton("ConsoleTab", "Console", 1, true)
	consoleTabBtn.Parent = tabBar

	local manualTabBtn, manualIndicator = createTabButton("ManualTab", "Manual Replace", 2, false)
	manualTabBtn.Parent = tabBar

	local settingsTabBtn, settingsIndicator = createTabButton("SettingsTab", "Settings", 3, false)
	settingsTabBtn.Parent = tabBar

	-- Containers
	local contentArea = Instance.new("Frame")
	contentArea.Name = "ContentArea"
	contentArea.Size = UDim2.new(1, -32, 1, -144)
	contentArea.Position = UDim2.fromOffset(16, 96)
	contentArea.BackgroundTransparency = 1
	contentArea.Parent = container

	-- CONSOLE CONTAINER
	local logsContainer = Instance.new("Frame")
	logsContainer.Name = "LogsContainer"
	logsContainer.Size = UDim2.fromScale(1, 1)
	logsContainer.BackgroundColor3 = Color3.fromHex("#0c0c0e")
	logsContainer.BorderSizePixel = 0
	logsContainer.Parent = contentArea

	local logsCorner = Instance.new("UICorner")
	logsCorner.CornerRadius = UDim.new(0, 8)
	logsCorner.Parent = logsContainer

	local logsStroke = Instance.new("UIStroke")
	logsStroke.Color = Color3.fromHex("#27272a")
	logsStroke.Thickness = 1
	logsStroke.Parent = logsContainer

	logsScrollingFrame = Instance.new("ScrollingFrame")
	logsScrollingFrame.Name = "Logs"
	logsScrollingFrame.Size = UDim2.fromScale(1, 1)
	logsScrollingFrame.BackgroundTransparency = 1
	logsScrollingFrame.BorderSizePixel = 0
	logsScrollingFrame.ScrollBarThickness = 6
	logsScrollingFrame.ScrollBarImageColor3 = Color3.fromHex("#27272a")
	logsScrollingFrame.CanvasSize = UDim2.new(0, 0, 0, 0)
	logsScrollingFrame.AutomaticCanvasSize = Enum.AutomaticSize.Y
	logsScrollingFrame.ScrollingEnabled = true
	logsScrollingFrame.Active = true
	logsScrollingFrame.Parent = logsContainer

	local logsPadding = Instance.new("UIPadding")
	logsPadding.PaddingLeft = UDim.new(0, 12)
	logsPadding.PaddingRight = UDim.new(0, 4)
	logsPadding.PaddingTop = UDim.new(0, 8)
	logsPadding.PaddingBottom = UDim.new(0, 8)
	logsPadding.Parent = logsScrollingFrame

	local listLayout = Instance.new("UIListLayout")
	listLayout.Parent = logsScrollingFrame
	listLayout.SortOrder = Enum.SortOrder.LayoutOrder
	listLayout.Padding = UDim.new(0, 4)

	listLayout:GetPropertyChangedSignal("AbsoluteContentSize"):Connect(function()
		local maxScroll = logsScrollingFrame.AbsoluteCanvasSize.Y
			- logsScrollingFrame.AbsoluteWindowSize.Y
		local isAtBottom = logsScrollingFrame.CanvasPosition.Y >= (maxScroll - 50)
		task.defer(function()
			if isAtBottom or maxScroll <= 0 then
				logsScrollingFrame.CanvasPosition =
					Vector2.new(0, logsScrollingFrame.AbsoluteCanvasSize.Y)
			end
		end)
	end)

	-- MANUAL REPLACEMENTS CONTAINER
	local manualContainer = Instance.new("Frame")
	manualContainer.Name = "ManualContainer"
	manualContainer.Size = UDim2.fromScale(1, 1)
	manualContainer.BackgroundTransparency = 1
	manualContainer.Visible = false
	manualContainer.Parent = contentArea

	-- Scrollable frame wrapping the input box so 4000+ IDs can be scrolled smoothly
	local manualScroll = Instance.new("ScrollingFrame")
	manualScroll.Name = "InputScroll"
	manualScroll.Size = UDim2.new(1, 0, 1, -112)
	manualScroll.Position = UDim2.new(0, 0, 0, 0)
	manualScroll.BackgroundColor3 = Color3.fromHex("#0c0c0e")
	manualScroll.BorderSizePixel = 0
	manualScroll.CanvasSize = UDim2.new(0, 0, 0, 0)
	manualScroll.AutomaticCanvasSize = Enum.AutomaticSize.Y
	manualScroll.ScrollBarThickness = 6
	manualScroll.ScrollBarImageColor3 = Color3.fromHex("#52525b")
	manualScroll.ScrollingDirection = Enum.ScrollingDirection.Y
	manualScroll.Active = true
	manualScroll.Parent = manualContainer

	local manualScrollCorner = Instance.new("UICorner")
	manualScrollCorner.CornerRadius = UDim.new(0, 8)
	manualScrollCorner.Parent = manualScroll

	local manualScrollStroke = Instance.new("UIStroke")
	manualScrollStroke.Color = Color3.fromHex("#27272a")
	manualScrollStroke.Thickness = 1
	manualScrollStroke.Parent = manualScroll

	local manualScrollPadding = Instance.new("UIPadding")
	manualScrollPadding.PaddingLeft = UDim.new(0, 8)
	manualScrollPadding.PaddingRight = UDim.new(0, 8)
	manualScrollPadding.PaddingTop = UDim.new(0, 8)
	manualScrollPadding.PaddingBottom = UDim.new(0, 8)
	manualScrollPadding.Parent = manualScroll

	local manualBox = Instance.new("TextBox")
	manualBox.Name = "InputBox"
	manualBox.Size = UDim2.new(1, -4, 1, 0)
	manualBox.AutomaticSize = Enum.AutomaticSize.Y
	manualBox.BackgroundTransparency = 1
	manualBox.BorderSizePixel = 0
	manualBox.Font = Enum.Font.RobotoMono
	manualBox.TextSize = 13
	manualBox.TextColor3 = Color3.fromHex("#fafafa")
	manualBox.PlaceholderText = "Paste 'oldId -> newId' pairs here..."
	manualBox.TextXAlignment = Enum.TextXAlignment.Left
	manualBox.TextYAlignment = Enum.TextYAlignment.Top
	manualBox.TextWrapped = true
	manualBox.ClearTextOnFocus = false
	manualBox.MultiLine = true
	manualBox.Text = ""
	manualBox.Parent = manualScroll

	-- SPEED / BATCH SIZE SLIDER SECTION
	local speedSection = Instance.new("Frame")
	speedSection.Name = "SpeedSection"
	speedSection.Size = UDim2.new(1, 0, 0, 58)
	speedSection.Position = UDim2.new(0, 0, 1, -102)
	speedSection.BackgroundTransparency = 1
	speedSection.Parent = manualContainer

	local speedLabel = Instance.new("TextLabel")
	speedLabel.Name = "SpeedLabel"
	speedLabel.Size = UDim2.new(0.45, 0, 0, 18)
	speedLabel.Position = UDim2.new(0, 0, 0, 0)
	speedLabel.BackgroundTransparency = 1
	speedLabel.Font = Enum.Font.BuilderSansBold
	speedLabel.TextSize = 12
	speedLabel.TextColor3 = Color3.fromHex("#fafafa")
	speedLabel.TextXAlignment = Enum.TextXAlignment.Left
	speedLabel.Text = "Batch Size & Speed"
	speedLabel.Parent = speedSection

	local speedValLabel = Instance.new("TextLabel")
	speedValLabel.Name = "SpeedValLabel"
	speedValLabel.Size = UDim2.new(0.55, 0, 0, 18)
	speedValLabel.Position = UDim2.new(0.45, 0, 0, 0)
	speedValLabel.BackgroundTransparency = 1
	speedValLabel.Font = Enum.Font.RobotoMono
	speedValLabel.TextSize = 12
	speedValLabel.TextColor3 = currentAccentColor
	speedValLabel.TextXAlignment = Enum.TextXAlignment.Right
	speedValLabel.Text = "50 / batch (Balanced)"
	speedValLabel.Parent = speedSection

	local speedTrack = Instance.new("Frame")
	speedTrack.Name = "SpeedTrack"
	speedTrack.Size = UDim2.new(1, 0, 0, 6)
	speedTrack.Position = UDim2.fromOffset(0, 26)
	speedTrack.BackgroundColor3 = Color3.fromHex("#27272a")
	speedTrack.BorderSizePixel = 0
	speedTrack.Active = true
	speedTrack.Parent = speedSection

	local speedTrackCorner = Instance.new("UICorner")
	speedTrackCorner.CornerRadius = UDim.new(1, 0)
	speedTrackCorner.Parent = speedTrack

	local speedFill = Instance.new("Frame")
	speedFill.Name = "SpeedFill"
	speedFill.BackgroundColor3 = currentAccentColor
	speedFill.BorderSizePixel = 0
	speedFill.Size = UDim2.new(0.1, 0, 1, 0)
	speedFill.Parent = speedTrack

	local speedFillCorner = Instance.new("UICorner")
	speedFillCorner.CornerRadius = UDim.new(1, 0)
	speedFillCorner.Parent = speedFill

	local speedHandle = Instance.new("Frame")
	speedHandle.Name = "SpeedHandle"
	speedHandle.Size = UDim2.fromOffset(14, 14)
	speedHandle.AnchorPoint = Vector2.new(0.5, 0.5)
	speedHandle.Position = UDim2.new(0.1, 0, 0.5, 0)
	speedHandle.BackgroundColor3 = Color3.fromHex("#fafafa")
	speedHandle.BorderSizePixel = 0
	speedHandle.ZIndex = 2
	speedHandle.Parent = speedTrack

	local speedHandleCorner = Instance.new("UICorner")
	speedHandleCorner.CornerRadius = UDim.new(1, 0)
	speedHandleCorner.Parent = speedHandle

	local minBatch = 10
	local maxBatch = 500
	local stepBatch = 5
	local currentBatchSize = 250

	local savedBatch = plugin:GetSetting("ManualBatchSize")
	if type(savedBatch) == "number" and savedBatch >= minBatch and savedBatch <= maxBatch then
		currentBatchSize = savedBatch
	end

	local function updateBatchUI(v)
		v = math.clamp(v, minBatch, maxBatch)
		v = math.floor((v - minBatch) / stepBatch + 0.5) * stepBatch + minBatch
		currentBatchSize = v
		plugin:SetSetting("ManualBatchSize", v)

		local alpha = (v - minBatch) / (maxBatch - minBatch)
		speedHandle.Position = UDim2.new(alpha, 0, 0.5, 0)
		speedFill.Size = UDim2.new(alpha, 0, 1, 0)

		local desc = "Balanced"
		if v <= 25 then
			desc = "Ultra Smooth"
		elseif v <= 80 then
			desc = "Balanced"
		elseif v <= 180 then
			desc = "Fast"
		else
			desc = "Max Speed"
		end
		speedValLabel.Text = string.format("%d / batch (%s)", v, desc)
	end

	updateBatchUIFunc = updateBatchUI
	updateBatchUI(currentBatchSize)

	local speedDragging = false
	local function updateSpeedFromInput(inputX)
		local trackPos = speedTrack.AbsolutePosition.X
		local trackWidth = speedTrack.AbsoluteSize.X
		if trackWidth > 0 then
			local alpha = math.clamp((inputX - trackPos) / trackWidth, 0, 1)
			updateBatchUI(minBatch + alpha * (maxBatch - minBatch))
		end
	end

	speedTrack.InputBegan:Connect(function(input)
		if
			input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch
		then
			speedDragging = true
			updateSpeedFromInput(input.Position.X)
		end
	end)
	speedHandle.InputBegan:Connect(function(input)
		if
			input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch
		then
			speedDragging = true
			updateSpeedFromInput(input.Position.X)
		end
	end)
	game:GetService("UserInputService").InputChanged:Connect(function(input)
		if
			speedDragging
			and (
				input.UserInputType == Enum.UserInputType.MouseMovement
				or input.UserInputType == Enum.UserInputType.Touch
			)
		then
			updateSpeedFromInput(input.Position.X)
		end
	end)
	game:GetService("UserInputService").InputEnded:Connect(function(input)
		if
			input.UserInputType == Enum.UserInputType.MouseButton1
			or input.UserInputType == Enum.UserInputType.Touch
		then
			speedDragging = false
		end
	end)

	-- RUN REPLACEMENTS BUTTON
	local runManualBtn = Instance.new("TextButton")
	runManualBtn.Name = "RunButton"
	runManualBtn.Size = UDim2.new(1, 0, 0, 36)
	runManualBtn.Position = UDim2.new(0, 0, 1, -36)
	runManualBtn.BackgroundColor3 = Color3.fromHex("#27272a")
	runManualBtn.BorderSizePixel = 0
	runManualBtn.Font = Enum.Font.BuilderSansMedium
	runManualBtn.TextSize = 14
	runManualBtn.TextColor3 = Color3.fromHex("#ffffff")
	runManualBtn.Text = "Run Replacements"
	runManualBtn.AutoButtonColor = false
	runManualBtn.Parent = manualContainer

	local runBtnCorner = Instance.new("UICorner")
	runBtnCorner.CornerRadius = UDim.new(0, 6)
	runBtnCorner.Parent = runManualBtn

	runManualBtn.MouseEnter:Connect(function()
		tweenBg(runManualBtn, Color3.fromHex("#3f3f46"))
	end)
	runManualBtn.MouseLeave:Connect(function()
		tweenBg(runManualBtn, Color3.fromHex("#27272a"))
	end)
	runManualBtn.MouseButton1Down:Connect(function()
		tweenBg(runManualBtn, Color3.fromHex("#18181b"))
	end)
	runManualBtn.MouseButton1Up:Connect(function()
		tweenBg(runManualBtn, Color3.fromHex("#3f3f46"))
	end)
	-- Guard: prevent queuing multiple concurrent async replacement runs.
	local manualRunning = false

	runManualBtn.MouseButton1Click:Connect(function()
		if manualRunning then
			return
		end
		ripple(runManualBtn)
		local txt = manualBox.Text
		if txt == "" then
			return
		end
		-- selene: allow(global_usage)
		local _G_plugin = _G.ISpooferMotionPlugin
		if _G_plugin and _G_plugin.runManualReplacements then
			manualRunning = true
			runManualBtn.Text = "Starting..."
			tweenBg(runManualBtn, Color3.fromHex("#18181b"))

			local startTime = os.clock()

			_G_plugin.runManualReplacements(txt, function(progress, total, replaced, isDone)
				if isDone then
					manualRunning = false
					if runManualBtn and runManualBtn.Parent then
						local totalElapsed = os.clock() - startTime
						local timeStr = totalElapsed >= 60
								and string.format(
									"%dm %02ds",
									math.floor(totalElapsed / 60),
									math.floor(totalElapsed % 60)
								)
							or string.format("%.1fs", totalElapsed)
						runManualBtn.Text =
							string.format("Done! (%d swapped • %s)", replaced, timeStr)
						tweenBg(runManualBtn, Color3.fromHex("#10b981"))
						task.delay(3.5, function()
							if runManualBtn and runManualBtn.Parent and not manualRunning then
								runManualBtn.Text = "Run Replacements"
								tweenBg(runManualBtn, Color3.fromHex("#27272a"))
							end
						end)
					end
				else
					if runManualBtn and runManualBtn.Parent and total > 0 then
						local elapsed = os.clock() - startTime
						local etaStr = "calc..."
						if progress > 0 and elapsed > 0.05 then
							local rate = progress / elapsed
							if rate > 0 then
								local remaining = math.max(0, total - progress)
								local etaSecs = math.ceil(remaining / rate)
								if etaSecs < 60 then
									etaStr = string.format("%ds", etaSecs)
								else
									etaStr = string.format(
										"%dm %02ds",
										math.floor(etaSecs / 60),
										etaSecs % 60
									)
								end
							end
						end
						runManualBtn.Text =
							string.format("Swapping (%d/%d ETA: %s)", progress, total, etaStr)
					end
				end
			end, currentBatchSize)
		else
			warn(
				"[ISpooferMotion] Plugin handler not ready yet - wait for the plugin to finish loading."
			)
		end
	end)

	-- SETTINGS CONTAINER
	local settingsContainer = Instance.new("ScrollingFrame")
	settingsContainer.Name = "SettingsContainer"
	settingsContainer.Size = UDim2.fromScale(1, 1)
	settingsContainer.BackgroundColor3 = Color3.fromHex("#09090b")
	settingsContainer.BackgroundTransparency = 1
	settingsContainer.BorderSizePixel = 0
	settingsContainer.ScrollBarThickness = 6
	settingsContainer.ScrollBarImageColor3 = Color3.fromHex("#27272a")
	settingsContainer.CanvasSize = UDim2.new(0, 0, 0, 0)
	settingsContainer.AutomaticCanvasSize = Enum.AutomaticSize.Y
	settingsContainer.ScrollingEnabled = true
	settingsContainer.Visible = false
	settingsContainer.Parent = contentArea

	local settingsList = Instance.new("UIListLayout")
	settingsList.Parent = settingsContainer
	settingsList.SortOrder = Enum.SortOrder.LayoutOrder
	settingsList.Padding = UDim.new(0, 16)

	local settingsPadding = Instance.new("UIPadding")
	settingsPadding.PaddingLeft = UDim.new(0, 12)
	settingsPadding.PaddingRight = UDim.new(0, 12)
	settingsPadding.PaddingTop = UDim.new(0, 12)
	settingsPadding.PaddingBottom = UDim.new(0, 12)
	settingsPadding.Parent = settingsContainer

	-- Shared tooltip for every settings row. Parented directly to the ScreenGui (not the
	-- ScrollingFrame) so it escapes clipping when a row near the edge is hovered.
	local TOOLTIP_WIDTH = 260

	local tooltip = Instance.new("Frame")
	tooltip.Name = "SettingTooltip"
	tooltip.BackgroundColor3 = Color3.fromHex("#18181b")
	tooltip.BorderSizePixel = 0
	tooltip.Size = UDim2.fromOffset(TOOLTIP_WIDTH, 0)
	tooltip.AutomaticSize = Enum.AutomaticSize.Y
	tooltip.Visible = false
	tooltip.ZIndex = 50
	-- Must never sink input: it floats above the panel and would otherwise steal
	-- clicks and hover events meant for the sliders underneath it.
	tooltip.Active = false
	tooltip.Parent = gui

	local tooltipCorner = Instance.new("UICorner")
	tooltipCorner.CornerRadius = UDim.new(0, 6)
	tooltipCorner.Parent = tooltip

	local tooltipStroke = Instance.new("UIStroke")
	tooltipStroke.Color = Color3.fromHex("#3f3f46")
	tooltipStroke.Thickness = 1
	tooltipStroke.Parent = tooltip

	local tooltipPadding = Instance.new("UIPadding")
	tooltipPadding.PaddingLeft = UDim.new(0, 10)
	tooltipPadding.PaddingRight = UDim.new(0, 10)
	tooltipPadding.PaddingTop = UDim.new(0, 8)
	tooltipPadding.PaddingBottom = UDim.new(0, 8)
	tooltipPadding.Parent = tooltip

	local tooltipText = Instance.new("TextLabel")
	tooltipText.Name = "Text"
	tooltipText.BackgroundTransparency = 1
	tooltipText.Size = UDim2.new(1, 0, 0, 0)
	tooltipText.AutomaticSize = Enum.AutomaticSize.Y
	tooltipText.Font = Enum.Font.BuilderSansMedium
	tooltipText.TextSize = 12
	tooltipText.TextColor3 = Color3.fromHex("#e4e4e7")
	tooltipText.TextXAlignment = Enum.TextXAlignment.Left
	tooltipText.TextYAlignment = Enum.TextYAlignment.Top
	tooltipText.TextWrapped = true
	tooltipText.Parent = tooltip

	-- Tooltip timing, following the conventions desktop UI toolkits use:
	--  * wait before the first appearance, so sweeping the cursor across rows
	--    does not fire a burst of tooltips (hover intent),
	--  * once one has been shown, a neighbouring row shows instantly while the
	--    tooltip is still "warm" - scanning a list should not feel sluggish,
	--  * leave a short grace period on the way out so brushing over the gap
	--    between two rows does not make it blink.
	local TOOLTIP_SHOW_DELAY = 0.45
	local TOOLTIP_HIDE_DELAY = 0.12
	local TOOLTIP_WARM_WINDOW = 0.4
	local TOOLTIP_FADE_TIME = 0.12
	local tooltipFadeInfo =
		TweenInfo.new(TOOLTIP_FADE_TIME, Enum.EasingStyle.Quad, Enum.EasingDirection.Out)

	--- Bumped by every show/hide request. Pending `task.delay` callbacks capture
	--- the current value and bail out when it no longer matches, which is how a
	--- scheduled show or hide gets cancelled.
	local tooltipToken = 0
	local tooltipShown = false
	local tooltipHiddenAt = 0
	--- Set while a slider is being dragged: a tooltip hovering next to the cursor
	--- during a drag is pure distraction, so we keep it away until the drag ends.
	local tooltipDragSuppressed = false
	local tooltipDesiredY = 0

	--- Keeps the tooltip fully on screen. `AutomaticSize` settles a frame after
	--- the text changes, so this also runs on every size change.
	local function clampTooltipVertically()
		local viewportHeight = gui.AbsoluteSize.Y
		local height = tooltip.AbsoluteSize.Y
		local y = tooltipDesiredY
		if viewportHeight > 0 and height > 0 then
			y = math.clamp(y, 8, math.max(8, viewportHeight - height - 8))
		end
		tooltip.Position = UDim2.fromOffset(tooltip.Position.X.Offset, y)
	end

	tooltip:GetPropertyChangedSignal("AbsoluteSize"):Connect(clampTooltipVertically)

	--- Fades every part of the tooltip together. A Frame has no group
	--- transparency, so the background, border, and text each get their own tween.
	local function fadeTooltipTo(transparency)
		TweenService:Create(tooltip, tooltipFadeInfo, { BackgroundTransparency = transparency })
			:Play()
		TweenService:Create(tooltipStroke, tooltipFadeInfo, { Transparency = transparency }):Play()
		TweenService:Create(tooltipText, tooltipFadeInfo, { TextTransparency = transparency })
			:Play()
	end

	--- Positions the tooltip OUTSIDE the panel bounds, vertically aligned with
	--- `anchor`. An earlier version put it directly below the hovered row, where
	--- it covered the next row's slider track and made those sliders hard to grab.
	local function placeTooltip(anchor, text)
		tooltipText.Text = text

		local panelPos = container.AbsolutePosition
		local panelSize = container.AbsoluteSize
		local viewportWidth = gui.AbsoluteSize.X

		-- Prefer the right of the panel; flip to the left when there is no room.
		local x = panelPos.X + panelSize.X + 8
		if viewportWidth > 0 and x + TOOLTIP_WIDTH > viewportWidth then
			x = panelPos.X - TOOLTIP_WIDTH - 8
		end

		tooltipDesiredY = anchor.AbsolutePosition.Y
		tooltip.Position = UDim2.fromOffset(x, tooltipDesiredY)
		clampTooltipVertically()
	end

	local function revealTooltip(anchor, text)
		placeTooltip(anchor, text)
		tooltipShown = true
		tooltip.Visible = true
		fadeTooltipTo(0)
	end

	local function concealTooltip()
		tooltipShown = false
		tooltipHiddenAt = os.clock()
		fadeTooltipTo(1)

		local token = tooltipToken
		task.delay(TOOLTIP_FADE_TIME, function()
			-- Skip if something asked for a tooltip again while we were fading.
			if token == tooltipToken and not tooltipShown then
				tooltip.Visible = false
			end
		end)
	end

	--- Asks for the tooltip to appear for `anchor`, honouring the show delay.
	local function requestTooltip(anchor, text)
		if tooltipDragSuppressed then
			return
		end

		tooltipToken += 1
		local token = tooltipToken

		-- Still warm from a recent tooltip: show without making the user wait.
		if tooltipShown or (os.clock() - tooltipHiddenAt) < TOOLTIP_WARM_WINDOW then
			revealTooltip(anchor, text)
			return
		end

		task.delay(TOOLTIP_SHOW_DELAY, function()
			if token == tooltipToken and not tooltipDragSuppressed then
				revealTooltip(anchor, text)
			end
		end)
	end

	--- Asks for the tooltip to go away. Pass `immediate` to skip the grace period
	--- (used when a drag starts, where waiting would look like a glitch).
	local function dismissTooltip(immediate)
		tooltipToken += 1
		local token = tooltipToken

		if immediate then
			if tooltipShown then
				concealTooltip()
			end
			return
		end

		task.delay(TOOLTIP_HIDE_DELAY, function()
			if token == tooltipToken and tooltipShown then
				concealTooltip()
			end
		end)
	end

	local function suppressTooltipForDrag()
		tooltipDragSuppressed = true
		dismissTooltip(true)
	end

	local function releaseTooltipDragSuppression()
		tooltipDragSuppressed = false
	end

	--- Trims a float to at most 2 decimals and drops trailing zeros, so a
	--- unit-scaled value reads like "8" or "0.5" instead of "8.00000001".
	local function formatDisplayNumber(v)
		local rounded = string.format("%.2f", v)
		rounded = string.gsub(rounded, "0+$", "")
		rounded = string.gsub(rounded, "%.$", "")
		return rounded
	end

	--- Builds one settings row as a draggable slider (track + handle) with a synced
	--- editable value box for exact entry. Description/warning text live in a hover
	--- tooltip instead of always-visible labels.
	---
	--- `unit`/`scale` are optional: when set, the slider operates in human units
	--- (e.g. min/max/step/defaultValue given in MB) while `scale` (e.g. 1000000)
	--- converts to/from the raw value actually persisted via `plugin:SetSetting`,
	--- so a byte-count setting can show "8 MB" instead of "8000000".
	local function createSliderSetting(
		order,
		key,
		labelText,
		descText,
		guidanceText,
		defaultValue,
		minValue,
		maxValue,
		step,
		unit,
		scale
	)
		local hasUnit = unit ~= nil and unit ~= ""
		local valueScale = scale or 1
		local rightMargin = hasUnit and 110 or 80
		local boxOffset = hasUnit and -110 or -72

		local frame = Instance.new("Frame")
		frame.Name = "Setting_" .. key
		frame.Size = UDim2.new(1, 0, 0, 64)
		frame.BackgroundTransparency = 1
		frame.LayoutOrder = order
		frame.Parent = settingsContainer

		local label = Instance.new("TextLabel")
		label.Name = "Label"
		label.Size = UDim2.new(1, -rightMargin, 0, 20)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.BuilderSansBold
		label.TextSize = 13
		label.TextColor3 = Color3.fromHex("#fafafa")
		label.TextXAlignment = Enum.TextXAlignment.Left
		label.Text = labelText
		label.Parent = frame

		local valueBox = Instance.new("TextBox")
		valueBox.Name = "Value"
		valueBox.Size = UDim2.fromOffset(72, 24)
		valueBox.Position = UDim2.new(1, boxOffset, 0, -2)
		valueBox.BackgroundColor3 = Color3.fromHex("#09090b")
		valueBox.Font = Enum.Font.RobotoMono
		valueBox.TextSize = 13
		valueBox.TextColor3 = Color3.fromHex("#ffffff")
		valueBox.ClearTextOnFocus = false
		valueBox.Parent = frame

		local valueBoxCorner = Instance.new("UICorner")
		valueBoxCorner.CornerRadius = UDim.new(0, 6)
		valueBoxCorner.Parent = valueBox

		local valueBoxStroke = Instance.new("UIStroke")
		valueBoxStroke.Color = Color3.fromHex("#27272a")
		valueBoxStroke.Thickness = 1
		valueBoxStroke.Parent = valueBox

		if hasUnit then
			local unitLabel = Instance.new("TextLabel")
			unitLabel.Name = "Unit"
			unitLabel.Size = UDim2.fromOffset(30, 24)
			unitLabel.Position = UDim2.new(1, -30, 0, -2)
			unitLabel.BackgroundTransparency = 1
			unitLabel.Font = Enum.Font.BuilderSansMedium
			unitLabel.TextSize = 12
			unitLabel.TextColor3 = Color3.fromHex("#71717a")
			unitLabel.TextXAlignment = Enum.TextXAlignment.Left
			unitLabel.Text = unit
			unitLabel.Parent = frame
		end

		local track = Instance.new("Frame")
		track.Name = "Track"
		track.Size = UDim2.new(1, 0, 0, 6)
		track.Position = UDim2.fromOffset(0, 40)
		track.BackgroundColor3 = Color3.fromHex("#27272a")
		track.BorderSizePixel = 0
		track.Active = true
		track.Parent = frame

		local trackCorner = Instance.new("UICorner")
		trackCorner.CornerRadius = UDim.new(1, 0)
		trackCorner.Parent = track

		local fill = Instance.new("Frame")
		fill.Name = "Fill"
		fill.BackgroundColor3 = currentAccentColor
		fill.BorderSizePixel = 0
		fill.Size = UDim2.new(0, 0, 1, 0)
		fill.Parent = track

		local fillCorner = Instance.new("UICorner")
		fillCorner.CornerRadius = UDim.new(1, 0)
		fillCorner.Parent = fill

		local handle = Instance.new("Frame")
		handle.Name = "Handle"
		handle.Size = UDim2.fromOffset(14, 14)
		handle.AnchorPoint = Vector2.new(0.5, 0.5)
		handle.Position = UDim2.new(0, 0, 0.5, 0)
		handle.BackgroundColor3 = Color3.fromHex("#fafafa")
		handle.BorderSizePixel = 0
		handle.ZIndex = 2
		handle.Parent = track

		local handleCorner = Instance.new("UICorner")
		handleCorner.CornerRadius = UDim.new(1, 0)
		handleCorner.Parent = handle

		local tooltipContent = descText .. "\n\n" .. guidanceText

		-- MouseLeave passes cursor coordinates, so these must be wrapped: connecting
		-- `dismissTooltip` directly would read the X coordinate as `immediate`.
		label.MouseEnter:Connect(function()
			requestTooltip(frame, tooltipContent)
		end)
		label.MouseLeave:Connect(function()
			dismissTooltip()
		end)
		track.MouseEnter:Connect(function()
			requestTooltip(frame, tooltipContent)
		end)
		track.MouseLeave:Connect(function()
			dismissTooltip()
		end)

		local function roundToStep(v)
			v = math.clamp(v, minValue, maxValue)
			return math.floor((v - minValue) / step + 0.5) * step + minValue
		end

		local function applyValue(v, flashColor)
			local alpha = (v - minValue) / (maxValue - minValue)
			handle.Position = UDim2.new(alpha, 0, 0.5, 0)
			fill.Size = UDim2.new(alpha, 0, 1, 0)
			valueBox.Text = hasUnit and formatDisplayNumber(v) or tostring(v)
			if flashColor then
				valueBoxStroke.Color = flashColor
				task.delay(1, function()
					valueBoxStroke.Color = Color3.fromHex("#27272a")
				end)
			end
		end

		-- Persisted settings are always raw (e.g. bytes); convert into display
		-- units (e.g. MB) here so the slider/box only ever deal with `unit` scale.
		local persistedRaw = plugin:GetSetting(key)
		local currentVal
		if persistedRaw == nil then
			currentVal = defaultValue
		else
			currentVal = persistedRaw / valueScale
		end
		currentVal = roundToStep(currentVal)
		applyValue(currentVal)

		-- Same stale-value guard as the range slider: a value saved under wider
		-- bounds is clamped for display, so write the clamped one back to keep the
		-- UI and what `runtime.luau` reads in agreement.
		local clampedRaw = math.floor(currentVal * valueScale + 0.5)
		if persistedRaw ~= nil and persistedRaw ~= clampedRaw then
			plugin:SetSetting(key, clampedRaw)
			-- Overwriting someone's saved setting should never happen quietly.
			if type(logToPlugin) == "function" then
				logToPlugin(
					string.format(
						"[Warning] %s was saved as %s, which is outside the allowed range - adjusted to %s.",
						labelText,
						tostring(persistedRaw),
						tostring(clampedRaw)
					)
				)
			end
		end

		local function commitValue(v, flashColor)
			currentVal = roundToStep(v)
			applyValue(currentVal, flashColor)
			plugin:SetSetting(key, math.floor(currentVal * valueScale + 0.5))
		end

		-- Named distinctly from the panel-header `dragging` flag further up: the two
		-- are unrelated, and shadowing it there trips selene's shadowing lint.
		local sliderDragging = false

		local function updateFromInputX(inputX)
			local trackPos = track.AbsolutePosition.X
			local trackWidth = track.AbsoluteSize.X
			local alpha = math.clamp((inputX - trackPos) / trackWidth, 0, 1)
			commitValue(minValue + alpha * (maxValue - minValue))
		end

		local function beginDrag(input)
			sliderDragging = true
			suppressTooltipForDrag()
			updateFromInputX(input.Position.X)
		end

		track.InputBegan:Connect(function(input)
			if
				input.UserInputType == Enum.UserInputType.MouseButton1
				or input.UserInputType == Enum.UserInputType.Touch
			then
				beginDrag(input)
			end
		end)
		handle.InputBegan:Connect(function(input)
			if
				input.UserInputType == Enum.UserInputType.MouseButton1
				or input.UserInputType == Enum.UserInputType.Touch
			then
				beginDrag(input)
			end
		end)

		game:GetService("UserInputService").InputChanged:Connect(function(input)
			if
				sliderDragging
				and (
					input.UserInputType == Enum.UserInputType.MouseMovement
					or input.UserInputType == Enum.UserInputType.Touch
				)
			then
				updateFromInputX(input.Position.X)
			end
		end)

		game:GetService("UserInputService").InputEnded:Connect(function(input)
			if
				sliderDragging
				and (
					input.UserInputType == Enum.UserInputType.MouseButton1
					or input.UserInputType == Enum.UserInputType.Touch
				)
			then
				sliderDragging = false
				releaseTooltipDragSuppression()
			end
		end)

		valueBox.FocusLost:Connect(function()
			local num = tonumber(valueBox.Text)
			if num then
				commitValue(num, Color3.fromHex("#10b981")) -- flash green on save
			else
				applyValue(currentVal, Color3.fromHex("#ef4444")) -- flash red on invalid
			end
		end)
	end

	--- Builds a single row with TWO handles on one track for a start/end pair
	--- (currently only the daemon port range). Each handle has its own synced
	--- value box; the handles cannot cross, and the gap between them is capped
	--- at `maxSpan` so a careless drag cannot balloon the range - see the
	--- `discovery.luau` warning below for why that matters.
	---
	--- `dangerCheck(startVal, endVal)`, if given, is re-run on every change; when
	--- it returns true the track/handles turn orange and a persistent warning
	--- (not just the hover tooltip) explains why - for a real, code-verified risk,
	--- not a hypothetical one.
	local function createRangeSliderSetting(
		order,
		keyStart,
		keyEnd,
		labelText,
		descText,
		guidanceText,
		defaultStart,
		defaultEnd,
		minValue,
		maxValue,
		step,
		maxSpan,
		dangerCheck
	)
		local frame = Instance.new("Frame")
		frame.Name = "Setting_" .. keyStart .. "_" .. keyEnd
		frame.Size = UDim2.new(1, 0, 0, dangerCheck and 86 or 64)
		frame.BackgroundTransparency = 1
		frame.LayoutOrder = order
		frame.Parent = settingsContainer

		local label = Instance.new("TextLabel")
		label.Name = "Label"
		label.Size = UDim2.new(1, -160, 0, 20)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.BuilderSansBold
		label.TextSize = 13
		label.TextColor3 = Color3.fromHex("#fafafa")
		label.TextXAlignment = Enum.TextXAlignment.Left
		label.Text = labelText
		label.Parent = frame

		local function createValueBox(rightOffset)
			local box = Instance.new("TextBox")
			box.Name = "Value"
			box.Size = UDim2.fromOffset(72, 24)
			box.Position = UDim2.new(1, rightOffset, 0, -2)
			box.BackgroundColor3 = Color3.fromHex("#09090b")
			box.Font = Enum.Font.RobotoMono
			box.TextSize = 13
			box.TextColor3 = Color3.fromHex("#ffffff")
			box.ClearTextOnFocus = false
			box.Parent = frame

			local corner = Instance.new("UICorner")
			corner.CornerRadius = UDim.new(0, 6)
			corner.Parent = box

			local stroke = Instance.new("UIStroke")
			stroke.Color = Color3.fromHex("#27272a")
			stroke.Thickness = 1
			stroke.Parent = box

			return box, stroke
		end

		local startBox, startBoxStroke = createValueBox(-156)
		local endBox, endBoxStroke = createValueBox(-72)

		local dash = Instance.new("TextLabel")
		dash.Size = UDim2.fromOffset(12, 24)
		dash.Position = UDim2.new(1, -84, 0, -2)
		dash.BackgroundTransparency = 1
		dash.Font = Enum.Font.BuilderSansMedium
		dash.TextSize = 13
		dash.TextColor3 = Color3.fromHex("#52525b")
		dash.TextXAlignment = Enum.TextXAlignment.Center
		dash.Text = "-"
		dash.Parent = frame

		local track = Instance.new("Frame")
		track.Name = "Track"
		track.Size = UDim2.new(1, 0, 0, 6)
		track.Position = UDim2.fromOffset(0, 40)
		track.BackgroundColor3 = Color3.fromHex("#27272a")
		track.BorderSizePixel = 0
		track.Active = true
		track.Parent = frame

		local trackCorner = Instance.new("UICorner")
		trackCorner.CornerRadius = UDim.new(1, 0)
		trackCorner.Parent = track

		local fill = Instance.new("Frame")
		fill.Name = "Fill"
		fill.BackgroundColor3 = currentAccentColor
		fill.BorderSizePixel = 0
		fill.Parent = track

		local fillCorner = Instance.new("UICorner")
		fillCorner.CornerRadius = UDim.new(1, 0)
		fillCorner.Parent = fill

		local function createHandle()
			local handle = Instance.new("Frame")
			handle.Name = "Handle"
			handle.Size = UDim2.fromOffset(14, 14)
			handle.AnchorPoint = Vector2.new(0.5, 0.5)
			handle.Position = UDim2.new(0, 0, 0.5, 0)
			handle.BackgroundColor3 = Color3.fromHex("#fafafa")
			handle.BorderSizePixel = 0
			handle.ZIndex = 2
			handle.Parent = track

			local handleCorner = Instance.new("UICorner")
			handleCorner.CornerRadius = UDim.new(1, 0)
			handleCorner.Parent = handle

			return handle
		end

		local startHandle = createHandle()
		local endHandle = createHandle()

		local dangerLabel = nil
		if dangerCheck then
			dangerLabel = Instance.new("TextLabel")
			dangerLabel.Name = "DangerWarning"
			dangerLabel.Size = UDim2.new(1, 0, 0, 30)
			dangerLabel.Position = UDim2.fromOffset(0, 50)
			dangerLabel.BackgroundTransparency = 1
			dangerLabel.Font = Enum.Font.BuilderSansMedium
			dangerLabel.TextSize = 11
			dangerLabel.TextColor3 = Color3.fromHex("#f97316")
			dangerLabel.TextXAlignment = Enum.TextXAlignment.Left
			dangerLabel.TextYAlignment = Enum.TextYAlignment.Top
			dangerLabel.TextWrapped = true
			dangerLabel.Visible = false
			dangerLabel.Parent = frame
		end

		local tooltipContent = descText .. "\n\n" .. guidanceText

		-- MouseLeave passes cursor coordinates, so these must be wrapped: connecting
		-- `dismissTooltip` directly would read the X coordinate as `immediate`.
		label.MouseEnter:Connect(function()
			requestTooltip(frame, tooltipContent)
		end)
		label.MouseLeave:Connect(function()
			dismissTooltip()
		end)
		track.MouseEnter:Connect(function()
			requestTooltip(frame, tooltipContent)
		end)
		track.MouseLeave:Connect(function()
			dismissTooltip()
		end)

		local function roundToStep(v)
			v = math.clamp(v, minValue, maxValue)
			return math.floor((v - minValue) / step + 0.5) * step + minValue
		end

		local storedStart = plugin:GetSetting(keyStart)
		local storedEnd = plugin:GetSetting(keyEnd)

		local startVal = roundToStep(storedStart == nil and defaultStart or storedStart)
		local endVal = roundToStep(storedEnd == nil and defaultEnd or storedEnd)
		if startVal > endVal then
			startVal, endVal = endVal, startVal
		end

		-- A value saved by an older build can sit outside the current bounds (this
		-- range used to allow 1024-20000). `roundToStep` clamps it for display, so
		-- persist the clamped value too - otherwise the slider would show one port
		-- range while `runtime.luau` kept scanning the stale one.
		local clampedStart = storedStart ~= nil and storedStart ~= startVal
		local clampedEnd = storedEnd ~= nil and storedEnd ~= endVal
		if clampedStart then
			plugin:SetSetting(keyStart, startVal)
		end
		if clampedEnd then
			plugin:SetSetting(keyEnd, endVal)
		end
		-- Overwriting someone's saved setting should never happen quietly.
		if (clampedStart or clampedEnd) and type(logToPlugin) == "function" then
			logToPlugin(
				string.format(
					"[Warning] Saved daemon port range was outside %d-%d - adjusted to %d-%d.",
					minValue,
					maxValue,
					startVal,
					endVal
				)
			)
		end

		--- Re-evaluates `dangerCheck` against the current range and flips the
		--- track/handles orange plus reveals `dangerLabel` when it fires. A no-op
		--- when this setting was built without a `dangerCheck`.
		local function updateDangerState()
			if not dangerCheck then
				return
			end
			local isDangerous, message = dangerCheck(startVal, endVal)
			if isDangerous then
				dangerLabel.Text = "⚠ " .. (message or "This range is risky.")
				dangerLabel.Visible = true
				fill.BackgroundColor3 = Color3.fromHex("#f97316")
				startHandle.BackgroundColor3 = Color3.fromHex("#f97316")
				endHandle.BackgroundColor3 = Color3.fromHex("#f97316")
			else
				dangerLabel.Visible = false
				fill.BackgroundColor3 = currentAccentColor
				startHandle.BackgroundColor3 = Color3.fromHex("#fafafa")
				endHandle.BackgroundColor3 = Color3.fromHex("#fafafa")
			end
		end

		local function render()
			local startAlpha = (startVal - minValue) / (maxValue - minValue)
			local endAlpha = (endVal - minValue) / (maxValue - minValue)
			startHandle.Position = UDim2.new(startAlpha, 0, 0.5, 0)
			endHandle.Position = UDim2.new(endAlpha, 0, 0.5, 0)
			fill.Position = UDim2.new(startAlpha, 0, 0, 0)
			fill.Size = UDim2.new(endAlpha - startAlpha, 0, 1, 0)
			startBox.Text = tostring(startVal)
			endBox.Text = tostring(endVal)
			updateDangerState()
		end

		render()

		local function flash(stroke, color)
			stroke.Color = color
			task.delay(1, function()
				stroke.Color = Color3.fromHex("#27272a")
			end)
		end

		--- Moves the start handle, clamping so it never passes the end handle
		--- and so the gap between the two never exceeds `maxSpan`.
		local function commitStart(v, flashColor)
			v = roundToStep(v)
			v = math.min(v, endVal)
			v = math.max(v, endVal - maxSpan)
			startVal = v
			render()
			plugin:SetSetting(keyStart, startVal)
			if flashColor then
				flash(startBoxStroke, flashColor)
			end
		end

		--- Mirror of `commitStart` for the end handle.
		local function commitEnd(v, flashColor)
			v = roundToStep(v)
			v = math.max(v, startVal)
			v = math.min(v, startVal + maxSpan)
			endVal = v
			render()
			plugin:SetSetting(keyEnd, endVal)
			if flashColor then
				flash(endBoxStroke, flashColor)
			end
		end

		-- "start" | "end" | nil - which handle the current drag gesture is moving.
		local draggingHandle = nil

		local function valueFromInputX(inputX)
			local trackPos = track.AbsolutePosition.X
			local trackWidth = track.AbsoluteSize.X
			local alpha = math.clamp((inputX - trackPos) / trackWidth, 0, 1)
			return minValue + alpha * (maxValue - minValue)
		end

		local function updateFromInputX(inputX)
			local rawVal = valueFromInputX(inputX)
			if draggingHandle == "start" then
				commitStart(rawVal)
			elseif draggingHandle == "end" then
				commitEnd(rawVal)
			end
		end

		local function beginDrag(handleKind, input)
			draggingHandle = handleKind
			suppressTooltipForDrag()
			updateFromInputX(input.Position.X)
		end

		local function isPointerInput(input)
			return input.UserInputType == Enum.UserInputType.MouseButton1
				or input.UserInputType == Enum.UserInputType.Touch
		end

		startHandle.InputBegan:Connect(function(input)
			if isPointerInput(input) then
				beginDrag("start", input)
			end
		end)
		endHandle.InputBegan:Connect(function(input)
			if isPointerInput(input) then
				beginDrag("end", input)
			end
		end)
		track.InputBegan:Connect(function(input)
			if not isPointerInput(input) then
				return
			end
			-- Clicking bare track (not a handle) jumps whichever handle is nearer.
			local rawVal = valueFromInputX(input.Position.X)
			local nearestKind = (math.abs(rawVal - startVal) <= math.abs(rawVal - endVal))
					and "start"
				or "end"
			beginDrag(nearestKind, input)
		end)

		game:GetService("UserInputService").InputChanged:Connect(function(input)
			if
				draggingHandle
				and (
					input.UserInputType == Enum.UserInputType.MouseMovement
					or input.UserInputType == Enum.UserInputType.Touch
				)
			then
				updateFromInputX(input.Position.X)
			end
		end)

		game:GetService("UserInputService").InputEnded:Connect(function(input)
			if draggingHandle and isPointerInput(input) then
				draggingHandle = nil
				releaseTooltipDragSuppression()
			end
		end)

		startBox.FocusLost:Connect(function()
			local num = tonumber(startBox.Text)
			if num then
				commitStart(num, Color3.fromHex("#10b981")) -- flash green on save
			else
				render()
				flash(startBoxStroke, Color3.fromHex("#ef4444")) -- flash red on invalid
			end
		end)

		endBox.FocusLost:Connect(function()
			local num = tonumber(endBox.Text)
			if num then
				commitEnd(num, Color3.fromHex("#10b981")) -- flash green on save
			else
				render()
				flash(endBoxStroke, Color3.fromHex("#ef4444")) -- flash red on invalid
			end
		end)
	end

	createRangeSliderSetting(
		1,
		"ISpooferMotion_PORT_START",
		"ISpooferMotion_PORT_END",
		"Daemon Port Scan Range",
		"Which local ports the plugin checks to find the desktop app.",
		"Recommended: 14285-14289.\n\nThe app tries 14285-14289 first; if all five are busy it moves up one port at a time to 14320. Widen this range only if the port diagnostic says the app landed above 14289.",
		14285,
		14289,
		14280,
		14320,
		1,
		20,
		function(startVal, endVal)
			local span = endVal - startVal
			if span > 10 then
				return true,
					string.format(
						"%d ports = %d probes. Keep this range narrow: the app defaults to 14285-14289 and only climbs higher if those are occupied.",
						span + 1,
						(span + 1) * 2
					)
			end
			return false, nil
		end
	)
	createSliderSetting(
		2,
		"ISpooferMotion_SEND_CHUNK_SIZE",
		"Scan Chunk Size",
		"How many assets get packed into each upload while scanning your place.",
		"Recommended: 5000\n\nUploads also flush every 500 KB, whichever comes first - so raising this past a few thousand usually changes nothing. Lower it only if scans keep failing on a slow connection.",
		5000,
		500,
		20000,
		250
	)
	createSliderSetting(
		3,
		"ISpooferMotion_MAX_SCRIPT_BYTES",
		"Max Script Size",
		"Scripts bigger than this are skipped - IDs inside them will not be replaced.",
		"Recommended: 8 MB (the maximum)\n\nThe desktop app discards anything larger anyway, so 8 MB covers the most scripts. Lower it only if scanning runs Studio out of memory.",
		8,
		0.1,
		8,
		0.1,
		"MB",
		1000000
	)
	createSliderSetting(
		4,
		"ISpooferMotion_MAX_PATCHES",
		"Max Patches Per Batch",
		"How many replacements the plugin applies in one pass.",
		'Recommended: 10000\n\nThis only decides when a "large batch" note appears in the Console - bigger batches still finish in full, just with more pauses. Nothing breaks either way.',
		10000,
		500,
		50000,
		500
	)
	createSliderSetting(
		5,
		"ISpooferMotion_MAX_HTTP_BODY",
		"Max HTTP Body",
		"Size limit for each upload the plugin sends to the desktop app.",
		"Recommended: 10 MB\n\nThe app rejects anything over 64 MB regardless, so higher values do nothing. Lower it if uploads time out on a slow connection.",
		10,
		1,
		50,
		1,
		"MB",
		1000000
	)
	createSliderSetting(
		6,
		"ISpooferMotion_MAX_HTTP_RESP",
		"Max HTTP Response",
		"Size limit for each reply the plugin accepts from the desktop app.",
		'Recommended: 1 MB\n\nReplies are normally far smaller; this is just a memory guard. Raise it if the Console shows "Invalid JSON response" on a very large place.',
		1,
		0.1,
		10,
		0.1,
		"MB",
		1000000
	)

	-- Script scan mode is configured in the Desktop App's Scan Studio popup.
	local restartNote = Instance.new("TextLabel")
	restartNote.Name = "RestartNote"
	restartNote.Size = UDim2.new(1, 0, 0, 40)
	restartNote.BackgroundTransparency = 1
	restartNote.LayoutOrder = 100
	restartNote.Font = Enum.Font.BuilderSansMedium
	restartNote.TextSize = 12
	restartNote.TextColor3 = Color3.fromHex("#38bdf8")
	restartNote.TextXAlignment = Enum.TextXAlignment.Center
	restartNote.Text =
		"Note: You may need to reload the plugin or restart Studio for some settings to take effect."
	restartNote.Parent = settingsContainer

	-- Tab Switching Logic
	local ALL_TABS = {
		{ btn = consoleTabBtn, ind = consoleIndicator },
		{ btn = manualTabBtn, ind = manualIndicator },
		{ btn = settingsTabBtn, ind = settingsIndicator },
	}

	local function switchTab(tab)
		-- Deactivate all
		for _, t in ipairs(ALL_TABS) do
			tweenBg(t.btn, Color3.fromHex("#09090b"))
			t.btn.TextColor3 = Color3.fromHex("#71717a")
			TweenService:Create(t.ind, tweenInfo, { BackgroundTransparency = 1 }):Play()
		end
		logsContainer.Visible = false
		manualContainer.Visible = false
		settingsContainer.Visible = false

		if tab == "console" then
			tweenBg(consoleTabBtn, Color3.fromHex("#18181b"))
			consoleTabBtn.TextColor3 = Color3.fromHex("#ffffff")
			TweenService:Create(consoleIndicator, tweenInfo, { BackgroundTransparency = 0 }):Play()
			logsContainer.Visible = true
		elseif tab == "manual" then
			tweenBg(manualTabBtn, Color3.fromHex("#18181b"))
			manualTabBtn.TextColor3 = Color3.fromHex("#ffffff")
			TweenService:Create(manualIndicator, tweenInfo, { BackgroundTransparency = 0 }):Play()
			manualContainer.Visible = true
		elseif tab == "settings" then
			tweenBg(settingsTabBtn, Color3.fromHex("#18181b"))
			settingsTabBtn.TextColor3 = Color3.fromHex("#ffffff")
			TweenService:Create(settingsIndicator, tweenInfo, { BackgroundTransparency = 0 }):Play()
			settingsContainer.Visible = true
		end
	end

	consoleTabBtn.MouseButton1Click:Connect(function()
		switchTab("console")
	end)
	manualTabBtn.MouseButton1Click:Connect(function()
		switchTab("manual")
	end)
	settingsTabBtn.MouseButton1Click:Connect(function()
		switchTab("settings")
	end)

	connectionStatusText = Instance.new("TextLabel")
	connectionStatusText.Name = "ConnectionStatusText"
	connectionStatusText.Size = UDim2.new(1, 0, 0, 20)
	connectionStatusText.Position = UDim2.new(0.5, 0, 1, -8)
	connectionStatusText.AnchorPoint = Vector2.new(0.5, 1)
	connectionStatusText.BackgroundTransparency = 1
	connectionStatusText.Font = Enum.Font.BuilderSansMedium
	connectionStatusText.TextSize = 13
	connectionStatusText.TextColor3 = Color3.fromHex("#ef4444")
	connectionStatusText.TextXAlignment = Enum.TextXAlignment.Center
	connectionStatusText.Text = "Disconnected from Desktop App"
	connectionStatusText.Parent = container

	return gui
end

local logConnection = nil
local LogService = game:GetService("LogService")

-- Guard: only register one LogService listener. If createPluginGui() is called again
-- after a hide/show cycle while the plugin stays alive, we do not want duplicate log
-- entries streaming into the new UI.
if logConnection then
	logConnection:Disconnect()
	logConnection = nil
end

logConnection = LogService.MessageOut:Connect(function(message, messageType)
	if not logsScrollingFrame then
		return
	end

	local isIsm = string.find(message, "[ISpooferMotion]", 1, true)

	if isIsm then
		logCounter += 1
		local logLabel = Instance.new("TextLabel")
		logLabel.Name = "Log_" .. logCounter
		logLabel.Size = UDim2.new(1, -8, 0, 0)
		logLabel.BackgroundTransparency = 1
		logLabel.Font = Enum.Font.RobotoMono
		logLabel.TextSize = 13

		-- Color based on message type
		if messageType == Enum.MessageType.MessageError then
			logLabel.TextColor3 = Color3.fromRGB(248, 113, 113) -- Red 400
		elseif messageType == Enum.MessageType.MessageWarning then
			logLabel.TextColor3 = Color3.fromRGB(250, 204, 21) -- Yellow 400
		else
			logLabel.TextColor3 = Color3.fromRGB(212, 212, 216) -- Zinc 300
		end

		logLabel.TextXAlignment = Enum.TextXAlignment.Left
		logLabel.TextWrapped = true

		-- Strip the prefix for cleaner UI
		local cleanMsg = string.gsub(message, "%[ISpooferMotion%] ", "")
		cleanMsg = string.gsub(cleanMsg, "%[Warning%] ", "")

		logLabel.Text = cleanMsg
		logLabel.AutomaticSize = Enum.AutomaticSize.Y
		logLabel.LayoutOrder = logCounter
		logLabel.Parent = logsScrollingFrame

		if logCounter > 200 then
			local oldest = logsScrollingFrame:FindFirstChild("Log_" .. (logCounter - 200))
			if oldest then
				oldest:Destroy()
			end
		end
	end
end)

--- Unified logging function that prints to both the Studio output and our UI.
function logToPlugin(text)
	local msg = tostring(text)
	-- Use plain=true so "[Warning]" is matched as a literal string, not a Lua character class.
	if string.find(msg, "[Warning]", 1, true) then
		warn(msg)
	else
		print("[ISpooferMotion] " .. msg)
	end
end

-- Pass silent=true for transient progress updates that should not produce log output.
--- Updates the main status text on the UI.
---
--- Pass `silent=true` for rapid progress updates (like scan chunks) that
--- we want to show visually without spamming the output console.
local function setPluginGuiStatus(text: string, silent: boolean?)
	if not gui then
		createPluginGui()
	end
	if statusText then
		statusText.Text = text
	end
	if not silent then
		logToPlugin(text)
	end
end

--- Completely destroys the UI and resets the log state.
function hidePluginGui()
	if gui then
		gui:Destroy()
		gui = nil
		statusText = nil
		logsScrollingFrame = nil
		connectionStatusText = nil
		-- Reset counter so eviction logic works correctly when the GUI is recreated.
		logCounter = 0
	end

	if logConnection then
		logConnection:Disconnect()
		logConnection = nil
	end
end

--- Toggles visibility of the UI, creating it if it does not exist yet.
function togglePluginGui()
	if not gui then
		createPluginGui()
	end
	if gui then
		gui.Enabled = not gui.Enabled
	end
end

--- Updates the visual connection status indicator
function setConnectionStatus(isConnected)
	if not gui then
		createPluginGui()
	end
	if connectionStatusText then
		if isConnected then
			connectionStatusText.Text = "Connected to Desktop App"
			connectionStatusText.TextColor3 = currentAccentColor
		else
			connectionStatusText.Text = "Disconnected from Desktop App"
			connectionStatusText.TextColor3 = Color3.fromHex("#ef4444")
		end
	end
end

--- Updates the current accent color and applies it to relevant elements.
function setThemeAccent(hex)
	if hex and type(hex) == "string" then
		pcall(function()
			local c = Color3.fromHex(hex)
			currentAccentColor = c
			for _, ind in ipairs(activeTabIndicators) do
				ind.BackgroundColor3 = c
			end
			if connectionStatusText and string.find(connectionStatusText.Text, "Connected") then
				connectionStatusText.TextColor3 = c
			end
		end)
	end
end

--- Updates the current batch size setting and syncs slider UI.
function setPluginBatchSize(size)
	if size and tonumber(size) then
		local num = math.clamp(tonumber(size), 10, 500)
		pcall(function()
			plugin:SetSetting("ManualBatchSize", num)
			if updateBatchUIFunc then
				updateBatchUIFunc(num)
			end
		end)
	end
end
