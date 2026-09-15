import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { apiReference } from '@scalar/nestjs-api-reference';

import type { AppConfigService } from '../config/app-config.service';

/** Versao do swagger-ui servida por CDN (ver nota abaixo sobre serverless). */
const SWAGGER_UI_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5';

const DESCRIPTION = `
API de **busca e integracao de dados**.

Consulta multiplos sistemas externos por uma interface unica e devolve os
resultados num formato normalizado, com diagnostico por origem.

### Como usar

1. \`GET /integrations\` - descubra quais sistemas estao conectados e o que cada um responde.
2. \`GET /integrations/capabilities\` - veja os tipos de consulta aceitos.
3. \`GET /search?q=<termo>\` - busque em todas as origens compativeis de uma vez.
4. \`GET /search/{source}?q=<termo>\` - busque em uma origem especifica.

### Formato das respostas

Toda resposta de sucesso vem embrulhada em \`{ success, data, meta }\`; toda
falha, em \`{ success, error, meta, path, statusCode }\`. O campo
\`meta.requestId\` tambem volta no header \`x-request-id\` - use-o ao reportar
qualquer problema.

### Resultados parciais

A busca federada e tolerante a falhas: se uma origem cair, as demais continuam
respondendo. Verifique \`data.partial\` e o bloco \`data.sources\` para saber o
que cada sistema retornou.

### Autenticacao

Quando \`API_KEYS\` esta configurado, envie a chave no header \`x-api-key\`
(ou como \`Authorization: Bearer <chave>\`). As rotas de health sao publicas.
`;

/**
 * Publica a documentacao em dois formatos:
 * - **Scalar** (`/docs`): leitura e testes, interface moderna;
 * - **Swagger UI** (`/docs/swagger`): o classico, para quem ja tem o fluxo nele;
 * - **OpenAPI JSON** (`/docs/openapi.json`): para gerar SDKs e importar no Postman/Insomnia.
 *
 * Nota sobre serverless: o Swagger UI e carregado de CDN em vez dos assets
 * empacotados. Na Vercel os arquivos estaticos do `swagger-ui-dist` nao entram
 * no bundle da funcao, e a pagina abriria sem estilo nem JavaScript.
 */
export function setupSwagger(
  app: INestApplication,
  config: AppConfigService,
): OpenAPIObject | null {
  if (!config.swagger.enabled) {
    return null;
  }

  const docsPath = config.swagger.path;
  const jsonPath = `${docsPath}/openapi.json`;

  const builder = new DocumentBuilder()
    .setTitle('api-goon')
    .setDescription(DESCRIPTION)
    .setVersion(config.apiVersion)
    .addApiKey(
      {
        type: 'apiKey',
        name: config.security.apiKeyHeader,
        in: 'header',
        description: 'Chave de API fornecida ao parceiro.',
      },
      'api-key',
    )
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', description: 'Alternativa ao header de API key.' },
      'bearer',
    )
    .addTag('Busca', 'Consulta federada e direcionada nas integracoes')
    .addTag('Integracoes', 'Catalogo, capabilities e saude dos conectores')
    .addTag('Health', 'Liveness e readiness')
    .addTag('Sistema', 'Informacoes gerais da API');

  // Na Vercel a URL publica muda a cada deploy: apontar o server para ela faz
  // o "Try it out" funcionar tanto em preview quanto em producao.
  const vercelUrl = process.env.VERCEL_URL;
  if (vercelUrl) {
    builder.addServer(`https://${vercelUrl}`, `Vercel (${process.env.VERCEL_ENV ?? 'deploy'})`);
  }
  builder.addServer(`http://localhost:${config.port}`, 'Local');

  const document = SwaggerModule.createDocument(app, builder.build(), {
    // operationId legivel (ex.: `Busca_search`) melhora o codigo gerado por SDKs.
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });

  SwaggerModule.setup(`${docsPath}/swagger`, app, document, {
    jsonDocumentUrl: jsonPath,
    customSiteTitle: 'api-goon | Swagger UI',
    customCssUrl: `${SWAGGER_UI_CDN}/swagger-ui.css`,
    customJs: [
      `${SWAGGER_UI_CDN}/swagger-ui-bundle.js`,
      `${SWAGGER_UI_CDN}/swagger-ui-standalone-preset.js`,
    ],
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      filter: true,
      tryItOutEnabled: true,
    },
  });

  // Rota exata (e nao `app.use`), para nao capturar `/docs/swagger` por prefixo.
  app.getHttpAdapter().get(
    `/${docsPath}`,
    apiReference({
      url: `/${jsonPath}`,
      title: 'api-goon | Referencia da API',
    }),
  );

  return document;
}
