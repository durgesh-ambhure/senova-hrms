import { Holiday } from './holiday.model.js';
import { getSettings } from '../company/company.service.js';
import { diffFields, recordAudit } from '../audit/audit.service.js';
import { conflict, notFound } from '../../shared/errors.js';
import { parseDateOnly, toDateOnly, todayIn } from '../../shared/dates.js';

const normalizeLocations = (locations = []) => [...new Set(locations.map((l) => l.trim()).filter(Boolean))];

export function toPublicHoliday(h) {
  return {
    id: String(h._id),
    date: toDateOnly(h.date),
    name: h.name,
    type: h.type,
    locations: h.locations,
    description: h.description,
  };
}

export async function listHolidays({ year, location }) {
  const filter = { year };
  if (location) filter.$or = [{ locations: { $size: 0 } }, { locations: { $regex: `^${location.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } }];
  const items = await Holiday.find(filter).sort({ date: 1 }).lean();
  return items.map(toPublicHoliday);
}

/** Holidays overlapping [from, to] as raw docs, for calendar calculations. */
export function holidaysBetween(from, to) {
  return Holiday.find({ date: { $gte: parseDateOnly(from), $lte: parseDateOnly(to) } }).lean();
}

export function appliesToLocation(holiday, location) {
  if (!holiday.locations?.length) return true;
  const loc = (location ?? '').trim().toLowerCase();
  return holiday.locations.some((l) => l.toLowerCase() === loc);
}

export async function createHoliday(req, input) {
  const date = parseDateOnly(input.date);
  if (await Holiday.exists({ date, name: input.name })) throw conflict('This holiday already exists on that date');
  const h = await Holiday.create({ ...input, date, locations: normalizeLocations(input.locations), createdBy: req.auth.user._id, updatedBy: req.auth.user._id });
  await recordAudit(req, { action: 'holiday.created', entityType: 'Holiday', entityId: h._id, summary: `Added holiday ${h.name} on ${input.date}` });
  return toPublicHoliday(h.toObject());
}

/** Past holidays have already shaped attendance and leave, so they are locked. */
async function assertEditable(h) {
  const today = todayIn((await getSettings()).timezone);
  if (toDateOnly(h.date) < today) throw conflict('Past holidays cannot be changed because attendance and leave already depend on them');
}

export async function updateHoliday(req, id, input) {
  const h = await Holiday.findById(id);
  if (!h) throw notFound('Holiday not found');
  await assertEditable(h);
  const before = h.toObject();
  if (input.date) {
    input.date = parseDateOnly(input.date);
    await assertEditable({ date: input.date });
  }
  if (input.locations) input.locations = normalizeLocations(input.locations);
  Object.assign(h, input, { updatedBy: req.auth.user._id });
  await h.save();
  await recordAudit(req, {
    action: 'holiday.updated',
    entityType: 'Holiday',
    entityId: h._id,
    summary: `Updated holiday ${h.name}`,
    changes: diffFields(before, h.toObject(), ['date', 'name', 'type', 'locations']),
  });
  return toPublicHoliday(h.toObject());
}

export async function deleteHoliday(req, id) {
  const h = await Holiday.findById(id);
  if (!h) throw notFound('Holiday not found');
  await assertEditable(h);
  await h.deleteOne();
  await recordAudit(req, { action: 'holiday.deleted', entityType: 'Holiday', entityId: id, summary: `Removed holiday ${h.name} (${toDateOnly(h.date)})` });
}
