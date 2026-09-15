import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  const THRESHOLD = 3;
  const RESET_MS = 1_000;

  const create = () => new CircuitBreaker('teste', THRESHOLD, RESET_MS);

  it('comeca fechado e aceitando chamadas', () => {
    const breaker = create();

    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.snapshot().state).toBe('closed');
  });

  it('permanece fechado enquanto as falhas nao atingem o limite', () => {
    const breaker = create();

    breaker.recordFailure();
    breaker.recordFailure();

    expect(breaker.canAttempt()).toBe(true);
    expect(breaker.snapshot().failures).toBe(2);
  });

  it('abre ao atingir o limite de falhas consecutivas', () => {
    const breaker = create();

    for (let i = 0; i < THRESHOLD; i++) {
      breaker.recordFailure();
    }

    expect(breaker.canAttempt()).toBe(false);
    expect(breaker.snapshot().state).toBe('open');
  });

  it('zera o contador apos um sucesso', () => {
    const breaker = create();

    breaker.recordFailure();
    breaker.recordFailure();
    breaker.recordSuccess();

    expect(breaker.snapshot().failures).toBe(0);
    expect(breaker.snapshot().state).toBe('closed');
  });

  it('libera uma tentativa (half-open) depois do tempo de espera', () => {
    const breaker = create();
    const now = Date.now();

    for (let i = 0; i < THRESHOLD; i++) {
      breaker.recordFailure(now);
    }

    expect(breaker.canAttempt(now)).toBe(false);
    expect(breaker.canAttempt(now + RESET_MS)).toBe(true);
    expect(breaker.snapshot(now + RESET_MS).state).toBe('half-open');
  });

  it('volta a abrir imediatamente se a tentativa em half-open falhar', () => {
    const breaker = create();
    const now = Date.now();

    for (let i = 0; i < THRESHOLD; i++) {
      breaker.recordFailure(now);
    }

    breaker.canAttempt(now + RESET_MS); // entra em half-open
    breaker.recordFailure(now + RESET_MS);

    expect(breaker.canAttempt(now + RESET_MS)).toBe(false);
    expect(breaker.snapshot(now + RESET_MS).state).toBe('open');
  });

  it('fecha o circuito quando a tentativa em half-open tem sucesso', () => {
    const breaker = create();
    const now = Date.now();

    for (let i = 0; i < THRESHOLD; i++) {
      breaker.recordFailure(now);
    }

    breaker.canAttempt(now + RESET_MS);
    breaker.recordSuccess();

    expect(breaker.snapshot().state).toBe('closed');
    expect(breaker.canAttempt()).toBe(true);
  });

  it('informa quando o circuito voltara a aceitar chamadas', () => {
    const breaker = create();
    const now = Date.now();

    for (let i = 0; i < THRESHOLD; i++) {
      breaker.recordFailure(now);
    }

    const snapshot = breaker.snapshot(now);

    expect(snapshot.retryAt).toBe(new Date(now + RESET_MS).toISOString());
    expect(snapshot.lastFailureAt).toBe(new Date(now).toISOString());
  });
});
