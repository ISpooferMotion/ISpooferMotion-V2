--!nolint UnknownGlobal
--!nocheck
--!nolint

-- luacheck: ignore
---@diagnostic disable: undefined-global, unused-local, unused-function, lowercase-global

local CoreGui = game:GetService("CoreGui")
local gui = nil
local statusText = nil
local logsScrollingFrame = nil
local connectionStatusText = nil

local logCounter = 0

local updateBatchUIFunc = nil

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

	local function setBg(btn, color)
		btn.BackgroundColor3 = color
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
		clearPluginLogs()
		clearLogsButton.Text = "Cleared"

		task.delay(1.5, function()
			if clearLogsButton and clearLogsButton.Parent then
				clearLogsButton.Text = "Clear"
				clearLogsButton.TextColor3 = Color3.fromHex("#a1a1aa")
			end
		end)
	end)

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
		closeButton.TextColor3 = Color3.fromHex("#ef4444")
	end)
	closeButton.MouseLeave:Connect(function()
		closeButton.TextColor3 = Color3.fromHex("#52525b")
	end)
	closeButton.MouseButton1Click:Connect(function()
		if gui then
			gui.Enabled = false
		end
	end)

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

		btn.MouseEnter:Connect(function()
			if btn.BackgroundColor3 ~= Color3.fromHex("#18181b") then
				setBg(btn, Color3.fromHex("#111114"))
			end
		end)
		btn.MouseLeave:Connect(function()
			if btn.BackgroundColor3 ~= Color3.fromHex("#18181b") then
				setBg(btn, Color3.fromHex("#09090b"))
			end
		end)

		return btn
	end

	local consoleTabBtn = createTabButton("ConsoleTab", "Console", 1, true)
	consoleTabBtn.Parent = tabBar

	local manualTabBtn = createTabButton("ManualTab", "Manual Replace", 2, false)
	manualTabBtn.Parent = tabBar

	local contentArea = Instance.new("Frame")
	contentArea.Name = "ContentArea"
	contentArea.Size = UDim2.new(1, -32, 1, -144)
	contentArea.Position = UDim2.fromOffset(16, 96)
	contentArea.BackgroundTransparency = 1
	contentArea.Parent = container

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

	local manualContainer = Instance.new("Frame")
	manualContainer.Name = "ManualContainer"
	manualContainer.Size = UDim2.fromScale(1, 1)
	manualContainer.BackgroundTransparency = 1
	manualContainer.Visible = false
	manualContainer.Parent = contentArea

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
	speedValLabel.TextColor3 = Color3.fromHex("#fafafa")
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
	speedFill.BackgroundColor3 = Color3.fromHex("#d4d4d8")
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

	currentBatchSize = manualBatchSize

	local function updateBatchUI(v)
		v = math.clamp(v, minBatch, maxBatch)
		v = math.floor((v - minBatch) / stepBatch + 0.5) * stepBatch + minBatch
		currentBatchSize = v
		manualBatchSize = v

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
		setBg(runManualBtn, Color3.fromHex("#3f3f46"))
	end)
	runManualBtn.MouseLeave:Connect(function()
		setBg(runManualBtn, Color3.fromHex("#27272a"))
	end)
	runManualBtn.MouseButton1Down:Connect(function()
		setBg(runManualBtn, Color3.fromHex("#18181b"))
	end)
	runManualBtn.MouseButton1Up:Connect(function()
		setBg(runManualBtn, Color3.fromHex("#3f3f46"))
	end)

	local manualRunning = false

	runManualBtn.MouseButton1Click:Connect(function()
		if manualRunning then
			return
		end
		local txt = manualBox.Text
		if txt == "" then
			return
		end
		-- selene: allow(global_usage)
		local _G_plugin = _G.ISpooferMotionPlugin
		if _G_plugin and _G_plugin.runManualReplacements then
			manualRunning = true
			runManualBtn.Text = "Starting..."
			setBg(runManualBtn, Color3.fromHex("#18181b"))

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
						setBg(runManualBtn, Color3.fromHex("#10b981"))
						task.delay(3.5, function()
							if runManualBtn and runManualBtn.Parent and not manualRunning then
								runManualBtn.Text = "Run Replacements"
								setBg(runManualBtn, Color3.fromHex("#27272a"))
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

	local ALL_TABS = { consoleTabBtn, manualTabBtn }

	local function switchTab(tab)
		for _, button in ipairs(ALL_TABS) do
			setBg(button, Color3.fromHex("#09090b"))
			button.TextColor3 = Color3.fromHex("#71717a")
		end
		logsContainer.Visible = tab == "console"
		manualContainer.Visible = tab == "manual"
		local activeButton = tab == "console" and consoleTabBtn or manualTabBtn
		setBg(activeButton, Color3.fromHex("#18181b"))
		activeButton.TextColor3 = Color3.fromHex("#ffffff")
	end

	consoleTabBtn.MouseButton1Click:Connect(function()
		switchTab("console")
	end)
	manualTabBtn.MouseButton1Click:Connect(function()
		switchTab("manual")
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

		if messageType == Enum.MessageType.MessageError then
			logLabel.TextColor3 = Color3.fromRGB(248, 113, 113)
		elseif messageType == Enum.MessageType.MessageWarning then
			logLabel.TextColor3 = Color3.fromRGB(250, 204, 21)
		else
			logLabel.TextColor3 = Color3.fromRGB(212, 212, 216)
		end

		logLabel.TextXAlignment = Enum.TextXAlignment.Left
		logLabel.TextWrapped = true

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

function logToPlugin(text)
	local msg = tostring(text)

	if string.find(msg, "[Warning]", 1, true) then
		warn(msg)
	else
		print("[ISpooferMotion] " .. msg)
	end
end

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

function hidePluginGui()
	if gui then
		gui:Destroy()
		gui = nil
		statusText = nil
		logsScrollingFrame = nil
		connectionStatusText = nil

		logCounter = 0
	end

	if logConnection then
		logConnection:Disconnect()
		logConnection = nil
	end
end

function togglePluginGui()
	if not gui then
		createPluginGui()
	end
	if gui then
		gui.Enabled = not gui.Enabled
	end
end

function setConnectionStatus(isConnected)
	if not gui then
		createPluginGui()
	end
	if connectionStatusText then
		if isConnected then
			connectionStatusText.Text = "Connected to Desktop App"
			connectionStatusText.TextColor3 = Color3.fromHex("#22c55e")
		else
			connectionStatusText.Text = "Disconnected from Desktop App"
			connectionStatusText.TextColor3 = Color3.fromHex("#ef4444")
		end
	end
end

function setPluginBatchSize(size)
	if size and tonumber(size) then
		local num = math.clamp(tonumber(size), 10, 500)
		pcall(function()
			manualBatchSize = num
			if updateBatchUIFunc then
				updateBatchUIFunc(num)
			end
		end)
	end
end
