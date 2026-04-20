import { useRef, useState, useCallback } from 'react';

// v1 stub: keyword-based canned responses, no real Whisper/Claude backend
const CANNED_PARSES = [
  {
    keywords: ['cappuccino', 'coffee', 'espresso', 'latte'],
    result: {
      intent: 'preference', destructive: false,
      subject: { type: 'guest', id: null, displayName: 'Susan' },
      content: 'Susan prefers a double cappuccino with oat milk each morning.',
      raw: '',
    },
  },
  {
    keywords: ['remove', 'take out', 'delete', 'use'],
    result: {
      intent: 'inventory-remove', destructive: true,
      subject: { type: 'inventory-item', id: null, displayName: 'Tignanello 2017' },
      content: 'Remove 1 bottle of Tignanello 2017 from the wine cellar.',
      context: 'Leaves 2 bottles · last opened 18 April for dinner service',
      raw: '',
    },
  },
  {
    keywords: ['ashore', 'marina', 'left', 'gone'],
    result: {
      intent: 'state-change', destructive: true,
      subject: { type: 'guest', id: null, displayName: 'Robert' },
      content: 'Mark Robert as ashore, departed to Palma Marina.',
      context: 'Currently marked as onboard · no return time set',
      raw: '',
    },
  },
  {
    keywords: ['allerg', 'nut', 'gluten', 'dairy', 'avoid'],
    result: {
      intent: 'allergy-change', destructive: true,
      subject: { type: 'guest', id: null, displayName: 'Anna' },
      content: 'Add tree nut allergy (severe) to Anna\'s profile.',
      context: 'No existing allergies on record',
      raw: '',
    },
  },
];

function stubParse(transcript) {
  const lower = transcript.toLowerCase();
  for (const { keywords, result } of CANNED_PARSES) {
    if (keywords.some(k => lower.includes(k))) {
      return { ...result, raw: transcript };
    }
  }
  // Default → stew note
  return {
    intent: 'stew-note', destructive: false,
    subject: null,
    content: transcript || 'Note added via voice dictation.',
    raw: transcript,
  };
}

export function useDictate({ onApply }) {
  const [state, setState] = useState({ kind: 'resting' });
  const mediaRef     = useRef(null);
  const analyserRef  = useRef(null);
  const chunksRef    = useRef([]);
  const startTimeRef = useRef(null);
  const timerRef     = useRef(null);
  const rafRef       = useRef(null);
  const [waveHeights, setWaveHeights] = useState(Array(24).fill(4));
  const [elapsed, setElapsed]         = useState(0);
  const [transcript, setTranscript]   = useState('');

  const startRecording = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const ctx     = new AudioContext();
      const source  = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);
      analyserRef.current = analyser;

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = e => chunksRef.current.push(e.data);
      recorder.start(100);
      mediaRef.current = { recorder, stream, ctx };
      startTimeRef.current = Date.now();
      setElapsed(0);
      setTranscript('');

      setState({ kind: 'recording', startedAt: new Date(), transcript: '' });

      // Elapsed timer
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      // Waveform RAF
      const updateWave = () => {
        if (!analyserRef.current) return;
        const buf = new Uint8Array(analyserRef.current.frequencyBinCount);
        analyserRef.current.getByteFrequencyData(buf);
        const heights = Array.from({ length: 24 }, (_, i) => {
          const idx = Math.floor((i / 24) * buf.length);
          return Math.max(3, (buf[idx] / 255) * 28);
        });
        setWaveHeights(heights);
        rafRef.current = requestAnimationFrame(updateWave);
      };
      rafRef.current = requestAnimationFrame(updateWave);

      // Mock streaming transcript
      const phrases = [
        'Add a note — ',
        'Add a note — Susan prefers',
        'Add a note — Susan prefers oat milk cappuccino',
      ];
      let i = 0;
      const mockStream = setInterval(() => {
        if (i < phrases.length) { setTranscript(phrases[i++]); }
        else clearInterval(mockStream);
      }, 700);

    } catch {
      // Mic not available — simulate for demo
      startTimeRef.current = Date.now();
      setElapsed(0);
      setState({ kind: 'recording', startedAt: new Date(), transcript: '' });
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 1000);
      setWaveHeights(Array.from({ length: 24 }, () => Math.random() * 20 + 4));
    }
  }, []);

  const stopRecording = useCallback(async () => {
    clearInterval(timerRef.current);
    cancelAnimationFrame(rafRef.current);

    if (mediaRef.current) {
      mediaRef.current.recorder.stop();
      mediaRef.current.stream.getTracks().forEach(t => t.stop());
      mediaRef.current.ctx.close().catch(() => {});
      mediaRef.current = null;
    }
    analyserRef.current = null;

    // Stub parse
    const finalTranscript = transcript || 'Note from voice dictation.';
    const parsed = stubParse(finalTranscript);

    if (parsed.destructive) {
      setState({ kind: 'parsed-confirm', action: parsed });
    } else {
      setState({ kind: 'parsed-auto', action: parsed, appliedAt: new Date() });
    }
  }, [transcript]);

  const confirmApply = useCallback(async () => {
    if (state.kind !== 'parsed-confirm') return;
    await onApply?.(state.action);
    setState({ kind: 'resting' });
  }, [state, onApply]);

  const cancel = useCallback(() => setState({ kind: 'resting' }), []);

  const undo = useCallback(() => setState({ kind: 'resting' }), []);

  const autoApplyDone = useCallback(async (action) => {
    await onApply?.(action);
    setState({ kind: 'resting' });
  }, [onApply]);

  return {
    state,
    waveHeights,
    elapsed,
    transcript,
    startRecording,
    stopRecording,
    confirmApply,
    cancel,
    undo,
    autoApplyDone,
  };
}
