// v1: stubbed — returns static weather data.
// Real integration: call a weather API (OpenWeatherMap / Tomorrow.io) via Netlify function.
export function useWeather() {
  return {
    temp: '24°C',
    condition: 'Clear',
    wind: '8 kn NW',
    sunset: '20:41',
    loading: false,
    error: null,
  };
}
