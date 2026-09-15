import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import {
  ApiIntegrationErrors,
  ApiStandardErrors,
  ApiStandardResponse,
} from '../../common/decorators/api-response.decorator';
import { AdsService } from './ads.service';
import { CampaignReportQueryDto, ListCampaignsQueryDto } from './dto/ads-query.dto';
import { AdCampaignDto, CampaignListDto, CampaignReportDto } from './dto/ads-response.dto';

/**
 * Rotas de midia do UOL Ads.
 *
 * O caminho e `/ads/uol/...` para que outras plataformas (Meta, Google) entrem
 * depois como `/ads/meta/...` sem quebrar quem ja consome estas.
 */
@ApiTags('Midia - UOL Ads')
@ApiStandardErrors()
@ApiIntegrationErrors()
@Controller('ads/uol')
export class AdsController {
  constructor(private readonly adsService: AdsService) {}

  /**
   * Lista as campanhas da conta com o estado normalizado.
   *
   * O filtro de status da plataforma nao e usado: medido na conta real, ele
   * devolve campanhas finalizadas ao pedir "ativas". A classificacao e feita
   * aqui, a partir do estado efetivo de cada campanha.
   *
   * `statusSummary` conta a conta inteira, independente de filtro e paginacao.
   */
  @Get('campaigns')
  @ApiOperation({ summary: 'Lista campanhas (ativas, pausadas, completas e demais estados)' })
  @ApiStandardResponse(CampaignListDto)
  listCampaigns(@Query() query: ListCampaignsQueryDto): Promise<CampaignListDto> {
    return this.adsService.listCampaigns(query);
  }

  /**
   * Detalha uma campanha, incluindo seus conjuntos de anuncios.
   */
  @Get('campaigns/:id')
  @ApiOperation({ summary: 'Detalha uma campanha e seus conjuntos de anuncios' })
  @ApiParam({ name: 'id', description: 'ID da campanha', example: 115912 })
  @ApiStandardResponse(AdCampaignDto)
  getCampaign(@Param('id', ParseIntPipe) id: number): Promise<AdCampaignDto> {
    return this.adsService.getCampaign(id);
  }

  /**
   * Relatorio de uma campanha, por data ou por localidade.
   *
   * Com `breakdown=date` (padrao) cada linha traz o conjunto de anuncios e o
   * criativo. Com `breakdown=region` traz a UF, porem sem o criativo - a
   * plataforma nao cruza as duas informacoes, e o campo `creativeAvailable`
   * sinaliza isso na resposta.
   *
   * Os totais no fim cobrem o periodo inteiro, nao apenas a pagina.
   */
  @Get('campaigns/:id/report')
  @ApiOperation({ summary: 'Relatorio da campanha por data, conjunto, criativo ou localidade' })
  @ApiParam({ name: 'id', description: 'ID da campanha', example: 115912 })
  @ApiStandardResponse(CampaignReportDto)
  getCampaignReport(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: CampaignReportQueryDto,
  ): Promise<CampaignReportDto> {
    return this.adsService.getCampaignReport(id, query);
  }
}
