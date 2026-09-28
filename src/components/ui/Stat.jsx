import { COLORS, BORDER_RADIUS } from "../../styles/designSystem";

const TONES = {
  primary: COLORS.primary.rgb,
  success: COLORS.success.rgb,
  warning: COLORS.warning.rgb,
  danger: COLORS.danger.rgb,
  neutral: COLORS.neutral.rgb,
};

/** Métrica destacada (KPI) */
export function StatCard({ label, value, icon, trend, color = "primary", style }) {
  const rgb = TONES[color] || TONES.primary;
  return (
    <div
      className="fisco-card animate-slideUp"
      style={{
        position: "relative",
        padding: "16px 18px",
        borderRadius: BORDER_RADIUS.xl,
        background: `linear-gradient(135deg, rgba(${rgb},0.12) 0%, rgba(255,255,255,0.02) 100%)`,
        border: `1px solid rgba(${rgb},0.22)`,
        boxShadow: COLORS.shadows.sm,
        overflow: "hidden",
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: COLORS.neutral[400], textTransform: "uppercase", letterSpacing: "0.07em" }}>
            {label}
          </div>
          <div style={{ fontSize: 26, fontWeight: 800, color: `rgb(${rgb})`, lineHeight: 1.15, marginTop: 6, letterSpacing: "-0.02em" }}>
            {value}
          </div>
          {trend && <div style={{ fontSize: 10.5, color: COLORS.neutral[400], marginTop: 4 }}>{trend}</div>}
        </div>
        {icon && (
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: BORDER_RADIUS.lg,
              background: `rgba(${rgb},0.16)`,
              fontSize: 16,
            }}
          >
            {icon}
          </span>
        )}
      </div>
    </div>
  );
}

export default StatCard;
