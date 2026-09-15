import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import type { Request } from 'express';

import { AppConfigService } from '../../config/app-config.service';

/**
 * Rate limiting com `@nestjs/throttler`.
 *
 * Duas adaptacoes ao contexto desta API:
 *
 * - **rastreio por chave de API**, com fallback para IP. Parceiros diferentes
 *   atras do mesmo IP (ou do mesmo proxy) nao disputam a mesma cota.
 * - **IP real via `x-forwarded-for`**, ja que na Vercel a aplicacao sempre
 *   enxerga o proxy da plataforma como origem.
 *
 * Limitacao de serverless: o storage padrao vive na memoria da instancia,
 * entao o teto efetivo e `RATE_LIMIT_MAX x instancias ativas`. Para um limite
 * global, use o Vercel Firewall (na borda, antes da funcao) ou plugue um
 * storage Redis via a opcao `storage`.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.rateLimit.windowMs,
            limit: config.rateLimit.max,
          },
        ],

        skipIf: () => !config.rateLimit.enabled,

        getTracker: (req: Record<string, unknown>): string => {
          const request = req as unknown as Request;
          const header = request.headers?.[config.security.apiKeyHeader];
          const apiKey = (Array.isArray(header) ? header[0] : header)?.trim();

          if (apiKey) {
            return `key:${apiKey}`;
          }

          const forwarded = request.headers?.['x-forwarded-for'];
          const ip = Array.isArray(forwarded)
            ? forwarded[0]
            : (forwarded?.split(',')[0]?.trim() ?? request.ip);

          return `ip:${ip ?? 'desconhecido'}`;
        },

        errorMessage: `Limite de ${config.rateLimit.max} requisicoes por ${
          config.rateLimit.windowMs / 1000
        }s excedido. Aguarde antes de tentar novamente.`,

        // Envia X-RateLimit-Limit / Remaining / Reset nas respostas.
        setHeaders: true,
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class AppThrottlerModule {}
