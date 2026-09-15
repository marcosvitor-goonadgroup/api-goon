# api-goon

API de **busca e integração de dados**: consulta vários sistemas externos por uma interface única e devolve os resultados num formato normalizado, com diagnóstico por origem.

Construída em NestJS + OpenAPI, pronta para deploy na Vercel.

---

## Índice

- [Como rodar](#como-rodar)
- [Endpoints](#endpoints)
- [Formato das respostas](#formato-das-respostas)
- [Arquitetura](#arquitetura)
- [Adicionando uma nova integração](#adicionando-uma-nova-integração)
- [Deploy na Vercel](#deploy-na-vercel)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Testes e qualidade](#testes-e-qualidade)
- [Decisões técnicas](#decisões-técnicas)

---

## Como rodar

```bash
npm install
cp .env.example .env
npm run dev
```

| Endereço | O quê |
| --- | --- |
| http://localhost:3000/ | Informações da API |
| http://localhost:3000/docs | Documentação interativa (Scalar) |
| http://localhost:3000/docs/swagger | Swagger UI |
| http://localhost:3000/docs/openapi.json | Especificação OpenAPI |
| http://localhost:3000/health | Health check |

**Stack:** NestJS 11 · TypeScript 5.9 · Express 5 · OpenAPI 3 (Swagger + Scalar) · Zod (validação de ambiente) · class-validator (validação de entrada) · pino (logs) · Jest.

---

## Endpoints

Rotas de negócio ficam sob `/api/v1`. Health e a raiz ficam fora do prefixo, porque monitoramento e quem abre a URL pela primeira vez não deveriam precisar saber a versão.

### Descoberta

```http
GET /api/v1/integrations              # catálogo de integrações e o que cada uma responde
GET /api/v1/integrations/capabilities # tipos de consulta aceitos
GET /api/v1/integrations/{key}        # detalhe de uma integração
GET /api/v1/integrations/{key}/health # saúde de uma integração (inclui o circuit breaker)
```

### Busca

```http
GET /api/v1/search?q={termo}          # busca federada: todas as origens compatíveis
GET /api/v1/search/{source}?q={termo} # busca direcionada a uma origem
GET /api/v1/search/{source}/{id}      # registro por identificador
```

| Parâmetro | Descrição |
| --- | --- |
| `q` | Termo buscado (obrigatório) |
| `capability` | Restringe o tipo de consulta. Hoje só `ad-campaign` |
| `sources` | Limita as origens: `sources=uol-ads` |
| `includeRaw` | `true` inclui o payload original de cada origem |
| `filters[chave]` | Filtros específicos do conector, repassados a quem os entenda |
| `page` / `limit` | Paginação (limit máximo: 100) |
| `sortBy` / `sortOrder` | Ordenação por `title`, `type`, `source`, `id`, `retrievedAt` |

**Exemplos:**

```bash
curl "http://localhost:3000/api/v1/search?q=radiola"           # campanhas por nome
curl "http://localhost:3000/api/v1/search?q=115912"            # campanha por ID
curl "http://localhost:3000/api/v1/search?q=radiola&sources=uol-ads"
```

Com uma única integração registrada, a busca federada funciona como uma busca comum. O valor dela aparece ao plugar a segunda origem: a mesma rota passa a consultar as duas em paralelo e devolver um resultado unificado, sem mudança no cliente.

### Mídia — UOL Ads

```http
GET /api/v1/ads/uol/campaigns                   # campanhas com estado normalizado
GET /api/v1/ads/uol/campaigns/{id}              # detalhe + conjuntos de anúncios
GET /api/v1/ads/uol/campaigns/{id}/report       # relatório da campanha
```

**Campanhas** — `?status=` filtra por `active`, `paused`, `completed` (e também `pending`, `approved`, `rejected`, `archived`, `deleted`). `?search=` busca por nome ou ID.

Toda resposta traz `statusSummary` com a contagem por estado **da conta inteira**, independente de filtro e paginação — responde "quantas tenho de cada" numa chamada:

```json
{ "items": [ ], "pagination": { },
  "statusSummary": { "completed": 13, "paused": 8, "pending": 1 },
  "totalAvailable": 22 }
```

**Relatório** — `startDate` e `endDate` (`yyyy-MM-dd`) são obrigatórios.

| Parâmetro | Descrição |
| --- | --- |
| `breakdown` | `date` (padrão) traz o criativo; `region` traz a UF |
| `layout` | `nested` (padrão) agrupa as métricas; `flat` devolve colunas fixas |
| `regions` | UFs a incluir (`SP,RJ`) ou `BR`. Exige `breakdown=region` |
| `groupIds` | Restringe a conjuntos de anúncios específicos |
| `page` / `limit` | Paginação — **limit padrão 20, máximo 100** |

#### A resposta é paginada

O relatório vem paginado, então `rows` traz no máximo `limit` linhas — é por isso que campanhas diferentes parecem devolver "o mesmo tamanho". O total real está em `pagination.total`:

```json
"pagination": { "page": 1, "limit": 20, "total": 1472, "totalPages": 74, "hasNextPage": true }
```

Um período de 45 dias com vários criativos passa de mil linhas facilmente, porque cada linha é uma combinação de data × conjunto × criativo. Para varrer tudo, use `limit=100` e percorra as páginas até `hasNextPage: false`.

Os `totals` **não** são afetados pela paginação: cobrem o período inteiro em qualquer página.

#### Datas relativas para consultas agendadas

`startDate` e `endDate` aceitam atalhos, para que uma rotina diária use sempre a mesma URL:

| Atalho | Significado |
| --- | --- |
| `today` / `hoje` | O dia corrente |
| `yesterday` / `ontem` | O dia anterior |
| `D-n` | `n` dias atrás (`D-7`, `D-30`) |

```bash
# o dia de ontem, todo dia
.../report?startDate=yesterday&endDate=yesterday

# janela móvel dos últimos 7 dias fechados
.../report?startDate=D-7&endDate=yesterday
```

Os atalhos são resolvidos no fuso **America/Sao_Paulo**, não no do servidor. Isso importa: a Vercel roda em UTC, onde a partir das 21h no horário de Brasília já é o dia seguinte — uma rotina noturna pediria o dia errado. O campo `period` da resposta sempre mostra as datas já resolvidas, então dá para conferir o que foi consultado.

Com `layout=flat` cada linha é um objeto plano de colunas fixas — **toda coluna existe sempre**, e o que a plataforma não mediu vem `null`. É o formato para planilha, BI ou carga em banco, onde uma coluna que some quebra o consumidor:

```json
{ "date": "2026-08-01",
  "campaignName": "...", "groupName": "...", "creativeName": "...",
  "region": null, "format": "IMAGE",
  "impressions": 10415, "clicks": 23, "cost": 45.31,
  "views": null, "views25": null, "views50": null, "views75": null, "views100": null,
  "trueViews": null,
  "viewableImpressions": 7155, "viewabilityRate": 0.687,
  "conversions": null,
  "ctr": 0.221, "cpc": 1.97, "cpm": 4.35 }
```

O campo `unavailableFields` da resposta lista as colunas que a plataforma não entrega naquele corte — vazio em `breakdown=date`, e com dez colunas em `breakdown=region`.

```bash
# por data: conjunto de anúncios + criativo
curl "localhost:3000/api/v1/ads/uol/campaigns/115912/report?startDate=2026-08-01&endDate=2026-08-31"

# por localidade
curl "localhost:3000/api/v1/ads/uol/campaigns/115912/report?startDate=2026-08-01&endDate=2026-08-31&breakdown=region&regions=SP,RJ"
```

Os `totals` no fim cobrem o período inteiro, não a página, e as taxas (`ctr`, `cpc`, `cpm`) são recalculadas sobre os somatórios — média de médias daria número errado, já que cada linha tem peso diferente em impressões.

As campanhas também entram na busca federada: `GET /api/v1/search?q=radiola`.

#### Duas limitações da plataforma que a API contorna

**O filtro de status da origem não é confiável.** Medido na conta real: `status=ATIVO` devolve 4 campanhas, das quais 3 estão finalizadas e nenhuma ativa; `status=PAUSADO` devolve 18, sendo 10 finalizadas. Ele filtra pela *configuração* da campanha, não pelo estado efetivo. Por isso **não usamos esse parâmetro**: buscamos a lista completa e classificamos pelo campo `status` de cada registro, que é confiável.

**O corte por localidade é bem mais pobre.** O endpoint de regiões da plataforma devolve apenas data, campanha, conjunto, região, impressões, cliques e custo. Não há criativo, métricas de vídeo, viewability nem conversões nesse corte — e ele responde 400 se receber a dimensão de criativo. A resposta traz `creativeAvailable: false` e lista em `unavailableFields` exatamente quais colunas virão vazias, em vez de deixar você concluir que a campanha não tem esses dados.

#### O que cada campo significa

| Campo | Origem | Observação |
| --- | --- | --- |
| `views` | `videoStart` | Vídeo iniciado |
| `views25/50/75/100` | quartis de vídeo | Preenchidos só em campanha de vídeo |
| `trueViews` | `trueView` | Visualização qualificada |
| `viewabilityRate` | `viewableImpressionsRate` | Proporção de 0 a 1 |
| `conversions` | `totalConversions` | Exige conversão configurada na campanha |

**Não existe métrica de engajamento na API do UOL Ads.** Nenhum dos cinco endpoints de relatório expõe curtidas, comentários, compartilhamentos ou interações. A métrica de interação disponível é `clicks`.

### Health

```http
GET /health       # processo + todas as integrações
GET /health/live  # liveness: não toca em nenhum sistema externo
GET /health/ready # readiness: consulta as integrações ativas (503 se alguma estiver fora)
```

`live` e `ready` são separados de propósito: sem isso, uma dependência externa fora do ar faria um orquestrador reiniciar a aplicação, que está perfeitamente saudável.

---

## Formato das respostas

**Sucesso** — sempre o mesmo envelope:

```json
{
  "success": true,
  "data": { },
  "meta": {
    "requestId": "8f3d2c1a-5b6e-4f70-9c2d-1e4a7b9c0d11",
    "timestamp": "2026-09-11T18:30:00.000Z",
    "durationMs": 142
  }
}
```

**Erro** — mesma forma para 4xx e 5xx:

```json
{
  "success": false,
  "error": {
    "code": "INTEGRATION_TIMEOUT",
    "message": "A integracao \"uol-ads\" nao respondeu em 8000ms.",
    "details": { },
    "source": "uol-ads"
  },
  "meta": { "requestId": "...", "timestamp": "...", "durationMs": 8012 },
  "path": "/api/v1/search",
  "statusCode": 504
}
```

Programe contra `error.code`, não contra a mensagem. Os códigos estáveis estão em [`src/common/constants.ts`](src/common/constants.ts).

O `meta.requestId` também volta no header `x-request-id` e aparece nos logs — é o que liga uma resposta à linha de log correspondente. Se o cliente enviar esse header, ele é preservado.

### Resultado parcial

A busca federada é tolerante a falhas: se uma origem cair, as demais continuam respondendo.

```json
{
  "items": [ ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 },
  "sources": [
    { "key": "uol-ads", "outcome": "ok", "count": 2, "tookMs": 185 },
    { "key": "outra-origem", "outcome": "error", "count": 0, "tookMs": 8003,
      "error": "...", "errorCode": "INTEGRATION_TIMEOUT" }
  ],
  "partial": true
}
```

| `outcome` | Significado |
| --- | --- |
| `ok` | Retornou registros |
| `empty` | Respondeu, sem resultados |
| `error` | Falhou |
| `timeout` | Estourou o tempo limite |
| `skipped` | Não atende esse tipo de consulta |

Verifique `partial` antes de tratar a lista como completa.

---

## Arquitetura

```
src/
├── main.ts                      # entrypoint (local e Vercel)
├── app.module.ts                # composição: guards, pipes e interceptors globais
├── app.controller.ts            # GET / com as informações da API
│
├── bootstrap/
│   ├── app.setup.ts             # configuração de runtime (usada também pelos testes e2e)
│   └── swagger.setup.ts         # OpenAPI + Scalar + Swagger UI
│
├── config/
│   ├── env.schema.ts            # contrato do ambiente, validado com Zod
│   ├── configuration.ts         # env cru -> configuração em seções
│   └── app-config.service.ts    # fachada tipada (injete isto, não o ConfigService)
│
├── common/                      # o que atravessa todos os módulos
│   ├── constants.ts             # códigos de erro estáveis
│   ├── decorators/              # @Public, @RawResponse, @RequestId, decorators de Swagger
│   ├── dto/                     # envelope de resposta, paginação
│   ├── exceptions/              # IntegrationException e especializações
│   ├── filters/                 # tratamento centralizado de erro
│   ├── guards/                  # autenticação por API key
│   ├── interceptors/            # envelope de sucesso
│   └── middleware/              # correlação de requisição
│
├── core/                        # infraestrutura
│   ├── http/                    # cliente resiliente: retry, timeout, circuit breaker, cache
│   ├── health/                  # liveness, readiness e indicador dos conectores
│   ├── logger/                  # pino: JSON em produção, legível em dev
│   └── throttler/               # rate limiting
│
├── integrations/                # ── o coração da extensibilidade ──
│   ├── contracts/               # a interface que toda integração implementa
│   ├── base/                    # classe base HTTP: cache, health, normalização
│   ├── registry/                # descoberta automática de conectores
│   ├── decorators/              # @RegisterConnector()
│   └── connectors/
│       └── uol-ads/             # origem autenticada, com domínio próprio
│
└── modules/
    ├── search/                  # busca federada (fan-out, agregação, falha parcial)
    └── ads/                     # rotas de mídia sobre o conector do UOL Ads
```

### As três camadas

**Contrato** ([`contracts/connector.contract.ts`](src/integrations/contracts/connector.contract.ts)) — toda integração implementa `DataConnector`: metadados, `supports()`, `search()`, `health()` e opcionalmente `findById()`. É o que permite ao resto do sistema tratar sistemas totalmente diferentes de forma uniforme.

**Base** ([`base/base-http.connector.ts`](src/integrations/base/base-http.connector.ts)) — implementa o que toda integração repetiria: chamada resiliente, chave de cache, health check, montagem do registro normalizado. A subclasse escreve apenas o que é específico daquele sistema.

**Registry** ([`registry/connector-registry.service.ts`](src/integrations/registry/connector-registry.service.ts)) — descobre os conectores no boot via `DiscoveryService`. Não existe lista central para manter em sincronia.

### Resiliência

Toda chamada externa passa pelo [`ResilientHttpService`](src/core/http/resilient-http.service.ts):

- **timeout** por chamada (`HTTP_TIMEOUT_MS`);
- **retry** com backoff exponencial e jitter — só para falhas que fazem sentido repetir (5xx, 429, rede). Um 4xx é resposta definitiva e propaga na hora;
- **circuit breaker** por integração: depois de N falhas consecutivas o circuito abre e as chamadas seguintes falham imediatamente, em vez de consumir o tempo de execução da função esperando um timeout;
- **cache** de resposta com TTL por tipo de consulta (`UOL_ADS_CACHE_TTL_MS` para campanhas; o dobro para relatórios);
- **tradução de erro**: nenhuma exceção de `axios` vaza para o cliente.

Somando com o teto de tempo global do fan-out (`SEARCH_TIMEOUT_MS`), a resposta nunca fica refém da origem mais lenta.

---

## Adicionando uma nova integração

Três passos. Nenhum arquivo existente muda, exceto uma linha no módulo.

### 1. Crie o conector

`src/integrations/connectors/meusistema/meusistema.connector.ts`:

```ts
import { Injectable } from '@nestjs/common';

import { AppConfigService } from '../../../config/app-config.service';
import { ResilientHttpService } from '../../../core/http/resilient-http.service';
import { BaseHttpConnector } from '../../base/base-http.connector';
import type {
  ConnectorContext,
  ConnectorMetadata,
  ConnectorQuery,
  NormalizedRecord,
} from '../../contracts/connector.contract';
import { RegisterConnector } from '../../decorators/register-connector.decorator';

interface MeuSistemaCliente {
  id: string;
  nome: string;
  documento: string;
  email: string;
}

@Injectable()
@RegisterConnector()
export class MeuSistemaConnector extends BaseHttpConnector {
  constructor(http: ResilientHttpService, config: AppConfigService) {
    super(http, config);
  }

  readonly metadata: ConnectorMetadata = {
    key: 'meusistema',
    label: 'Meu Sistema',
    description: 'Consulta de clientes no ERP interno.',
    capabilities: ['cliente'],
    baseUrl: this.config.connectors.meusistema.baseUrl,
    requiresCredentials: true,
  };

  isEnabled(): boolean {
    // Com credencial obrigatória, exija-a aqui: sem chave o conector fica fora
    // do catálogo, em vez de responder 401 a cada chamada.
    const { enabled, token } = this.config.connectors.meusistema;
    return enabled && token.length > 0;
  }

  /**
   * Credenciais da origem. Aplicadas em `fetch()` e também no health check —
   * sem isso o probe tomaria 401 e o conector apareceria como `down`.
   */
  protected override authHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.connectors.meusistema.token}` };
  }

  /** Evita fan-out inútil: só é chamado quando faz sentido. */
  supports(query: ConnectorQuery): boolean {
    if (query.capability) {
      return this.metadata.capabilities.includes(query.capability);
    }
    return query.term.trim().length >= 3;
  }

  async search(query: ConnectorQuery, context: ConnectorContext): Promise<NormalizedRecord[]> {
    // `fetch` já aplica credenciais, timeout, retry, circuit breaker e cache.
    const clientes = await this.fetch<MeuSistemaCliente[]>('/clientes', {
      params: { busca: query.term, limite: query.limit ?? 20 },
      cacheTtlMs: 5 * 60 * 1000,
    });

    if (!clientes?.length) {
      return [];
    }

    // Normalizar aqui é o que permite devolver este dado lado a lado com o
    // de qualquer outra origem.
    return clientes.map((cliente) =>
      this.toRecord({
        id: cliente.id,
        type: 'customer',
        title: cliente.nome,
        subtitle: cliente.documento,
        context,
        raw: cliente,
        attributes: {
          document: cliente.documento,
          name: cliente.nome,
          email: cliente.email,
        },
      }),
    );
  }

  /** Endpoint barato e estável, usado pelo health check. */
  protected healthProbePath(): string {
    return '/status';
  }
}
```

### 2. Declare a configuração

Em [`src/config/env.schema.ts`](src/config/env.schema.ts):

```ts
MEUSISTEMA_ENABLED: booleanFromEnv(false),
MEUSISTEMA_BASE_URL: z.string().url().default('https://erp.interno/api'),
MEUSISTEMA_TOKEN: z.string().default(''),
```

Em [`src/config/configuration.ts`](src/config/configuration.ts), dentro de `connectors`:

```ts
meusistema: {
  enabled: env.MEUSISTEMA_ENABLED,
  baseUrl: env.MEUSISTEMA_BASE_URL,
  token: env.MEUSISTEMA_TOKEN,
},
```

E acrescente as variáveis ao `.env.example`.

### 3. Registre no módulo

Em [`src/integrations/integrations.module.ts`](src/integrations/integrations.module.ts):

```ts
const CONNECTORS = [UolAdsConnector, MeuSistemaConnector];
```

Pronto. O conector já aparece em `/integrations`, entra no health check e participa da busca federada.

### Se a integração não for REST

`BaseHttpConnector` é uma conveniência, não uma obrigação. Para SOAP, GraphQL, banco de dados ou fila, implemente `DataConnector` diretamente — o registry, a busca e o health check só dependem da interface.

---

## Deploy na Vercel

A Vercel tem **detecção automática para NestJS**: o `src/main.ts` convencional (com `bootstrap()` chamando `app.listen()`) vira uma Vercel Function. Não há build command nem output directory para configurar, e não existe handler paralelo para manter em sincronia — o mesmo código roda local e em produção.

### Pelo Git

1. Suba o repositório para GitHub/GitLab/Bitbucket.
2. Em [vercel.com/new](https://vercel.com/new), importe o projeto.
3. Cadastre as variáveis de ambiente (Settings → Environment Variables).
4. Deploy.

### Pela CLI

```bash
npm i -g vercel
vercel            # preview
vercel --prod     # produção
```

Para rodar localmente no mesmo ambiente da Vercel: `npm run vercel:dev` (requer Vercel CLI 48.4.0+).

### O que já está configurado

[`vercel.json`](vercel.json) define apenas a região `gru1` (São Paulo — menor latência para consumidores e origens brasileiras). O resto fica com os defaults da plataforma de propósito.

NestJS na Vercel roda sobre [Fluid compute](https://vercel.com/docs/fluid-compute), cujos defaults já são generosos: **300s** de duração máxima e **2 GB / 1 vCPU**. Duas observações que evitam surpresa:

- **`memory` não pode ser definido no `vercel.json` com Fluid compute** — ajuste pelo dashboard (Settings → Functions), se precisar.
- Para reduzir a duração máxima (útil para conter custo de uma função pendurada), adicione o bloco abaixo. Na prática a API já se protege sozinha: `HTTP_TIMEOUT_MS` e `SEARCH_TIMEOUT_MS` garantem resposta bem antes disso.

  ```json
  "functions": { "src/main.ts": { "maxDuration": 30 } }
  ```

### Dependências ESM quebram a função inteira

O runtime da Vercel **não permite** que um pacote CommonJS carregue um pacote ESM via `require()`. O Node local, a partir da versão 22.12, permite — então uma dependência nessa situação passa em todos os testes e só falha em produção, com `ERR_REQUIRE_ESM` no boot. E como o erro acontece antes de a aplicação subir, **toda a API responde 500**, não apenas a rota que usava o pacote.

Foi o que derrubou o primeiro deploy: o `@scalar/nestjs-api-reference` é CommonJS e importa um pacote ESM. A documentação passou a ser servida por CDN, sem dependência de runtime.

Antes de cada deploy, ou ao adicionar qualquer dependência:

```bash
npm run build && npm run check:serverless
```

O [script](scripts/check-serverless-boot.js) sobe a aplicação com `--no-experimental-require-module`, que impõe exatamente a mesma restrição do runtime da Vercel, e testa as rotas principais. Falha local, em segundos, em vez de falhar em produção.

Quando um pacote for incompatível, as saídas são: trocar por um equivalente, carregá-lo com `import()` dinâmico, ou servir o recurso por CDN — foi o caminho adotado para o Swagger UI e o Scalar.

O check roda dois cenários: **produção configurada** e **sem nenhuma variável cadastrada**. O segundo existe porque um projeto recém-publicado na Vercel está exatamente nesse estado, e a aplicação precisa subir mesmo assim — ainda que degradada. Foi o que pegou a segunda falha de deploy: o `pino-pretty` é devDependency carregada por nome, invisível para o rastreamento de arquivos da Vercel, e um ambiente sem `NODE_ENV=production` pedia esse transport e derrubava tudo no boot.

### Cadastre as variáveis antes do primeiro acesso

Sem variáveis, a API **sobe**, mas com o UOL Ads desligado — `/api/v1/ads/uol/*` responde `503 INTEGRATION_UNAVAILABLE` dizendo qual variável falta. Em Settings → Environment Variables, no mínimo:

| Variável | Por quê |
| --- | --- |
| `UOL_ADS_KEY` | Sem ela a integração fica desabilitada e as rotas de mídia não respondem |
| `NODE_ENV=production` | Log em JSON e detalhe interno de erro 5xx oculto |
| `API_KEYS` | Sem ela a API fica pública (a aplicação avisa no boot) |
| `CORS_ORIGINS` | Os domínios reais, não `*` |

Depois de cadastrar, **refaça o deploy** — variáveis de ambiente só entram em vigor em um novo build.

### Antes de expor em produção

- [ ] **`npm run check:serverless`** passando.
- [ ] **`API_KEYS`** preenchido — sem isso a API fica aberta (a aplicação avisa no boot).
- [ ] **`CORS_ORIGINS`** com os domínios reais, não `*`.
- [ ] **`NODE_ENV=production`** — muda o log para JSON e esconde detalhe interno de erro 5xx.
- [ ] **`SWAGGER_ENABLED=false`** se a documentação não deve ser pública.
- [ ] **`LOG_LEVEL=info`** (`debug` em produção gera volume e custo desnecessários).

---

## Variáveis de ambiente

Todas são validadas por Zod no boot: valor inválido derruba a aplicação com uma mensagem que lista **todos** os problemas de uma vez, em vez de falhar no meio de uma requisição. Ver [`.env.example`](.env.example) para a lista completa.

| Grupo | Variáveis |
| --- | --- |
| Aplicação | `NODE_ENV`, `PORT`, `API_PREFIX`, `API_VERSION` |
| Documentação | `SWAGGER_ENABLED`, `SWAGGER_PATH` |
| Segurança | `API_KEYS`, `API_KEY_HEADER`, `CORS_ORIGINS` |
| Rate limit | `RATE_LIMIT_ENABLED`, `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX` |
| Resiliência | `HTTP_TIMEOUT_MS`, `HTTP_MAX_RETRIES`, `HTTP_RETRY_BASE_DELAY_MS`, `CIRCUIT_BREAKER_THRESHOLD`, `CIRCUIT_BREAKER_RESET_MS` |
| Cache | `CACHE_ENABLED`, `CACHE_TTL_MS`, `CACHE_MAX_ITEMS` |
| Busca | `SEARCH_TIMEOUT_MS` |
| Logs | `LOG_LEVEL` |
| Conectores | `UOL_ADS_*` |

Conectores que exigem credencial (como o UOL Ads) **se desabilitam sozinhos** quando a chave não está presente — ficam fora do catálogo em vez de aparecer ativos e responder 401 a cada chamada. Credenciais viajam apenas no header: nunca entram na chave de cache nem em log.

### Autenticação

Com `API_KEYS` preenchido, envie a chave em `x-api-key` (ou `Authorization: Bearer <chave>`):

```bash
curl -H "x-api-key: sua-chave" "https://sua-api.vercel.app/api/v1/search?q=01001000"
```

As rotas de health e a raiz são públicas (`@Public()`). Para trocar por JWT ou OAuth, substitua o `ApiKeyGuard` no `APP_GUARD` do [`app.module.ts`](src/app.module.ts) — nenhum controller muda.

---

## Testes e qualidade

```bash
npm test           # unitários
npm run test:e2e   # ponta a ponta (integrações externas mockadas)
npm run test:cov   # cobertura
npm run lint       # ESLint + Prettier
npm run typecheck  # TypeScript
npm run build      # build de produção
```

Os testes e2e usam a mesma função `configureApp()` da produção e substituem o `ResilientHttpService` por um dublê — a suíte exercita rotas, validação, guards, envelope e tratamento de erro sem depender de rede.

```bash
npm run openapi:export   # gera openapi.json (SDKs, diff de contrato em CI)
```

---

## Decisões técnicas

**Envelope padronizado em todas as respostas.** Clientes de integração se beneficiam de previsibilidade: um único formato de sucesso e um único de erro. Rotas que precisam devolver outro formato (health check, callbacks de terceiros) usam `@RawResponse()`.

**Falha parcial em vez de tudo ou nada.** Numa busca que consulta N sistemas, exigir que todos respondam multiplica a chance de erro. A API devolve o que conseguiu e diz exatamente o que aconteceu com cada origem.

**Erro de origem escolhida explicitamente propaga.** Em `/search/{source}`, uma falha vira erro HTTP — mascarar como "sem resultados" esconderia do cliente que o sistema que ele pediu está quebrado.

**`forbidNonWhitelisted` na validação.** Um parâmetro com erro de digitação vira 400 explícito, em vez de um filtro silenciosamente ignorado.

**Imports relativos, sem path aliases.** `@/` exige reescrita de caminhos no build ou `tsconfig-paths` em runtime — atrito desnecessário num alvo serverless. O ganho não compensa.

**Redação de credenciais nos logs.** `authorization`, `x-api-key` e `cookie` saem como `[REDACTED]` — o vazamento clássico em APIs de integração.

### Limitações conhecidas

**Cache e rate limit vivem na memória da instância.** Em serverless isso significa: o cache não é compartilhado entre instâncias, e o teto efetivo do rate limit é `RATE_LIMIT_MAX × instâncias ativas`. Para ambos há caminho pronto — cache: trocar o store do [`core.module.ts`](src/core/core.module.ts) por `@keyv/redis`; rate limit: Vercel Firewall (limite na borda, antes da função) ou um storage Redis no throttler. Nenhuma das trocas exige mudança em outro arquivo.

**Sem banco de dados.** A API é um agregador: busca, normaliza e devolve. Se surgir necessidade de persistência (histórico de consultas, cadastro próprio), o lugar natural é um novo módulo em `src/modules/`.

**Swagger UI carregado via CDN.** Os assets estáticos do `swagger-ui-dist` não entram no bundle da função na Vercel, e a página abriria sem estilo nem JavaScript. O Scalar (`/docs`) não tem essa dependência.
