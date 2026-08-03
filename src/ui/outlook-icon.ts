/**
 * The Outlook icon, drawn rather than shipped.
 *
 * Deliberately not Microsoft's actual logo file: this repo publishes to npm
 * and every bundled asset has to be CC0 (see ASSETS.md), which a trademarked
 * brand asset is not. This is our own rendering of the same recognisable
 * shapes — blue tile, white envelope, the O — which is what parody needs and
 * what the joke actually depends on: you should feel the jolt of recognition
 * before you read a word of it.
 */
export function outlookIconDataUrl(size = 128): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = size / 128;

  // Blue tile.
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#1a7fd4');
  gradient.addColorStop(1, '#0e4b9c');
  roundedRect(ctx, 0, 0, size, size, 22 * s);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Envelope: back panel, then the flap folding into it.
  ctx.fillStyle = '#ffffff';
  roundedRect(ctx, 40 * s, 38 * s, 74 * s, 54 * s, 4 * s);
  ctx.fill();

  ctx.fillStyle = '#cfe4f7';
  ctx.beginPath();
  ctx.moveTo(40 * s, 40 * s);
  ctx.lineTo(77 * s, 68 * s);
  ctx.lineTo(114 * s, 40 * s);
  ctx.lineTo(114 * s, 46 * s);
  ctx.lineTo(77 * s, 75 * s);
  ctx.lineTo(40 * s, 46 * s);
  ctx.closePath();
  ctx.fill();

  // The O, sitting proud of the envelope on the left.
  ctx.beginPath();
  ctx.ellipse(40 * s, 64 * s, 30 * s, 34 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#0a3d82';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(40 * s, 64 * s, 22 * s, 26 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(40 * s, 64 * s, 11 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#0a3d82';
  ctx.fill();

  return canvas.toDataURL('image/png');
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
