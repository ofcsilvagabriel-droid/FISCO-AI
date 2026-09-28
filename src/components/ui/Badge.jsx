import { COLORS, BORDER_RADIUS } from "../../styles/designSystem";

const VARIANTS = {
  neutral: COLORS.neutral.rgb,
  primary: COLORS.primary.rgb,
  success: COLORS.success.rgb,
  warning: COLORS.warning.rgb,
  danger: COLORS.danger.rgb,
};

const SIZES = {
  sm: { padding: "2px 8px", fontSize: 10 },
  md: { padding: "3px 10px", fontSize: 11 },
  lg: { padding: "5px 14px", fontSize: 13 },
};

export function Badge({ children, variant = "neutral", size = "md", style, ...props }) {
  const rgb = VARIANTS[variant] || VARIANTS.neutral;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        borderRadius: BORDER_RADIUS.full,
        fontWeight: 700,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        background: `rgba(${rgb},0.14)`,
        color: `rgb(${rgb})`,
        border: `1px solid rgba(${rgb},0.32)`,
        ...SIZES[size],
        ...style,
      }}
      {...props}
    >
      {children}
    </span>
  );
}

export default Badge;
