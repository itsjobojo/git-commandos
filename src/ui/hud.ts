import { el } from './overlay';
import { basename, type Mission } from '../game/mission';

export interface HudState {
  progress: number;
  inside: boolean;
  secondsRemaining: number;
  /** Names of files still safe. M4 makes this shrink when you're hit. */
  safe: string[];
  lost: string[];
  distanceToPad: number;
}

/**
 * In-run HUD: the cargo manifest and the extraction hold bar.
 *
 * The manifest lists real filenames because that is the entire point — the
 * thing you are protecting has a name, and you should watch it go.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly manifest: HTMLDivElement;
  private readonly bar: HTMLDivElement;
  private readonly barFill: HTMLDivElement;
  private readonly barLabel: HTMLDivElement;
  private readonly compass: HTMLDivElement;
  private rows = new Map<string, HTMLDivElement>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'position:absolute; inset:0; pointer-events:none;');

    this.manifest = el(
      'div',
      `position:absolute; left:18px; bottom:18px; font:12px/1.7 var(--font-mono);
       text-shadow:0 1px 2px rgba(0,0,0,.9);`,
    );

    this.bar = el(
      'div',
      `position:absolute; left:50%; bottom:56px; transform:translateX(-50%);
       width:min(420px, 60vw); opacity:0; transition:opacity .18s ease;`,
    );
    this.barLabel = el(
      'div',
      `text-align:center; font:11px/1.6 var(--font-mono); letter-spacing:.16em;
       text-transform:uppercase; color:#8fd9ac; margin-bottom:6px;`,
    );
    const track = el(
      'div',
      'height:6px; background:rgba(255,255,255,.08); border:1px solid #24343f; border-radius:2px; overflow:hidden;',
    );
    this.barFill = el('div', 'height:100%; width:0%; background:#4ade80; transition:width .06s linear;');
    track.appendChild(this.barFill);
    this.bar.append(this.barLabel, track);

    this.compass = el(
      'div',
      `position:absolute; right:18px; bottom:18px; text-align:right;
       font:12px/1.7 var(--font-mono); color:#5c7180; text-shadow:0 1px 2px rgba(0,0,0,.9);`,
    );

    this.root.append(this.manifest, this.bar, this.compass);
    parent.appendChild(this.root);
  }

  setMission(mission: Mission): void {
    this.manifest.textContent = '';
    this.rows.clear();

    const title = el(
      'div',
      'color:#5c7180; font-size:10px; letter-spacing:.16em; text-transform:uppercase; margin-bottom:4px;',
      'cargo',
    );
    this.manifest.appendChild(title);

    for (const file of mission.files) {
      const row = el('div', 'color:#c3d3d0; transition:color .2s, opacity .2s;');
      row.textContent = `▪ ${basename(file.name)}`;
      row.title = file.name;
      this.rows.set(file.name, row);
      this.manifest.appendChild(row);
    }
  }

  update(state: HudState): void {
    for (const name of state.lost) {
      const row = this.rows.get(name);
      if (row && row.dataset.lost !== '1') {
        row.dataset.lost = '1';
        row.style.color = '#f87171';
        row.style.textDecoration = 'line-through';
        row.style.opacity = '0.6';
      }
    }

    this.bar.style.opacity = state.progress > 0 ? '1' : '0';
    this.barFill.style.width = `${(state.progress * 100).toFixed(1)}%`;
    this.barLabel.textContent = state.inside
      ? `writing commit object — ${state.secondsRemaining.toFixed(1)}s`
      : 'extraction paused — return to the beacon';
    this.barFill.style.background = state.inside ? '#4ade80' : '#8fa3ae';

    this.compass.textContent =
      state.progress >= 1
        ? ''
        : `beacon ${state.distanceToPad.toFixed(0)}m · ${state.safe.length} safe · ${state.lost.length} lost`;
  }

  dispose(): void {
    this.root.remove();
  }
}
