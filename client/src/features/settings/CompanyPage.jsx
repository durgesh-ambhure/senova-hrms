import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useAuth } from '../auth/AuthProvider.jsx';
import { useCompany, useUpdateCompany } from './api.js';
import { applyFieldErrors } from '../../lib/api.js';
import { Alert, Button, Card, CardHeader, ErrorState, Input, PageHeader, PageLoader, Select, useToast } from '../../components/ui/index.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const TIMEZONES = ['Asia/Kolkata', 'Asia/Dubai', 'Asia/Singapore', 'Europe/London', 'America/New_York', 'UTC'];

const optionalEmail = z.union([z.literal(''), z.string().trim().pipe(z.email('Enter a valid email address'))]);
const optionalUrl = z.union([z.literal(''), z.url('Enter a full URL, e.g. https://example.com')]);

const schema = z.object({
  legalName: z.string().trim().min(2, 'Legal name is required').max(200),
  displayName: z.string().trim().min(2, 'Display name is required').max(80),
  contactEmail: optionalEmail,
  phone: z.string().trim().max(30),
  website: optionalUrl,
  address: z.object({
    line1: z.string().trim().max(200),
    line2: z.string().trim().max(200),
    city: z.string().trim().max(100),
    state: z.string().trim().max(100),
    postalCode: z.string().trim().max(20),
    country: z.string().trim().max(100),
  }),
  timezone: z.string().min(1),
  dateFormat: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']),
  financialYearStartMonth: z.coerce.number().int().min(1).max(12),
  employeeCodePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2,10}$/, '2–10 letters'),
});

export function CompanyPage() {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('company:manage');
  const company = useCompany();
  const update = useUpdateCompany();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (company.data) reset(company.data);
  }, [company.data, reset]);

  if (company.isLoading) return <PageLoader label="Loading company settings" />;
  if (company.error) return <ErrorState error={company.error} onRetry={company.refetch} />;

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync(values);
      reset(saved);
      toast.success('Company settings saved');
    } catch (err) {
      if (!applyFieldErrors(err, setError)) toast.error(err.message);
    }
  });

  const timezones = TIMEZONES.includes(company.data.timezone) ? TIMEZONES : [company.data.timezone, ...TIMEZONES];

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title="Company"
        description="Organization details used across Senova, including payslips and letters."
        actions={
          canEdit && (
            <>
              <Button variant="secondary" onClick={() => reset(company.data)} disabled={!isDirty || update.isPending}>
                Discard
              </Button>
              <Button type="submit" disabled={!isDirty} loading={update.isPending}>
                Save changes
              </Button>
            </>
          )
        }
      />
      {!canEdit && (
        <div className="mb-6">
          <Alert tone="info">You can view these settings. Only administrators can change them.</Alert>
        </div>
      )}
      <fieldset disabled={!canEdit} className="space-y-6">
        <Card>
          <CardHeader title="Organization" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Input label="Legal name" required error={errors.legalName?.message} {...register('legalName')} />
            <Input label="Display name" required error={errors.displayName?.message} {...register('displayName')} />
            <Input label="Contact email" type="email" error={errors.contactEmail?.message} {...register('contactEmail')} />
            <Input label="Phone" error={errors.phone?.message} {...register('phone')} />
            <Input label="Website" className="sm:col-span-2" placeholder="https://" error={errors.website?.message} {...register('website')} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Registered address" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Input label="Address line 1" className="sm:col-span-2" error={errors.address?.line1?.message} {...register('address.line1')} />
            <Input label="Address line 2" className="sm:col-span-2" error={errors.address?.line2?.message} {...register('address.line2')} />
            <Input label="City" error={errors.address?.city?.message} {...register('address.city')} />
            <Input label="State" error={errors.address?.state?.message} {...register('address.state')} />
            <Input label="Postal code" error={errors.address?.postalCode?.message} {...register('address.postalCode')} />
            <Input label="Country" error={errors.address?.country?.message} {...register('address.country')} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Regional & HR defaults" description="Currency is fixed to INR." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Select label="Timezone" hint="Used for attendance and payroll cut-offs." {...register('timezone')}>
              {timezones.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
            <Select label="Date format" {...register('dateFormat')}>
              <option value="DD/MM/YYYY">DD/MM/YYYY</option>
              <option value="MM/DD/YYYY">MM/DD/YYYY</option>
              <option value="YYYY-MM-DD">YYYY-MM-DD</option>
            </Select>
            <Select label="Financial year starts in" {...register('financialYearStartMonth')}>
              {MONTHS.map((m, i) => (
                <option key={m} value={i + 1}>
                  {m}
                </option>
              ))}
            </Select>
            <Input label="Employee code prefix" hint="e.g. SEN → SEN-0001" error={errors.employeeCodePrefix?.message} {...register('employeeCodePrefix')} />
          </div>
        </Card>
      </fieldset>
    </form>
  );
}
