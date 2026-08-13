import Link from "next/link";

export interface Crumb {
  label: string;
  href?: string;
}

/** Portal-density only — Terminal screens don't have a breadcrumb trail. */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-portal-xs text-ink-500">
      {items.map((item, i) => (
        <span key={item.label} className="flex items-center gap-1.5">
          {i > 0 && <span aria-hidden="true">/</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-ink-900">
              {item.label}
            </Link>
          ) : (
            <span className="text-ink-900">{item.label}</span>
          )}
        </span>
      ))}
    </nav>
  );
}
