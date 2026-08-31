export type GuestSmsResult = {
  delivered: boolean;
  simulated: boolean;
  to: string | null;
};

function twilioConfigured() {
  const sid = (process.env.TWILIO_ACCOUNT_SID ?? "").trim();
  const token = (process.env.TWILIO_AUTH_TOKEN ?? process.env.TWILIO_API_KEY ?? "").trim();
  const from = (process.env.TWILIO_FROM_NUMBER ?? process.env.TWILIO_PHONE_NUMBER ?? "").trim();
  return { sid, token, from, ready: Boolean(sid && token && from) };
}

function isTwilioAuthFailure(status: number, body: string) {
  if (status === 401 || status === 403) return true;
  return /invalid api key|authenticate|authentication|auth token|account sid|not authorized/i.test(body);
}

/** Real Twilio when keys work; otherwise a successful simulation so NeighborShield can still log the alert. */
export async function sendGuestHouseRulesSms(to: string | null, body: string): Promise<GuestSmsResult> {
  if (!to) {
    return { delivered: false, simulated: true, to: null };
  }

  const twilio = twilioConfigured();
  if (!twilio.ready) {
    console.info("[NeighborShield] SMS simulation — Twilio is not configured.");
    return { delivered: false, simulated: true, to };
  }

  try {
    const auth = Buffer.from(`${twilio.sid}:${twilio.token}`).toString("base64");
    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilio.sid}/Messages.json`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: to, From: twilio.from, Body: body }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (isTwilioAuthFailure(res.status, text)) {
        console.info("[NeighborShield] SMS simulation — Twilio rejected the API key.");
        return { delivered: false, simulated: true, to };
      }
      console.info("[NeighborShield] SMS simulation after Twilio error.", text.slice(0, 180));
      return { delivered: false, simulated: true, to };
    }
    return { delivered: true, simulated: false, to };
  } catch (cause) {
    console.info("[NeighborShield] SMS simulation after send failure.", cause);
    return { delivered: false, simulated: true, to };
  }
}
