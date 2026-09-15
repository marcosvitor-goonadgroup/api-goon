import { HttpException, HttpStatus } from '@nestjs/common';

import { ErrorCode, type ErrorCodeValue } from '../constants';

export interface IntegrationExceptionPayload {
  /** Codigo estavel exposto ao cliente. */
  code: ErrorCodeValue;
  /** Mensagem legivel, ja tratada (nunca vaze detalhes internos aqui). */
  message: string;
  /** Chave do conector que originou a falha (ex.: `uol-ads`). */
  source: string;
  /** Contexto adicional: corpo do erro remoto, status original, etc. */
  details?: unknown;
  /** Status HTTP que a nossa API devolve. */
  status?: HttpStatus;
}

/**
 * Erro originado em um sistema externo.
 *
 * Conectores devem traduzir qualquer falha remota para esta excecao (ou uma
 * das especializacoes abaixo). Assim o filtro global produz sempre a mesma
 * forma de resposta e o cliente nunca ve um stack trace do axios.
 */
export class IntegrationException extends HttpException {
  readonly code: ErrorCodeValue;
  readonly source: string;
  readonly details?: unknown;

  constructor(payload: IntegrationExceptionPayload) {
    const status = payload.status ?? HttpStatus.BAD_GATEWAY;
    super(payload.message, status);

    this.name = new.target.name;
    this.code = payload.code;
    this.source = payload.source;
    this.details = payload.details;
  }
}

/** O sistema externo nao respondeu dentro do tempo limite. */
export class IntegrationTimeoutException extends IntegrationException {
  constructor(source: string, timeoutMs: number, details?: unknown) {
    super({
      code: ErrorCode.INTEGRATION_TIMEOUT,
      message: `A integracao "${source}" nao respondeu em ${timeoutMs}ms.`,
      source,
      details,
      status: HttpStatus.GATEWAY_TIMEOUT,
    });
  }
}

/** Circuito aberto ou indisponibilidade confirmada do sistema externo. */
export class IntegrationUnavailableException extends IntegrationException {
  constructor(source: string, reason: string, details?: unknown) {
    super({
      code: ErrorCode.INTEGRATION_UNAVAILABLE,
      message: `A integracao "${source}" esta indisponivel: ${reason}`,
      source,
      details,
      status: HttpStatus.SERVICE_UNAVAILABLE,
    });
  }
}

/** O sistema externo respondeu, mas num formato que nao conseguimos interpretar. */
export class UpstreamResponseException extends IntegrationException {
  constructor(source: string, reason: string, details?: unknown) {
    super({
      code: ErrorCode.UPSTREAM_INVALID_RESPONSE,
      message: `Resposta inesperada da integracao "${source}": ${reason}`,
      source,
      details,
      status: HttpStatus.BAD_GATEWAY,
    });
  }
}

/** A chave de conector informada na requisicao nao existe ou esta desabilitada. */
export class ConnectorNotFoundException extends IntegrationException {
  constructor(key: string, available: string[]) {
    super({
      code: ErrorCode.INTEGRATION_NOT_FOUND,
      message: `Conector "${key}" nao encontrado ou desabilitado.`,
      source: key,
      details: { available },
      status: HttpStatus.NOT_FOUND,
    });
  }
}
