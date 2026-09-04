import type { NavIconName } from "@/components/layout/nav-config";

export function NavIcon({ name, className }: { name: NavIconName; className?: string }) {
  const props = {
    className,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.75,
    viewBox: "0 0 24 24",
    "aria-hidden": true as const,
  };

  switch (name) {
    case "home":
      return (
        <svg {...props}>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z" strokeLinejoin="round" />
        </svg>
      );
    case "archive":
      return (
        <svg {...props}>
          <path d="M7 4h10v3H7V4Z" strokeLinejoin="round" />
          <path d="M5 7h14v13H5V7Z" strokeLinejoin="round" />
          <path d="M9 11h6M9 15h4" strokeLinecap="round" />
        </svg>
      );
    case "settings":
      return (
        <svg {...props}>
          <path
            d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"
            strokeLinejoin="round"
          />
          <path
            d="M19.4 13a7.8 7.8 0 0 0 .05-2l2-1.15-2-3.45-2.3.7a7.6 7.6 0 0 0-1.75-1L15 4h-4l-.4 2.1a7.6 7.6 0 0 0-1.75 1l-2.3-.7-2 3.45 2 1.15a7.8 7.8 0 0 0 0 2l-2 1.15 2 3.45 2.3-.7a7.6 7.6 0 0 0 1.75 1L11 20h4l.4-2.1a7.6 7.6 0 0 0 1.75-1l2.3.7 2-3.45-2-1.15Z"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}
