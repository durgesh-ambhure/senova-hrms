import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useDepartments, useDesignations, useEmployee, useEmployeeMutations } from './api.js';
import { useShifts } from '../time/api.js';
import { EmployeePicker } from './EmployeePicker.jsx';
import { emptyAddress, employeeFormSchema, toEmployeePayload } from './schemas.js';
import { EMPLOYMENT_TYPES, GENDERS } from '../../lib/labels.js';
import { Alert, Button, Card, CardHeader, ErrorState, Input, PageHeader, PageLoader, Select, useToast } from '../../components/ui/index.js';

const blank = {
  firstName: '',
  middleName: '',
  lastName: '',
  workEmail: '',
  personalEmail: '',
  phone: '',
  dateOfBirth: '',
  gender: '',
  departmentId: '',
  designationId: '',
  reportingManager: null,
  employmentType: 'full_time',
  workLocation: '',
  shiftId: '',
  joiningDate: '',
  probationEndDate: '',
  effectiveDate: '',
  currentAddress: emptyAddress,
  permanentAddress: emptyAddress,
  emergencyContact: { name: '', relationship: '', phone: '' },
};

function toFormValues(e) {
  return {
    ...blank,
    firstName: e.firstName,
    middleName: e.middleName ?? '',
    lastName: e.lastName,
    workEmail: e.workEmail,
    personalEmail: e.personalEmail ?? '',
    phone: e.phone ?? '',
    dateOfBirth: e.dateOfBirth ?? '',
    gender: e.gender ?? '',
    departmentId: e.department?.id ?? '',
    designationId: e.designation?.id ?? '',
    reportingManager: e.reportingManager,
    employmentType: e.employmentType,
    workLocation: e.workLocation ?? '',
    shiftId: e.shift?.id ?? '',
    joiningDate: e.joiningDate,
    probationEndDate: e.probation?.endDate ?? '',
    currentAddress: { ...emptyAddress, ...e.currentAddress },
    permanentAddress: { ...emptyAddress, ...e.permanentAddress },
    emergencyContact: { name: '', relationship: '', phone: '', ...e.emergencyContact },
  };
}

function AddressFields({ prefix, register, errors }) {
  const err = errors[prefix] ?? {};
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Input label="Address line 1" className="sm:col-span-2" error={err.line1?.message} {...register(`${prefix}.line1`)} />
      <Input label="Address line 2" className="sm:col-span-2" error={err.line2?.message} {...register(`${prefix}.line2`)} />
      <Input label="City" error={err.city?.message} {...register(`${prefix}.city`)} />
      <Input label="State" error={err.state?.message} {...register(`${prefix}.state`)} />
      <Input label="Postal code" error={err.postalCode?.message} {...register(`${prefix}.postalCode`)} />
      <Input label="Country" error={err.country?.message} {...register(`${prefix}.country`)} />
    </div>
  );
}

export function EmployeeFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();
  const employee = useEmployee(id);
  const departments = useDepartments();
  const designations = useDesignations();
  const shifts = useShifts();
  const mutations = useEmployeeMutations(id);
  const mutation = isEdit ? mutations.update : mutations.create;

  const {
    register,
    handleSubmit,
    control,
    reset,
    setError,
    getValues,
    setValue,
    formState: { errors, dirtyFields, isDirty },
  } = useForm({ resolver: zodResolver(employeeFormSchema), defaultValues: blank });

  useEffect(() => {
    if (employee.data) reset(toFormValues(employee.data));
  }, [employee.data, reset]);

  if (isEdit && employee.isLoading) return <PageLoader label="Loading employee" />;
  if (isEdit && employee.error) return <ErrorState error={employee.error} onRetry={employee.refetch} />;

  const preJoining = !isEdit || employee.data?.lifecycleStatus === 'pre_joining';
  const orgDirty = dirtyFields.departmentId || dirtyFields.designationId || dirtyFields.reportingManager || dirtyFields.employmentType || dirtyFields.workLocation || dirtyFields.shiftId;
  // Archived options are still shown when the record currently uses them.
  const withCurrent = (list, current, label) => (current && list && !list.some((x) => x.id === current.id) ? [...list, { id: current.id, [label]: current[label] }] : list ?? []);

  const onSubmit = handleSubmit(async (values) => {
    try {
      const saved = await mutation.mutateAsync(toEmployeePayload(values, isEdit ? dirtyFields : null));
      toast.success(isEdit ? 'Employee updated' : `Employee ${saved.employeeCode} created`);
      navigate(`/employees/${saved.id}`);
    } catch (err) {
      const fieldMap = { reportingManagerId: 'reportingManager' };
      if (Array.isArray(err.details)) for (const d of err.details) setError(fieldMap[d.path] ?? d.path, { type: 'server', message: d.message });
      else toast.error(err.message);
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate>
      <PageHeader
        title={isEdit ? `Edit ${employee.data.fullName}` : 'Add employee'}
        description={isEdit ? `${employee.data.employeeCode} · employee code cannot be changed` : 'An employee code is generated automatically when you save.'}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(isEdit ? `/employees/${id}` : '/employees')}>
              Cancel
            </Button>
            <Button type="submit" loading={mutation.isPending} disabled={isEdit && !isDirty}>
              {isEdit ? 'Save changes' : 'Create employee'}
            </Button>
          </>
        }
      />
      {Object.keys(errors).length > 0 && (
        <div className="mb-6">
          <Alert>Please fix the highlighted fields.</Alert>
        </div>
      )}
      <div className="space-y-6">
        <Card>
          <CardHeader title="Basic details" />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Input label="First name" required error={errors.firstName?.message} {...register('firstName')} />
            <Input label="Middle name" error={errors.middleName?.message} {...register('middleName')} />
            <Input label="Last name" required error={errors.lastName?.message} {...register('lastName')} />
            <Input label="Work email" type="email" required error={errors.workEmail?.message} {...register('workEmail')} />
            <Input label="Phone" type="tel" error={errors.phone?.message} {...register('phone')} />
            <Input label="Personal email" type="email" error={errors.personalEmail?.message} {...register('personalEmail')} />
            <Input label="Date of birth" type="date" error={errors.dateOfBirth?.message} {...register('dateOfBirth')} />
            <Select label="Gender" {...register('gender')}>
              <option value="">Not specified</option>
              {Object.entries(GENDERS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </div>
        </Card>

        <Card>
          <CardHeader title="Employment" />
          <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
            <Select label="Department" required error={errors.departmentId?.message} {...register('departmentId')}>
              <option value="">Select…</option>
              {withCurrent(departments.data, employee.data?.department, 'name').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
            <Select label="Designation" required error={errors.designationId?.message} {...register('designationId')}>
              <option value="">Select…</option>
              {withCurrent(designations.data, employee.data?.designation, 'title').map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
            <Controller
              control={control}
              name="reportingManager"
              render={({ field }) => (
                <EmployeePicker label="Reporting manager" value={field.value} onChange={field.onChange} excludeId={id} error={errors.reportingManager?.message} />
              )}
            />
            <Select label="Employment type" required error={errors.employmentType?.message} {...register('employmentType')}>
              {Object.entries(EMPLOYMENT_TYPES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            <Input label="Work location" placeholder="e.g. Pune" hint="Location-specific holidays use this" error={errors.workLocation?.message} {...register('workLocation')} />
            <Select label="Shift" error={errors.shiftId?.message} {...register('shiftId')}>
              <option value="">Company default{shifts.data?.find((s) => s.isDefault) ? ` (${shifts.data.find((s) => s.isDefault).name})` : ''}</option>
              {withCurrent(shifts.data?.filter((s) => !s.isDefault), employee.data?.shift, 'name').map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}{s.startTime ? ` · ${s.startTime}–${s.endTime}` : ''}
                </option>
              ))}
            </Select>
            <Input
              label="Joining date"
              type="date"
              required
              disabled={!preJoining}
              hint={!preJoining ? 'Fixed once the employee has joined' : !isEdit ? 'A future date creates a pre-joining record' : undefined}
              error={errors.joiningDate?.message}
              {...register('joiningDate')}
            />
            <Input
              label="Probation ends"
              type="date"
              disabled={employee.data?.probation?.status === 'confirmed'}
              hint="Leave empty if not on probation"
              error={errors.probationEndDate?.message}
              {...register('probationEndDate')}
            />
            {isEdit && orgDirty && (
              <Input
                label="Changes take effect on"
                type="date"
                hint="Recorded in employment history (defaults to today)"
                error={errors.effectiveDate?.message}
                {...register('effectiveDate')}
              />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Current address" />
          <div className="p-5">
            <AddressFields prefix="currentAddress" register={register} errors={errors} />
          </div>
        </Card>
        <Card>
          <CardHeader
            title="Permanent address"
            actions={
              <Button variant="ghost" size="sm" onClick={() => setValue('permanentAddress', { ...getValues('currentAddress') }, { shouldDirty: true })}>
                Same as current
              </Button>
            }
          />
          <div className="p-5">
            <AddressFields prefix="permanentAddress" register={register} errors={errors} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Emergency contact" />
          <div className="grid gap-4 p-5 sm:grid-cols-3">
            <Input label="Name" error={errors.emergencyContact?.name?.message} {...register('emergencyContact.name')} />
            <Input label="Relationship" error={errors.emergencyContact?.relationship?.message} {...register('emergencyContact.relationship')} />
            <Input label="Phone" type="tel" error={errors.emergencyContact?.phone?.message} {...register('emergencyContact.phone')} />
          </div>
        </Card>
      </div>
    </form>
  );
}
