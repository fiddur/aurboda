// API configuration - reads from runtime config or build-time env
// No fallback: VITE_API_URL must be configured for the app to work
export const API_URL = window.__RUNTIME_CONFIG__?.API_URL || import.meta.env.VITE_API_URL || ''
