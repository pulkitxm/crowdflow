/** Python-compatible MT19937, used so migration parity keeps seed 42 meaningful. */
export class Random {
  private mt = new Uint32Array(624);
  private index = 624;
  private gaussian: number | null = null;

  constructor(seed: number) { this.seed(seed); }

  seed(seed: number): void {
    // CPython seeds its MT from the full integer through init_by_array.
    const words: number[] = [];
    let value = BigInt.asUintN(64, BigInt(Math.trunc(seed)));
    do { words.push(Number(value & 0xffffffffn)); value >>= 32n; } while (value > 0n);
    this.initByArray(words);
    this.gaussian = null;
  }

  private initGenrand(seed: number): void {
    this.mt[0] = seed >>> 0;
    for (let i = 1; i < 624; i++) {
      const previous = this.mt[i - 1]!;
      this.mt[i] = (Math.imul(1812433253, previous ^ (previous >>> 30)) + i) >>> 0;
    }
    this.index = 624;
  }

  private initByArray(key: number[]): void {
    this.initGenrand(19650218);
    let i = 1; let j = 0;
    for (let k = Math.max(624, key.length); k > 0; k--) {
      const previous = this.mt[i - 1]!;
      this.mt[i] = ((this.mt[i]! ^ Math.imul(previous ^ (previous >>> 30), 1664525)) + key[j]! + j) >>> 0;
      i += 1; j += 1;
      if (i >= 624) { this.mt[0] = this.mt[623]!; i = 1; }
      if (j >= key.length) j = 0;
    }
    for (let k = 623; k > 0; k--) {
      const previous = this.mt[i - 1]!;
      this.mt[i] = ((this.mt[i]! ^ Math.imul(previous ^ (previous >>> 30), 1566083941)) - i) >>> 0;
      i += 1;
      if (i >= 624) { this.mt[0] = this.mt[623]!; i = 1; }
    }
    this.mt[0] = 0x80000000;
  }

  private uint32(): number {
    if (this.index >= 624) this.twist();
    let value = this.mt[this.index++]!;
    value ^= value >>> 11;
    value ^= (value << 7) & 0x9d2c5680;
    value ^= (value << 15) & 0xefc60000;
    value ^= value >>> 18;
    return value >>> 0;
  }

  private twist(): void {
    for (let i = 0; i < 624; i++) {
      const y = (this.mt[i]! & 0x80000000) | (this.mt[(i + 1) % 624]! & 0x7fffffff);
      this.mt[i] = this.mt[(i + 397) % 624]! ^ (y >>> 1) ^ ((y & 1) ? 0x9908b0df : 0);
    }
    this.index = 0;
  }

  random(): number {
    const a = this.uint32() >>> 5;
    const b = this.uint32() >>> 6;
    return (a * 67108864 + b) / 9007199254740992;
  }

  uniform(min: number, max: number): number { return min + (max - min) * this.random(); }

  gauss(mean: number, sigma: number): number {
    if (this.gaussian != null) {
      const value = this.gaussian; this.gaussian = null;
      return mean + value * sigma;
    }
    const angle = 2 * Math.PI * this.random();
    const radius = Math.sqrt(-2 * Math.log(1 - this.random()));
    this.gaussian = Math.sin(angle) * radius;
    return mean + Math.cos(angle) * radius * sigma;
  }
}
