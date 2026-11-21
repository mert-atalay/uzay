export interface GamepadRawSnapshot {
  connected: boolean;
  id: string;
  axes: readonly number[];
  /** Button analog values (0..1) */
  buttons: readonly number[];
}

export interface GamepadFlightInput {
  connected: boolean;
  name: string | null;
  /** Analog strafe right (-1..1) */
  moveRight: number;
  /** Analog forward (-1..1) */
  moveForward: number;
  /** Analog vertical ascend/descend (-1..1) */
  moveUp: number;
  /** Analog yaw turn rate (-1..1, positive = turn right) */
  lookYaw: number;
  /** Analog pitch turn rate (-1..1, positive = look down) */
  lookPitch: number;
  /** True when RT/R2 boost trigger or L3 sprint is engaged */
  boostHeld: boolean;
  /** Analog boost intensity (0..1) */
  boostAmount: number;
  /** True while A/Cross jump/ascend button is held */
  jumpHeld: boolean;
  /** Edge-triggered one-shot actions */
  pressedJump: boolean;
  pressedLand: boolean;
  pressedScan: boolean;
  pressedCamera: boolean;
  pressedStarMap: boolean;
  pressedPause: boolean;
  pressedDock: boolean;
  pressedMute: boolean;
  pressedBack: boolean;
  pressedBlackHoleShortcut: boolean;
  pressedGearUp: boolean;
  pressedGearDown: boolean;
  pressedStartConfirm: boolean;
}

const STICK_DEADZONE = 0.14;
const TRIGGER_THRESHOLD = 0.22;
const BUTTON_THRESHOLD = 0.5;

/**
 * Radial 2D analog stick deadzone with smooth quadratic response curve
 * so fine orbital framing feels silky while full deflection hits 1.0 cleanly.
 */
export function applyRadialDeadzone(
  x: number,
  y: number,
  deadzone = STICK_DEADZONE,
): [number, number] {
  const mag = Math.hypot(x, y);
  if (mag <= deadzone || !Number.isFinite(mag)) {
    return [0, 0];
  }
  const normalized = Math.min(1, (mag - deadzone) / Math.max(0.001, 1 - deadzone));
  const curved = Math.pow(normalized, 1.55);
  const scale = curved / mag;
  return [x * scale, y * scale];
}

/**
 * Pure, deterministic standard gamepad mapper (Xbox / PlayStation DualSense / Switch Pro / Steam Deck).
 * Tracks edge-triggered presses via `prevButtons` so one-shot actions fire cleanly once per press.
 */
export function processGamepadState(
  raw: GamepadRawSnapshot | null,
  prevButtons: boolean[],
): { input: GamepadFlightInput; nextButtons: boolean[] } {
  if (!raw || !raw.connected) {
    return {
      input: {
        connected: false,
        name: null,
        moveRight: 0,
        moveForward: 0,
        moveUp: 0,
        lookYaw: 0,
        lookPitch: 0,
        boostHeld: false,
        boostAmount: 0,
        jumpHeld: false,
        pressedJump: false,
        pressedLand: false,
        pressedScan: false,
        pressedCamera: false,
        pressedStarMap: false,
        pressedPause: false,
        pressedDock: false,
        pressedMute: false,
        pressedBack: false,
        pressedBlackHoleShortcut: false,
        pressedGearUp: false,
        pressedGearDown: false,
        pressedStartConfirm: false,
      },
      nextButtons: [],
    };
  }

  const axes = raw.axes;
  const btns = raw.buttons;
  const btnVal = (idx: number): number => (idx < btns.length ? btns[idx] : 0);
  const isDown = (idx: number): boolean => btnVal(idx) >= BUTTON_THRESHOLD;
  const wasDown = (idx: number): boolean => Boolean(prevButtons[idx]);
  const justPressed = (idx: number): boolean => isDown(idx) && !wasDown(idx);

  // Left stick: movement (axes[0] = left/right, axes[1] = up/down where -1 is forward)
  const [lx, ly] = applyRadialDeadzone(axes[0] ?? 0, axes[1] ?? 0);
  // Right stick: camera look (axes[2] = yaw, axes[3] = pitch)
  const [rx, ry] = applyRadialDeadzone(axes[2] ?? 0, axes[3] ?? 0);

  // Triggers: RT (7) = Hyper-Boost / Sprint, LT (6) = Descend
  const lt = btnVal(6);
  const rt = btnVal(7);
  const boostAmount = rt > TRIGGER_THRESHOLD ? (rt - TRIGGER_THRESHOLD) / (1 - TRIGGER_THRESHOLD) : 0;
  const boostHeld = boostAmount > 0.05 || isDown(10); // RT or L3 click

  // Vertical thrust: A/Cross (0) = Ascend/Jump, B/Circle (1) or LT (6) = Descend
  const ascend = isDown(0) ? 1 : 0;
  const descend = Math.max(isDown(1) ? 1 : 0, lt > TRIGGER_THRESHOLD ? lt : 0);
  const moveUp = Math.max(-1, Math.min(1, ascend - descend));

  const nextButtons: boolean[] = new Array(Math.max(17, btns.length));
  for (let i = 0; i < nextButtons.length; i++) {
    nextButtons[i] = isDown(i);
  }

  const cleanName = raw.id ? raw.id.replace(/\s*\(.*?\)\s*/g, '').trim().slice(0, 32) || 'Controller' : 'Controller';

  return {
    input: {
      connected: true,
      name: cleanName,
      moveRight: lx,
      moveForward: -ly,
      moveUp,
      lookYaw: rx,
      lookPitch: ry,
      boostHeld,
      boostAmount,
      jumpHeld: isDown(0),
      pressedJump: justPressed(0),
      pressedBack: justPressed(1),
      pressedLand: justPressed(2), // X / Square
      pressedScan: justPressed(3), // Y / Triangle
      pressedGearDown: justPressed(4), // LB / L1
      pressedGearUp: justPressed(5), // RB / R1
      pressedStarMap: justPressed(8), // View / Select / Share
      pressedPause: justPressed(9), // Menu / Start / Options
      pressedCamera: justPressed(12), // D-Pad Up
      pressedDock: justPressed(13), // D-Pad Down
      pressedMute: justPressed(14), // D-Pad Left
      pressedBlackHoleShortcut: justPressed(15), // D-Pad Right
      pressedStartConfirm: justPressed(0) || justPressed(9),
    },
    nextButtons,
  };
}

/**
 * Safely read the first active standard browser Gamepad snapshot.
 */
export function pollActiveBrowserGamepad(): GamepadRawSnapshot | null {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
    return null;
  }
  let pads: (Gamepad | null)[] = [];
  try {
    pads = Array.from(navigator.getGamepads() || []);
  } catch {
    return null;
  }
  const active = pads.find((p) => p && p.connected) || null;
  if (!active) return null;

  return {
    connected: true,
    id: active.id || 'Controller',
    axes: active.axes,
    buttons: active.buttons.map((b) => (typeof b === 'number' ? b : b.value)),
  };
}

/**
 * Trigger tactile dual-rumble haptics on supported controllers (silently no-ops when unsupported).
 */
export function triggerGamepadHaptics(
  durationMs: number,
  weakMagnitude: number,
  strongMagnitude: number,
): void {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
  try {
    const pads = navigator.getGamepads();
    for (const pad of pads) {
      if (!pad || !pad.connected) continue;
      const actuator = (
        pad as Gamepad & {
          vibrationActuator?: {
            playEffect?: (
              type: string,
              params: {
                startDelay?: number;
                duration: number;
                weakMagnitude: number;
                strongMagnitude: number;
              },
            ) => Promise<void>;
          };
        }
      ).vibrationActuator;
      if (actuator && typeof actuator.playEffect === 'function') {
        void actuator
          .playEffect('dual-rumble', {
            startDelay: 0,
            duration: Math.max(25, Math.round(durationMs)),
            weakMagnitude: Math.max(0, Math.min(1, weakMagnitude)),
            strongMagnitude: Math.max(0, Math.min(1, strongMagnitude)),
          })
          .catch(() => {});
        break;
      }
    }
  } catch {
    // Ignore browser security / unsupported haptics errors
  }
}
