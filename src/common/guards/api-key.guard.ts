import { timingSafeEqual } from 'node:crypto';

import {
  type CanActivate,
  type ExecutionContext,
  HttpStatus,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppConfigService } from '../../config/app-config.service';
import { ErrorCode, IS_PUBLIC_KEY } from '../constants';

/**
 * Autenticacao por chave de API - o modelo tipico para integracao
 * servidor-a-servidor, que e o caso de uso desta API.
 *
 * Se `API_KEYS` estiver vazio a protecao fica desligada (conveniente em dev).
 * O aviso no boot existe para que isso nunca passe despercebido em producao.
 *
 * Para trocar por JWT/OAuth, substitua este guard no `APP_GUARD` do
 * `AppModule` - nenhum controller precisa mudar.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly config: AppConfigService,
  ) {
    if (this.config.security.apiKeys.length === 0) {
      this.logger.warn(
        'Nenhuma API_KEY configurada: a API esta aberta. Defina API_KEYS antes de expor em producao.',
      );
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const { apiKeys, apiKeyHeader } = this.config.security;

    if (apiKeys.length === 0) {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const provided = this.extractKey(request, apiKeyHeader);

    if (!provided || !this.matches(provided, apiKeys)) {
      throw new UnauthorizedException({
        code: ErrorCode.UNAUTHORIZED,
        message: `Chave de API ausente ou invalida. Envie-a no header "${apiKeyHeader}".`,
        statusCode: HttpStatus.UNAUTHORIZED,
      });
    }

    request.apiKey = provided;
    return true;
  }

  /** Aceita `x-api-key: <chave>` ou `Authorization: Bearer <chave>`. */
  private extractKey(request: Request, headerName: string): string | undefined {
    const header = request.headers[headerName];
    const fromCustomHeader = Array.isArray(header) ? header[0] : header;

    if (fromCustomHeader?.trim()) {
      return fromCustomHeader.trim();
    }

    const authorization = request.headers.authorization;
    if (authorization?.toLowerCase().startsWith('bearer ')) {
      return authorization.slice(7).trim() || undefined;
    }

    return undefined;
  }

  /** Comparacao em tempo constante, para nao vazar a chave por timing. */
  private matches(provided: string, allowed: string[]): boolean {
    const providedBuffer = Buffer.from(provided);

    return allowed.some((candidate) => {
      const candidateBuffer = Buffer.from(candidate);
      if (candidateBuffer.length !== providedBuffer.length) {
        return false;
      }
      return timingSafeEqual(candidateBuffer, providedBuffer);
    });
  }
}
