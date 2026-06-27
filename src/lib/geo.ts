export type GeofenceStatus = "INSIDE" | "OUTSIDE" | "LOCATION_MISSING" | "GPS_LOW_ACCURACY";

export function isValidLatLng(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
  if (!isValidLatLng(lat1, lng1) || !isValidLatLng(lat2, lng2)) return Number.NaN;
  const earthRadiusM = 6371000;
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const deltaLat = radians(lat2 - lat1);
  const deltaLng = radians(lng2 - lng1);
  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(deltaLng / 2) ** 2;
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function coordinatePair(value: string | null | undefined) {
  const match = value?.match(/(-?\d{1,2}(?:\.\d+)?)[,\s]+(-?\d{1,3}(?:\.\d+)?)/);
  if (!match) return null;
  const latitude = Number(match[1]);
  const longitude = Number(match[2]);
  return isValidLatLng(latitude, longitude) ? { latitude, longitude } : null;
}

export function parseGoogleMapsLocation(input: string) {
  const value = String(input || "").trim();
  if (!value) return null;

  const atCoordinates = coordinatePair(value.match(/@([^/?#]+)/)?.[1]);
  if (atCoordinates) return atCoordinates;

  try {
    const url = new URL(value);
    for (const key of ["q", "query", "ll"]) {
      const coordinates = coordinatePair(url.searchParams.get(key));
      if (coordinates) return coordinates;
    }
  } catch {
    // Plain coordinate text is accepted below.
  }

  const embedded = value.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (embedded) {
    const latitude = Number(embedded[1]);
    const longitude = Number(embedded[2]);
    if (isValidLatLng(latitude, longitude)) return { latitude, longitude };
  }

  return coordinatePair(value);
}

export function getGeofenceStatus(distance: number | null, radiusM: number, accuracyM?: number | null): GeofenceStatus {
  if (distance === null || !Number.isFinite(distance)) return "LOCATION_MISSING";
  if (accuracyM != null && (!Number.isFinite(accuracyM) || accuracyM > Math.max(radiusM * 2, 150))) return "GPS_LOW_ACCURACY";
  return distance <= radiusM ? "INSIDE" : "OUTSIDE";
}
