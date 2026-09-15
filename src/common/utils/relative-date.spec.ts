import { DEFAULT_REPORT_TIMEZONE, resolveRelativeDate, shiftDays, todayIn } from './relative-date';

describe('resolveRelativeDate', () => {
  // 15/09/2026 as 12:00 UTC = 09:00 em Sao Paulo. Mesmo dia nos dois fusos.
  const meioDia = new Date('2026-09-15T12:00:00Z');
  const resolve = (value: unknown, now = meioDia) =>
    resolveRelativeDate(value, DEFAULT_REPORT_TIMEZONE, now);

  it('deixa passar uma data absoluta', () => {
    expect(resolve('2026-08-01')).toBe('2026-08-01');
  });

  it('resolve today e yesterday', () => {
    expect(resolve('today')).toBe('2026-09-15');
    expect(resolve('yesterday')).toBe('2026-09-14');
  });

  it('aceita os atalhos em portugues', () => {
    expect(resolve('hoje')).toBe('2026-09-15');
    expect(resolve('ontem')).toBe('2026-09-14');
  });

  it('ignora caixa e espaco em volta', () => {
    expect(resolve('  YESTERDAY  ')).toBe('2026-09-14');
  });

  it('resolve janelas D-n', () => {
    expect(resolve('D-7')).toBe('2026-09-08');
    expect(resolve('d-30')).toBe('2026-08-16');
    expect(resolve('D-0')).toBe('2026-09-15');
  });

  /**
   * O caso que motiva resolver por fuso: as 22h em Sao Paulo ja e o dia
   * seguinte em UTC. Uma rotina noturna pedindo "ontem" buscaria o dia errado
   * se a conta fosse feita no relogio do servidor.
   */
  it('usa o dia de Sao Paulo, e nao o do servidor em UTC', () => {
    const noiteEmSaoPaulo = new Date('2026-09-16T01:00:00Z'); // 15/09 22:00 BRT

    expect(resolve('today', noiteEmSaoPaulo)).toBe('2026-09-15');
    expect(resolve('yesterday', noiteEmSaoPaulo)).toBe('2026-09-14');

    // A mesma instrucao em UTC avancaria um dia indevidamente.
    expect(resolveRelativeDate('today', 'UTC', noiteEmSaoPaulo)).toBe('2026-09-16');
  });

  it('atravessa a virada de mes corretamente', () => {
    const primeiroDeSetembro = new Date('2026-09-01T12:00:00Z');
    expect(resolve('yesterday', primeiroDeSetembro)).toBe('2026-08-31');
    expect(resolve('D-1', primeiroDeSetembro)).toBe('2026-08-31');
  });

  it('atravessa a virada de ano', () => {
    const anoNovo = new Date('2027-01-01T12:00:00Z');
    expect(resolve('yesterday', anoNovo)).toBe('2026-12-31');
  });

  it('devolve o valor original quando nao reconhece, para o DTO recusar', () => {
    // Manter o texto intacto preserva a mensagem de erro de formato.
    expect(resolve('semana-passada')).toBe('semana-passada');
    expect(resolve('01/08/2026')).toBe('01/08/2026');
    expect(resolve(42)).toBe(42);
    expect(resolve(undefined)).toBeUndefined();
  });
});

describe('shiftDays', () => {
  it('soma e subtrai dias', () => {
    expect(shiftDays('2026-09-15', -1)).toBe('2026-09-14');
    expect(shiftDays('2026-09-15', 1)).toBe('2026-09-16');
    expect(shiftDays('2026-09-15', 0)).toBe('2026-09-15');
  });

  it('lida com ano bissexto', () => {
    expect(shiftDays('2028-03-01', -1)).toBe('2028-02-29');
  });
});

describe('todayIn', () => {
  it('formata como yyyy-MM-dd', () => {
    expect(todayIn('America/Sao_Paulo', new Date('2026-09-15T12:00:00Z'))).toBe('2026-09-15');
  });
});
