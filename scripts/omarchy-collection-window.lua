-- AI Capacity Monitor: keep only the extension's dedicated collector hidden.
-- Loaded from ~/.config/hypr/hyprland.lua, after the Omarchy defaults.
-- The extension loads the anchor title before creating this native window.
o.window({
  class = "((google-)?[cC]hrom(e|ium)|[bB]rave-browser|[mM]icrosoft-edge|Vivaldi-stable|helium)",
  initial_title = "^Capacity Monitor collector( - .*)?$",
}, {
  workspace = "special:capacity-monitor silent",
  no_initial_focus = true,
  suppress_event = "activate activatefocus",
})
