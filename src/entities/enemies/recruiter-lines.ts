/**
 * What the Recruiter says while it shoots at you.
 *
 * Tone target: a cold outreach that will not take no for an answer. The bros
 * are evangelising at you and the Interns want your time; the Recruiter wants
 * to *place* you, and the comedy is that it keeps pitching through a firefight.
 *
 * Same length rule as the bros — a bubble wraps around 25 characters, so
 * anything needing a subordinate clause gets cut down to the part that lands.
 */

/**
 * Said the moment it spots you. These have to work as an opening line from
 * someone who has just made eye contact across a car park.
 */
export const RECRUITER_OPENERS: readonly string[] = [
  'so tell me about yourself',
  "we're like a family here",
  "we're a fast-paced environment",
  'we offer a competitive salary',
  'we leverage AI across the org',
  'hybrid — 3 days in office',
  "we're looking for a 10x engineer",
  'the equity upside is significant',
  'lots of growth potential here',
  "we're AI-native from day one",
  'culture fit is important to us',
  'just a few interview rounds',
  "we're disrupting the space",
  'below market, but the mission',
  'we just closed our Series B',
  'a quick 15-min intro call?',
  "you'd be a founding engineer",
  "we don't really do titles here",
  'we are remote friendly',
  "let me check with the team",
  'are you open to opportunities?',
  'saw your profile — impressive',
  'is now a bad time?',
] as const;

/**
 * Said when it has heard something and is coming to look. These must read as
 * *searching* — the moment it can see you it switches to an opener, so anything
 * that assumes contact belongs in the list above.
 */
export const RECRUITER_HUNCHES: readonly string[] = [
  'was someone there?',
  'hello? just wanted to sync',
  'thought I saw an engineer',
  'are you still at your desk?',
  'just following up',
  'I know you got my message',
  'anyone in here?',
] as const;
