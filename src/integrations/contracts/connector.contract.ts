import type { CircuitSnapshot } from '../../core/http/circuit-breaker';

/**
 * O que um conector sabe buscar. Nao e um enum fechado de proposito: cada
 * integracao declara as suas, e o roteamento da busca federada usa isso para
 * decidir quem consultar.
 */
export type ConnectorCapability = string;

export interface ConnectorMetadata {
  /** Identificador estavel usado em rotas, logs e circuito. Ex.: `uol-ads`. */
  key: string;
  /** Nome legivel para humanos. */
  label: string;
  description: string;
  /** Tipos de consulta suportados. Ex.: `['cnpj', 'cep', 'bank']`. */
  capabilities: ConnectorCapability[];
  /** Host do sistema externo (sem credenciais). */
  baseUrl: string;
  /** Documentacao oficial da API externa. */
  docsUrl?: string;
  /** Indica se a integracao exige credencial configurada. */
  requiresCredentials: boolean;
}

/** Contexto propagado da requisicao HTTP ate o conector. */
export interface ConnectorContext {
  requestId: string;
  /** Se `true`, o payload original da origem acompanha cada registro. */
  includeRaw?: boolean;
}

export interface ConnectorQuery {
  /** Termo buscado: um CNPJ, um CEP, um nome... */
  term: string;
  /** Restringe a consulta a uma capability especifica. */
  capability?: ConnectorCapability;
  /** Teto de registros que o conector deve devolver. */
  limit?: number;
  /** Filtros livres especificos da integracao. */
  filters?: Record<string, unknown>;
}

/**
 * Formato comum de saida.
 *
 * Normalizar aqui e o que permite a busca federada devolver resultados de
 * sistemas totalmente diferentes numa unica lista coerente. O payload
 * especifico de cada origem continua acessivel em `attributes` (tratado) e
 * `raw` (intacto).
 */
export interface NormalizedRecord<TAttributes = Record<string, unknown>> {
  /** Identificador do registro dentro da origem. */
  id: string;
  /** Natureza do dado: `company`, `address`, `bank`, `person`... */
  type: string;
  title: string;
  subtitle?: string;
  /** Chave do conector que produziu o registro. */
  source: string;
  attributes: TAttributes;
  /** Resposta original da origem - presente apenas quando pedida. */
  raw?: unknown;
  /** Momento da consulta (ISO-8601). */
  retrievedAt: string;
}

export type ConnectorStatus = 'up' | 'degraded' | 'down' | 'disabled';

export interface ConnectorHealth {
  key: string;
  status: ConnectorStatus;
  circuit: CircuitSnapshot;
  latencyMs?: number;
  message?: string;
  checkedAt: string;
}

/**
 * Contrato que toda integracao implementa.
 *
 * Para adicionar um sistema novo: implemente esta interface (ou herde de
 * `BaseHttpConnector`), anote a classe com `@RegisterConnector()` e declare-a
 * como provider. O registry descobre o conector sozinho e ele passa a
 * responder em `/integrations` e na busca federada - sem tocar em nenhum
 * arquivo existente.
 */
export interface DataConnector {
  readonly metadata: ConnectorMetadata;

  /** O conector esta ligado por configuracao? */
  isEnabled(): boolean;

  /** Este conector consegue atender a consulta? Evita fan-out inutil. */
  supports(query: ConnectorQuery): boolean;

  /** Consulta a origem e devolve registros ja normalizados. */
  search(query: ConnectorQuery, context: ConnectorContext): Promise<NormalizedRecord[]>;

  /** Busca direta por identificador, quando a origem suportar. */
  findById?(id: string, context: ConnectorContext): Promise<NormalizedRecord | null>;

  /** Verificacao de disponibilidade usada pelo `/health`. */
  health(): Promise<ConnectorHealth>;
}
