"use client";

import { Sparkles } from "lucide-react";
import { useState } from "react";

const AVATAR_SRC = "/images/elena-avatar.jpg";

/**
 * Circular Elena photo. Uses a plain img so Safari/iOS does not decode a giant
 * next/image srcset (which can freeze the guest portal on first paint).
 */
export function ElenaAvatar({
  size = 44,
  showGlow = true,
}: {
  size?: number;
  showGlow?: boolean;
}) {
  const [ok, setOk] = useState(true);

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full border border-emerald-500/40 bg-gradient-to-br from-emerald-400/40 via-sky-500/30 to-violet-500/40 ${
        showGlow ? "shadow-[0_0_24px_rgb(16_185_129_/_0.3)]" : ""
      }`}
      style={{ width: size, height: size }}
    >
      {ok ? (
        <img
          src={AVATAR_SRC}
          alt="Elena · AI Concierge"
          width={size}
          height={size}
          className="h-full w-full scale-[1.65] origin-top rounded-full object-cover object-top"
          onError={() => setOk(false)}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <Sparkles
            className="text-emerald-300"
            style={{ width: Math.round(size * 0.45), height: Math.round(size * 0.45) }}
          />
        </div>
      )}
    </div>
  );
}
