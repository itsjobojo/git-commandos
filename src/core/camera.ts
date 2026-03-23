export class Camera {
  y = 0;
  speed = 18; // pixels per second (slightly slower base)

  update(dt: number): void {
    this.y += this.speed * dt;
  }
}
