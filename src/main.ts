import 'reflect-metadata';

import { Logger as NestLogger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { configureApp } from './bootstrap/app.setup';
import { setupSwagger } from './bootstrap/swagger.setup';

/**
 * Ponto de entrada unico - local e Vercel.
 *
 * A Vercel detecta `src/main.ts` automaticamente e transforma a aplicacao numa
 * Vercel Function, interceptando o `listen()`. Por isso o arquivo mantem a
 * forma convencional do NestJS: o mesmo codigo que roda em `npm run dev` e o
 * que vai para producao, sem handler paralelo para manter em sincronia.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Segura os logs do boot ate o pino assumir, para nao perder nada.
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const config = configureApp(app);
  setupSwagger(app, config);

  await app.listen(config.port, '0.0.0.0');

  const logger = new NestLogger('Bootstrap');
  logger.log(`api-goon no ar em ${await app.getUrl()} (${config.env})`);
  logger.log(`Rotas versionadas em /${config.apiPrefix}/v${config.apiVersion}`);
  if (config.swagger.enabled) {
    logger.log(`Documentacao em /${config.swagger.path}`);
  }
}

void bootstrap();
