"use client";

import React, { useState } from "react";

export default function ElenaVoiceWidget() {
  const [input, setInput] = useState("");
  const [status, setStatus] = useState("En espera");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const prompt = input;
    setInput("");
    setLoading(true);
    setStatus("Procesando respuesta...");

    try {
      const ttsRes = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt, voice: "nova" }),
      });

      if (ttsRes.ok) {
        const blob = await ttsRes.blob();
        const audioUrl = URL.createObjectURL(blob);
        const audio = new Audio(audioUrl);
        setStatus("Reproduciendo audio...");
        await audio.play();
        setStatus("Listo");
      } else {
        setStatus("Error en /api/tts (Status " + ttsRes.status + ")");
      }
    } catch (err) {
      setStatus("Error de conexión");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg mx-auto text-white shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold">Elena Asistente</h2>
        <span className="text-xs px-2 py-1 bg-emerald-900/60 text-emerald-400 border border-emerald-700 rounded-md">
          {status}
        </span>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-row items-center gap-2 w-full">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe lo que quieres que Elena diga..."
          className="flex-1 min-w-0 px-4 py-2 bg-slate-800 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading}
          className="shrink-0 px-5 py-2 bg-blue-600 hover:bg-blue-500 font-semibold rounded-lg disabled:opacity-50 transition"
        >
          {loading ? "..." : "Enviar"}
        </button>
      </form>
    </div>
  );
}
