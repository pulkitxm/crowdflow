import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'crowdflow.person.v1';

export function validPersonId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export async function storedPersonId(): Promise<number | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const value = Number(raw);
    return validPersonId(value) && String(value) === raw ? value : null;
  } catch {
    return null;
  }
}

export async function storePersonId(personId: number): Promise<void> {
  if (!validPersonId(personId)) throw new Error('Person ID must be a positive whole number.');
  await AsyncStorage.setItem(KEY, String(personId));
}

