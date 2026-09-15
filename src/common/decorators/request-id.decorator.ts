import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Injeta o identificador de correlacao da requisicao no handler.
 *
 * Evita espalhar `@Req()` pelos controllers so para ler um campo.
 */
export const RequestId = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest<Request>();
  return request.requestId ?? 'unknown';
});
