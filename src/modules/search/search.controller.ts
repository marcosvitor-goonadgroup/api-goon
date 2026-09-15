import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiIntegrationErrors,
  ApiStandardErrors,
  ApiStandardResponse,
} from '../../common/decorators/api-response.decorator';
import { RequestId } from '../../common/decorators/request-id.decorator';
import type { NormalizedRecord } from '../../integrations/contracts/connector.contract';
import { NormalizedRecordDto } from '../../integrations/dto/connector.dto';
import { SearchQueryDto } from './dto/search-query.dto';
import { SearchResultDto } from './dto/search-response.dto';
import { SearchService } from './search.service';

@ApiTags('Busca')
@ApiStandardErrors()
@Controller('search')
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  /**
   * Busca federada.
   *
   * Consulta em paralelo todas as integracoes compativeis com o termo e
   * devolve os resultados normalizados numa lista unica. O bloco `sources`
   * informa o que cada origem respondeu - se uma falhar, as demais ainda
   * retornam e `partial` vem `true`.
   */
  @Get()
  @ApiOperation({ summary: 'Busca em todas as integracoes compativeis' })
  @ApiStandardResponse(SearchResultDto)
  @ApiIntegrationErrors()
  search(@Query() query: SearchQueryDto, @RequestId() requestId: string): Promise<SearchResultDto> {
    return this.searchService.search(query, {
      requestId,
      includeRaw: query.includeRaw ?? false,
    });
  }

  /**
   * Busca em uma integracao especifica.
   *
   * Ao contrario da busca federada, falhas da origem sao propagadas como erro
   * HTTP - a origem foi escolhida explicitamente pelo cliente.
   */
  @Get(':source')
  @ApiOperation({ summary: 'Busca em uma integracao especifica' })
  @ApiParam({ name: 'source', description: 'Chave do conector', example: 'uol-ads' })
  @ApiStandardResponse(SearchResultDto)
  @ApiIntegrationErrors()
  searchOne(
    @Param('source') source: string,
    @Query() query: SearchQueryDto,
    @RequestId() requestId: string,
  ): Promise<SearchResultDto> {
    return this.searchService.searchOne(source, query, {
      requestId,
      includeRaw: query.includeRaw ?? false,
    });
  }

  /**
   * Recupera um registro pelo identificador dentro de uma integracao.
   */
  @Get(':source/:id')
  @ApiOperation({ summary: 'Busca um registro por identificador em uma integracao' })
  @ApiParam({ name: 'source', description: 'Chave do conector', example: 'uol-ads' })
  @ApiParam({
    name: 'id',
    description: 'Identificador na origem (CNPJ, CEP, codigo do banco...)',
    example: '00000000000191',
  })
  @ApiStandardResponse(NormalizedRecordDto)
  @ApiIntegrationErrors()
  findById(
    @Param('source') source: string,
    @Param('id') id: string,
    @RequestId() requestId: string,
  ): Promise<NormalizedRecord> {
    return this.searchService.findById(source, id, { requestId, includeRaw: false });
  }
}
