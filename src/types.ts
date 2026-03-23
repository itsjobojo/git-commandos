export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type GameState = 'title' | 'playing' | 'dying' | 'game-over' | 'level-intro' | 'win';
