import { CSS, el, fadeIn } from './overlay';
import type { Mission } from '../game/mission';
import type { Outcome } from '../net/protocol';

/**
 * Why the run ended. `empty-handed` is a loss, but a different one from being
 * put down — you walked onto the pad with nothing, and saying so is clearer
 * than a generic GAME OVER.
 */
export type DebriefReason = 'extracted' | 'empty-handed' | 'down' | 'wiped';

export interface DebriefData {
  outcome: Outcome;
  reason: DebriefReason;
  mission: Mission;
  surviving: string[];
  lost: string[];
  stashed: string[];
}

const HEADLINE: Record<DebriefReason, { label: string; colour: string }> = {
  extracted: { label: 'extraction complete', colour: '#4ade80' },
  'empty-handed': { label: 'extracted empty-handed', colour: '#fbbf24' },
  down: { label: 'mission failed', colour: '#f87171' },
  // Distinct from `down` on purpose: you were not killed, you simply have
  // nothing left to carry out, and the debrief should say which happened.
  wiped: { label: 'all cargo lost', colour: '#f87171' },
};

/**
 * Post-run debrief. States exactly what the CLI is about to do to the working
 * tree, per file. A tool that can unstage your work owes you this screen.
 */
export function showDebrief(root: HTMLElement, data: DebriefData): void {
  const { outcome, reason, mission, surviving, lost, stashed } = data;
  const won = outcome === 'win';
  const headline = HEADLINE[reason];

  const screen = el('div', CSS.fullscreen);
  const panel = el('div', CSS.panel);

  panel.appendChild(el('div', CSS.label, headline.label));
  panel.appendChild(
    el(
      'div',
      `font-size:24px; margin:6px 0 14px; color:${headline.colour};`,
      won
        ? `Committed ${surviving.length} file${surviving.length === 1 ? '' : 's'}`
        : reason === 'empty-handed'
          ? 'You reached the commit tube empty-handed'
          : 'Nothing committed',
    ),
  );

  if (surviving.length) {
    panel.appendChild(el('div', CSS.label, 'shipped'));
    const list = el('div', 'margin:6px 0 14px; max-height:160px; overflow-y:auto;');
    for (const name of surviving) {
      list.appendChild(el('div', 'color:#c3d3d0;', `✓ ${name}`));
    }
    panel.appendChild(list);
  }

  if (stashed.length) {
    panel.appendChild(el('div', CSS.label, 'stashed — held back, still staged for next run'));
    const list = el('div', 'margin:6px 0 14px; max-height:120px; overflow-y:auto;');
    for (const name of stashed) {
      list.appendChild(el('div', 'color:#a78bfa;', `🗄 ${name}`));
    }
    panel.appendChild(list);
  }

  if (lost.length) {
    const verb = mission.difficulty === 'extreme' ? 'deleted from disk' : 'unstaged';
    panel.appendChild(el('div', CSS.label, `left behind — ${verb}`));
    const list = el('div', 'margin:6px 0 14px; max-height:160px; overflow-y:auto;');
    for (const name of lost) {
      list.appendChild(el('div', 'color:#f87171; text-decoration:line-through;', `✗ ${name}`));
    }
    panel.appendChild(list);
  }

  panel.appendChild(el('div', CSS.rule));
  panel.appendChild(
    el(
      'div',
      'color:#5c7180;',
      mission.sandbox
        ? 'Sandbox run — no git command was executed.'
        : 'Result sent to the CLI. You can close this window; check your terminal.',
    ),
  );

  screen.appendChild(panel);
  root.appendChild(screen);
  fadeIn(screen);
}

/**
 * Shown after a deliberate abort. Deliberately reassuring and specific: the
 * point of aborting is that nothing happened, so say nothing happened.
 */
export function showAborted(root: HTMLElement, mission: Mission): void {
  const screen = el('div', CSS.fullscreen);
  const panel = el('div', `${CSS.panel} min-width:min(420px, 88vw);`);

  panel.appendChild(el('div', CSS.label, 'run aborted'));
  panel.appendChild(el('div', 'font-size:22px; margin:6px 0 14px; color:#8fa3ae;', 'Nothing was changed'));
  panel.appendChild(
    el(
      'div',
      'color:#5c7180;',
      mission.sandbox
        ? 'Sandbox run — no git command was executed.'
        : 'No commit, no unstaging. Your index is exactly as you left it. You can close this window.',
    ),
  );

  screen.appendChild(panel);
  root.appendChild(screen);
  fadeIn(screen);
}
