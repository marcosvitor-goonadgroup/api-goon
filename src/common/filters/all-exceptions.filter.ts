import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ErrorCode, type ErrorCodeValue } from '../constants';
import { type ApiErrorResponseDto } from '../dto/api-response.dto';
import { IntegrationException } from '../exceptions/integration.exception';

/** Menor status considerado falha do servidor - separa o que vira log de erro. */
const SERVER_ERROR_THRESHOLD = 500;

interface NormalizedError {
  status: number;
  code: ErrorCodeValue;
  message: string;
  details?: unknown;
  source?: string;
}

/** Mapeia status HTTP para os codigos estaveis expostos ao cliente. */
const STATUS_TO_CODE: Partial<Record<number, ErrorCodeValue>> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.VALIDATION_ERROR,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHORIZED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.REQUEST_TIMEOUT]: ErrorCode.REQUEST_TIMEOUT,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMIT_EXCEEDED,
  [HttpStatus.BAD_GATEWAY]: ErrorCode.INTEGRATION_ERROR,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.INTEGRATION_UNAVAILABLE,
  [HttpStatus.GATEWAY_TIMEOUT]: ErrorCode.INTEGRATION_TIMEOUT,
};

/**
 * Ponto unico de traducao de excecoes para resposta HTTP.
 *
 * Regras que este filtro garante:
 * - toda falha sai no mesmo formato (`ApiErrorResponseDto`);
 * - erros de validacao vem detalhados campo a campo;
 * - 5xx nao vazam mensagem interna em producao, mas sao logados com stack;
 * - o `requestId` acompanha a resposta, ligando-a a linha de log correspondente.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(private readonly isProduction: boolean) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const normalized = this.normalize(exception);
    const startedAt = request.requestStartedAt ?? Date.now();
    const requestId = request.requestId ?? 'unknown';

    const body: ApiErrorResponseDto = {
      success: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details !== undefined ? { details: normalized.details } : {}),
        ...(normalized.source ? { source: normalized.source } : {}),
      },
      meta: {
        requestId,
        timestamp: new Date().toISOString(),
        durationMs: Date.now() - startedAt,
      },
      path: request.originalUrl ?? request.url,
      statusCode: normalized.status,
    };

    this.log(exception, normalized, request, requestId);

    response.status(normalized.status).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof IntegrationException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        source: exception.source,
      };
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception);
    }

    // Qualquer outra coisa e bug nosso: resposta generica, log completo.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message: this.isProduction
        ? 'Erro interno do servidor.'
        : exception instanceof Error
          ? exception.message
          : 'Erro interno do servidor.',
    };
  }

  private fromHttpException(exception: HttpException): NormalizedError {
    const status = exception.getStatus();
    const payload = exception.getResponse();
    const code = STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR;

    if (typeof payload === 'string') {
      return { status, code, message: payload };
    }

    const record = payload as Record<string, unknown>;
    const rawMessage = record.message;

    // O ValidationPipe entrega `message: string[]` - vira `details` estruturado.
    if (Array.isArray(rawMessage)) {
      return {
        status,
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Os dados enviados sao invalidos.',
        details: { issues: rawMessage.map(String) },
      };
    }

    return {
      status,
      code: typeof record.code === 'string' ? (record.code as ErrorCodeValue) : code,
      message:
        typeof rawMessage === 'string' ? rawMessage : (exception.message ?? 'Erro na requisicao.'),
      details: record.details,
    };
  }

  private log(
    exception: unknown,
    normalized: NormalizedError,
    request: Request,
    requestId: string,
  ): void {
    const context = `${request.method} ${request.originalUrl ?? request.url} -> ${normalized.status} [${requestId}]`;

    if (normalized.status >= SERVER_ERROR_THRESHOLD) {
      this.logger.error(
        `${context} ${normalized.message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
      return;
    }

    this.logger.warn(`${context} ${normalized.code}: ${normalized.message}`);
  }
}
