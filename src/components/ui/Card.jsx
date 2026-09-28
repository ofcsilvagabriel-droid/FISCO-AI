import { COLORS, BORDER_RADIUS, TRANSITIONS } from "../../styles/designSystem";

export function Card({ children, style, elevation = "md", accent, className = "", ...props }) {
  return (
    <div
      className={`fisco-card animate-slideUp ${className}`}
      style={{
        background: COLORS.gradients.subtle,
        border: `1px solid ${COLORS.surface.border}`,
        borderTop: accent ? `2px solid rgba(${accent},0.7)` : `1px solid ${COLORS.surface.border}`,
        borderRadius: BORDER_RADIUS["2xl"],
        boxShadow: COLORS.shadows[elevation],
        backdropFilter: "blur(10px)",
        overflow: "hidden",
        transition: TRANSITIONS.normal,
        ...style,
      }}
      {...props}
    >
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon, action, style }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "16px 20px",
        borderBottom: `1px solid ${COLORS.surface.border}`,
        ...style,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        {icon && (
          <span
            style={{
              display: "grid",
              placeItems: "center",
              width: 34,
              height: 34,
              flexShrink: 0,
              borderRadius: BORDER_RADIUS.lg,
              background: "rgba(59,130,246,0.14)",
              border: "1px solid rgba(91,141,250,0.28)",
              fontSize: 16,
            }}
          >
            {icon}
          </span>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#e6edf7", letterSpacing: "0.02em" }}>{title}</div>
          {subtitle && <div style={{ fontSize: 11, color: COLORS.neutral[400], marginTop: 2 }}>{subtitle}</div>}
        </div>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  );
}

export function CardBody({ children, style }) {
  return <div style={{ padding: 20, ...style }}>{children}</div>;
}

export function CardFooter({ children, style }) {
  return (
    <div
      style={{
        padding: "12px 20px",
        borderTop: `1px solid ${COLORS.surface.border}`,
        background: "rgba(2,6,23,0.25)",
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export default Card;
