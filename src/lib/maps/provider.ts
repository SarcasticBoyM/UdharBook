export const SCHOOL_MAP_PROVIDER = "mappls" as const;
export function mapplsOpenUrl(latitude: number, longitude: number) { return `https://mappls.com/@${latitude},${longitude}`; }
