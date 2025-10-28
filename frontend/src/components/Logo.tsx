import React from "react";

export default function Logo() {
  return (
    <div className="logo-wrap" style={{ alignItems: "center", justifyContent: "flex-start", margin: 0, marginTop: -6, padding: 0, width: "100%" }}>
      <img
        src="/logo.svg"
        alt="Block Lotto"
        style={{
          width: "clamp(140px, 22vw, 380px)",
          height: "auto",
          maxWidth: "100%",
          display: "block",
        }}
      />
    </div>
  );
}