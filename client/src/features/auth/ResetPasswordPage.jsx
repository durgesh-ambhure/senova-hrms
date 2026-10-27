import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthLayout } from './AuthLayout.jsx';
import { newPasswordSchema } from './schemas.js';
import { applyFieldErrors, post } from '../../lib/api.js';
import { Alert, Button, Input, buttonClass } from '../../components/ui/index.js';

/** Handles both password-reset links and first-time invitation links (?invite=1). */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  // Keep the token in memory and drop it from the address bar (history, screenshots, shoulder-surfing).
  const [{ token, isInvite }] = useState(() => ({ token: params.get('token'), isInvite: params.get('invite') === '1' }));
  useEffect(() => {
    if (window.location.search) window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(newPasswordSchema), defaultValues: { password: '', confirmPassword: '' } });

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(null);
    try {
      await post('/auth/reset-password', { token, password });
      setDone(true);
    } catch (err) {
      if (!applyFieldErrors(err, setError, ['password'])) setFormError(err.message);
    }
  });

  const title = isInvite ? 'Set up your account' : 'Choose a new password';
  if (!token) {
    return (
      <AuthLayout title={title}>
        <Alert>This link is incomplete. Open the link from your email again, or request a new one.</Alert>
        <Link to="/forgot-password" className="mt-6 block text-center text-sm font-medium text-brand-700">
          Request a new link
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={title} subtitle="Use at least 12 characters, including a letter and a number.">
      {done ? (
        <div className="space-y-6">
          <Alert tone="success">{isInvite ? 'Your account is ready.' : 'Your password has been changed.'} You can now sign in.</Alert>
          <Link to="/login" className={buttonClass({ className: 'w-full' })}>
            Go to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {formError && <Alert>{formError}</Alert>}
          <Input label="New password" type="password" autoComplete="new-password" error={errors.password?.message} {...register('password')} />
          <Input
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            error={errors.confirmPassword?.message}
            {...register('confirmPassword')}
          />
          <Button type="submit" className="w-full" loading={isSubmitting}>
            {isInvite ? 'Activate account' : 'Update password'}
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
