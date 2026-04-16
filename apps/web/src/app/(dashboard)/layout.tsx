import { UserButton } from "@clerk/nextjs";
import Link from "next/link";

const navItems = [
  { href: "/", label: "Overview" },
  { href: "/sessions", label: "Sessions" },
  { href: "/settings", label: "Settings" },
];

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="w-56 border-r border-neutral-200 bg-neutral-50 p-4 flex flex-col gap-1">
        <div className="font-semibold text-lg mb-6 px-2">Clawdi Cloud</div>
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="px-3 py-2 rounded-md text-sm text-neutral-700 hover:bg-neutral-100 transition-colors"
          >
            {item.label}
          </Link>
        ))}
        <div className="mt-auto pt-4 px-2">
          <UserButton />
        </div>
      </aside>
      <main className="flex-1 p-8 overflow-auto">{children}</main>
    </div>
  );
}
