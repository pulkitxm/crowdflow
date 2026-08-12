export const collectedData = [
  'Rotating random node ID',
  'Venue-relative position and accuracy',
  'Walking speed and direction',
  'Current venue zone',
  'Nearby anonymous node density',
] as const;

export const neverCollectedData = [
  'Name, phone number, or email',
  'Contacts or account identifiers',
  'IMEI, Android ID, or advertising ID',
  'MAC address or any stable device identifier',
  'Raw latitude/longitude above the location driver',
] as const;

export const forbiddenWireKeys = new Set([
  'name',
  'phone',
  'email',
  'contact',
  'contacts',
  'account_id',
  'imei',
  'android_id',
  'advertising_id',
  'mac',
  'latitude',
  'longitude',
]);

export function assertPrivatePayload(value: unknown): void {
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      candidate.forEach(visit);
      return;
    }
    if (!candidate || typeof candidate !== 'object') return;
    Object.entries(candidate as Record<string, unknown>).forEach(([key, child]) => {
      if (forbiddenWireKeys.has(key.toLowerCase())) {
        throw new Error(`Forbidden wire field: ${key}`);
      }
      visit(child);
    });
  };
  visit(value);
}
