import { redirect } from 'next/navigation';

// Eski yer imleri çalışmaya devam eder; site artık şifre istemez.
export default function LoginPage() {
  redirect('/');
}
