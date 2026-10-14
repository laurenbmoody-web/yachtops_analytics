// Face engine — turns a video frame into a 128-float descriptor, and nothing else.
//
// Deliberately the only place in the app that touches a face model, so the rules
// below hold everywhere:
//
//   * NO IMAGE EVER LEAVES THIS FILE. Callers get numbers. There is no path here
//     that returns a frame, a canvas or a data URL, which is what makes "templates
//     only, never photographs" a property of the code rather than a promise.
//   * The library is loaded by DYNAMIC IMPORT. @vladmandic/face-api carries its own
//     TensorFlow.js and unpacks to ~23MB; statically importing it would put that in
//     front of every page in Cargo. Only the door board and the enrolment screen
//     pay, and only when they actually open.
//   * Weights are SELF-HOSTED from /models/face (6.5MB, copied out of the package
//     at build time). The gangway iPad is often on vessel wifi with no route to a
//     CDN, and a sign-in board that needs jsdelivr to work is not a sign-in board.
//
// Models: TinyFaceDetector (190KB) for detection, the tiny 68-point landmarks
// (77KB) for alignment, and FaceRecognitionNet (6.2MB) for the descriptor. The
// tiny variants are chosen for an older iPad's sake; the recognition net has no
// smaller version and is the bulk of the download.

const MODEL_URL = '/models/face';

// A face smaller than this fraction of the frame height is too far away to
// identify reliably — matching on it produces confident-looking nonsense.
const MIN_FACE_RATIO = 0.18;

// Detector score below this isn't a face worth embedding.
const MIN_DETECTION_SCORE = 0.5;

let apiPromise = null;   // the dynamic import
let readyPromise = null; // model weights

// Load the library once. Kept separate from the weights so a caller can start the
// (slow) import while it is still asking for camera permission.
export const loadApi = () => {
  if (!apiPromise) {
    apiPromise = import('@vladmandic/face-api').then(async (mod) => {
      const api = mod.default || mod;
      // WebGL is what makes this usable on an iPad; without it tfjs falls back to
      // a CPU backend that takes seconds per frame. Failing to set it is not fatal,
      // so don't let it reject the whole load.
      try { await api.tf.setBackend('webgl'); await api.tf.ready(); }
      catch (err) { console.warn('[face] webgl backend unavailable, using default', err); }
      return api;
    });
  }
  return apiPromise;
};

// Load the three models. Idempotent and safe to call from several components.
export const loadModels = () => {
  if (!readyPromise) {
    readyPromise = loadApi().then(async (api) => {
      await Promise.all([
        api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
        api.nets.faceLandmark68TinyNet.loadFromUri(MODEL_URL),
        api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
      ]);
      return api;
    }).catch((err) => {
      // Let the next attempt retry rather than caching a permanent failure — a
      // kiosk that lost wifi mid-load should recover when it comes back.
      readyPromise = null;
      throw err;
    });
  }
  return readyPromise;
};

export const isLoaded = () => !!readyPromise;

// One detection pass over a <video>. Returns:
//   { ok: true, descriptor: number[128], score, ratio }
//   { ok: false, reason: 'no-face' | 'too-far' | 'low-score' | 'not-ready' }
//
// `descriptor` is a plain array, ready to hand to the match_face RPC. The frame
// it came from is not retained anywhere.
export async function describeFace(video) {
  if (!video || video.readyState < 2) return { ok: false, reason: 'not-ready' };

  const api = await loadModels();
  const opts = new api.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: MIN_DETECTION_SCORE });

  // detectSingleFace takes the most confident face only. At a gangway there may
  // be several people in shot; identifying the one nearest the camera (hence
  // largest and sharpest) is the behaviour we want, and guessing between two
  // faces is exactly what the runner-up margin in faceGate refuses to do.
  const found = await api
    .detectSingleFace(video, opts)
    .withFaceLandmarks(true)       // true = the tiny landmark model
    .withFaceDescriptor();

  if (!found) return { ok: false, reason: 'no-face' };

  const score = found.detection?.score ?? 0;
  if (score < MIN_DETECTION_SCORE) return { ok: false, reason: 'low-score' };

  const box = found.detection?.box;
  const frameH = video.videoHeight || 1;
  const ratio = box ? box.height / frameH : 0;
  if (ratio < MIN_FACE_RATIO) return { ok: false, reason: 'too-far', ratio };

  const descriptor = Array.from(found.descriptor || []);
  if (descriptor.length !== 128) return { ok: false, reason: 'no-face' };

  return { ok: true, descriptor, score, ratio };
}

// Human-readable nudge for a failed pass, for the "look at the camera" screen.
export const describeFailure = (reason) => ({
  'no-face': 'Look at the camera',
  'too-far': 'Step a little closer',
  'low-score': 'Hold still a moment',
  'not-ready': 'Starting the camera…',
}[reason] || 'Look at the camera');

// Release GPU memory when a kiosk leaves the camera view. The board can sit on
// one page for weeks, so tensors left behind are a real leak.
export async function disposeEngine() {
  if (!apiPromise) return;
  try {
    const api = await apiPromise;
    api.tf?.disposeVariables?.();
  } catch { /* nothing useful to do on the way out */ }
}
