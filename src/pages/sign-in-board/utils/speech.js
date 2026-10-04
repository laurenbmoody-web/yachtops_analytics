// Spoken confirmations — pick a natural-sounding system voice rather than the
// default (which is usually the robotic one). Preference order favours Apple's
// and Google's natural voices; falls back to any English voice.
let cached = null;

const PREFERRED = [
  // Apple (iOS / macOS) — the door iPad is Safari.
  'Samantha', 'Karen', 'Serena', 'Martha', 'Stephanie', 'Moira', 'Daniel', 'Arthur',
  // Google (Chrome / Android).
  'Google UK English Female', 'Google UK English Male', 'Google US English',
  // Microsoft (Edge) online natural voices.
  'Microsoft Sonia Online', 'Microsoft Libby Online', 'Microsoft Aria Online', 'Microsoft Ryan Online',
];

if (typeof window !== 'undefined' && window.speechSynthesis) {
  // Voices load async — clear the cache when the list changes.
  try { window.speechSynthesis.onvoiceschanged = () => { cached = null; }; } catch { /* ignore */ }
  try { window.speechSynthesis.getVoices(); } catch { /* ignore */ }
}

function pickVoice() {
  const voices = window.speechSynthesis?.getVoices?.() || [];
  if (!voices.length) return null;
  for (const name of PREFERRED) {
    const v = voices.find((x) => x.name === name) || voices.find((x) => x.name.includes(name));
    if (v) return v;
  }
  // Otherwise a named English voice (avoid the bare "default" robotic one).
  return voices.find((v) => /en[-_]GB/i.test(v.lang) && !v.default)
    || voices.find((v) => /en[-_]GB/i.test(v.lang))
    || voices.find((v) => /^en/i.test(v.lang) && !v.default)
    || voices.find((v) => /^en/i.test(v.lang))
    || null;
}

export function speakText(text, { rate = 1, pitch = 1 } = {}) {
  try {
    const synth = window.speechSynthesis;
    if (!synth || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    const v = cached || pickVoice();
    if (v) { cached = v; u.voice = v; u.lang = v.lang; }
    u.rate = rate; u.pitch = pitch;
    synth.cancel();
    synth.speak(u);
  } catch { /* ignore */ }
}
