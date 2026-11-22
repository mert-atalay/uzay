# Uzay

A true-scale space exploration game built with [Godot 4.7](https://godotengine.org). Float as an
astronaut through the real Solar System, travel to nearby stars, and fall into Sagittarius A*.

## Play

- **Easiest:** open the latest pull request or Actions run on GitHub, download the `Uzay-Windows`,
  `Uzay-macOS` or `Uzay-Linux` artifact, unzip and run it. (On macOS the first launch needs
  right-click → Open, since the build isn't notarized.)
- **From source:** install Godot 4.7.2, open this folder in the editor (Import → `project.godot`),
  press F5.

## Controls

| Action | Keyboard / mouse | Gamepad |
| --- | --- | --- |
| Move | W A S D | Left stick |
| Up / down | Space / Ctrl | A / B (or left trigger for down) |
| Look | Mouse | Right stick |
| Roll | Q / E | LB / RB |
| Boost | Shift | Right trigger |
| Throttle up / down | Scroll, or ] / [ | D-pad up / down |
| Time speed | T | Back |
| Travel menu (warp to any planet, star or the black hole) | Tab | Start |
| Warp to the black hole / back to Earth | B / N | D-pad right / left |
| Warp to what you are looking at | J | X |
| Music on / off | M | |
| Third / first person | V | Right stick click |
| Toggle markers | H | Y |
| Free the mouse | Esc | |
| Fullscreen / window | F11 | |

The game starts fullscreen. In the travel menu, move with the D-pad or arrows, A / Enter picks a
destination, B / Esc closes. The bottom-left hint line names the controller the game has found.

**The black hole:** press B to jump next to Sagittarius A*, then hold W. It pulls you in as you get close. Cross the event horizon
and there is no way back: you fall for about a minute, then the tesseract opens. Press Enter (Start on a
controller) there to let go.

**Landing:** fly down to any rocky planet or moon. Dive fast through air and it burns around you.
Touch the ground and you are on foot: W A S D walk, Shift runs, Space jumps (try the Moon). Hold
Space to fire the jetpack and fly again.

Your top speed depends on how far you are from the nearest surface: slow near a planet, very
fast in empty space.

## Status

Step 1 of the build plan: project setup, true-scale catalogue, Kepler orbits, floating origin,
true-scale rendering, and a first flyable scene with placeholder visuals. Next: the feel of space
(real star catalogue, astronaut, auto-exposure), then the black hole.

The original AI Studio prototype is kept in `prototype-web/` for reference.
