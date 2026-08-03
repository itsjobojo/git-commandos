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

  const extreme = mission.rules.loss === 'delete' && !mission.sandbox;
  const stakes = mission.sandbox
    ? 'Nothing is at stake. No git command will run.'
    : extreme
      ? 'EXTREME — cargo you fail to extract is DELETED FROM DISK.'
      : 'Cargo you carry out gets committed. Cargo you leave behind is unstaged.';
  panel.appendChild(
    el('div', `color:${extreme ? '#f87171' : '#8fa3ae'}; margin-bottom:10px;`, stakes),
  );

  // Spell out the rules that are not the default, so a run never surprises you.
  const ruleNotes: string[] = [];
  if (mission.rules.death === 'health') ruleNotes.push('4 hits and the run is lost outright');
  if (mission.rules.death === 'fragile') ruleNotes.push('a hit while empty-handed kills you');
  if (mission.rules.stash === 'persist') ruleNotes.push('cargo left in the stash stays staged for next run');
  if (mission.rules.stash === 'off') ruleNotes.push('no stash cache on this map');
  if (ruleNotes.length) {
    panel.appendChild(
      el('div', 'color:#a78bfa; margin-bottom:14px;', `Rules: ${ruleNotes.join(' · ')}`),
    );
  }

  // You land with the whole commit already on your back — the run is carrying
  // it out, not finding it. The old copy described a collect-the-crates game
  // that no longer exists and sent people hunting the map for cargo they were
  // already holding.
  panel.appendChild(
    el(
      'div',
      CSS.label,
      `objective — carry the cargo to the beacon and hold it for ${mission.holdSeconds.toFixed(1)}s`,
    ),
  );
  panel.appendChild(
    el(
      'div',
      'color:#8fa3ae; margin-top:4px;',
      'You deploy with every file already on your back. Taking a hit knocks one loose — ' +
        'pick it back up before it decays, or it does not make the commit.',
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

  // Firing and pausing were missing entirely — this is the only place the
  // controls are ever shown, so anything left off it is undiscoverable.
  const hint = el('div', 'color:#8fa3ae; display:flex; flex-wrap:wrap; gap:4px 14px; align-items:center;');
  hint.innerHTML = [
    `<span style="${CSS.key}">WASD</span> move`,
    `<span style="${CSS.key}">MOUSE</span> aim`,
    `<span style="${CSS.key}">LMB</span> fire`,
    `<span style="${CSS.key}">SPACE</span> dodge`,
    `<span style="${CSS.key}">Q</span> drop`,
    ...(mission.rules.stash === 'off' ? [] : [`<span style="${CSS.key}">E</span> stash`]),
    `<span style="${CSS.key}">ESC</span> pause`,
  ].join('');
  controls.append(deploy, hint);
  panel.appendChild(controls);

  screen.appendChild(panel);
  root.appendChild(screen);
  fadeIn(screen);

  return waitForKey(['Enter', 'NumpadEnter'], deploy).then(() => {
    screen.remove();
  });
}
