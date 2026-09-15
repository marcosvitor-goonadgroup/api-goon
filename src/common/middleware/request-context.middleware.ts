import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { REQUEST_ID_HEADER } from '../constants';

/**
 * Garante um identificador de correlacao para cada requisicao.
 *
 * Reaproveita o `x-request-id` recebido (util quando a chamada vem de outro
 * servico nosso) e sempre devolve o valor no header da resposta, para que o
 * cliente consiga referenciar a requisicao ao abrir um chamado.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const fromHeader = (Array.isArray(incoming) ? incoming[0] : incoming)?.trim();

    // O pino-http roda antes e ja atribuiu um id em `req.id`; reaproveita-lo
    // mantem o identificador da resposta igual ao que aparece nos logs.
    const fromLogger = (req as Request & { id?: unknown }).id;

    const requestId =
      fromHeader ||
      (typeof fromLogger === 'string' || typeof fromLogger === 'number'
        ? String(fromLogger)
        : undefined) ||
      randomUUID();

    req.requestId = requestId;
    req.requestStartedAt = Date.now();
    res.setHeader(REQUEST_ID_HEADER, requestId);

    next();
  }
}
