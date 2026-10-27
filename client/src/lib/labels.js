/** Display labels for server enums. Keep in sync with the server models. */
export const ROLE_LABELS = {
  super_admin: 'Super Admin',
  hr_admin: 'HR Admin',
  payroll_admin: 'Payroll Admin',
  manager: 'Manager',
  recruiter: 'Recruiter',
  employee: 'Employee',
};
export const EMPLOYMENT_TYPES = {
  full_time: 'Full-time',
  part_time: 'Part-time',
  contract: 'Contract',
  intern: 'Intern',
  consultant: 'Consultant',
};

export const LIFECYCLE = {
  pre_joining: { label: 'Pre-joining', tone: 'brand' },
  active: { label: 'Active', tone: 'success' },
  notice_period: { label: 'Notice period', tone: 'warning' },
  exited: { label: 'Exited', tone: 'neutral' },
};

export const PROBATION = {
  not_applicable: 'Not applicable',
  on_probation: 'On probation',
  extended: 'Extended',
  confirmed: 'Confirmed',
};

export const GENDERS = { female: 'Female', male: 'Male', non_binary: 'Non-binary', prefer_not_to_say: 'Prefer not to say' };

export const DOCUMENT_CATEGORIES = {
  identity: 'Identity proof',
  address_proof: 'Address proof',
  education: 'Education',
  experience: 'Experience / previous employment',
  offer_letter: 'Offer letter',
  appointment_letter: 'Appointment letter',
  relieving_letter: 'Relieving letter',
  bank_proof: 'Bank proof',
  photo: 'Photograph',
  other: 'Other',
};

export const DOCUMENT_STATUS = {
  pending: { label: 'Pending review', tone: 'warning' },
  verified: { label: 'Verified', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
};

export const ASSIGNEE_TYPES = { employee: 'Employee', manager: 'Manager', hr: 'HR' };

export const TASK_STATUS = {
  pending: { label: 'Pending', tone: 'warning' },
  completed: { label: 'Completed', tone: 'success' },
  waived: { label: 'Waived', tone: 'neutral' },
};

export const EVENT_LABELS = {
  created: 'Record created',
  joined: 'Joined',
  department_changed: 'Department changed',
  designation_changed: 'Designation changed',
  manager_changed: 'Reporting manager changed',
  employment_type_changed: 'Employment type changed',
  location_changed: 'Work location changed',
  probation_confirmed: 'Probation confirmed',
  probation_extended: 'Probation extended',
  notice_started: 'Notice period started',
  notice_withdrawn: 'Resignation withdrawn',
  exited: 'Exited',
  archived: 'Archived',
  restored: 'Restored',
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const ATTENDANCE_KIND = {
  present: { label: 'Present', tone: 'success' },
  half_day: { label: 'Half day', tone: 'warning' },
  absent: { label: 'Absent', tone: 'danger' },
  incomplete: { label: 'Missing punch', tone: 'danger' },
  leave: { label: 'Leave', tone: 'brand' },
  holiday: { label: 'Holiday', tone: 'accent' },
  weekly_off: { label: 'Weekly off', tone: 'neutral' },
  today: { label: 'Today', tone: 'brand' },
  upcoming: { label: '—', tone: 'neutral' },
  not_employed: { label: '—', tone: 'neutral' },
};

export const REQUEST_STATUS = {
  pending: { label: 'Pending', tone: 'warning' },
  approved: { label: 'Approved', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  cancellation_requested: { label: 'Cancellation requested', tone: 'warning' },
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Submitted', tone: 'warning' },
};

export const HOLIDAY_TYPES = { public: 'Public holiday', company: 'Company holiday', optional: 'Optional holiday' };

export const STAGES = {
  applied: { label: 'Applied', tone: 'neutral' },
  screening: { label: 'Screening', tone: 'brand' },
  shortlisted: { label: 'Shortlisted', tone: 'brand' },
  interview: { label: 'Interview', tone: 'accent' },
  selected: { label: 'Selected', tone: 'success' },
  offer: { label: 'Offer', tone: 'warning' },
  hired: { label: 'Hired', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};
export const ACTIVE_STAGE_KEYS = ['applied', 'screening', 'shortlisted', 'interview', 'selected', 'offer'];

export const JOB_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  open: { label: 'Open', tone: 'success' },
  on_hold: { label: 'On hold', tone: 'warning' },
  closed: { label: 'Closed', tone: 'neutral' },
  filled: { label: 'Filled', tone: 'brand' },
};
export const JOB_TRANSITIONS = { draft: ['open', 'closed'], open: ['on_hold', 'closed', 'filled'], on_hold: ['open', 'closed'], closed: ['open'], filled: ['open', 'closed'] };

export const CANDIDATE_SOURCES = {
  careers_site: 'Careers site',
  referral: 'Employee referral',
  linkedin: 'LinkedIn',
  job_board: 'Job board',
  agency: 'Agency',
  campus: 'Campus',
  walk_in: 'Walk-in',
  other: 'Other',
};

export const INTERVIEW_MODES = { in_person: 'In person', video: 'Video call', phone: 'Phone' };
export const RECOMMENDATIONS = { strong_yes: 'Strong hire', yes: 'Hire', no: 'No hire', strong_no: 'Strong no' };

export const OFFER_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  pending_approval: { label: 'Awaiting approval', tone: 'warning' },
  approved: { label: 'Approved', tone: 'brand' },
  rejected: { label: 'Changes requested', tone: 'danger' },
  sent: { label: 'Sent', tone: 'accent' },
  accepted: { label: 'Accepted', tone: 'success' },
  declined: { label: 'Declined', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

export const RUN_STATUS = {
  draft: { label: 'Draft', tone: 'neutral' },
  calculated: { label: 'Calculated', tone: 'brand' },
  under_review: { label: 'Under review', tone: 'warning' },
  approved: { label: 'Approved', tone: 'accent' },
  finalized: { label: 'Finalized', tone: 'success' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};
export const RUN_STEPS = ['draft', 'calculated', 'under_review', 'approved', 'finalized'];
