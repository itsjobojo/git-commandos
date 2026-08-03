import { el } from './overlay';
import type { Rng } from '../core/rng';

export type InviteChoice = 'accept' | 'decline';

const SUBJECTS = [
  'Quick sync on the sync',
  'Deep dive: Q3 alignment',
  'AI Strategy Working Group',
  '30 min to unblock',
  'Touch base re: touching base',
  'Innovation Hour (mandatory fun)',
  'Post-mortem pre-brief',
  'Weekly cadence alignment',
  'Kickoff for the kickoff',
  'Culture Committee: volunteers needed',
  'Alignment on the alignment doc',
  'Brief chat about your commits',
  'Retro on the retro format',
  'Optional (not optional)',
];

const ORGANIZERS = [
  'Chad Vinceth',
  'Brayden Culp',
  'Tiffany Mangold-Reyes',
  'Dave (Strategy)',
  'People Operations',
  'AI Center of Excellence',
  'Someone you have never met',
];

const LOCATIONS = [
  'Video call — link in the body',
  'Conf Rm — Synergy (4th floor)',
  'Zoom (link to follow)',
  'Wherever you are, honestly',
  'No location set',
];

/** Seconds before an ignored invite accepts itself. */
export const INVITE_TIMEOUT = 9;

/**
 * A meeting invite, in your face, mid-firefight.
 *
 * Styled as part of the game rather than as a replica of any real mail client
 * — a photoreal window pasted over a stylised 3D scene reads as a broken game,
 * not a joke, and no real product name or logo appears anywhere. Same palette
 * and typeface as everything else, and it stays compact and undimmed so you
 * can see the fight continuing underneath.
 *
 * The joke is that it's obstructive: the game does not pause, and ignoring it
 * does not make it go away — it accepts itself, which is exactly what happens
 * in real life. Declining is free but costs you the seconds it takes to find
 * the button while something is shooting at you.
 */
export function showInvite(
  root: HTMLElement,
  rng: Rng,
  onChoice: (choice: InviteChoice) => void,
): () => void {
  const subject = rng.pick(SUBJECTS);
  const organizer = rng.pick(ORGANIZERS);
  const location = rng.pick(LOCATIONS);
  const attendees = rng.int(9, 48);

  const shell = el(
    'div',
    `position:absolute; left:50%; top:34%; transform:translate(-50%,-50%) scale(.9);
     width:min(460px, 88vw); opacity:0;
     transition:opacity .16s ease, transform .16s cubic-bezier(.2,1.2,.4,1);
     background:rgba(8,12,17,.94); border:1px solid #2b4a6b; border-radius:3px;
     box-shadow:0 24px 70px rgba(0,0,0,.7), 0 0 0 1px rgba(96,165,250,.12),
                inset 0 1px 0 rgba(255,255,255,.04);
     font-family:var(--font-mono); color:var(--ink); overflow:hidden;`,
  );

  // Header. The mark is a generic envelope drawn in CSS, not anyone's logo.
  const bar = el(
    'div',
    `display:flex; align-items:center; gap:9px; padding:9px 12px;
     background:rgba(96,165,250,.1); border-bottom:1px solid #2b4a6b;`,
  );
  const mark = el(
    'div',
    `width:14px; height:12px; flex:none; border:1.5px solid #60a5fa; border-radius:1px;
     border-top-width:4px;`,
  );
  const barTitle = el(
    'div',
    `flex:1; font-size:10px; letter-spacing:.18em; text-transform:uppercase; color:#60a5fa;`,
    'Meeting invitation',
  );
  const close = el(
    'button',
    `width:22px; height:20px; border:0; background:transparent; color:#6b7d79; cursor:pointer;
     font-size:13px; line-height:1; font-family:inherit;`,
    '✕',
  );
  close.title = 'Decline';
  close.addEventListener('mouseenter', () => {
    close.style.color = '#f87171';
  });
  close.addEventListener('mouseleave', () => {
    close.style.color = '#6b7d79';
  });
  bar.append(mark, barTitle, close);

  const body = el('div', 'padding:16px 18px 4px;');
  body.appendChild(
    el('div', 'font-size:17px; line-height:1.35; color:#e6f1ee; margin-bottom:3px;', subject),
  );
  body.appendChild(el('div', 'font-size:12px; color:#5c7180; margin-bottom:13px;', organizer));

  const rows = el('div', 'font-size:12px; line-height:1.85;');
  for (const [label, value] of [
    ['when', 'now — 30 minutes'],
    ['where', location],
    ['required', `you and ${attendees} others`],
  ]) {
    const row = el('div', 'display:flex; gap:10px;');
    row.append(
      el('span', 'width:62px; color:#4b5c66; flex:none;', label),
      el('span', 'flex:1; color:#c3d3d0;', value),
    );
    rows.appendChild(row);
  }
  body.appendChild(rows);

  const note = el(
    'div',
    `margin-top:13px; padding:8px 10px; background:rgba(251,191,36,.09);
     border-left:2px solid #fbbf24; font-size:11px; color:#c9a44b;`,
  );
  const countdown = el('span', 'color:#fbbf24;', `${INVITE_TIMEOUT}s`);
  note.append(
    document.createTextNode('No response required. Accepting automatically in '),
    countdown,
    document.createTextNode('.'),
  );
  body.appendChild(note);

  const actions = el('div', 'display:flex; gap:8px; padding:14px 18px 16px; justify-content:flex-end;');
  const decline = gameButton('Decline', '#4ade80');
  const accept = gameButton('Accept', '#f87171');
  actions.append(decline, accept);

  shell.append(bar, body, actions);
  root.appendChild(shell);
  requestAnimationFrame(() => {
    shell.style.opacity = '1';
    shell.style.transform = 'translate(-50%,-50%) scale(1)';
  });

  let settled = false;
  let remaining = INVITE_TIMEOUT;
  const tick = setInterval(() => {
    remaining -= 1;
    countdown.textContent = `${Math.max(0, remaining)}s`;
    if (remaining <= 0) finish('accept');
  }, 1000);

  function finish(choice: InviteChoice): void {
    if (settled) return;
    settled = true;
    clearInterval(tick);
    shell.style.opacity = '0';
    shell.style.transform = 'translate(-50%,-50%) scale(.94)';
    setTimeout(() => shell.remove(), 180);
    onChoice(choice);
  }

  accept.addEventListener('click', () => finish('accept'));
  decline.addEventListener('click', () => finish('decline'));
  close.addEventListener('click', () => finish('decline'));

  // Caller's escape hatch, for teardown mid-run.
  return () => finish('decline');
}

/**
 * Declining is the good outcome, so it wears the good colour. Accepting drops
 * a mandatory meeting on your head — the button should look like a mistake.
 */
function gameButton(text: string, colour: string): HTMLButtonElement {
  const node = el(
    'button',
    `padding:7px 18px; border:1px solid ${colour}; border-radius:2px; cursor:pointer;
     background:transparent; color:${colour}; font:12px/1 var(--font-mono);
     letter-spacing:.12em; text-transform:uppercase;`,
    text,
  );
  node.addEventListener('mouseenter', () => {
    node.style.background = 'rgba(255,255,255,.07)';
  });
  node.addEventListener('mouseleave', () => {
    node.style.background = 'transparent';
  });
  return node;
}
