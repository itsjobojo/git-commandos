import { Rect } from '../types';

export abstract class Entity {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  width = 24;
  height = 24;
  active = true;

  getBounds(): Rect {
    return { x: this.x, y: this.y, w: this.width, h: this.height };
  }

  abstract update(dt: number): void;
  abstract render(ctx: CanvasRenderingContext2D): void;
}
