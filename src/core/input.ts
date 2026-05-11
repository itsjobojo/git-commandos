export class Input {
  private keys = new Map<string, boolean>();
  private justPressedKeys = new Set<string>();
  private previousKeys = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.get(e.code)) {
        this.justPressedKeys.add(e.code);
      }
      this.keys.set(e.code, true);
      e.preventDefault();
    });

    window.addEventListener('keyup', (e) => {
      this.keys.set(e.code, false);
      e.preventDefault();
    });
  }

  isDown(code: string): boolean {
    return this.keys.get(code) === true;
  }

  justPressed(code: string): boolean {
    return this.justPressedKeys.has(code);
  }

  endFrame(): void {
    this.justPressedKeys.clear();
    this.previousKeys.clear();
    for (const [key, val] of this.keys) {
      if (val) this.previousKeys.add(key);
    }
  }

  // Convenience: check movement directions (arrow keys + WASD)
  get left(): boolean {
    return this.isDown('ArrowLeft') || this.isDown('KeyA');
  }
  get right(): boolean {
    return this.isDown('ArrowRight') || this.isDown('KeyD');
  }
  get up(): boolean {
    return this.isDown('ArrowUp') || this.isDown('KeyW');
  }
  get down(): boolean {
    return this.isDown('ArrowDown') || this.isDown('KeyS');
  }
  get fire(): boolean {
    return this.isDown('KeyZ') || this.isDown('Space');
  }
  get fireLeft(): boolean {
    return this.isDown('KeyQ');
  }
  get fireRight(): boolean {
    return this.isDown('KeyE');
  }
  get blame(): boolean {
    return this.justPressed('KeyX');
  }
  get revert(): boolean {
    return this.justPressed('KeyC');
  }
}
