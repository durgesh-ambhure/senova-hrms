import { CompanySettings, SETTINGS_KEY } from './companySettings.model.js';
import { diffFields, recordAudit } from '../audit/audit.service.js';

const FIELDS = [
  'legalName',
  'displayName',
  'contactEmail',
  'phone',
  'website',
  'address',
  'timezone',
  'currency',
  'dateFormat',
  'financialYearStartMonth',
  'employeeCodePrefix',
  'policies',
];

function toPublic(doc) {
  return { ...Object.fromEntries(FIELDS.map((f) => [f, doc[f]])), updatedAt: doc.updatedAt };
}

export async function getSettings() {
  // Not lean: hydrating applies schema defaults, so settings saved by an older release still get
  // fields added later (e.g. policies) without a data migration.
  const doc = await CompanySettings.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $setOnInsert: { key: SETTINGS_KEY } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  );
  return toPublic(doc.toObject());
}

export async function updateSettings(req, changes) {
  await getSettings();
  const doc = await CompanySettings.findOne({ key: SETTINGS_KEY });
  const before = doc.toObject();
  if (changes.address) {
    doc.address = { ...before.address, ...changes.address };
    delete changes.address;
  }
  if (changes.policies) {
    // Deep-merge each policy group so a partial update never resets other rules.
    for (const [group, values] of Object.entries(changes.policies)) {
      doc.policies[group] = { ...before.policies?.[group], ...values };
    }
    delete changes.policies;
  }
  Object.assign(doc, changes, { updatedBy: req.auth.user._id });
  await doc.save();
  await recordAudit(req, {
    action: 'company.updated',
    entityType: 'CompanySettings',
    entityId: SETTINGS_KEY,
    summary: 'Updated company settings',
    changes: diffFields(before, doc.toObject(), FIELDS),
  });
  return toPublic(doc.toObject());
}
