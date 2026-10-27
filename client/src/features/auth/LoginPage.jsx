import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AuthLayout } from './AuthLayout.jsx';
import { useAuth } from './AuthProvider.jsx';
import { loginSchema } from './schemas.js';
import { Alert, Button, Input } from '../../components/ui/index.js';

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [formError, setFormError] = useState(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit(async (values) => {
    setFormError(null);
    try {
      await login(values);
      const from = location.state?.from;
      navigate(from && from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard', { replace: true });
    } catch (err) {
      setFormError(err.message);
    }
  });

  return (
    <AuthLayout title="Welcome back" subtitle="Sign in to continue to Senova HRMS.">
      <form onSubmit={onSubmit} noValidate className="space-y-5">
        {formError && <Alert>{formError}</Alert>}
        <Input label="Work email" type="email" autoComplete="username" error={errors.email?.message} {...register('email')} />
        <Input label="Password" type="password" autoComplete="current-password" error={errors.password?.message} {...register('password')} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-700 hover:text-brand-900">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={isSubmitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}
