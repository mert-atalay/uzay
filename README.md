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
| Up / down | Space / Ctrl | A / B |
| Look | Mouse | Right stick |
| Roll | Q / E | LB / RB |
| Boost | Shift | Right trigger |
| Throttle up / down | Scroll, or ] / [ | D-pad up / down |
| Time speed | T | Back |
| Toggle markers | H | Y |
| Free the mouse | Esc | |

Your top speed depends on how far you are from the nearest surface: slow near a planet, very
fast in empty space.

## Status

Step 1 of the build plan: project setup, true-scale catalogue, Kepler orbits, floating origin,
true-scale rendering, and a first flyable scene with placeholder visuals. Next: the feel of space
(real star catalogue, astronaut, auto-exposure), then the black hole.

The original AI Studio prototype is kept in `prototype-web/` for reference.
