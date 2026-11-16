# Background collection on Omarchy

Enable **Use a dedicated minimized collection window** in the extension's
Settings and save. This setting is off by default; without it, provider tabs
are pinned in your regular Chrome window.

Chrome's `minimized` and `focused: false` requests are not a guarantee that a
Wayland compositor will hide a new window. On Omarchy, route the dedicated
collector to a silent special workspace instead. Ordinary provider tabs,
including sign-in tabs, do not match this rule.

For Omarchy versions using Lua configuration, copy
[`scripts/omarchy-collection-window.lua`](../scripts/omarchy-collection-window.lua)
to `~/.config/hypr/capacity-monitor.lua`, then add this line after the Omarchy
defaults in `~/.config/hypr/hyprland.lua`:

```lua
require("hypr.capacity-monitor")
```

Run `hyprctl reload` followed by `hyprctl configerrors` and resolve any errors.
The rule uses the [current Hyprland window-rule syntax](https://wiki.hypr.land/configuring/core/rules/window-rules/).
Older installations using `.conf` configuration need the matching syntax for
their installed Hyprland version; do not paste Lua into a `.conf` file.

Reload the unpacked extension at `chrome://extensions`, then collect once.
The extension keeps **Capacity Monitor collector** as the active tab in its
dedicated window so the native title stays stable. Provider pages are pinned
background tabs in that same window. On the first pass, a local inactive tab
briefly appears in the main browser before moving into the collector window;
provider pages are never staged in the main window.

The rule applies when a native window opens. If an older collector window is
already open, turn the dedicated-window setting off and save, then on and save
before collecting. This closes only extension-owned collection tabs and its
dedicated window.

Verify with `hyprctl clients`: the collector's workspace should be
`special:capacity-monitor`, while your active workspace and foreground window
remain unchanged. The **Close Capacity Monitor collection tabs after
collection** option can still close all provider pages; the local anchor stays
behind for the next pass.

To inspect the hidden window deliberately, run
`hyprctl dispatch togglespecialworkspace capacity-monitor`. Run it again to
hide it. Sign-in and card links continue to use ordinary browser tabs.

To undo the desktop rule, remove the `require` line and reload Hyprland.

Chrome's [offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
supports hidden local extension documents and embedded frames, rather than
directly replacing authenticated top-level provider tabs. A tab-free collector
would require separate validation of provider framing policies, session access,
and rendering. The workspace approach retains the existing provider readers
and browser sign-in sessions.
