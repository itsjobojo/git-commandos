import { el } from './overlay';
import { basename, type Mission } from '../game/mission';
import type { CrateRecord, CrateState } from '../systems/cargo-ledger';

export interface HudState {
  crates: readonly CrateRecord[];
  decaySeconds: number;
  progress: number;
  inside: boolean;
  secondsRemaining: number;
  carrying: number;
  /** 1 = unencumbered. Surfaced so the slowdown is legible, not mysterious. */
  loadFactor: number;
  /** null unless the death rule is `health`. */
  hp: number | null;
  maxHp: number;
  distanceToPad: number;
}

type FlashKind = 'good' | 'warn' | 'bad' | 'info';

const STATE_STYLE: Record<CrateState, { colour: string; mark: string; note: string }> = {
  world: { colour: '#6b7d79', mark: '▫', note: 'on the map' },
  carried: { colour: '#4ade80', mark: '▪', note: 'carried' },
  dropped: { colour: '#fbbf24', mark: '▪', note: '' },
  stashed: { colour: '#a78bfa', mark: '▪', note: 'stashed' },
  lost: { colour: '#f87171', mark: '✗', note: 'lost' },
};

const FLASH_COLOUR: Record<FlashKind, string> = {
  good: '#4ade80',
  warn: '#fbbf24',
  bad: '#f87171',
  info: '#a78bfa',
};

/**
 * In-run HUD: the cargo manifest, decay clocks, and the extraction hold.
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
  private readonly status: HTMLDivElement;
  private readonly flashes: HTMLDivElement;
  private readonly rows = new Map<string, { row: HTMLDivElement; label: HTMLSpanElement; timer: HTMLSpanElement }>();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'position:absolute; inset:0; pointer-events:none;');

    this.manifest = el(
      'div',
      `position:absolute; left:18px; bottom:18px; font:12px/1.7 var(--font-mono);
       text-shadow:0 1px 2px rgba(0,0,0,.9); min-width:210px;`,
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

    this.status = el(
      'div',
      `position:absolute; right:18px; bottom:18px; text-align:right;
       font:12px/1.7 var(--font-mono); color:#5c7180; text-shadow:0 1px 2px rgba(0,0,0,.9);`,
    );

    this.flashes = el(
      'div',
      `position:absolute; left:50%; top:14%; transform:translateX(-50%); text-align:center;
       font:13px/1.9 var(--font-mono); letter-spacing:.12em;
       text-shadow:0 2px 6px rgba(0,0,0,.95);`,
    );

    this.root.append(this.manifest, this.bar, this.status, this.flashes);
    parent.appendChild(this.root);
  }

  setMission(mission: Mission): void {
    this.manifest.textContent = '';
    this.rows.clear();

    this.manifest.appendChild(
      el(
        'div',
        'color:#5c7180; font-size:10px; letter-spacing:.16em; text-transform:uppercase; margin-bottom:4px;',
        'cargo',
      ),
    );

    for (const file of mission.files) {
      const row = el('div', 'display:flex; gap:8px; align-items:baseline; transition:color .2s;');
      const label = el('span', 'flex:1;');
      label.textContent = `▪ ${basename(file.name)}`;
      const timer = el('span', 'font-size:11px; opacity:.9;');
      row.title = file.name;
      row.append(label, timer);
      this.rows.set(file.name, { row, label, timer });
      this.manifest.appendChild(row);
    }
  }

  /** Transient centre-screen message — a file changing hands. */
  flash(text: string, kind: FlashKind = 'info'): void {
    const line = el('div', `color:${FLASH_COLOUR[kind]}; opacity:0; transition:opacity .15s ease;`, text);
    this.flashes.appendChild(line);
    requestAnimationFrame(() => {
      line.style.opacity = '1';
    });
    setTimeout(() => {
      line.style.opacity = '0';
      setTimeout(() => line.remove(), 300);
    }, 1500);
  }

  update(state: HudState): void {
    for (const crate of state.crates) {
      const entry = this.rows.get(crate.name);
      if (!entry) continue;
      const style = STATE_STYLE[crate.state];

      entry.row.style.color = style.colour;
      entry.label.textContent = `${style.mark} ${basename(crate.name)}`;
      entry.label.style.textDecoration = crate.state === 'lost' ? 'line-through' : 'none';
      entry.row.style.opacity = crate.state === 'lost' ? '0.55' : '1';

      // A dropped crate gets a live countdown — the single most urgent number
      // on screen, because it is a file bleeding out.
      entry.timer.textContent =
        crate.state === 'dropped' ? `${crate.decay.toFixed(1)}s` : style.note;
      entry.timer.style.color = crate.state === 'dropped' ? '#fbbf24' : '#4b5c66';
    }

    this.bar.style.opacity = state.progress > 0 ? '1' : '0';
    this.barFill.style.width = `${(state.progress * 100).toFixed(1)}%`;
    this.barLabel.textContent = state.inside
      ? `writing commit object — ${state.secondsRemaining.toFixed(1)}s`
      : 'extraction paused — return to the beacon';
    this.barFill.style.background = state.inside ? '#4ade80' : '#8fa3ae';

    const slowdown = Math.round((1 - state.loadFactor) * 100);
    const bits = [
      `beacon ${state.distanceToPad.toFixed(0)}m`,
      `carrying ${state.carrying}${slowdown > 0 ? ` (−${slowdown}% speed)` : ''}`,
    ];
    if (state.hp !== null) bits.push(`hp ${'●'.repeat(Math.max(0, state.hp))}${'○'.repeat(Math.max(0, state.maxHp - state.hp))}`);
    this.status.textContent = state.progress >= 1 ? '' : bits.join(' · ');
  }

  dispose(): void {
    this.root.remove();
  }
}
