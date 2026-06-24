export function parseDeliveryLocation(input: unknown) {
  const value = String(input || "").trim().slice(0, 1000);
  if (!value) return { deliveryLocationText: null, deliveryLocationUrl: null };

  const urlMatch = value.match(/https?:\/\/\S+/i);
  const url = urlMatch ? urlMatch[0] : null;
  const lowerUrl = url?.toLowerCase() ?? "";
  const isMapsUrl = Boolean(
    url &&
    (
      lowerUrl.includes("maps.app.goo.gl") ||
      lowerUrl.includes("google.com/maps") ||
      lowerUrl.includes("goo.gl/maps") ||
      lowerUrl.includes("maps.google.")
    ),
  );

  return {
    deliveryLocationText: value,
    deliveryLocationUrl: isMapsUrl ? url : null,
  };
}
