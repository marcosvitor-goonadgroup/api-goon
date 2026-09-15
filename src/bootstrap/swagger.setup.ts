import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

import type { AppConfigService } from '../config/app-config.service';

/** Versao do swagger-ui servida por CDN (ver nota abaixo sobre serverless). */
const SWAGGER_UI_CDN = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5';

/** Scalar em modo standalone, tambem por CDN (ver nota abaixo). */
const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';

/** Neutraliza aspas e sinais de tag ao interpolar valores no HTML. */
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );

/**
 * Pagina do Scalar montada a mao.
 *
 * O pacote `@scalar/nestjs-api-reference` seria mais direto, mas ele e CommonJS
 * e faz `require()` de uma dependencia que so existe como ESM. O Node local
 * tolera isso; o runtime da Vercel nao, e a funcao inteira morria no boot com
 * `ERR_REQUIRE_ESM` - derrubando a API toda, nao apenas a documentacao.
 * Servindo o HTML direto do CDN nao ha dependencia de runtime para quebrar.
 */
const scalarHtml = (specUrl: string, title: string): string => `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <script id="api-reference" data-url="${escapeHtml(specUrl)}"></script>
    <script src="${SCALAR_CDN}"></script>
  </body>
</html>`;

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

/** O minimo da resposta do Express que a rota da documentacao usa. */
interface DocsResponse {
  type(contentType: string): DocsResponse;
  send(body: string): unknown;
}

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
  const page = scalarHtml(`/${jsonPath}`, 'api-goon | Referencia da API');
  app.getHttpAdapter().get(`/${docsPath}`, (_req: unknown, res: DocsResponse) => {
    res.type('text/html').send(page);
  });

  return document;
}
