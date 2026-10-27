/**
 * Application pipeline. Stage keys are fixed so reports and integrations stay stable; allowed
 * moves are enforced on the server (see DECISIONS R2 for configurability).
 *
 *  applied → screening → shortlisted → interview → selected → offer → hired
 *  Any active stage → rejected | withdrawn. Rejected/withdrawn can be reopened to screening.
 *  "offer" and "hired" are reached only through the offer workflow, never by a manual move.
 */
export const STAGES = ['applied', 'screening', 'shortlisted', 'interview', 'selected', 'offer', 'hired', 'rejected', 'withdrawn'];
export const ACTIVE_STAGES = ['applied', 'screening', 'shortlisted', 'interview', 'selected', 'offer'];
export const CLOSED_STAGES = ['hired', 'rejected', 'withdrawn'];

const exits = ['rejected', 'withdrawn'];
export const TRANSITIONS = {
  applied: ['screening', 'shortlisted', ...exits],
  screening: ['shortlisted', ...exits],
  shortlisted: ['interview', 'screening', ...exits],
  interview: ['selected', 'shortlisted', ...exits],
  selected: ['offer', 'interview', ...exits],
  offer: ['hired', 'selected', ...exits],
  hired: [],
  rejected: ['screening'],
  withdrawn: ['screening'],
};

/** Moves that only the offer workflow may make. */
export const SYSTEM_ONLY_TARGETS = new Set(['offer', 'hired']);

export function canMove(from, to, { system = false } = {}) {
  if (!TRANSITIONS[from]?.includes(to)) return false;
  if (SYSTEM_ONLY_TARGETS.has(to) && !system) return false;
  // Leaving the offer stage backwards is only allowed when the offer workflow does it (offer declined/withdrawn).
  if (from === 'offer' && to === 'selected' && !system) return false;
  return true;
}

export function manualTargets(from) {
  return (TRANSITIONS[from] ?? []).filter((to) => canMove(from, to));
}

/** Interviewer feedback summary: average rating and recommendation counts. */
export function summarizeFeedback(feedback) {
  if (!feedback.length) return { count: 0, averageRating: null, recommendations: {} };
  const recommendations = {};
  for (const f of feedback) recommendations[f.recommendation] = (recommendations[f.recommendation] ?? 0) + 1;
  const averageRating = Math.round((feedback.reduce((s, f) => s + f.rating, 0) / feedback.length) * 10) / 10;
  return { count: feedback.length, averageRating, recommendations };
}
