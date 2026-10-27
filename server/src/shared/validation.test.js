import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { updateSchemaFrom } from './validation.js';
import { signedInAs } from '../../test/helpers.js';
import { addDays, todayIn } from './dates.js';

describe('updateSchemaFrom (unit)', () => {
  it('never fills in create-time defaults on partial updates', () => {
    const create = z.object({ name: z.string(), level: z.number().default(1), tags: z.array(z.string()).default([]) });
    const update = updateSchemaFrom(create, { extend: { status: z.enum(['active', 'archived']) } });
    expect(update.parse({ status: 'archived' })).toEqual({ status: 'archived' });
    expect(update.parse({ level: 3 })).toEqual({ level: 3 });
    expect(update.safeParse({}).success).toBe(false);
  });
});

// Regression: PATCHing one field must not reset the others to their defaults.
describe('partial updates keep untouched fields', () => {
  it('shifts, leave types, holidays, departments and projects', async () => {
    const { client: hr } = await signedInAs(['hr_admin']);
    const n = Date.now() % 100000;

    const shift = (await hr.post('/api/v1/shifts').send({ name: 'Six-day', code: `SD${n}`, startTime: '08:00', endTime: '17:00', lateGraceMinutes: 5, weeklyOffs: [0] })).body.data;
    const shiftAfter = (await hr.patch(`/api/v1/shifts/${shift.id}`).send({ name: 'Six-day shift' })).body.data;
    expect(shiftAfter).toMatchObject({ lateGraceMinutes: 5, weeklyOffs: [0], startTime: '08:00' });

    const type = (await hr.post('/api/v1/leave/types').send({ name: 'Study', code: `ST${n}`, annualQuotaDays: 5, paid: false, allowHalfDay: false, accrual: 'annual' })).body.data;
    const typeAfter = (await hr.patch(`/api/v1/leave/types/${type.id}`).send({ status: 'archived' })).body.data;
    expect(typeAfter).toMatchObject({ status: 'archived', annualQuotaDays: 5, paid: false, allowHalfDay: false, accrual: 'annual' });

    const date = addDays(todayIn('Asia/Kolkata'), 40);
    const holiday = (await hr.post('/api/v1/holidays').send({ date, name: `Local fest ${n}`, type: 'optional', locations: ['Pune'] })).body.data;
    const holidayAfter = (await hr.patch(`/api/v1/holidays/${holiday.id}`).send({ name: `Local festival ${n}` })).body.data;
    expect(holidayAfter).toMatchObject({ type: 'optional', locations: ['Pune'] });

    const dept = (await hr.post('/api/v1/departments').send({ name: `Research ${n}`, code: `RS${n}`, description: 'R&D' })).body.data;
    expect((await hr.patch(`/api/v1/departments/${dept.id}`).send({ name: `Research & Dev ${n}` })).body.data.description).toBe('R&D');

    const project = (await hr.post('/api/v1/timesheets/projects').send({ name: 'Atlas', code: `AT${n}`, description: 'Migration' })).body.data;
    expect((await hr.patch(`/api/v1/timesheets/projects/${project.id}`).send({ status: 'archived' })).body.data.description).toBe('Migration');
  });
});
