import {
  type CallHandler,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { map, type Observable } from 'rxjs';

import { RAW_RESPONSE_KEY } from '../constants';
import { type ApiSuccessResponseDto } from '../dto/api-response.dto';

/** 204 nao carrega corpo; comparado como numero para bater com `res.statusCode`. */
const NO_CONTENT_STATUS: number = HttpStatus.NO_CONTENT;

/**
 * Embrulha toda resposta de sucesso no envelope `{ success, data, meta }`.
 *
 * Rotas anotadas com `@RawResponse()` passam intactas - necessario para
 * endpoints que precisam devolver um formato ditado por terceiros.
 */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, ApiSuccessResponseDto<T> | T> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponseDto<T> | T> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isRaw) {
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((data) => {
        // 204 nao carrega corpo - envolver aqui geraria uma resposta invalida.
        if (response.statusCode === NO_CONTENT_STATUS || data === undefined) {
          return data;
        }

        const startedAt = request.requestStartedAt ?? Date.now();

        return {
          success: true as const,
          data,
          meta: {
            requestId: request.requestId ?? 'unknown',
            timestamp: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
          },
        };
      }),
    );
  }
}
