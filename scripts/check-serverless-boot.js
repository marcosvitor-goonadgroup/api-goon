#!/usr/bin/env node
/**
 * Verifica se a aplicacao sobe sob as regras do runtime serverless.
 *
 * Motivo: o Node local (>= 22.12) permite que um modulo CommonJS faca
 * `require()` de um pacote ESM. O runtime da Vercel nao permite, e uma
 * dependencia nessa situacao derruba a funcao inteira no boot com
 * `ERR_REQUIRE_ESM` - a API toda responde 500, nao apenas a rota afetada.
 * Foi assim que o pacote do Scalar quebrou o primeiro deploy.
 *
 * `--no-experimental-require-module` reproduz exatamente essa restricao, o que
 * transforma um erro que so aparecia em producao em uma falha local.
 *
 * Uso: npm run build && npm run check:serverless
 */
const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');

const PORT = process.env.CHECK_PORT ?? '3399';
const BOOT_TIMEOUT_MS = 60_000;
const ENTRYPOINT = path.join(__dirname, '..', 'dist', 'main.js');

/** Rotas que cobrem os principais caminhos de carregamento de modulos. */
const ROUTES = ['/', '/health/live', '/docs', '/docs/openapi.json', '/docs/swagger'];

if (!fs.existsSync(ENTRYPOINT)) {
  console.error(`dist/main.js nao encontrado. Rode "npm run build" antes.`);
  process.exit(1);
}

const child = spawn(process.execPath, ['--no-experimental-require-module', ENTRYPOINT], {
  env: { ...process.env, PORT, LOG_LEVEL: 'warn', NODE_ENV: 'production', SWAGGER_ENABLED: 'true' },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let output = '';
child.stdout.on('data', (chunk) => (output += chunk));
child.stderr.on('data', (chunk) => (output += chunk));

const stop = () => {
  if (!child.killed) child.kill();
};

const fail = (message) => {
  console.error(`\n[FALHOU] ${message}\n`);
  if (output.trim()) console.error(output.trim().split('\n').slice(0, 20).join('\n'));
  stop();
  process.exit(1);
};

child.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    const esm = output.includes('ERR_REQUIRE_ESM');
    fail(
      esm
        ? 'Uma dependencia CommonJS importa um pacote ESM via require(). Isso quebra na Vercel.\n' +
            'Substitua o pacote, carregue-o com import() dinamico, ou sirva o recurso por CDN.'
        : `O processo saiu com codigo ${code} antes de responder.`,
    );
  }
});

const get = (route) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: '127.0.0.1', port: Number(PORT), path: route }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.setTimeout(10_000, () => req.destroy(new Error('timeout')));
  });

/** Aguarda a porta aceitar conexao, em vez de dormir um tempo fixo. */
const waitForBoot = async () => {
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await get('/health/live');
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return false;
};

void (async () => {
  if (!(await waitForBoot())) {
    fail(`a aplicacao nao respondeu em ${BOOT_TIMEOUT_MS / 1000}s.`);
  }

  let failures = 0;
  for (const route of ROUTES) {
    const status = await get(route).catch(() => 0);
    const ok = status >= 200 && status < 400;
    if (!ok) failures++;
    console.log(`  ${ok ? 'ok  ' : 'FALHA'} ${route} -> HTTP ${status || 'sem resposta'}`);
  }

  stop();

  if (failures > 0) {
    console.error(`\n[FALHOU] ${failures} rota(s) nao responderam sob as regras do serverless.`);
    process.exit(1);
  }

  console.log('\nboot compativel com o runtime serverless.');
  process.exit(0);
})();
