"use client";

import { useState } from "react";
import Image from "next/image";
import { Sparkles } from "lucide-react";

const AVATAR_SRC = "/images/elena-avatar.jpg";

/**
 * Circular Elena photo avatar with an emerald ring + glow.
 * Renders /images/elena-avatar.jpg (face framed with object-cover object-top)
 * and gracefully falls back to the Sparkles mark while the image is unavailable.
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
        <Image
          src={AVATAR_SRC}
          alt="Elena · AI Concierge"
          fill
          sizes={`${size}px`}
          className="scale-[1.65] origin-top rounded-full object-cover object-top"
          onError={() => setOk(false)}
          priority={size >= 80}
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
