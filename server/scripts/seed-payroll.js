/**
 * Non-production payroll demo: one ACTIVE but UNVERIFIED rule set with EXAMPLE values, and salaries
 * for the demo employees. The example values are placeholders to make the demo work — they are not
 * a statement of current law. Finalizing payroll stays blocked until someone records verification.
 */
import { PayrollRuleSet, SalaryRevision, SalaryStructure } from '../src/modules/payroll/payroll.models.js';
import { salaryBreakdown } from '../src/modules/payroll/payroll.engine.js';
import { Employee } from '../src/modules/employees/employee.model.js';

const CTC_BY_DESIGNATION = {
  'Head of Operations': 4_200_000,
  'Engineering Manager': 3_600_000,
  'HR Manager': 2_400_000,
  'Senior Software Engineer': 2_200_000,
  'Software Engineer': 1_200_000,
  Accountant: 900_000,
  'Sales Executive': 600_000,
  'HR Executive': 500_000,
  Intern: 240_000,
};

export async function seedPayrollData() {
  if (await PayrollRuleSet.exists({})) return;
  const now = new Date();
  const start = `${now.getUTCFullYear() - 1}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const rules = await PayrollRuleSet.create({
    version: 1,
    effectiveFrom: start,
    status: 'active',
    template: { basicBpOfGross: 5000, hraBpOfBasic: 4000 },
    pf: { enabled: true, employeeBp: 1200, employerBp: 1200, epsBp: 833, wageCeilingPaise: 1_500_000, epsCeilingPaise: 1_500_000 },
    esi: { enabled: true, employeeBp: 75, employerBp: 325, wageLimitPaise: 2_100_000 },
    pt: {
      enabled: true,
      state: 'MH',
      slabs: [
        { fromPaise: 0, toPaise: 750_000, monthlyPaise: 0, februaryPaise: null },
        { fromPaise: 750_001, toPaise: 1_000_000, monthlyPaise: 17_500, februaryPaise: null },
        { fromPaise: 1_000_001, toPaise: null, monthlyPaise: 20_000, februaryPaise: 30_000 },
      ],
    },
    notes: 'DEMO EXAMPLE VALUES — NOT VERIFIED. Replace with figures confirmed by your CA before any real payroll.',
  });

  const employees = await Employee.find({ archivedAt: null }).populate('designation', 'title').lean();
  let count = 0;
  for (const e of employees) {
    if (await SalaryRevision.exists({ employee: e._id })) continue;
    const annualCtcPaise = (CTC_BY_DESIGNATION[e.designation?.title] ?? 800_000) * 100;
    const input = { annualCtcPaise, basicBpOfGross: null, hraBpOfBasic: null, fixedAllowances: [], pfApplicable: true, pfOnFullWage: false };
    const r = await SalaryRevision.create({ ...input, employee: e._id, revisionNo: 1, effectiveFrom: e.joiningDate, breakdown: salaryBreakdown({ ...input, rules }), ruleVersion: 1, reason: 'Demo joining salary', createdByName: 'Seed' });
    await SalaryStructure.create({ employee: e._id, currentRevision: r._id, annualCtcPaise, effectiveFrom: e.joiningDate });
    count += 1;
  }
  console.log(`Seeded demo payroll rules (UNVERIFIED example values) and ${count} salaries.`);
}
