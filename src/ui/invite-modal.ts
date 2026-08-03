import { el } from './overlay';
import { outlookIconDataUrl } from './outlook-icon';
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
  'Culture Committee: Volunteers Needed',
];

const ORGANIZERS = [
  'Chad Vinceth',
  'Brayden Culp',
  'Tiffany Mangold-Reyes',
  'Dave (Strategy)',
  'People Operations',
  'AI Center of Excellence',
];

const LOCATIONS = [
  'Microsoft Teams Meeting',
  'Conf Rm — Synergy (4th floor)',
  'Zoom (link to follow)',
  'Wherever you are, honestly',
];

/** Seconds before an ignored invite accepts itself. */
export const INVITE_TIMEOUT = 9;

/**
 * An Outlook meeting invite, in your face, mid-firefight.
 *
 * The joke only works if it's genuinely obstructive: it sits on top of
 * everything, the game keeps running underneath, and ignoring it does not make
 * it go away — it accepts itself, which is exactly what happens in real life.
 * Declining is free but costs you the seconds it takes to find the button
 * while something is shooting at you.
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
    `position:absolute; left:50%; top:44%; transform:translate(-50%,-50%) scale(.86);
     width:min(560px, 92vw); opacity:0;
     transition:opacity .16s ease, transform .16s cubic-bezier(.2,1.2,.4,1);
     background:#faf9f8; color:#201f1e; border-radius:8px;
     box-shadow:0 28px 90px rgba(0,0,0,.75), 0 0 0 1px rgba(0,0,0,.25);
     font-family:'Segoe UI', system-ui, -apple-system, sans-serif; overflow:hidden;`,
  );

  // Title bar.
  const bar = el(
    'div',
    `display:flex; align-items:center; gap:10px; padding:10px 12px;
     background:#0f6cbd; color:#fff; font-size:13px;`,
  );
  const icon = el('img', 'width:22px; height:22px; display:block; border-radius:4px;') as HTMLImageElement;
  icon.src = outlookIconDataUrl(64);
  icon.alt = 'Outlook';
  const barTitle = el('div', 'flex:1; font-weight:600;', 'Meeting invitation');
  const close = el(
    'button',
    `width:30px; height:24px; border:0; background:transparent; color:#fff; cursor:pointer;
     font-size:15px; line-height:1; border-radius:3px;`,
    '✕',
  );
  close.title = 'Decline';
  close.addEventListener('mouseenter', () => {
    close.style.background = '#c42b1c';
  });
  close.addEventListener('mouseleave', () => {
    close.style.background = 'transparent';
  });
  bar.append(icon, barTitle, close);

  // Body.
  const body = el('div', 'padding:18px 20px 6px;');
  body.appendChild(
    el('div', 'font-size:19px; font-weight:600; line-height:1.3; margin-bottom:4px;', subject),
  );
  body.appendChild(
    el('div', 'font-size:13px; color:#605e5c; margin-bottom:14px;', `${organizer} is inviting you`),
  );

  const rows = el('div', 'font-size:13px; line-height:1.9; color:#323130;');
  for (const [label, value] of [
    ['When', 'Now — 30 minutes'],
    ['Where', location],
    ['Required', `You and ${attendees} others`],
  ]) {
    const row = el('div', 'display:flex; gap:12px;');
    row.append(
      el('span', 'width:70px; color:#605e5c; flex:none;', label),
      el('span', 'flex:1;', value),
    );
    rows.appendChild(row);
  }
  body.appendChild(rows);

  const note = el(
    'div',
    `margin:14px 0 0; padding:10px 12px; background:#fff4ce; border-left:3px solid #f2c811;
     font-size:12px; color:#3b3a39;`,
  );
  const countdown = el('span', 'font-weight:600;', `${INVITE_TIMEOUT}`);
  note.append(
    document.createTextNode('No response required. Accepting automatically in '),
    countdown,
    document.createTextNode('s.'),
  );
  body.appendChild(note);

  // Buttons.
  const actions = el(
    'div',
    'display:flex; gap:8px; padding:16px 20px 18px; justify-content:flex-end;',
  );
  const accept = el(
    'button',
    `padding:8px 20px; border:0; border-radius:4px; background:#0f6cbd; color:#fff;
     font-size:13px; font-weight:600; cursor:pointer; font-family:inherit;`,
    'Accept',
  );
  const decline = el(
    'button',
    `padding:8px 20px; border:1px solid #8a8886; border-radius:4px; background:#fff;
     color:#201f1e; font-size:13px; cursor:pointer; font-family:inherit;`,
    'Decline',
  );
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
    countdown.textContent = `${Math.max(0, remaining)}`;
    if (remaining <= 0) finish('accept');
  }, 1000);

  function finish(choice: InviteChoice): void {
    if (settled) return;
    settled = true;
    clearInterval(tick);
    shell.style.opacity = '0';
    shell.style.transform = 'translate(-50%,-50%) scale(.9)';
    setTimeout(() => shell.remove(), 180);
    onChoice(choice);
  }

  accept.addEventListener('click', () => finish('accept'));
  decline.addEventListener('click', () => finish('decline'));
  close.addEventListener('click', () => finish('decline'));

  // Caller's escape hatch, for teardown mid-run.
  return () => finish('decline');
}
