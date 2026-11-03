import { requireProfile } from '@/lib/session';
import { Nav } from '@/components/nav';
import { signOut } from '@/app/actions/auth';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await requireProfile();
  return (
    <>
      <Nav role={profile.role} name={profile.full_name} signOut={signOut} />
      <main id="main" className="container py-5 pb-16">{children}</main>
    </>
  );
}
