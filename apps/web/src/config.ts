// API configuration - reads from environment variable or falls back to current host
export const API_URL = import.meta.env.VITE_API_URL || `${window.location.protocol}//${window.location.host}`
