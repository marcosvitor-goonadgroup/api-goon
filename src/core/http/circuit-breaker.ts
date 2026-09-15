export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitSnapshot {
  state: CircuitState;
  failures: number;
  /** ISO-8601 da ultima falha registrada, se houver. */
  lastFailureAt: string | null;
  /** ISO-8601 do momento em que o circuito voltara a aceitar tentativas. */
  retryAt: string | null;
}

/**
 * Disjuntor por integracao.
 *
 * Depois de `threshold` falhas consecutivas o circuito abre e as chamadas
 * seguintes falham imediatamente, sem esperar timeout. Passado `resetMs`, uma
 * unica chamada e liberada (half-open): se passar, o circuito fecha; se
 * falhar, abre de novo.
 *
 * Isso evita que uma integracao lenta consuma o tempo de execucao da funcao
 * serverless e derrube endpoints que nem dependem dela.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureAt: number | null = null;
  private openedAt: number | null = null;

  constructor(
    readonly name: string,
    private readonly threshold: number,
    private readonly resetMs: number,
  ) {}

  /** Informa se uma nova tentativa pode ser feita agora. */
  canAttempt(now: number = Date.now()): boolean {
    if (this.state === 'closed') {
      return true;
    }

    if (this.state === 'open' && this.openedAt !== null && now - this.openedAt >= this.resetMs) {
      this.state = 'half-open';
      return true;
    }

    return this.state === 'half-open';
  }

  recordSuccess(): void {
    this.state = 'closed';
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(now: number = Date.now()): void {
    this.failures += 1;
    this.lastFailureAt = now;

    // Uma falha em half-open volta a abrir o circuito imediatamente.
    if (this.state === 'half-open' || this.failures >= this.threshold) {
      this.state = 'open';
      this.openedAt = now;
    }
  }

  snapshot(now: number = Date.now()): CircuitSnapshot {
    const retryAt =
      this.state === 'open' && this.openedAt !== null ? this.openedAt + this.resetMs : null;

    return {
      state: this.state,
      failures: this.failures,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      retryAt: retryAt && retryAt > now ? new Date(retryAt).toISOString() : null,
    };
  }
}
