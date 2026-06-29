local CoreGui = game:GetService("CoreGui")
local gui = nil
local statusText = nil

local function createPluginGui()
    if gui then return end
    
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
    container.Name = "Container"
    container.Size = UDim2.new(1, 0, 1, 0)
    container.BackgroundTransparency = 1
    container.Parent = gui
    
    local icon = Instance.new("ImageLabel")
    icon.Name = "Icon"
    icon.Size = UDim2.new(0, 80, 0, 80)
    icon.Position = UDim2.new(0.5, 0, 0, 30)
    icon.AnchorPoint = Vector2.new(0.5, 0)
    icon.BackgroundTransparency = 1
    icon.Image = "rbxassetid://137844667859456"
    icon.Parent = container
    
    statusText = Instance.new("TextLabel")
    statusText.Name = "StatusText"
    statusText.Size = UDim2.new(1, -40, 0, 40)
    statusText.Position = UDim2.new(0.5, 0, 0, 120)
    statusText.AnchorPoint = Vector2.new(0.5, 0)
    statusText.BackgroundTransparency = 1
    statusText.Font = Enum.Font.GothamMedium
    statusText.TextSize = 24
    statusText.TextColor3 = Color3.new(1, 1, 1)
    statusText.TextStrokeColor3 = Color3.new(0, 0, 0)
    statusText.TextStrokeTransparency = 0
    statusText.TextWrapped = true
    statusText.Text = "Connected to ISpooferMotion Desktop App."
    statusText.Parent = container
    
    return gui
end

local function setPluginGuiStatus(text)
    if not gui then
        createPluginGui()
    end
    if statusText then
        statusText.Text = text
    end
end

local function hidePluginGui()
    if gui then
        gui:Destroy()
        gui = nil
        statusText = nil
    end
end
