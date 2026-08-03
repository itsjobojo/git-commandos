import { CSS, el, fadeIn } from './overlay';
import type { Mission } from '../game/mission';

export type PauseChoice = 'resume' | 'abort';

/**
 * Pause menu.
 *
 * Aborting is a first-class option, not something you do by closing the tab
 * and hoping. It states plainly that nothing will change, because the whole
 * anxiety of this tool is not knowing what it just did to your working tree.
 */
export function showPause(root: HTMLElement, mission: Mission): Promise<PauseChoice> {
  const screen = el('div', CSS.fullscreen);
  const panel = el('div', `${CSS.panel} min-width:min(420px, 88vw);`);

  panel.appendChild(el('div', CSS.label, 'paused'));
  panel.appendChild(
    el('div', 'font-size:20px; margin:6px 0 16px; color:#e6f1ee;', mission.commitMessage || 'Run paused'),
  );

  const buttons = el('div', 'display:flex; gap:10px; flex-wrap:wrap;');
  const resume = button('Resume', '#4ade80');
  const abort = button('Abort run', '#f87171');
  buttons.append(resume, abort);
  panel.appendChild(buttons);

  panel.appendChild(
    el(
      'div',
      'color:#5c7180; margin-top:14px;',
      mission.sandbox
        ? 'Nothing is at stake either way.'
        : 'Aborting changes nothing — no commit, no unstaging. Your index is left exactly as it is.',
    ),
  );

  screen.appendChild(panel);
  root.appendChild(screen);
  fadeIn(screen);

  return new Promise<PauseChoice>((resolve) => {
    const finish = (choice: PauseChoice): void => {
      window.removeEventListener('keydown', onKey);
      screen.remove();
      resolve(choice);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.code === 'Escape') {
        e.preventDefault();
        finish('resume');
      }
    };
    window.addEventListener('keydown', onKey);
    resume.addEventListener('click', () => finish('resume'));
    abort.addEventListener('click', () => finish('abort'));
  });
}

function button(text: string, colour: string): HTMLButtonElement {
  const node = el(
    'button',
    `padding:9px 20px; border:1px solid ${colour}; border-radius:2px; cursor:pointer;
     background:transparent; color:${colour}; font:13px/1 var(--font-mono);
     letter-spacing:.1em; text-transform:uppercase;`,
    text,
  );
  node.addEventListener('mouseenter', () => {
    node.style.background = 'rgba(255,255,255,.06)';
  });
  node.addEventListener('mouseleave', () => {
    node.style.background = 'transparent';
  });
  return node;
}
