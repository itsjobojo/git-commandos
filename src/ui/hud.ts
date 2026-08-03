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
  weapon: string;
  /** null when the held weapon never runs out. */
  ammo: number | null;
  /** null unless the death rule is `health`. */
  hp: number | null;
  maxHp: number;
}

type FlashKind = 'good' | 'warn' | 'bad' | 'info';

/**
 * Type scale and safe margins.
 *
 * The HUD was set in 10–12px throughout, which is below the floor for anything
 * you have to read while moving, and pinned 18px from the window edge — about
 * 1.2% inset, well inside the region a TV or an overscanning display will clip.
 * These are `clamp`ed against viewport units so the HUD grows on a large
 * display instead of shrinking into it, and both ends are bounded so it never
 * collapses on a small window or swallows the screen on a huge one.
 */
const SAFE = 'clamp(20px, 3vmin, 46px)';
/** Ammo — critical, read at a glance mid-fight. */
const TITLE = 'clamp(19px, 2.1vmin, 30px)';
/** Filenames, timers, load. Everything you actually parse. */
const BODY = 'clamp(14px, 1.35vmin, 19px)';
/** Section captions only. Never carries information on its own. */
const CAPTION = 'clamp(11px, 1.05vmin, 14px)';

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
  private readonly ammoLine: HTMLDivElement;
  private readonly loadLine: HTMLDivElement;
  private readonly hpLine: HTMLDivElement;
  private readonly flashes: HTMLDivElement;
  private readonly banners: HTMLDivElement;
  private readonly rows = new Map<
    string,
    {
      row: HTMLDivElement;
      label: HTMLSpanElement;
      timer: HTMLSpanElement;
      bar: HTMLDivElement;
      barFill: HTMLDivElement;
    }
  >();

  constructor(parent: HTMLElement) {
    this.root = el('div', 'position:absolute; inset:0; pointer-events:none;');

    this.manifest = el(
      'div',
      `position:absolute; left:${SAFE}; bottom:${SAFE}; font:${BODY}/1.65 var(--font-mono);
       text-shadow:0 1px 3px rgba(0,0,0,.95); min-width:min(260px, 26vw);`,
    );

    this.bar = el(
      'div',
      `position:absolute; left:50%; bottom:calc(${SAFE} + 4.5vmin); transform:translateX(-50%);
       width:min(460px, 56vw); opacity:0; transition:opacity .18s ease;`,
    );
    this.barLabel = el(
      'div',
      `text-align:center; font:${BODY}/1.6 var(--font-mono); letter-spacing:.16em;
       text-transform:uppercase; color:#9ce6b8; margin-bottom:7px;
       text-shadow:0 1px 3px rgba(0,0,0,.95);`,
    );
    const track = el(
      'div',
      'height:6px; background:rgba(255,255,255,.08); border:1px solid #24343f; border-radius:2px; overflow:hidden;',
    );
    this.barFill = el('div', 'height:100%; width:0%; background:#4ade80; transition:width .06s linear;');
    track.appendChild(this.barFill);
    this.bar.append(this.barLabel, track);

    // Ammo is the one number you check mid-fight without taking your eyes off
    // the fight, so it gets real size instead of being a clause in a run-on
    // sentence set in 12px grey. Distance to the beacon left this block
    // entirely — the objective marker carries it now, and repeating it here
    // was two places to read the same fact.
    this.status = el(
      'div',
      `position:absolute; right:${SAFE}; bottom:${SAFE}; text-align:right;
       text-shadow:0 1px 3px rgba(0,0,0,.95);`,
    );
    this.ammoLine = el(
      'div',
      `font:600 ${TITLE}/1.15 var(--font-mono); letter-spacing:.06em;
       text-transform:uppercase; color:#dbe7e4;`,
    );
    this.hpLine = el('div', `font:${BODY}/1.5 var(--font-mono); letter-spacing:.18em; color:#f87171;`);
    this.loadLine = el('div', `font:${BODY}/1.55 var(--font-mono); color:#93a9b6;`);
    this.status.append(this.ammoLine, this.hpLine, this.loadLine);

    // Banners sit above the flash lane so an arriving event never gets buried
    // under a run of cargo notifications.
    this.banners = el(
      'div',
      `position:absolute; left:50%; top:12%; transform:translateX(-50%); width:min(720px, 88vw);`,
    );

    this.flashes = el(
      'div',
      `position:absolute; left:50%; top:26%; transform:translateX(-50%); text-align:center;
       font:600 ${BODY}/1.9 var(--font-mono); letter-spacing:.12em;
       text-shadow:0 2px 6px rgba(0,0,0,.95);`,
    );

    this.root.append(this.manifest, this.bar, this.status, this.banners, this.flashes);
    parent.appendChild(this.root);
  }

  setMission(mission: Mission): void {
    this.manifest.textContent = '';
    this.rows.clear();

    this.manifest.appendChild(
      el(
        'div',
        `color:#93a9b6; font-size:${CAPTION}; letter-spacing:.16em;
         text-transform:uppercase; margin-bottom:5px;`,
        'cargo',
      ),
    );

    for (const file of mission.files) {
      const wrapper = el('div', 'margin-bottom:1px;');
      const row = el('div', 'display:flex; gap:8px; align-items:baseline; transition:color .2s;');
      const label = el('span', 'flex:1;');
      label.textContent = `▪ ${basename(file.name)}`;
      const timer = el('span', `font-size:${CAPTION}; opacity:.95;`);
      row.title = file.name;
      row.append(label, timer);

      // A drain bar under the row, shown only while this crate is bleeding out.
      const bar = el(
        'div',
        `height:3px; background:rgba(255,255,255,.1); border-radius:2px; overflow:hidden;
         margin:1px 0 3px 12px; display:none;`,
      );
      const barFill = el('div', 'height:100%; width:100%; background:#fbbf24;');
      bar.appendChild(barFill);

      wrapper.append(row, bar);
      this.rows.set(file.name, { row, label, timer, bar, barFill });
      this.manifest.appendChild(wrapper);
    }
  }

  /**
   * Big event banner — a named thing arriving, not a status line.
   *
   * Separate from `flash` on purpose: cargo changing hands is bookkeeping you
   * read in passing, whereas a stampede coming down the valley is an event you
   * need to react to, and the two shouldn't compete in the same lane.
   */
  announce(title: string, subtitle: string, kind: FlashKind = 'warn'): void {
    const colour = FLASH_COLOUR[kind];
    const wrap = el(
      'div',
      `text-align:center; opacity:0; transform:translateY(-14px);
       transition:opacity .28s ease, transform .28s cubic-bezier(.2,.9,.3,1); margin-bottom:10px;`,
    );

    const heading = el(
      'div',
      `font:700 clamp(34px, 5.2vw, 62px)/1.1 var(--font-mono); letter-spacing:.14em;
       text-transform:uppercase; color:${colour};
       text-shadow:0 4px 24px rgba(0,0,0,.98), 0 0 38px ${colour}55;`,
      title,
    );
    const rule = el(
      'div',
      `height:2px; width:70%; margin:8px auto 6px; background:${colour}; opacity:.55;`,
    );
    const sub = el(
      'div',
      `font:clamp(13px, 1.5vw, 17px)/1.4 var(--font-mono); letter-spacing:.24em;
       text-transform:uppercase; color:#9fb4c0;`,
      subtitle,
    );

    wrap.append(heading, rule, sub);
    // One banner at a time. Stacked headlines are unreadable and there is only
    // ever one thing that most needs your attention.
    this.banners.textContent = '';
    this.banners.appendChild(wrap);
    requestAnimationFrame(() => {
      wrap.style.opacity = '1';
      wrap.style.transform = 'translateY(0)';
    });
    setTimeout(() => {
      wrap.style.opacity = '0';
      wrap.style.transform = 'translateY(-10px)';
      setTimeout(() => wrap.remove(), 400);
    }, 2600);
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

      // A dropped crate gets a live countdown AND a draining bar — the single
      // most urgent thing on screen, because it is a file bleeding out.
      const dropped = crate.state === 'dropped';
      entry.timer.textContent = dropped ? `${crate.decay.toFixed(1)}s` : style.note;
      entry.timer.style.color = dropped ? '#fbbf24' : '#4b5c66';

      entry.bar.style.display = dropped ? 'block' : 'none';
      if (dropped && state.decaySeconds > 0) {
        const remaining = Math.max(0, Math.min(1, crate.decay / state.decaySeconds));
        entry.barFill.style.width = `${(remaining * 100).toFixed(1)}%`;
        // Goes red as it runs out, so peripheral vision catches it.
        entry.barFill.style.background = remaining < 0.3 ? '#f87171' : '#fbbf24';
      }
    }

    this.bar.style.opacity = state.progress > 0 ? '1' : '0';
    this.barFill.style.width = `${(state.progress * 100).toFixed(1)}%`;
    this.barLabel.textContent = state.inside
      ? `writing commit object — ${state.secondsRemaining.toFixed(1)}s`
      : 'extraction paused — return to the beacon';
    this.barFill.style.background = state.inside ? '#4ade80' : '#8fa3ae';

    this.status.style.display = state.progress >= 1 ? 'none' : 'block';
    if (state.progress >= 1) return;

    this.ammoLine.textContent = `${state.weapon.toUpperCase()}  ${state.ammo === null ? '∞' : state.ammo}`;
    // Running dry is a state change you need to notice before it happens, not
    // after the gun stops. Colour is a second channel here, never the only one
    // — the number itself is the signal.
    const dry = state.ammo !== null && state.ammo <= 10;
    this.ammoLine.style.color = dry ? '#f87171' : '#dbe7e4';

    if (state.hp === null) {
      this.hpLine.style.display = 'none';
    } else {
      this.hpLine.style.display = 'block';
      const full = Math.max(0, state.hp);
      this.hpLine.textContent = `${'●'.repeat(full)}${'○'.repeat(Math.max(0, state.maxHp - full))}`;
      this.hpLine.style.color = full <= 1 ? '#f87171' : '#fbbf24';
    }

    const slowdown = Math.round((1 - state.loadFactor) * 100);
    this.loadLine.textContent =
      `carrying ${state.carrying}` + (slowdown > 0 ? ` · −${slowdown}% speed` : '');
  }

  dispose(): void {
    this.root.remove();
  }
}
