// API configuration - reads from runtime config, build-time env, or falls back to current host
export const API_URL =
  window.__RUNTIME_CONFIG__?.API_URL ||
  import.meta.env.VITE_API_URL ||
  `${window.location.protocol}//${window.location.host}`
