import { isPackageInstalled, resolvePrettyTransport } from './logger.module';

describe('resolvePrettyTransport', () => {
  const instalado = () => true;
  const ausente = () => false;

  it('nao usa transport fora de desenvolvimento', () => {
    // Producao escreve JSON puro no stdout, que e o que a Vercel indexa.
    expect(resolvePrettyTransport(false, instalado)).toBeUndefined();
  });

  it('usa pino-pretty em desenvolvimento quando o pacote existe', () => {
    expect(resolvePrettyTransport(true, instalado)).toMatchObject({
      target: 'pino-pretty',
      options: expect.objectContaining({ colorize: true }),
    });
  });

  it('cai no JSON puro quando o pacote nao esta instalado', () => {
    // Cenario que derrubou o deploy: ambiente marcado como development, mas
    // sem `pino-pretty` no bundle. O logger e construido antes de tudo, entao
    // pedir um transport ausente tirava a API inteira do ar.
    expect(resolvePrettyTransport(true, ausente)).toBeUndefined();
  });

  it('nao consulta o pacote quando nem esta em desenvolvimento', () => {
    const spy = jest.fn(() => true);
    resolvePrettyTransport(false, spy);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('isPackageInstalled', () => {
  it('reconhece um pacote presente', () => {
    expect(isPackageInstalled('pino')).toBe(true);
  });

  it('devolve false em vez de lancar quando o pacote nao existe', () => {
    expect(isPackageInstalled('pacote-que-nao-existe-em-lugar-nenhum')).toBe(false);
  });
});
