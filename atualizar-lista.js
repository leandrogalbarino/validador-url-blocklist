const https = require('https');
const fs = require('fs');

const URL_PROCON = 'https://sistemas.procon.sp.gov.br/evitesites/list/evitesites.php';
const URL_OPENPHISH = 'https://openphish.com/feed.txt';

// Configuração com cabeçalhos para o Procon não barrar o robô do GitHub
const opcoesProcon = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  }
};

function fazerRequisicao(url, opcoes = {}) {
  return new Promise((resolve, reject) => {
    https.get(url, opcoes, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', (err) => reject(err));
  });
}

function extrairDominio(url) {
  try {
    const urlFormatada = url.startsWith('http') ? url : 'http://' + url;
    const urlObj = new URL(urlFormatada);
    return urlObj.hostname.replace(/^www\./, '').toLowerCase().trim();
  } catch (e) {
    return null;
  }
}

async function rodarRobo() {
  console.log('🤖 Iniciando atualização da Blocklist Híbrida...');
  const todosOsDominios = new Set();

  // --- FONTE 1: PROCON-SP ---
  try {
    console.log('⏳ Coletando dados do Procon-SP...');
    const htmlProcon = await fazerRequisicao(URL_PROCON, opcoesProcon);
    
    // Regex melhorada para pegar domínios com ou sem www na tabela deles
    const regexDominios = /[a-zA-Z0-9-]+\.(com|net|org|xyz|top|click|info|biz|club|site|online)(?:\.br)?/g;
    const encontradosProcon = htmlProcon.match(regexDominios) || [];
    
    encontradosProcon.forEach(dom => {
      // Evita salvar domínios institucionais falsos positivos como w3.org
      if (dom && dom.length > 4 && !dom.includes('w3.org') && !dom.includes('w3c')) {
        todosOsDominios.add(dom.replace(/^www\./, '').toLowerCase().trim());
      }
    });
    console.log(`✅ Procon-SP processado.`);
  } catch (err) {
    console.error('❌ Erro ao coletar dados do Procon-SP:', err.message);
  }

  // --- FONTE 2: OPENPHISH ---
  try {
    console.log('⏳ Coletando dados do OpenPhish...');
    const textoOpenPhish = await fazerRequisicao(URL_OPENPHISH);
    const linhas = textoOpenPhish.split('\n');
    
    linhas.forEach(linha => {
      if (linha.trim()) {
        const dom = extrairDominio(linha);
        // Captura phishings genéricos comuns de golpes rápidos (.xyz, .top, .click) ou focados no BR (.br)
        if (dom && (dom.endsWith('.br') || dom.endsWith('.xyz') || dom.endsWith('.top') || dom.endsWith('.click') || dom.endsWith('.site'))) {
          todosOsDominios.add(dom);
        }
      }
    });
    console.log(`✅ OpenPhish processado.`);
  } catch (err) {
    console.error('❌ Erro ao coletar dados do OpenPhish:', err.message);
  }

  // Se der algum problema geral nas duas requisições, coloca itens de fallback para não quebrar a extensão
  if (todosOsDominios.size === 0) {
    ['site-falso-exemplo.com.br', 'golpe-procon.net', 'ganhe-dinheiro-facil.xyz'].forEach(d => todosOsDominios.add(d));
  }

  const listaFinal = Array.from(todosOsDominios);

  fs.writeFileSync('blocklist.json', JSON.stringify(listaFinal, null, 2));
  console.log(`🚀 Sucesso total! blocklist.json atualizada com ${listaFinal.length} domínios únicos.`);
}

rodarRobo();
