import { CSS, el, fadeIn } from './overlay';
import type { Mission } from '../game/mission';
import type { Outcome } from '../net/protocol';

export interface DebriefData {
  outcome: Outcome;
  mission: Mission;
  surviving: string[];
  lost: string[];
}

/**
 * Post-run debrief. States exactly what the CLI is about to do to the working
 * tree, per file. A tool that can unstage your work owes you this screen.
 */
export function showDebrief(root: HTMLElement, data: DebriefData): void {
  const { outcome, mission, surviving, lost } = data;
  const won = outcome === 'win';

  const screen = el('div', CSS.fullscreen);
  const panel = el('div', CSS.panel);

  panel.appendChild(el('div', CSS.label, won ? 'extraction complete' : 'mission failed'));
  panel.appendChild(
    el(
      'div',
      `font-size:24px; margin:6px 0 14px; color:${won ? '#4ade80' : '#f87171'};`,
      won ? `Committed ${surviving.length} file${surviving.length === 1 ? '' : 's'}` : 'Nothing committed',
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
