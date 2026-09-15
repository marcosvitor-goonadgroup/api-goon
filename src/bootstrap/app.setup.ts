import { VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import compression from 'compression';
import helmet from 'helmet';

import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { AppConfigService } from '../config/app-config.service';

/**
 * Aplica toda a configuracao de runtime da aplicacao.
 *
 * Existe separado do `main.ts` por um motivo pratico: os testes e2e usam
 * exatamente esta funcao. Sem isso, o ambiente de teste iria divergir do de
 * producao em prefixo, versionamento ou tratamento de erro - e os testes
 * passariam a validar uma aplicacao que nao e a que roda de verdade.
 */
export function configureApp(app: NestExpressApplication): AppConfigService {
  const config = app.get(AppConfigService);

  // --- Seguranca e transporte ------------------------------------------
  app.use(
    helmet({
      // A documentacao carrega assets de CDN; a CSP padrao do helmet bloqueia.
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(compression());

  const { corsOrigins } = config.security;
  app.enableCors({
    origin: corsOrigins.length === 0 || corsOrigins.includes('*') ? true : corsOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', config.security.apiKeyHeader, 'x-request-id'],
    exposedHeaders: ['x-request-id', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
    credentials: true,
    maxAge: 86_400,
  });

  // Confia no proxy da Vercel para obter o IP real em `x-forwarded-for`.
  app.set('trust proxy', 1);

  // --- Rotas -----------------------------------------------------------
  app.setGlobalPrefix(config.apiPrefix, {
    // Health e a raiz ficam fora do prefixo: monitoramento e quem abre a URL
    // pela primeira vez nao deveriam precisar saber a versao.
    exclude: ['/', 'health', 'health/live', 'health/ready'],
  });

  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: config.apiVersion,
  });

  app.useGlobalFilters(new AllExceptionsFilter(config.isProduction));
  app.enableShutdownHooks();

  return config;
}
