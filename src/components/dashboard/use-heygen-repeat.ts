"use client";

import { useCallback, useRef, useState } from "react";
import StreamingAvatar, {
  AvatarQuality,
  ElevenLabsModel,
  StreamingEvents,
  TaskMode,
  TaskType,
  VoiceEmotion,
} from "@heygen/streaming-avatar";
import { HEYGEN_FEMALE_AVATAR_ID, HEYGEN_FEMALE_VOICE_ID, HEYGEN_LANGUAGE } from "@/lib/heygen-config";

type TokenPayload = {
  token: string;
  language?: string;
  avatarName?: string;
  voice?: { voice_id?: string; rate?: number };
};

/**
 * HeyGen in REPEAT / text mode only.
 * Never startVoiceChat(), never knowledgeId, never TaskType.TALK — those use HeyGen's own KB.
 */
export function useHeygenRepeatAvatar() {
  const avatarRef = useRef<StreamingAvatar | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [ready, setReady] = useState(false);
  const [speaking, setSpeaking] = useState(false);

  const stop = useCallback(async () => {
    const avatar = avatarRef.current;
    avatarRef.current = null;
    setReady(false);
    setSpeaking(false);
    if (!avatar) return;
    try {
      await avatar.stopAvatar();
    } catch (cause) {
      console.error("[heygen] stopAvatar failed", cause);
    }
  }, []);

  const start = useCallback(async () => {
    if (avatarRef.current) return true;

    try {
      const tokenRes = await fetch("/api/heygen/token", { method: "POST" });
      if (!tokenRes.ok) {
        console.error("[heygen] token unavailable", tokenRes.status);
        return false;
      }
      const session = (await tokenRes.json()) as TokenPayload;
      const voiceId = session.voice?.voice_id || HEYGEN_FEMALE_VOICE_ID;
      const avatarName = session.avatarName || HEYGEN_FEMALE_AVATAR_ID;

      const avatar = new StreamingAvatar({ token: session.token });
      avatarRef.current = avatar;

      avatar.on(StreamingEvents.STREAM_READY, (stream: MediaStream) => {
        const video = videoRef.current;
        if (video && stream) {
          video.srcObject = stream;
          video.muted = false;
          void video.play().catch((cause) => console.error("[heygen] video play blocked", cause));
        }
        setReady(true);
      });
      avatar.on(StreamingEvents.AVATAR_START_TALKING, () => setSpeaking(true));
      avatar.on(StreamingEvents.AVATAR_STOP_TALKING, () => setSpeaking(false));
      avatar.on(StreamingEvents.STREAM_DISCONNECTED, () => {
        setReady(false);
        avatarRef.current = null;
      });

      await avatar.createStartAvatar({
        quality: AvatarQuality.Medium,
        avatarName,
        language: session.language || HEYGEN_LANGUAGE,
        voice: {
          voiceId,
          rate: session.voice?.rate ?? 1.0,
          emotion: VoiceEmotion.FRIENDLY,
          model: ElevenLabsModel.eleven_multilingual_v2,
        },
        disableIdleTimeout: true,
        activityIdleTimeout: 3600,
      });
      return true;
    } catch (cause) {
      console.error("[heygen] createStartAvatar failed", cause);
      avatarRef.current = null;
      setReady(false);
      return false;
    }
  }, []);

  const speakRepeat = useCallback(async (text: string) => {
    const avatar = avatarRef.current;
    const clean = text.trim();
    if (!avatar || !clean) return false;
    setSpeaking(true);
    await avatar.speak({
      text: clean,
      task_type: TaskType.REPEAT,
      taskType: TaskType.REPEAT,
      taskMode: TaskMode.SYNC,
    });
    return true;
  }, []);

  return { videoRef, ready, speaking, start, stop, speakRepeat };
}
