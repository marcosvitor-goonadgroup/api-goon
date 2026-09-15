import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LoggerModule } from 'nestjs-pino';

import { REQUEST_ID_HEADER } from '../../common/constants';
import { AppConfigService } from '../../config/app-config.service';

/** Rotas ruidosas que nao agregam nada ao log de acesso. */
const IGNORED_PATHS = ['/health', '/health/live', '/health/ready', '/favicon.ico'];

/**
 * Logging estruturado com pino.
 *
 * Em producao sai JSON puro no stdout - que e exatamente o que a Vercel
 * coleta e indexa. Em desenvolvimento passa pelo `pino-pretty` para ficar
 * legivel no terminal.
 *
 * Dois cuidados deliberados:
 * - `redact` impede que credenciais (Authorization, x-api-key, cookies)
 *   apareçam em log - o erro classico de API de integracao;
 * - `genReqId` reaproveita o `x-request-id` recebido, de modo que o id nos
 *   logs e o mesmo devolvido ao cliente na resposta.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => ({
        pinoHttp: {
          level: config.logLevel,

          genReqId: (req: IncomingMessage, res: ServerResponse) => {
            const incoming = req.headers[REQUEST_ID_HEADER];
            const id = (Array.isArray(incoming) ? incoming[0] : incoming)?.trim() || randomUUID();
            res.setHeader(REQUEST_ID_HEADER, id);
            return id;
          },

          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.headers["x-api-key"]',
              'res.headers["set-cookie"]',
            ],
            censor: '[REDACTED]',
          },

          autoLogging: {
            ignore: (req: IncomingMessage) => {
              const url = (req.url ?? '').split('?')[0];
              return IGNORED_PATHS.includes(url) || url.startsWith(`/${config.swagger.path}`);
            },
          },

          // Enxuga o log de acesso: o payload completo de req/res raramente
          // ajuda e infla o custo de ingestao.
          serializers: {
            req: (req: { id: string; method: string; url: string }) => ({
              id: req.id,
              method: req.method,
              url: req.url,
            }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },

          transport: config.isDevelopment
            ? {
                target: 'pino-pretty',
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: 'SYS:HH:MM:ss',
                  ignore: 'pid,hostname,req.id',
                },
              }
            : undefined,
        },
      }),
    }),
  ],
  exports: [LoggerModule],
})
export class AppLoggerModule {}
