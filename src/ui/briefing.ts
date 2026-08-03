import { CSS, el, fadeIn, waitForKey } from './overlay';
import type { Mission } from '../game/mission';

/**
 * Mission briefing. Shows the real git state before anything is at risk —
 * repo, branch, message and the exact file manifest — so nobody is ever
 * surprised by what a run was playing for.
 */
export function showBriefing(root: HTMLElement, mission: Mission): Promise<void> {
  const screen = el('div', CSS.fullscreen);
  const panel = el('div', CSS.panel);

  const heading = mission.sandbox ? 'SANDBOX' : `gcmds ${mission.command}`;
  panel.appendChild(el('div', CSS.label, heading));
  panel.appendChild(
    el(
      'div',
      'font-size:22px; line-height:1.35; margin:6px 0 2px; color:#e6f1ee; word-break:break-word;',
      mission.commitMessage || '(no message)',
    ),
  );
  panel.appendChild(
    el(
      'div',
      'color:#5c7180;',
      `${mission.repo || 'repo'} · ${mission.branch} · +${mission.linesAdded} lines`,
    ),
  );

  panel.appendChild(el('div', CSS.rule));

  panel.appendChild(
    el('div', CSS.label, `cargo — ${mission.files.length} file${mission.files.length === 1 ? '' : 's'}`),
  );

  const list = el('div', 'margin:10px 0 4px; max-height:210px; overflow-y:auto;');
  for (const file of mission.files) {
    const row = el('div', 'display:flex; gap:12px; align-items:baseline; padding:2px 0;');
    row.appendChild(el('span', 'color:#4ade80;', '▪'));
    row.appendChild(
      el('span', 'flex:1; color:#c3d3d0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;', file.name),
    );
    if (file.added || file.removed) {
      row.appendChild(el('span', 'color:#4ade80; font-size:11px;', `+${file.added}`));
      row.appendChild(el('span', 'color:#f87171; font-size:11px;', `-${file.removed}`));
    }
    list.appendChild(row);
  }
  panel.appendChild(list);

  panel.appendChild(el('div', CSS.rule));

  const stakes = mission.sandbox
    ? 'Nothing is at stake. No git command will run.'
    : mission.difficulty === 'extreme'
      ? 'EXTREME — files you fail to extract are DELETED FROM DISK.'
      : 'Files you fail to extract are unstaged. Files you carry out get committed.';
  panel.appendChild(
    el(
      'div',
      `color:${mission.difficulty === 'extreme' && !mission.sandbox ? '#f87171' : '#8fa3ae'}; margin-bottom:14px;`,
      stakes,
    ),
  );

  panel.appendChild(
    el(
      'div',
      CSS.label,
      `objective — reach the beacon and hold it for ${mission.holdSeconds.toFixed(1)}s`,
    ),
  );

  const controls = el('div', 'display:flex; align-items:center; gap:16px; margin-top:20px;');
  const deploy = el(
    'button',
    `padding:9px 22px; border:1px solid #4ade80; border-radius:2px; cursor:pointer;
     background:rgba(74,222,128,.1); color:#4ade80; font:13px/1 var(--font-mono);
     letter-spacing:.1em; text-transform:uppercase;`,
    'Deploy',
  );
  deploy.addEventListener('mouseenter', () => {
    deploy.style.background = 'rgba(74,222,128,.2)';
  });
  deploy.addEventListener('mouseleave', () => {
    deploy.style.background = 'rgba(74,222,128,.1)';
  });

  const hint = el('div', 'color:#5c7180;');
  hint.innerHTML = `<span style="${CSS.key}">ENTER</span> &nbsp;·&nbsp; <span style="${CSS.key}">WASD</span> move &nbsp;·&nbsp; <span style="${CSS.key}">SPACE</span> dodge`;
  controls.append(deploy, hint);
  panel.appendChild(controls);

  screen.appendChild(panel);
  root.appendChild(screen);
  fadeIn(screen);

  return waitForKey(['Enter', 'NumpadEnter'], deploy).then(() => {
    screen.remove();
  });
}
