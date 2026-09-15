import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap/app.setup';
import { setupSwagger } from '../src/bootstrap/swagger.setup';

/**
 * Gera `openapi.json` sem subir a API.
 *
 * Serve para versionar o contrato, alimentar geradores de SDK e rodar diff de
 * API na esteira de CI - detectando quebra de compatibilidade antes do merge.
 *
 * Uso: `npm run openapi:export`
 */
async function exportOpenApi(): Promise<void> {
  process.env.SWAGGER_ENABLED = 'true';

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: false,
  });

  const config = configureApp(app);
  const document = setupSwagger(app, config);

  if (!document) {
    throw new Error('Nao foi possivel gerar o documento OpenAPI.');
  }

  const outputPath = resolve(process.cwd(), 'openapi.json');
  writeFileSync(outputPath, JSON.stringify(document, null, 2), 'utf-8');

  const operations = Object.values(document.paths ?? {}).reduce(
    (total, path) => total + Object.keys(path ?? {}).length,
    0,
  );

  console.log(`OpenAPI gerado em ${outputPath}`);
  console.log(`${Object.keys(document.paths ?? {}).length} rotas / ${operations} operacoes`);

  await app.close();
}

void exportOpenApi().catch((error: unknown) => {
  console.error('Falha ao exportar o OpenAPI:', error);
  process.exit(1);
});
