import { PayrollRuleSet } from './payroll.models.js';
import { recordAudit } from '../audit/audit.service.js';
import { conflict, notFound, validationError } from '../../shared/errors.js';
import { paiseToRupees } from '../../shared/money.js';

const pct = (bp) => (bp === null || bp === undefined ? null : bp / 100);

export function toPublicRuleSet(r) {
  return {
    id: String(r._id),
    version: r.version,
    effectiveFrom: r.effectiveFrom,
    status: r.status,
    template: { basicPercentOfGross: pct(r.template.basicBpOfGross), hraPercentOfBasic: pct(r.template.hraBpOfBasic) },
    pf: { enabled: r.pf.enabled, employeePercent: pct(r.pf.employeeBp), employerPercent: pct(r.pf.employerBp), epsPercent: pct(r.pf.epsBp), wageCeiling: paiseToRupees(r.pf.wageCeilingPaise), epsCeiling: paiseToRupees(r.pf.epsCeilingPaise) },
    esi: { enabled: r.esi.enabled, employeePercent: pct(r.esi.employeeBp), employerPercent: pct(r.esi.employerBp), wageLimit: paiseToRupees(r.esi.wageLimitPaise) },
    pt: { enabled: r.pt.enabled, state: r.pt.state, slabs: r.pt.slabs.map((s) => ({ from: paiseToRupees(s.fromPaise), to: paiseToRupees(s.toPaise), monthly: paiseToRupees(s.monthlyPaise), february: paiseToRupees(s.februaryPaise) })) },
    gratuity: { percentOfBasic: pct(r.gratuity.bpOfBasic) },
    lop: { includeAbsence: r.lop.includeAbsence },
    notes: r.notes,
    verification: r.verification?.verifiedAt ? { verifiedByName: r.verification.verifiedByName, verifiedAt: r.verification.verifiedAt, reference: r.verification.reference } : null,
    updatedAt: r.updatedAt,
  };
}

/** API shape (rupees / percent) → stored shape (paise / basis points), merged onto `doc`. */
function applyInput(doc, input) {
  if (input.effectiveFrom) doc.effectiveFrom = input.effectiveFrom;
  const t = input.template ?? {};
  if (t.basicPercentOfGross !== undefined) doc.template.basicBpOfGross = t.basicPercentOfGross;
  if (t.hraPercentOfBasic !== undefined) doc.template.hraBpOfBasic = t.hraPercentOfBasic;
  const pf = input.pf ?? {};
  for (const [from, to] of [['enabled', 'enabled'], ['employeePercent', 'employeeBp'], ['employerPercent', 'employerBp'], ['epsPercent', 'epsBp'], ['wageCeiling', 'wageCeilingPaise'], ['epsCeiling', 'epsCeilingPaise']]) {
    if (pf[from] !== undefined) doc.pf[to] = pf[from];
  }
  const esi = input.esi ?? {};
  for (const [from, to] of [['enabled', 'enabled'], ['employeePercent', 'employeeBp'], ['employerPercent', 'employerBp'], ['wageLimit', 'wageLimitPaise']]) {
    if (esi[from] !== undefined) doc.esi[to] = esi[from];
  }
  const pt = input.pt ?? {};
  if (pt.enabled !== undefined) doc.pt.enabled = pt.enabled;
  if (pt.state !== undefined) doc.pt.state = pt.state;
  if (pt.slabs) doc.pt.slabs = pt.slabs.map((s) => ({ fromPaise: s.from, toPaise: s.to, monthlyPaise: s.monthly, februaryPaise: s.february ?? null }));
  if (input.gratuity?.percentOfBasic !== undefined) doc.gratuity.bpOfBasic = input.gratuity.percentOfBasic;
  if (input.lop?.includeAbsence !== undefined) doc.lop.includeAbsence = input.lop.includeAbsence;
  if (input.notes !== undefined) doc.notes = input.notes;
}

/** Internal consistency only; whether values are legally correct is for the CA to confirm. */
function assertConsistent(doc) {
  const issues = [];
  if (doc.pf.enabled && (!doc.pf.employeeBp || !doc.pf.employerBp || !doc.pf.wageCeilingPaise)) issues.push({ path: 'pf', message: 'Enter PF rates and the wage ceiling, or disable PF' });
  if (doc.pf.enabled && doc.pf.epsBp > doc.pf.employerBp) issues.push({ path: 'pf.epsPercent', message: 'The pension share cannot exceed the employer rate' });
  if (doc.esi.enabled && (!doc.esi.employeeBp || !doc.esi.employerBp || !doc.esi.wageLimitPaise)) issues.push({ path: 'esi', message: 'Enter ESI rates and the wage limit, or disable ESI' });
  if (doc.pt.enabled) {
    const slabs = [...doc.pt.slabs].sort((a, b) => a.fromPaise - b.fromPaise);
    if (!slabs.length) issues.push({ path: 'pt.slabs', message: 'Add at least one professional tax slab, or disable PT' });
    slabs.forEach((s, i) => {
      if (s.toPaise !== null && s.toPaise < s.fromPaise) issues.push({ path: `pt.slabs.${i}`, message: 'Slab "to" is below "from"' });
      const next = slabs[i + 1];
      if (next && (s.toPaise === null || next.fromPaise <= s.toPaise)) issues.push({ path: `pt.slabs.${i}`, message: 'Slabs overlap' });
    });
    doc.pt.slabs = slabs;
  }
  if (issues.length) throw validationError(issues);
}

export async function listRuleSets() {
  return (await PayrollRuleSet.find().sort({ version: -1 }).lean()).map(toPublicRuleSet);
}

/** New draft, copied from the latest version so only differences need entering. */
export async function createDraft(req, input) {
  if (await PayrollRuleSet.exists({ status: 'draft' })) throw conflict('Finish or activate the existing draft first');
  const latest = await PayrollRuleSet.findOne().sort({ version: -1 }).lean();
  const { _id: _ignore, verification: _v, createdAt: _c, updatedAt: _u, ...base } = latest ?? {};
  const doc = new PayrollRuleSet({ ...base, version: (latest?.version ?? 0) + 1, status: 'draft', effectiveFrom: input.effectiveFrom ?? latest?.effectiveFrom, createdBy: req.auth.user._id });
  applyInput(doc, input);
  if (!doc.effectiveFrom) throw validationError([{ path: 'effectiveFrom', message: 'Choose the first payroll month this applies to' }]);
  assertConsistent(doc);
  await doc.save();
  await recordAudit(req, { action: 'payroll.rules_drafted', entityType: 'PayrollRuleSet', entityId: doc._id, summary: `Drafted payroll rules v${doc.version}` });
  return toPublicRuleSet(doc.toObject());
}

export async function updateDraft(req, id, input) {
  const doc = await PayrollRuleSet.findById(id);
  if (!doc) throw notFound('Rule set not found');
  if (doc.status !== 'draft') throw conflict('Active rule sets cannot be changed; create a new version');
  applyInput(doc, input);
  assertConsistent(doc);
  doc.verification = {};
  doc.updatedBy = req.auth.user._id;
  await doc.save();
  await recordAudit(req, { action: 'payroll.rules_updated', entityType: 'PayrollRuleSet', entityId: doc._id, summary: `Edited payroll rules v${doc.version}` });
  return toPublicRuleSet(doc.toObject());
}

export async function activate(req, id) {
  const doc = await PayrollRuleSet.findOneAndUpdate({ _id: id, status: 'draft' }, { status: 'active', updatedBy: req.auth.user._id }, { returnDocument: 'after' });
  if (!doc) throw conflict('Only a draft can be activated');
  await recordAudit(req, { action: 'payroll.rules_activated', entityType: 'PayrollRuleSet', entityId: doc._id, summary: `Activated payroll rules v${doc.version} from ${doc.effectiveFrom}` });
  return toPublicRuleSet(doc.toObject());
}

/** Records that a qualified professional confirmed the values (required before finalizing payroll). */
export async function verify(req, id, { reference }) {
  const doc = await PayrollRuleSet.findById(id);
  if (!doc) throw notFound('Rule set not found');
  doc.verification = { verifiedBy: req.auth.user._id, verifiedByName: req.auth.user.name, verifiedAt: new Date(), reference };
  await doc.save();
  await recordAudit(req, { action: 'payroll.rules_verified', entityType: 'PayrollRuleSet', entityId: doc._id, summary: `Marked payroll rules v${doc.version} as verified: ${reference}` });
  return toPublicRuleSet(doc.toObject());
}

/** The active rule set for a payroll month: the latest one whose effectiveFrom is on or before it. */
export async function rulesForMonth(month, session) {
  return PayrollRuleSet.findOne({ status: 'active', effectiveFrom: { $lte: month } }).sort({ effectiveFrom: -1, version: -1 }).session(session ?? null).lean();
}

export async function latestActiveRules() {
  return PayrollRuleSet.findOne({ status: 'active' }).sort({ effectiveFrom: -1, version: -1 }).lean();
}
