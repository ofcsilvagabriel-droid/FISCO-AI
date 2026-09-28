/**
 * Design System — FiscoAI v3
 * Paleta, tipografia, espaçamento, raios, sombras e transições.
 * Fonte única de verdade visual da aplicação.
 */

export const COLORS = {
  primary: {
    50: "#eef4ff",
    100: "#dbe7ff",
    200: "#bcd2ff",
    300: "#8fb4ff",
    400: "#5b8dfa",
    500: "#3b82f6",
    600: "#2563eb",
    700: "#1d4ed8",
    900: "#1e3a8a",
    rgb: "91,141,250",
  },
  success: {
    50: "#f0fdf4",
    500: "#22c55e",
    600: "#16a34a",
    700: "#15803d",
    rgb: "52,211,153",
  },
  warning: {
    50: "#fffbeb",
    500: "#f59e0b",
    600: "#d97706",
    700: "#b45309",
    rgb: "251,191,36",
  },
  danger: {
    50: "#fef2f2",
    500: "#ef4444",
    600: "#dc2626",
    700: "#b91c1c",
    rgb: "248,113,113",
  },
  neutral: {
    0: "#ffffff",
    50: "#f9fafb",
    100: "#f3f4f6",
    200: "#e5e7eb",
    300: "#d1d5db",
    400: "#9ca3af",
    500: "#6b7280",
    600: "#4b5563",
    700: "#374151",
    800: "#1f2937",
    900: "#111827",
    rgb: "148,163,184",
  },
  surface: {
    base: "#0b1120",
    raised: "rgba(255,255,255,0.045)",
    sunken: "rgba(2,6,23,0.45)",
    border: "rgba(148,163,184,0.16)",
    borderStrong: "rgba(148,163,184,0.28)",
  },
  gradients: {
    primary: "linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)",
    success: "linear-gradient(135deg, #22c55e 0%, #15803d 100%)",
    warning: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)",
    danger: "linear-gradient(135deg, #ef4444 0%, #b91c1c 100%)",
    app: "radial-gradient(1200px 600px at 12% -10%, rgba(59,130,246,0.16), transparent 60%), radial-gradient(900px 500px at 100% 0%, rgba(16,185,129,0.10), transparent 55%), linear-gradient(180deg, #0b1120 0%, #0d1526 100%)",
    subtle: "linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%)",
  },
  shadows: {
    sm: "0 1px 2px 0 rgba(2,6,23,0.35)",
    md: "0 4px 10px -2px rgba(2,6,23,0.45)",
    lg: "0 12px 28px -8px rgba(2,6,23,0.55)",
    xl: "0 24px 48px -16px rgba(2,6,23,0.65)",
    glow: "0 6px 20px -6px rgba(59,130,246,0.55)",
  },
};

export const TYPOGRAPHY = {
  fontFamily: {
    sans: `"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", sans-serif`,
    mono: `"JetBrains Mono", "Fira Code", ui-monospace, "Courier New", monospace`,
  },
  fontSize: {
    xs: "0.75rem",
    sm: "0.8125rem",
    base: "0.875rem",
    lg: "1rem",
    xl: "1.125rem",
    "2xl": "1.375rem",
    "3xl": "1.75rem",
    "4xl": "2.25rem",
  },
  fontWeight: { light: 300, normal: 400, medium: 500, semibold: 600, bold: 700, black: 800 },
  lineHeight: { tight: 1.2, normal: 1.5, relaxed: 1.75 },
  tracking: { tight: "-0.02em", wide: "0.06em" },
};

export const SPACING = {
  xs: "0.25rem",
  sm: "0.5rem",
  md: "1rem",
  lg: "1.5rem",
  xl: "2rem",
  "2xl": "3rem",
  "3xl": "4rem",
};

export const BORDER_RADIUS = {
  none: "0",
  sm: "0.375rem",
  md: "0.5rem",
  lg: "0.75rem",
  xl: "1rem",
  "2xl": "1.25rem",
  full: "9999px",
};

export const TRANSITIONS = {
  fast: "150ms cubic-bezier(0.4, 0, 0.2, 1)",
  normal: "200ms cubic-bezier(0.4, 0, 0.2, 1)",
  slow: "300ms cubic-bezier(0.4, 0, 0.2, 1)",
};

export default { COLORS, TYPOGRAPHY, SPACING, BORDER_RADIUS, TRANSITIONS };
