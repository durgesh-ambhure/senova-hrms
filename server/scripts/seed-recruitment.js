/**
 * Non-production recruitment demo: two open jobs and a handful of candidates spread across the
 * pipeline. Runs only when no job openings exist. Contact details use the reserved .test domain.
 */
import { Application, Candidate, CandidateActivity, JobOpening } from '../src/modules/recruitment/recruitment.models.js';
import { Department } from '../src/modules/organization/department.model.js';
import { Designation } from '../src/modules/organization/designation.model.js';
import { Employee } from '../src/modules/employees/employee.model.js';
import { nextSequence } from '../src/db/counter.model.js';
import { parseDateOnly } from '../src/shared/dates.js';

const CANDIDATES = [
  ['Aditi', 'Sharma', 'Software Engineer', 'Infosys', 3, ['Node.js', 'React', 'MongoDB'], 'linkedin', 'applied'],
  ['Karan', 'Mehta', 'Backend Developer', 'TCS', 5, ['Node.js', 'PostgreSQL'], 'job_board', 'screening'],
  ['Pooja', 'Iyer', 'Full-stack Engineer', 'Freshworks', 4, ['React', 'Node.js', 'AWS'], 'referral', 'shortlisted'],
  ['Rahul', 'Deshpande', 'Senior Engineer', 'Zoho', 7, ['Node.js', 'Kubernetes'], 'careers_site', 'interview'],
  ['Sana', 'Qureshi', 'HR Generalist', 'Wipro', 4, ['Recruiting', 'HR operations'], 'linkedin', 'screening'],
  ['Vivek', 'Rao', 'HR Executive', 'Accenture', 2, ['Payroll', 'Onboarding'], 'agency', 'applied'],
];

export async function seedRecruitmentData() {
  if (await JobOpening.exists({})) return;
  const [eng, hr] = await Promise.all([Department.findOne({ code: 'ENG' }).lean(), Department.findOne({ code: 'HR' }).lean()]);
  if (!eng || !hr) return;
  const [sse, hrExec, engMgr, hrMgr] = await Promise.all([
    Designation.findOne({ title: 'Senior Software Engineer' }).lean(),
    Designation.findOne({ title: 'HR Executive' }).lean(),
    Employee.findOne({ firstName: 'Vikram' }).lean(),
    Employee.findOne({ firstName: 'Kavita' }).lean(),
  ]);
  const today = new Date().toISOString().slice(0, 10);
  const mkJob = async (title, dept, designation, manager, skills, description) =>
    JobOpening.create({
      code: `REQ-${String(await nextSequence('jobCode')).padStart(4, '0')}`,
      title,
      department: dept._id,
      designation: designation?._id ?? null,
      hiringManager: manager?._id ?? null,
      employmentType: 'full_time',
      workLocation: 'Pune',
      openings: 2,
      requiredSkills: skills,
      description,
      status: 'open',
      openedOn: parseDateOnly(today),
    });
  const backend = await mkJob('Senior Backend Engineer', eng, sse, engMgr, ['Node.js', 'MongoDB', 'System design'], 'Own core services of the Senova platform.');
  const hrRole = await mkJob('HR Executive', hr, hrExec, hrMgr, ['Recruiting', 'Onboarding'], 'Run end-to-end hiring and joining formalities.');

  for (const [i, [firstName, lastName, title, company, years, skills, source, stage]] of CANDIDATES.entries()) {
    const c = await Candidate.create({
      firstName,
      lastName,
      email: `${firstName}.${lastName}@candidates.test`.toLowerCase(),
      phone: `+91 97${String(31000000 + i * 7121)}`,
      currentTitle: title,
      currentCompany: company,
      experienceYears: years,
      skills,
      source,
      location: 'Pune',
    });
    const job = skills.includes('Node.js') ? backend : hrRole;
    const order = ['applied', 'screening', 'shortlisted', 'interview'];
    const history = order.slice(0, order.indexOf(stage) + 1).map((to, k) => ({ from: k ? order[k - 1] : null, to, at: new Date(), byName: 'Seed' }));
    const app = await Application.create({ candidate: c._id, job: job._id, stage, source, stageHistory: history });
    await CandidateActivity.create({ candidate: c._id, application: app._id, type: 'system', body: `Seeded demo candidate for ${job.code}`, actorName: 'Seed' });
  }
  console.log('Seeded 2 demo job openings and 6 candidates.');
}
