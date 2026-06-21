'use strict';

const https = require('https');
const fs = require('fs');
const puppeteer = require('puppeteer');

const URL_PROCON = 'https://sistemas.procon.sp.gov.br/evitesite/list/evitesites.php';
const URL_OPENPHISH = 'https://openphish.com/feed.txt';
const OUTPUT_FILE = 'blocklist.json';
const TIMEOUT_MS = 15_000;

// Domínios legítimos: qualquer subdomínio destes também é ignorado
const IGNORE_LIST = [
  'microsoft.com', 'google.com', 'google.com.br', 'youtube.com',
  'w3.org', 'w3c.org', 'github.com', 'apple.com', 'amazon.com',
  'facebook.com', 'instagram.com', 'whatsapp.com', 'linkedin.com',
];

// --------------------------------------------------------------------------
// Verifica se o domínio é ou pertence a um domínio da lista de exceções
// Ex.: 'mail.google.com' → ignorado porque termina com '.google.com'
// --------------------------------------------------------------------------
function ehDominioIgnorado(dominio) {
  return IGNORE_LIST.some(
    (seguro) => dominio === seguro || dominio.endsWith('.' + seguro)
  );
}

// --------------------------------------------------------------------------
// Faz uma requisição HTTPS com suporte a timeout e verifica o status HTTP.
// Segue até 5 redirecionamentos automaticamente.
// --------------------------------------------------------------------------
function fazerRequisicao(url, opcoes = {}, redirecionamentos = 0) {
  return new Promise((resolve, reject) => {
    if (redirecionamentos > 5) {
      return reject(new Error('Limite de redirecionamentos excedido'));
    }

    const req = https.get(url, opcoes, (res) => {
      // Segue redirecionamentos (301, 302, 307, 308)
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
        return fazerRequisicao(res.headers.location, opcoes, redirecionamentos + 1)
          .then(resolve)
          .catch(reject);
      }

      if (res.statusCode < 200 || res.statusCode >= 300) {
        return reject(new Error(`Status HTTP inesperado: ${res.statusCode} em ${url}`));
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    });

    req.setTimeout(TIMEOUT_MS, () => {
      req.destroy(new Error(`Timeout de ${TIMEOUT_MS}ms excedido em ${url}`));
    });

    req.on('error', reject);
  });
}

// --------------------------------------------------------------------------
// Extrai o hostname de uma URL, removendo o prefixo "www."
// --------------------------------------------------------------------------
function extrairDominio(url) {
  try {
    const urlFormatada = url.startsWith('http') ? url : 'http://' + url;
    return new URL(urlFormatada).hostname.replace(/^www\./, '').toLowerCase().trim();
  } catch {
    return null;
  }
}

// --------------------------------------------------------------------------
// FONTE 1 — Procon-SP (Puppeteer)
// Abre o site em um browser headless real para executar o JavaScript da
// página. Aguarda a tabela ser populada antes de extrair os domínios,
// coletando o texto de cada célula da coluna de sites.
// --------------------------------------------------------------------------
async function coletarProcon(destino) {
  console.log('⏳ Coletando dados do Procon-SP via Puppeteer...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',   // evita crash por falta de memória no CI
      '--disable-gpu',             // não há GPU no Actions
      '--single-process',          // reduz uso de memória
    ],
  });

  try {
    const page = await browser.newPage();

    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(URL_PROCON, { waitUntil: 'networkidle2', timeout: 30_000 });

    // Aguarda aparecer pelo menos uma linha de dados na tabela.
    // Ajuste o seletor caso o site use classes/ids diferentes.
    await page.waitForSelector('table tr td', { timeout: 20_000 });

    // Extrai o texto de todas as células — os domínios ficam em colunas de texto
    const textosCelulas = await page.$$eval('table tr td', (cells) =>
      cells.map((c) => c.innerText.trim())
    );

    let contador = 0;

    for (const texto of textosCelulas) {
      // Cada célula pode conter uma URL ou domínio puro
      const dominio = extrairDominio(texto);
      if (dominio && dominio.length > 4 && !ehDominioIgnorado(dominio)) {
        destino.add(dominio);
        contador++;
      }
    }

    console.log(`✅ Procon-SP: ${contador} domínios encontrados.`);
  } finally {
    // Garante que o browser sempre fecha, mesmo em caso de erro
    await browser.close();
  }
}

// --------------------------------------------------------------------------
// FONTE 2 — OpenPhish
// Processa cada linha da feed como uma URL completa e extrai o domínio.
// Qualquer domínio fora da IGNORE_LIST é adicionado — se está na feed,
// foi classificado como phishing e deve entrar na blocklist.
// --------------------------------------------------------------------------
async function coletarOpenPhish(destino) {
  console.log('⏳ Coletando dados do OpenPhish...');

  const texto = await fazerRequisicao(URL_OPENPHISH);
  const linhas = texto.split('\n');
  let contador = 0;

  for (const linha of linhas) {
    const url = linha.trim();
    if (!url) continue;

    const dominio = extrairDominio(url);
    if (!dominio) continue;
    if (ehDominioIgnorado(dominio)) continue;

    destino.add(dominio);
    contador++;
  }

  console.log(`✅ OpenPhish: ${contador} domínios encontrados.`);
}

// --------------------------------------------------------------------------
// Orquestrador principal
// --------------------------------------------------------------------------
async function rodarRobo() {
  console.log('🤖 Iniciando atualização da Blocklist Híbrida...\n');

  const todosOsDominios = new Set();
  const erros = [];

  // Procon usa Puppeteer (browser real) — roda separado do OpenPhish
  // para evitar conflito de recursos com o browser headless.
  await coletarProcon(todosOsDominios).catch((err) => {
    erros.push(`Procon-SP: ${err.message}`);
    console.error('❌ Erro ao coletar dados do Procon-SP:', err.message);
  });

  await coletarOpenPhish(todosOsDominios).catch((err) => {
    erros.push(`OpenPhish: ${err.message}`);
    console.error('❌ Erro ao coletar dados do OpenPhish:', err.message);
  });

  if (todosOsDominios.size === 0) {
    console.error('\n🚫 Nenhum domínio coletado. Arquivo NÃO atualizado.');
    console.error('   Erros encontrados:');
    erros.forEach((e) => console.error('   -', e));
    process.exit(1);
  }

  const listaFinal = Array.from(todosOsDominios).sort();

  try {
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(listaFinal, null, 2), 'utf-8');
    console.log(`\n🚀 Sucesso! ${OUTPUT_FILE} atualizado com ${listaFinal.length} domínios.`);

    if (erros.length > 0) {
      console.warn('\n⚠️  Atenção: algumas fontes falharam:');
      erros.forEach((e) => console.warn('   -', e));
    }
  } catch (err) {
    console.error('\n❌ Erro ao gravar o arquivo:', err.message);
    process.exit(1);
  }
}

rodarRobo();
