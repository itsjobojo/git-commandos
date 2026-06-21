type SoundName =
  | 'shoot'
  | 'shootHeavy'
  | 'hit'
  | 'explosion'
  | 'coin'
  | 'hurt'
  | 'lose'
  | 'select'
  | 'revert';

const soundPaths: Record<SoundName, string[]> = {
  shoot: ['/sounds/shoot-a.ogg', '/sounds/shoot-b.ogg', '/sounds/shoot-c.ogg'],
  shootHeavy: ['/sounds/shoot-d.ogg', '/sounds/shoot-e.ogg'],
  hit: ['/sounds/hurt-a.ogg', '/sounds/hurt-b.ogg', '/sounds/hurt-c.ogg'],
  explosion: ['/sounds/explosion-a.ogg', '/sounds/explosion-b.ogg', '/sounds/explosion-c.ogg'],
  coin: ['/sounds/coin-a.ogg', '/sounds/coin-b.ogg'],
  hurt: ['/sounds/hurt-d.ogg', '/sounds/hurt-e.ogg'],
  lose: ['/sounds/lose-a.ogg', '/sounds/lose-b.ogg'],
  select: ['/sounds/select-a.ogg'],
  revert: ['/sounds/explosion-c.ogg'],
};

const audioCache = new Map<string, HTMLAudioElement[]>();
const POOL_SIZE = 4;

function getPool(path: string): HTMLAudioElement[] {
  let pool = audioCache.get(path);
  if (!pool) {
    pool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      pool.push(new Audio(path));
    }
    audioCache.set(path, pool);
  }
  return pool;
}

export { playMusic, stopMusic, setMusicVolume } from './music';

export function playSound(name: SoundName, volume = 0.3): void {
  const paths = soundPaths[name];
  const path = paths[Math.floor(Math.random() * paths.length)];
  const pool = getPool(path);

  // Find an audio element that's not currently playing
  const audio = pool.find((a) => a.paused || a.ended) ?? pool[0];
  audio.volume = volume;
  audio.currentTime = 0;
  audio.play().catch(() => {
    // Autoplay blocked — ignore
  });
}
