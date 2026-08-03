/**
 * Input → intent. Nothing downstream knows whether a frame came from a
 * keyboard, a mouse or a gamepad; systems read the `Intent` struct only.
 *
 * Edge-triggered actions (dodge, interact, drop) latch until `consumeEdges()`
 * is called at the end of a fixed step, so a key press can never be eaten by
 * a frame that happened to render between steps.
 */
export interface Intent {
  /** Desired move direction on the ground plane, length <= 1. */
  moveX: number;
  moveZ: number;
  /** Mouse position in normalised device coords, for ground raycasting. */
  pointerX: number;
  pointerY: number;
  /** Gamepad aim stick, length <= 1. Zero when aiming with the mouse. */
  stickAimX: number;
  stickAimZ: number;
  usingGamepad: boolean;

  fire: boolean;
  sprint: boolean;

  // Edge-triggered.
  dodge: boolean;
  interact: boolean;
  drop: boolean;
  revert: boolean;
  reload: boolean;
  pause: boolean;
}

const KEY_BINDINGS: Record<string, keyof Intent | 'up' | 'down' | 'left' | 'right'> = {
  KeyW: 'up',
  ArrowUp: 'up',
  KeyS: 'down',
  ArrowDown: 'down',
  KeyA: 'left',
  ArrowLeft: 'left',
  KeyD: 'right',
  ArrowRight: 'right',
  Space: 'dodge',
  KeyE: 'interact',
  KeyQ: 'drop',
  KeyC: 'revert',
  KeyR: 'reload',
  Escape: 'pause',
  ShiftLeft: 'sprint',
  ShiftRight: 'sprint',
};

const DEADZONE = 0.22;

export class Input {
  readonly intent: Intent = {
    moveX: 0,
    moveZ: 0,
    pointerX: 0,
    pointerY: 0,
    stickAimX: 0,
    stickAimZ: 0,
    usingGamepad: false,
    fire: false,
    sprint: false,
    dodge: false,
    interact: false,
    drop: false,
    revert: false,
    reload: false,
    pause: false,
  };

  private keys = new Set<string>();
  private mouseDown = false;
  private padIndex: number | null = null;
  private prevPadButtons: boolean[] = [];

  constructor(private readonly canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('gamepadconnected', (e) => {
      this.padIndex = (e as GamepadEvent).gamepad.index;
    });
    window.addEventListener('gamepaddisconnected', () => {
      this.padIndex = null;
    });
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  /** Call once per fixed step, before systems read the intent. */
  sample(): void {
    const i = this.intent;

    let x = (this.keys.has('right') ? 1 : 0) - (this.keys.has('left') ? 1 : 0);
    let z = (this.keys.has('down') ? 1 : 0) - (this.keys.has('up') ? 1 : 0);

    i.fire = this.mouseDown;
    i.sprint = this.keys.has('sprint');
    i.stickAimX = 0;
    i.stickAimZ = 0;

    const pad = this.padIndex !== null ? navigator.getGamepads()[this.padIndex] : null;
    if (pad) {
      const lx = deadzone(pad.axes[0] ?? 0);
      const ly = deadzone(pad.axes[1] ?? 0);
      if (lx || ly) {
        x = lx;
        z = ly;
        i.usingGamepad = true;
      }
      const rx = deadzone(pad.axes[2] ?? 0);
      const ry = deadzone(pad.axes[3] ?? 0);
      if (rx || ry) {
        i.stickAimX = rx;
        i.stickAimZ = ry;
        i.usingGamepad = true;
      }
      const buttons = pad.buttons.map((b) => b.pressed || b.value > 0.4);
      i.fire ||= !!buttons[7] || !!buttons[5];
      i.sprint ||= !!buttons[10];
      if (edge(buttons, this.prevPadButtons, 0)) i.dodge = true;
      if (edge(buttons, this.prevPadButtons, 2)) i.interact = true;
      if (edge(buttons, this.prevPadButtons, 1)) i.drop = true;
      if (edge(buttons, this.prevPadButtons, 3)) i.reload = true;
      if (edge(buttons, this.prevPadButtons, 9)) i.pause = true;
      this.prevPadButtons = buttons;
    }

    // Normalise so diagonals aren't faster than cardinals.
    const len = Math.hypot(x, z);
    if (len > 1) {
      x /= len;
      z /= len;
    }
    i.moveX = x;
    i.moveZ = z;
  }

  /** Clear edge-triggered flags. Call at the end of each fixed step. */
  consumeEdges(): void {
    const i = this.intent;
    i.dodge = false;
    i.interact = false;
    i.drop = false;
    i.revert = false;
    i.reload = false;
    i.pause = false;
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    const bound = KEY_BINDINGS[e.code];
    if (!bound) return;
    e.preventDefault();
    if (bound === 'up' || bound === 'down' || bound === 'left' || bound === 'right' || bound === 'sprint') {
      this.keys.add(bound);
      this.intent.usingGamepad = false;
      return;
    }
    // Edge action — ignore auto-repeat.
    if (e.repeat) return;
    (this.intent as unknown as Record<string, boolean>)[bound] = true;
    this.intent.usingGamepad = false;
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const bound = KEY_BINDINGS[e.code];
    if (bound) this.keys.delete(bound);
  };

  private onBlur = (): void => {
    this.keys.clear();
    this.mouseDown = false;
  };

  private onPointerMove = (e: PointerEvent): void => {
    const rect = this.canvas.getBoundingClientRect();
    this.intent.pointerX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.intent.pointerY = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
    this.intent.usingGamepad = false;
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (e.button === 0) this.mouseDown = true;
    this.intent.usingGamepad = false;
  };

  private onPointerUp = (e: PointerEvent): void => {
    if (e.button === 0) this.mouseDown = false;
  };
}

function deadzone(v: number): number {
  return Math.abs(v) < DEADZONE ? 0 : (v - Math.sign(v) * DEADZONE) / (1 - DEADZONE);
}

function edge(now: boolean[], prev: boolean[], index: number): boolean {
  return !!now[index] && !prev[index];
}
