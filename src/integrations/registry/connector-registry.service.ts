import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';

import { ConnectorNotFoundException } from '../../common/exceptions/integration.exception';
import type {
  ConnectorMetadata,
  ConnectorQuery,
  DataConnector,
} from '../contracts/connector.contract';
import { CONNECTOR_METADATA_KEY } from '../decorators/register-connector.decorator';

/**
 * Catalogo de integracoes disponiveis.
 *
 * Os conectores sao descobertos no boot via `DiscoveryService`, entao nao ha
 * lista central para manter em sincronia: anotar a classe com
 * `@RegisterConnector()` e registra-la como provider e suficiente.
 */
@Injectable()
export class ConnectorRegistryService implements OnModuleInit {
  private readonly logger = new Logger(ConnectorRegistryService.name);
  private readonly connectors = new Map<string, DataConnector>();

  constructor(private readonly discovery: DiscoveryService) {}

  onModuleInit(): void {
    const discovered = this.discovery
      .getProviders()
      .filter((wrapper) => {
        const metatype = wrapper.metatype;
        if (!metatype || wrapper.instance == null) {
          return false;
        }
        return Reflect.getMetadata(CONNECTOR_METADATA_KEY, metatype) === true;
      })
      .map((wrapper) => wrapper.instance as DataConnector);

    for (const connector of discovered) {
      const { key } = connector.metadata;

      if (this.connectors.has(key)) {
        throw new Error(
          `Conector duplicado: a chave "${key}" ja esta registrada. Use uma chave unica por integracao.`,
        );
      }

      this.connectors.set(key, connector);
    }

    const enabled = this.enabled().map((c) => c.metadata.key);
    this.logger.log(
      `${discovered.length} conector(es) descoberto(s); ativos: ${enabled.length ? enabled.join(', ') : 'nenhum'}`,
    );
  }

  /** Todos os conectores, inclusive os desligados por configuracao. */
  all(): DataConnector[] {
    return [...this.connectors.values()];
  }

  /** Apenas os conectores habilitados. */
  enabled(): DataConnector[] {
    return this.all().filter((connector) => connector.isEnabled());
  }

  /** Metadados publicos de todos os conectores, para o endpoint de catalogo. */
  catalog(): Array<ConnectorMetadata & { enabled: boolean }> {
    return this.all().map((connector) => ({
      ...connector.metadata,
      enabled: connector.isEnabled(),
    }));
  }

  /** Busca um conector habilitado pela chave, ou lanca 404 com as opcoes validas. */
  get(key: string): DataConnector {
    const connector = this.connectors.get(key);

    if (!connector || !connector.isEnabled()) {
      throw new ConnectorNotFoundException(
        key,
        this.enabled().map((item) => item.metadata.key),
      );
    }

    return connector;
  }

  has(key: string): boolean {
    const connector = this.connectors.get(key);
    return Boolean(connector?.isEnabled());
  }

  /**
   * Seleciona os conectores que devem participar de uma busca.
   *
   * @param query consulta a ser roteada
   * @param only restringe a estas chaves (quando o cliente escolhe as fontes)
   */
  resolveFor(query: ConnectorQuery, only?: string[]): DataConnector[] {
    const candidates = only?.length ? only.map((key) => this.get(key)) : this.enabled();

    return candidates.filter((connector) => connector.supports(query));
  }

  /** Todas as capabilities anunciadas pelos conectores ativos, sem repeticao. */
  capabilities(): string[] {
    const set = new Set<string>();

    for (const connector of this.enabled()) {
      for (const capability of connector.metadata.capabilities) {
        set.add(capability);
      }
    }

    return [...set].sort();
  }
}
