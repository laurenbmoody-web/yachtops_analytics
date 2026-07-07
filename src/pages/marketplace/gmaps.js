// Lazily load the Google Maps JS API (with Places) exactly once.
//
// The key comes from VITE_GOOGLE_MAPS_API_KEY (set in Netlify, inlined
// at build time — never committed). It's a browser key, so it's visible
// in the client by design; protection comes from the HTTP-referrer +
// API restrictions set on the key in Google Cloud.

let promise = null;

export const hasGoogleKey = () => Boolean(import.meta.env.VITE_GOOGLE_MAPS_API_KEY);

export function loadGoogleMaps() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
  if (!key) return Promise.reject(new Error('Google Maps key not configured'));
  if (window.google && window.google.maps) return Promise.resolve(window.google.maps);
  if (promise) return promise;
  promise = new Promise((resolve, reject) => {
    const cb = '__cargoGmapsReady';
    window[cb] = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&loading=async&callback=${cb}`;
    s.async = true;
    s.defer = true;
    s.onerror = () => { promise = null; reject(new Error('Google Maps failed to load')); };
    document.head.appendChild(s);
  });
  return promise;
}

// Editorial map styling — Google's tiles, warmed to the Cargo palette.
export const MAP_STYLE_LIGHT = [
  { elementType: 'geometry', stylers: [{ color: '#F2EDE3' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7A7365' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#F7F4EE' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.country', elementType: 'labels.text.fill', stylers: [{ color: '#9A9384' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#6B6559' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#F0EADD' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#E7E0D1' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#CDDFE3' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#8AA6AD' }] },
];

export const MAP_STYLE_DARK = [
  { elementType: 'geometry', stylers: [{ color: '#1C1A2B' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8E889C' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#141320' }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#232135' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2A2740' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0F1720' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#5C7178' }] },
];
