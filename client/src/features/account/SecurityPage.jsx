import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { changePasswordSchema } from '../auth/schemas.js';
import { applyFieldErrors, post } from '../../lib/api.js';
import { Button, Card, CardHeader, Input, PageHeader, useToast } from '../../components/ui/index.js';

export function SecurityPage() {
  const toast = useToast();
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(changePasswordSchema), defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });

  const onSubmit = handleSubmit(async ({ currentPassword, newPassword }) => {
    try {
      await post('/auth/change-password', { currentPassword, newPassword });
      reset();
      toast.success('Password changed. You have been signed out on other devices.');
    } catch (err) {
      if (!applyFieldErrors(err, setError, ['currentPassword', 'newPassword'])) toast.error(err.message);
    }
  });

  return (
    <>
      <PageHeader title="Password & security" description="Changing your password signs you out everywhere else." />
      <Card className="max-w-xl">
        <CardHeader title="Change password" description="At least 12 characters, including a letter and a number." />
        <form onSubmit={onSubmit} noValidate className="space-y-4 p-5">
          <Input label="Current password" type="password" autoComplete="current-password" error={errors.currentPassword?.message} {...register('currentPassword')} />
          <Input label="New password" type="password" autoComplete="new-password" error={errors.newPassword?.message} {...register('newPassword')} />
          <Input label="Confirm new password" type="password" autoComplete="new-password" error={errors.confirmPassword?.message} {...register('confirmPassword')} />
          <div className="flex justify-end">
            <Button type="submit" loading={isSubmitting}>
              Update password
            </Button>
          </div>
        </form>
      </Card>
    </>
  );
}
