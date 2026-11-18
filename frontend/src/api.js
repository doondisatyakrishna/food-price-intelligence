/**
 * Centralized API client for the Food Price Intelligence FastAPI backend.
 * Also captures Load Balancer telemetry headers (X-Worker-PID, X-Process-Time-Ms).
 */

async function requestJson(url, options = {}, onTelemetry = null) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  // Extract worker PID & latency headers attached by backend/api.py middleware
  if (onTelemetry) {
    const workerPid = response.headers.get('X-Worker-PID');
    const processTime = response.headers.get('X-Process-Time-Ms');
    if (workerPid || processTime) {
      onTelemetry({
        workerPid: workerPid || 'N/A',
        latencyMs: processTime || '0.0',
      });
    }
  }

  if (!response.ok) {
    const errBody = await response.json().catch(() => ({}));
    throw new Error(errBody.detail || `API error (${response.status})`);
  }

  return response.json();
}

export const api = {
  getCatalog: (onTelemetry) => requestJson('/api/catalog', {}, onTelemetry),

  getAlerts: (includeNormal = false, onTelemetry) =>
    requestJson(`/api/alerts?include_normal=${includeNormal}`, {}, onTelemetry),

  getHistory: (regionName, commodity, limit = 180, onTelemetry) => {
    const params = new URLSearchParams({
      region_name: regionName,
      commodity,
      limit: String(limit),
    });
    return requestJson(`/api/history?${params.toString()}`, {}, onTelemetry);
  },

  getForecast: (regionName, commodity, onTelemetry) =>
    requestJson(
      '/api/forecast',
      {
        method: 'POST',
        body: JSON.stringify({ region_name: regionName, commodity }),
      },
      onTelemetry
    ),

  getWeatherForecast: (regionName, days = 14, onTelemetry) => {
    const params = new URLSearchParams({
      region_name: regionName,
      days: String(days),
    });
    return requestJson(`/api/weather-forecast?${params.toString()}`, {}, onTelemetry);
  },

  getSyncStatus: () => requestJson('/api/sync/status'),

  triggerSync: () => requestJson('/api/sync', { method: 'POST' }),
};