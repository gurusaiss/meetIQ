import Link from 'next/link';
import { requireMerchant } from '@/modules/auth/session-server';
import { can } from '@/modules/auth/rbac';
import { IconChevronRight, PageHeader } from '@/components/ui';
import { logoutAction } from '../../login/actions';

type IconProps = { className?: string };

function IconShop({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M3 8.5 4.5 3h11L17 8.5M3 8.5v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7M3 8.5h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M7.5 16.5V12h5v4.5" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function IconUsers({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <circle cx="7" cy="7" r="2.75" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 16.5c0-2.4 2-4 4.5-4s4.5 1.6 4.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="14.5" cy="7.5" r="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13 12.7c1.9.3 3.5 1.6 3.5 3.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconCard({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <rect x="2.5" y="4.5" width="15" height="11" rx="1.8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M2.5 8h15" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.5 11.5h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function IconSparkle({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M10 2.5 11.6 7.9 17 9.5l-5.4 1.6L10 16.5 8.4 11.1 3 9.5l5.4-1.6L10 2.5Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconLogout({ className = 'h-5 w-5' }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path d="M8 17H4.5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1H8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.5 13.5 16 10l-3.5-3.5M16 10H7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MenuRow({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="card card-interactive flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700">
        {icon}
      </span>
      <span className="flex-1 text-[15px] font-medium">{label}</span>
      <IconChevronRight className="h-4 w-4 shrink-0 text-ink-400" />
    </Link>
  );
}

export default async function MorePage() {
  const { principal } = await requireMerchant();

  return (
    <div>
      <PageHeader title="More" />
      <div className="space-y-2.5">
        <MenuRow href="/app/profile" icon={<IconShop />} label="Shop details" />
        {can(principal, 'ai:configure') && <MenuRow href="/app/ai" icon={<IconSparkle />} label="AI assistant" />}
        {can(principal, 'members:read') && <MenuRow href="/app/team" icon={<IconUsers />} label="Team" />}
        {can(principal, 'billing:read') && <MenuRow href="/app/plan" icon={<IconCard />} label="Plan & billing" />}
      </div>

      <form action={logoutAction} className="mt-6">
        <button
          type="submit"
          className="tap-target flex w-full items-center gap-3 rounded-[var(--radius-sm)] px-4 text-[15px] font-medium text-danger-600 transition-colors hover:bg-danger-50"
        >
          <IconLogout />
          Sign out
        </button>
      </form>
    </div>
  );
}
