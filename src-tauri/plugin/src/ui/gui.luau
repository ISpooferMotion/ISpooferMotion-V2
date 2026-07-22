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

local currentAccentColor = Color3.fromHex("#10b981")
local activeTabIndicators = {}

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

	local copyLogsButton = Instance.new("TextButton")
	copyLogsButton.Name = "CopyLogsButton"
	copyLogsButton.Size = UDim2.fromOffset(92, 28)
	copyLogsButton.Position = UDim2.new(1, -52, 0.5, 0)
	copyLogsButton.AnchorPoint = Vector2.new(1, 0.5)
	copyLogsButton.BackgroundTransparency = 1
	copyLogsButton.BorderSizePixel = 0
	copyLogsButton.Font = Enum.Font.BuilderSansMedium
	copyLogsButton.TextSize = 12
	copyLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
	copyLogsButton.Text = "Export Logs"
	copyLogsButton.AutoButtonColor = false
	copyLogsButton.ClipsDescendants = true
	copyLogsButton.Parent = header

	copyLogsButton.MouseEnter:Connect(function()
		copyLogsButton.TextColor3 = Color3.fromHex("#fafafa")
	end)
	copyLogsButton.MouseLeave:Connect(function()
		copyLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
	end)
	copyLogsButton.MouseButton1Click:Connect(function()
		ripple(copyLogsButton)
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

			local logScript = Instance.new("Script")
			logScript.Name = "ISpooferMotion_Logs"
			logScript.Source = "-- ISpooferMotion Logs\n-- Copy the contents below:\n\n--[[\n"
				.. finalString
				.. "\n]]"
			logScript.Parent = game:GetService("ServerStorage")

			local exportSuccess, err = pcall(function()
				-- selene: allow(deprecated)
				plugin:OpenScript(logScript)
			end)

			if exportSuccess then
				copyLogsButton.Text = "Exported!"
			else
				warn("ISpooferMotion Export Logs Failed: " .. tostring(err))
				copyLogsButton.Text = "Error"
			end

			task.delay(1.5, function()
				if copyLogsButton then
					copyLogsButton.Text = "Export Logs"
					copyLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
				end
			end)
		end
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

	local manualBox = Instance.new("TextBox")
	manualBox.Name = "InputBox"
	manualBox.Size = UDim2.new(1, 0, 1, -44)
	manualBox.BackgroundColor3 = Color3.fromHex("#0c0c0e")
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
	manualBox.Parent = manualContainer

	local manualBoxCorner = Instance.new("UICorner")
	manualBoxCorner.CornerRadius = UDim.new(0, 8)
	manualBoxCorner.Parent = manualBox

	local manualBoxStroke = Instance.new("UIStroke")
	manualBoxStroke.Color = Color3.fromHex("#27272a")
	manualBoxStroke.Thickness = 1
	manualBoxStroke.Parent = manualBox

	local manualBoxPadding = Instance.new("UIPadding")
	manualBoxPadding.PaddingLeft = UDim.new(0, 8)
	manualBoxPadding.PaddingRight = UDim.new(0, 8)
	manualBoxPadding.PaddingTop = UDim.new(0, 8)
	manualBoxPadding.PaddingBottom = UDim.new(0, 8)
	manualBoxPadding.Parent = manualBox

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
			runManualBtn.Text = "Running..."
			tweenBg(runManualBtn, Color3.fromHex("#18181b"))
			-- runManualReplacements is async (task.spawn internally) so we use a
			-- separate task to poll for completion via a brief delay heuristic.
			-- We reset the button after a generous timeout rather than hooking into
			-- the Luau coroutine (click handler cannot yield).
			_G_plugin.runManualReplacements(txt)
			task.delay(0.5, function()
				-- Reset after all spawned work has had time to kick off.
				-- The actual replacement task runs independently; this just unblocks the button.
				manualRunning = false
				if runManualBtn and runManualBtn.Parent then
					runManualBtn.Text = "Run Replacements"
					tweenBg(runManualBtn, Color3.fromHex("#27272a"))
				end
			end)
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

	local function createSettingInput(order, key, labelText, descText, warningText, defaultValue)
		local frame = Instance.new("Frame")
		frame.Name = "Setting_" .. key
		frame.Size = UDim2.new(1, 0, 0, 80)
		frame.BackgroundTransparency = 1
		frame.LayoutOrder = order
		frame.Parent = settingsContainer

		local label = Instance.new("TextLabel")
		label.Name = "Label"
		label.Size = UDim2.new(1, -120, 0, 20)
		label.BackgroundTransparency = 1
		label.Font = Enum.Font.BuilderSansBold
		label.TextSize = 13
		label.TextColor3 = Color3.fromHex("#fafafa")
		label.TextXAlignment = Enum.TextXAlignment.Left
		label.Text = labelText
		label.Parent = frame

		local desc = Instance.new("TextLabel")
		desc.Name = "Description"
		desc.Size = UDim2.new(1, -120, 0, 18)
		desc.Position = UDim2.fromOffset(0, 22)
		desc.BackgroundTransparency = 1
		desc.Font = Enum.Font.BuilderSansMedium
		desc.TextSize = 12
		desc.TextColor3 = Color3.fromHex("#a1a1aa")
		desc.TextXAlignment = Enum.TextXAlignment.Left
		desc.TextYAlignment = Enum.TextYAlignment.Top
		desc.TextWrapped = true
		desc.Text = descText
		desc.Parent = frame

		local warning = Instance.new("TextLabel")
		warning.Name = "Warning"
		warning.Size = UDim2.new(1, -120, 0, 28)
		warning.Position = UDim2.fromOffset(0, 44)
		warning.BackgroundTransparency = 1
		warning.Font = Enum.Font.BuilderSansMedium
		warning.TextSize = 11
		warning.TextColor3 = Color3.fromHex("#f97316") -- Orange 500
		warning.TextXAlignment = Enum.TextXAlignment.Left
		warning.TextYAlignment = Enum.TextYAlignment.Top
		warning.TextWrapped = true
		warning.Text = "⚠ " .. warningText
		warning.Parent = frame

		local inputContainer = Instance.new("Frame")
		inputContainer.Size = UDim2.fromOffset(100, 32)
		inputContainer.Position = UDim2.new(1, -100, 0, 24)
		inputContainer.BackgroundColor3 = Color3.fromHex("#09090b")
		inputContainer.Parent = frame

		local inCorner = Instance.new("UICorner")
		inCorner.CornerRadius = UDim.new(0, 6)
		inCorner.Parent = inputContainer

		local inStroke = Instance.new("UIStroke")
		inStroke.Color = Color3.fromHex("#27272a")
		inStroke.Thickness = 1
		inStroke.Parent = inputContainer

		local textBox = Instance.new("TextBox")
		textBox.Size = UDim2.fromScale(1, 1)
		textBox.BackgroundTransparency = 1
		textBox.Font = Enum.Font.RobotoMono
		textBox.TextSize = 13
		textBox.TextColor3 = Color3.fromHex("#ffffff")

		local currentVal = plugin:GetSetting(key)
		if currentVal == nil then
			currentVal = defaultValue
		end
		textBox.Text = tostring(currentVal)
		textBox.Parent = inputContainer

		textBox.FocusLost:Connect(function()
			local num = tonumber(textBox.Text)
			if num then
				plugin:SetSetting(key, num)
				inStroke.Color = Color3.fromHex("#10b981") -- flash green on save
				task.delay(1, function()
					inStroke.Color = Color3.fromHex("#27272a")
				end)
			else
				textBox.Text = tostring(plugin:GetSetting(key) or defaultValue)
				inStroke.Color = Color3.fromHex("#ef4444") -- flash red on invalid-
				task.delay(1, function()
					inStroke.Color = Color3.fromHex("#27272a")
				end)
			end
		end)
	end

	createSettingInput(
		-1,
		"ISpooferMotion_PORT_START",
		"Daemon Port Start",
		"Starting port the plugin scans to discover the desktop daemon.",
		"Lower: may miss the daemon if it binds above this port. Higher: narrows the scan range and may fail to connect.",
		14285
	)
	createSettingInput(
		2,
		"ISpooferMotion_PORT_END",
		"Daemon Port End",
		"Ending port the plugin scans to discover the desktop daemon.",
		"Lower than Port Start: scan will never succeed. Higher: scan takes longer but is more resilient to daemon port changes.",
		14289
	)
	createSettingInput(
		3,
		"ISpooferMotion_SEND_CHUNK_SIZE",
		"Scan Chunk Size",
		"Max asset records packed into one HTTP request during a scan.",
		"Lower: safer for huge games with slow HTTP, but scans take more round-trips. Higher: faster scans but may hit request size limits and cause errors.",
		5000
	)
	createSettingInput(
		4,
		"ISpooferMotion_MAX_SCRIPT_BYTES",
		"Max Script Size",
		"Scripts larger than this (in bytes) are skipped entirely during scanning and patching.",
		"Lower: large scripts with IDs inside them will be silently skipped and not replaced. Higher: very large scripts are read into memory - may crash Studio on low-RAM machines.",
		8000000
	)
	createSettingInput(
		5,
		"ISpooferMotion_MAX_PATCHES",
		"Max Patches Per Batch",
		"Maximum number of asset replacements applied in one patch operation.",
		"Lower: massive games may not get all IDs replaced in one run - re-run needed. Higher: very large batches can freeze Studio temporarily while changes are applied.",
		10000
	)
	createSettingInput(
		6,
		"ISpooferMotion_MAX_HTTP_BODY",
		"Max HTTP Body",
		"Maximum byte size of a single outgoing HTTP payload to the daemon.",
		"Lower: large scan payloads will be truncated or refused, causing incomplete scans. Higher: oversized payloads risk Studio memory spikes or timeouts on slow connections.",
		10000000
	)
	createSettingInput(
		7,
		"ISpooferMotion_MAX_HTTP_RESP",
		"Max HTTP Response",
		"Maximum byte size accepted for a single HTTP response from the daemon.",
		"Lower: large patch responses from the daemon will be rejected, causing failed replacements. Higher: very large responses consume more memory and may slow the UI.",
		1000000
	)

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

local logCounter = 0
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
