const https = require('https');
const fs = require('fs');

// URLs das fontes de dados de ameaças
const URL_PROCON = 'https://sistemas.procon.sp.gov.br/evitesites/list/evitesites.php';
const URL_OPENPHISH = 'https://openphish.com/feed.txt'; // Feed de texto puro com URLs de Phishing ativas

// Função auxiliar para fazer requisições HTTP do tipo GET nativas
function fazerRequisicao(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
    }).on('error', (err) => reject(err));
  });
}

// Função para extrair o domínio de qualquer string de URL
function extrairDominio(url) {
  try {
    // Adiciona protocolo se não existir para o construtor URL funcionar
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
    const htmlProcon = await fazerRequisicao(URL_PROCON);
    const regexDominios = /www\.[a-zA-Z0-9-]+\.[a-zA-Z0-9.-]+/g;
    const encontradosProcon = htmlProcon.match(regexDominios) || [];
    
    encontradosProcon.forEach(url => {
      const dom = extrairDominio(url);
      if (dom && dom.length > 4) todosOsDominios.add(dom);
    });
    console.log(`✅ Procon-SP processado.`);
  } catch (err) {
    console.error('❌ Erro ao coletar dados do Procon-SP:', err.message);
  }

  // --- FONTE 2: OPENPHISH (Global Threat Intelligence) ---
  try {
    console.log('⏳ Coletando dados do OpenPhish...');
    const textoOpenPhish = await fazerRequisicao(URL_OPENPHISH);
    // O OpenPhish retorna uma URL por linha
    const linhas = textoOpenPhish.split('\n');
    
    linhas.forEach(linha => {
      if (linha.trim()) {
        const dom = extrairDominio(linha);
        // Filtragem opcional: focar em golpes voltados para o Brasil (.br) ou de domínios genéricos perigosos
        if (dom && (dom.endsWith('.br') || dom.endsWith('.xyz') || dom.endsWith('.top') || dom.endsWith('.click'))) {
          todosOsDominios.add(dom);
        }
      }
    });
    console.log(`✅ OpenPhish processado.`);
  } catch (err) {
    console.error('❌ Erro ao coletar dados do OpenPhish:', err.message);
  }

  // --- SALVAMENTO E ATUALIZAÇÃO ---
  const listaFinal = Array.from(todosOsDominios);

  if (listaFinal.length > 0) {
    fs.writeFileSync('blocklist.json', JSON.stringify(listaFinal, null, 2));
    console.log(`🚀 Sucesso total! blocklist.json atualizada com ${listaFinal.length} domínios únicos de ameaças.`);
  } else {
    console.log('⚠️ Nenhuma ameaça nova encontrada. Mantendo arquivo anterior intacto.');
  }
}

rodarRobo();
