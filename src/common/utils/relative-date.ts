/**
 * Datas relativas para consultas agendadas.
 *
 * Uma automacao diaria nao deveria precisar calcular a data antes de chamar a
 * API. Com estes atalhos, a mesma URL serve todos os dias:
 *
 *   ?startDate=yesterday&endDate=yesterday   (o dia anterior)
 *   ?startDate=D-7&endDate=yesterday         (janela movel de 7 dias)
 *
 * **Fuso horario importa aqui.** "Ontem" depende de onde se esta: a Vercel roda
 * em UTC, e entre 21h e 23h59 no horario de Brasilia o UTC ja virou o dia
 * seguinte. Uma rotina noturna pediria o dia errado. Como as metricas do UOL
 * Ads sao dias de calendario brasileiro, resolvemos no fuso configurado
 * (`REPORT_TIMEZONE`, por padrao America/Sao_Paulo) e nao no do servidor.
 */

export const DEFAULT_REPORT_TIMEZONE = 'America/Sao_Paulo';

/** `yyyy-MM-dd`, o formato aceito pela origem. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `D-7`, `d-30`: quantos dias atras a partir de hoje. */
const DAYS_AGO = /^d-(\d{1,4})$/i;

/**
 * Data de hoje no fuso informado, em `yyyy-MM-dd`.
 *
 * `en-CA` e usado porque formata justamente nesse padrao, evitando montar a
 * string a partir de componentes separados.
 */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Soma (ou subtrai) dias de uma data `yyyy-MM-dd`.
 *
 * A aritmetica roda em UTC de proposito: a data ja foi resolvida no fuso certo,
 * e UTC nao tem horario de verao para deslocar o resultado.
 */
export function shiftDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Atalhos aceitos, além de `D-n`. Documentados no Swagger. */
export const RELATIVE_DATE_TOKENS = ['today', 'hoje', 'yesterday', 'ontem'] as const;

/**
 * Converte um atalho em data absoluta. Uma data `yyyy-MM-dd` passa intacta, e
 * qualquer outro texto tambem - cabe ao validador do DTO recusa-lo, para que a
 * mensagem de erro continue sendo a de formato.
 */
export function resolveRelativeDate(
  value: unknown,
  timeZone: string = DEFAULT_REPORT_TIMEZONE,
  now: Date = new Date(),
): unknown {
  if (typeof value !== 'string') {
    return value;
  }

  const token = value.trim().toLowerCase();

  if (ISO_DATE.test(token)) {
    return token;
  }

  const today = () => todayIn(timeZone, now);

  switch (token) {
    case 'today':
    case 'hoje':
      return today();
    case 'yesterday':
    case 'ontem':
      return shiftDays(today(), -1);
  }

  const daysAgo = DAYS_AGO.exec(token);
  if (daysAgo) {
    return shiftDays(today(), -Number(daysAgo[1]));
  }

  return value;
}
