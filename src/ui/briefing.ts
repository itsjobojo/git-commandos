import { CSS, el, fadeIn, waitForKey } from './overlay';
import { LOGO } from '../assets/manifest';
import { MAX_HP, basename, type Mission } from '../game/mission';

interface Control {
  keys: string[];
  action: string;
  detail: string;
}

/**
 * Mission briefing — a title screen, not a document.
 *
 * It still has to state the real git stakes, because this is the last thing
 * between a staged working tree and a game that can unstage it. An earlier pass
 * answered that by writing all of it down, and ended up with three paragraphs
 * and a two-row outcome table stacked above the Deploy button. Nobody reads a
 * wall of text to start a game: they press the green button, and everything
 * they skipped may as well not have been written.
 *
 * So the screen reads like a dossier, not prose: labeled stat rows instead of
 * sentences, and the cargo as a manifest table — one row per file, the same
 * +/- a `git status` would show, because that is the one number a caller
 * cares about knowing before they mash Deploy. Anything that is mechanics
 * rather than stakes moved to the controls page — one keypress away, and
 * where somebody who actually wants the detail goes looking for it.
 */
export function showBriefing(root: HTMLElement, mission: Mission): Promise<void> {
  const screen = el('div', CSS.fullscreen);
  const panel = el('div', `${CSS.panel} max-height:92vh; overflow-y:auto; text-align:center;`);

  const logo = document.createElement('img');
  logo.src = LOGO;
  logo.alt = 'Git Commandos';
  logo.style.cssText = `
    display:block; width:min(240px, 48%); height:auto; margin:0 auto 10px;
    filter:drop-shadow(0 6px 18px rgba(0,0,0,.55));
  `;
  panel.appendChild(logo);

  // What this run is. The commit message is the only thing that tells one
  // deploy from the next, so it gets the biggest type under the logo.
  panel.appendChild(
    el(
      'div',
      'font-size:18px; line-height:1.3; color:#e6f1ee; word-break:break-word;',
      mission.commitMessage || '(no message)',
    ),
  );

  panel.appendChild(
    el(
      'div',
      'color:#5c7180; font-size:11px; margin-top:4px; letter-spacing:.03em;',
      [mission.sandbox ? 'sandbox' : `gcmds ${mission.command}`, mission.branch].join('  ·  '),
    ),
  );

  panel.appendChild(el('div', CSS.rule));

  panel.appendChild(
    el(
      'div',
      'color:#7dd3fc; font-size:14px; letter-spacing:.04em; text-transform:uppercase;',
      `Extract cargo  →  hold pad ${mission.holdSeconds.toFixed(1)}s`,
    ),
  );

  panel.appendChild(el('div', 'height:12px;'));
  panel.appendChild(manifest(mission));

  panel.appendChild(el('div', CSS.rule));
  panel.appendChild(stakes(mission));

  const deploy = button('Deploy', '#4ade80');
  const controlsButton = button('Controls', '#6b8394');
  const buttons = el(
    'div',
    'display:flex; align-items:center; gap:10px; margin-top:20px; justify-content:center;',
  );
  buttons.append(deploy, controlsButton);
  panel.appendChild(buttons);
  panel.appendChild(
    el('div', 'color:#42535e; font-size:11px; margin-top:10px;', 'ENTER to deploy · C for controls'),
  );

  // Built up front and swapped in, so opening it costs nothing and the backdrop
  // never flickers.
  const controlsPanel = controlsScreen(mission);
  controlsPanel.style.display = 'none';

  let showingControls = false;
  const toggleControls = (open: boolean): void => {
    showingControls = open;
    panel.style.display = open ? 'none' : '';
    controlsPanel.style.display = open ? '' : 'none';
  };

  controlsButton.addEventListener('click', () => toggleControls(true));
  controlsPanel.querySelector('button')?.addEventListener('click', () => toggleControls(false));

  const onKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyC' && !showingControls) {
      e.preventDefault();
      toggleControls(true);
    } else if ((e.code === 'Escape' || e.code === 'KeyC') && showingControls) {
      e.preventDefault();
      toggleControls(false);
    }
  };
  window.addEventListener('keydown', onKey);

  screen.append(panel, controlsPanel);
  root.appendChild(screen);
  fadeIn(screen);

  // Deploy stays deaf while the controls are up: the Enter meant to close a
  // sub-panel must never spend the user's staged work instead.
  return waitForKey(['Enter', 'NumpadEnter'], deploy, 300, () => !showingControls).then(() => {
    window.removeEventListener('keydown', onKey);
    screen.remove();
  });
}

/**
 * The cargo, as a manifest: one row per file, the same +/- a `git status`
 * would show. Full paths made a wall of text; the basename plus its line
 * delta is what a caller actually needs standing here, and the HUD names
 * crates the same way once the run starts.
 */
function manifest(mission: Mission): HTMLElement {
  const files = mission.files.length;
  const totalRemoved = mission.files.reduce((n, f) => n + f.removed, 0);

  const wrap = el('div', 'text-align:left;');
  const header = el(
    'div',
    'display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;',
  );
  header.appendChild(el('div', CSS.label, 'cargo manifest'));
  header.appendChild(
    el(
      'div',
      'color:#5c7180; font-size:11px;',
      `${files} file${files === 1 ? '' : 's'}  ·  +${mission.linesAdded} -${totalRemoved}`,
    ),
  );
  wrap.appendChild(header);

  const list = el(
    'div',
    `max-height:168px; overflow-y:auto; border:1px solid #17222a; border-radius:2px;`,
  );
  mission.files.forEach((file, i) => {
    const row = el(
      'div',
      `display:flex; align-items:center; gap:8px; padding:6px 9px;
       background:${i % 2 ? 'rgba(255,255,255,.015)' : 'transparent'};`,
    );
    row.appendChild(el('div', 'color:#7dd3fc; font-size:10px; flex:0 0 auto;', '▣'));
    row.appendChild(
      el(
        'div',
        `flex:1; min-width:0; color:#c3d3d0; font-size:13px;
         overflow:hidden; text-overflow:ellipsis; white-space:nowrap;`,
        basename(file.name),
      ),
    );
    row.appendChild(
      el(
        'div',
        `flex:0 0 40px; text-align:right; font-size:12px;
         color:${file.added ? '#4ade80' : '#3a4a52'};`,
        `+${file.added}`,
      ),
    );
    row.appendChild(
      el(
        'div',
        `flex:0 0 40px; text-align:right; font-size:12px;
         color:${file.removed ? '#f87171' : '#3a4a52'};`,
        `-${file.removed}`,
      ),
    );
    list.appendChild(row);
  });
  wrap.appendChild(list);

  return wrap;
}

/**
 * What git does, in one line.
 *
 * Both halves of it, because the losing half is the one that costs something
 * and the one nobody has thought about. Kept to a single line so it is read at
 * a glance instead of skipped as a block — which is the entire reason it is
 * here rather than in the paragraph it used to be.
 */
function stakes(mission: Mission): HTMLElement {
  const wrap = el('div', '');
  const line = el(
    'div',
    'display:flex; gap:8px; justify-content:center; flex-wrap:wrap;',
  );
  const extreme = mission.rules.loss === 'delete' && !mission.sandbox;
  const chip = (colour: string, text: string): HTMLElement =>
    el(
      'span',
      `display:inline-block; padding:4px 10px; border:1px solid ${colour}44; border-radius:2px;
       background:${colour}14; color:${colour}; font-size:11px; letter-spacing:.03em;
       text-transform:uppercase;`,
      text,
    );

  if (mission.sandbox) {
    line.appendChild(chip('#6b8394', 'Sandbox — no git command runs either way'));
  } else {
    line.append(
      chip('#4ade80', 'Carried out → committed'),
      chip(extreme ? '#f87171' : '#fbbf24', extreme ? 'Left behind → deleted' : 'Left behind → unstaged'),
    );
  }
  wrap.appendChild(line);

  const ruleNotes: string[] = [];
  if (mission.rules.death === 'health') ruleNotes.push(`${MAX_HP} hits and the run is lost`);
  if (mission.rules.death === 'fragile') ruleNotes.push('a hit while empty-handed kills you');
  if (mission.rules.stash === 'persist') ruleNotes.push('stashed cargo stays staged');
  if (mission.rules.stash === 'off') ruleNotes.push('no stash cache');
  if (ruleNotes.length) {
    const notes = el(
      'div',
      'display:flex; gap:8px; justify-content:center; flex-wrap:wrap; margin-top:8px;',
    );
    ruleNotes.forEach((note) => notes.appendChild(chip('#a78bfa', note)));
    wrap.appendChild(notes);
  }

  return wrap;
}

/**
 * The controls, and everything the front screen is better off without.
 *
 * The two mechanics that actually catch people out — that you start already
 * holding every file, and that being hit drops one — live here now. They are
 * things you want in the first ten seconds of a run, not things you want
 * before pressing Deploy.
 */
function controlsScreen(mission: Mission): HTMLElement {
  const panel = el('div', `${CSS.panel} max-height:92vh; overflow-y:auto;`);

  panel.appendChild(el('div', CSS.label, 'how a run goes'));
  panel.appendChild(
    el(
      'div',
      'color:#8fa3ae; margin:8px 0 2px;',
      'You deploy with the whole commit already on your back — there is nothing to find out there. ' +
        'Every hit knocks a file loose; get it back before it decays, or it stays in the wilderness.',
    ),
  );

  panel.appendChild(el('div', CSS.rule));
  panel.appendChild(el('div', CSS.label, 'controls'));

  const controls: Control[] = [
    { keys: ['W', 'A', 'S', 'D'], action: 'Move', detail: 'Carrying more cargo slows you down.' },
    { keys: ['MOUSE'], action: 'Aim', detail: 'The reticle is where the round lands, not where you face.' },
    { keys: ['LMB'], action: 'Fire', detail: 'Held for automatic weapons.' },
    { keys: ['SPACE'], action: 'Dodge roll', detail: 'Briefly invulnerable. The only way out of a crossfire.' },
    { keys: ['Q'], action: 'Drop cargo', detail: 'Deliberately. It decays on the ground like any loose file.' },
    ...(mission.rules.stash === 'off'
      ? []
      : [
          {
            keys: ['E'],
            action: 'Stash cargo',
            detail:
              mission.rules.stash === 'persist'
                ? 'At the cache. Stashed files stay staged for your next run.'
                : 'At the cache. Safe from the run, but it does not make the commit.',
          },
        ]),
    { keys: ['ESC'], action: 'Pause', detail: 'Quitting from the pause menu abandons the run and changes nothing.' },
  ];

  for (const control of controls) {
    const row = el('div', 'display:flex; gap:14px; align-items:baseline; padding:5px 0;');
    const keys = el('div', 'flex:0 0 132px; white-space:nowrap;');
    keys.innerHTML = control.keys.map((k) => `<span style="${CSS.key}">${k}</span>`).join('');
    row.appendChild(keys);
    const text = el('div', 'flex:1;');
    text.appendChild(el('div', 'color:#c3d3d0;', control.action));
    text.appendChild(el('div', 'color:#6b8394; font-size:12px;', control.detail));
    row.appendChild(text);
    panel.appendChild(row);
  }

  panel.appendChild(el('div', CSS.rule));
  const back = button('Back', '#6b8394');
  const row = el('div', 'display:flex; align-items:center; gap:14px;');
  row.appendChild(back);
  row.appendChild(el('div', 'color:#5c7180; font-size:11px;', 'ESC to go back'));
  panel.appendChild(row);

  return panel;
}

function button(label: string, colour: string): HTMLButtonElement {
  const node = el(
    'button',
    `padding:9px 22px; border:1px solid ${colour}; border-radius:2px; cursor:pointer;
     background:${colour}1a; color:${colour}; font:13px/1 var(--font-mono);
     letter-spacing:.1em; text-transform:uppercase;`,
    label,
  );
  node.addEventListener('mouseenter', () => {
    node.style.background = `${colour}33`;
  });
  node.addEventListener('mouseleave', () => {
    node.style.background = `${colour}1a`;
  });
  return node;
}
