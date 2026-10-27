import { useState } from 'react';
import { Link } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthLayout } from './AuthLayout.jsx';
import { forgotPasswordSchema } from './schemas.js';
import { post } from '../../lib/api.js';
import { Alert, Button, Input } from '../../components/ui/index.js';

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(forgotPasswordSchema), defaultValues: { email: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await post('/auth/forgot-password', values);
      setSent(true);
    } catch (err) {
      setFormError(err.message);
    }
  });

  return (
    <AuthLayout title="Reset your password" subtitle="Enter your work email and we'll send you a reset link.">
      {sent ? (
        <div className="space-y-6">
          <Alert tone="success">If an active account exists for that email, a reset link is on its way. The link expires in 30 minutes.</Alert>
          <Link to="/login" className="block text-center text-sm font-medium text-brand-700 hover:text-brand-900">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="space-y-5">
          {formError && <Alert>{formError}</Alert>}
          <Input label="Work email" type="email" autoComplete="email" error={errors.email?.message} {...register('email')} />
          <Button type="submit" className="w-full" loading={isSubmitting}>
            Send reset link
          </Button>
          <Link to="/login" className="block text-center text-sm font-medium text-brand-700 hover:text-brand-900">
            Back to sign in
          </Link>
        </form>
      )}
    </AuthLayout>
  );
}
