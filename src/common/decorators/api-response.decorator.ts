import { applyDecorators, HttpStatus, type Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';

import { ApiErrorResponseDto, ApiSuccessResponseDto } from '../dto/api-response.dto';
import { PaginationMetaDto } from '../dto/pagination.dto';

interface StandardResponseOptions {
  status?: HttpStatus;
  description?: string;
  isArray?: boolean;
}

/**
 * Documenta uma resposta de sucesso ja embrulhada no envelope padrao.
 *
 * O Swagger nao entende genericos do TypeScript, entao compomos o schema com
 * `allOf`: envelope + o tipo concreto em `data`.
 */
export const ApiStandardResponse = <TModel extends Type<unknown>>(
  model: TModel,
  options: StandardResponseOptions = {},
) => {
  const { status = HttpStatus.OK, description, isArray = false } = options;

  const dataSchema = isArray
    ? { type: 'array', items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };

  return applyDecorators(
    ApiExtraModels(ApiSuccessResponseDto, model),
    ApiResponse({
      status,
      description: description ?? 'Operacao concluida com sucesso.',
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiSuccessResponseDto) },
          { properties: { data: dataSchema } },
        ],
      },
    }),
  );
};

/**
 * Documenta uma resposta paginada: envelope + `data.items[]` + `data.pagination`.
 */
export const ApiPaginatedResponse = <TModel extends Type<unknown>>(
  model: TModel,
  description?: string,
) =>
  applyDecorators(
    ApiExtraModels(ApiSuccessResponseDto, PaginationMetaDto, model),
    ApiResponse({
      status: HttpStatus.OK,
      description: description ?? 'Lista paginada de resultados.',
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiSuccessResponseDto) },
          {
            properties: {
              data: {
                type: 'object',
                required: ['items', 'pagination'],
                properties: {
                  items: { type: 'array', items: { $ref: getSchemaPath(model) } },
                  pagination: { $ref: getSchemaPath(PaginationMetaDto) },
                },
              },
            },
          },
        ],
      },
    }),
  );

/**
 * Anexa as respostas de erro que qualquer rota autenticada pode devolver.
 * Evita repetir os mesmos quatro `@ApiResponse` em todo controller.
 */
export const ApiStandardErrors = () =>
  applyDecorators(
    ApiExtraModels(ApiErrorResponseDto),
    ApiResponse({
      status: HttpStatus.BAD_REQUEST,
      description: 'Parametros invalidos.',
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      status: HttpStatus.UNAUTHORIZED,
      description: 'Chave de API ausente ou invalida.',
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      status: HttpStatus.TOO_MANY_REQUESTS,
      description: 'Limite de requisicoes excedido.',
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      description: 'Falha inesperada no servidor.',
      type: ApiErrorResponseDto,
    }),
  );

/** Respostas tipicas de rotas que dependem de sistemas externos. */
export const ApiIntegrationErrors = () =>
  applyDecorators(
    ApiResponse({
      status: HttpStatus.BAD_GATEWAY,
      description: 'O sistema externo respondeu com erro ou formato inesperado.',
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      description: 'Integracao indisponivel (circuito aberto).',
      type: ApiErrorResponseDto,
    }),
    ApiResponse({
      status: HttpStatus.GATEWAY_TIMEOUT,
      description: 'O sistema externo nao respondeu no tempo limite.',
      type: ApiErrorResponseDto,
    }),
  );
