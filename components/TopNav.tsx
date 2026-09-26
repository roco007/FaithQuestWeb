'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Map, Gamepad2, Wand2, Backpack, User } from 'lucide-react';

const LINKS = [
  { href: '/', label: 'Quest Map', icon: Map },
  { href: '/games', label: 'Hunts', icon: Gamepad2 },
  { href: '/creator', label: 'Creator', icon: Wand2 },
  { href: '/inventory', label: 'Inventory', icon: Backpack },
  { href: '/profile', label: 'Profile', icon: User },
];

/** Primary navigation, replacing the native bottom tab bar. */
export function TopNav() {
  const pathname = usePathname();

  return (
    <nav className="topNav">
      <Link href="/" className="brand">
        <span className="brandMark" aria-hidden="true">
          ✝
        </span>
        <span>
          FaithQuest
          <br />
          <span className="brandSub">Web Edition</span>
        </span>
      </Link>

      <div className="navLinks">
        {LINKS.map(({ href, label, icon: Icon }) => {
          // Exact match for "/" so it doesn't stay lit on every nested route.
          const isActive = href === '/' ? pathname === '/' : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`navLink${isActive ? ' navLinkActive' : ''}`}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}