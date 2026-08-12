export type Unsubscribe = () => void;

export class TypedEvent<T> {
  private readonly listeners = new Set<(value: T) => void>();

  subscribe(listener: (value: T) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(value: T): void {
    this.listeners.forEach((listener) => listener(value));
  }

  clear(): void {
    this.listeners.clear();
  }
}
