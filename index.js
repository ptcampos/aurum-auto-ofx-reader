/** AURUM - OFX
 *
 * Script para ler os arquivos em uma pasta cujo nome possua "ext_"
 * e também a data do dia e a data do dia anterior no formato DDMMYY.
 * Ler o arquivo que salva as movimentações usando string de posição, extrair os dados de movimentações bancárias e enviar para o AURUM
 * @author Paulo Campos - ptharso@gmail.com
 * @version 1.0.0
*/

// Importa as bibliotecas
const fs = require('fs');
const moment = require('moment-timezone');
const util = require('util');
const axios = require('axios');

const dotenv = require('dotenv');
dotenv.config();

// Define as variáveis
const dir = process.env.OFX_DIR;
const padraoNome = 'ext_';
// LISTA COM AS URLS DAS AURUMs
const URLAURUMsParaEnviar = [
  'https://aurum-v2.sistemaaurum.com',
  'http://grupoyes.sistemaaurum.com',
]

// Função para ler os arquivos
async function retornaOsArquivosOfxDeHojeOuOntem (dirname) {
  return new Promise((resolve, reject) => {
    fs.readdir(dirname, (err, filenames) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(filenames.filter((filename) => {
        const dataHoje = moment().format('DDMMYY');
        const dataOntem = moment().subtract(1, 'days').format('DDMMYY');
        return filename.includes(padraoNome) && (filename.includes(dataHoje) || filename.includes(dataOntem));
      }));
    });
  });
}

async function enviaAsMovimentacoesExtraidasParaAURUMs (movimentacoesPorArquivo) {
  const responses = [];
  const errorResponses = [];
  for (const url of URLAURUMsParaEnviar) {
    const headers = {
      'Content-Type': 'application/json'
    };
    try {
      const response = await axios.post(`${url}/api/ext-salva-movimentacoes-externas`, {
        movimentacoesPorArquivo
      }, { headers });
      responses.push({
        arquivosEnviados: movimentacoesPorArquivo.length,
        serverResponse: response.data,
        url
      });
    } catch (error) {
      errorResponses.push({
        url,
        arquivosEnviados: movimentacoesPorArquivo.length,
        serverResponse: error.response.data,
      });
    }
  }
  return {
    responses,
    errorResponses
  };
}

async function main () {
  const arquivos = await retornaOsArquivosOfxDeHojeOuOntem(dir);
  const dadosDosArquivos = [];
  for (const nomeArquivo of arquivos) {
    // extrai o conteúdo do arquivo
    const conteudo = fs.readFileSync(`${dir}/${nomeArquivo}`, 'utf8');
    const codigoBanco = nomeArquivo.split('_')[1];
    const numeroConta = nomeArquivo.split('_')[2];
    const movimentacaoFormatada = {
      dataLeitura: moment().tz('UTC').format('DD/MM/YYYY HH:mm:ss z'),
      nomeArquivo,
      codigoBanco,
      numeroConta,
      movimentacoes: [],
    };
    // recupera as linhas do arquivo
    const linhas = conteudo.split('\n');
    // percorre as linhas do arquivo
    const isUltimaLinhaEmBranco = linhas[linhas.length - 1].trim() === '';
    let contador = 0;
    for (const linha of linhas) {
      let movimentacao = {};
      // verifica se a linha é uma movimentação
      // ignore as duas primeiras linhas, as duas últimas e as linhas em branco
      if (
        contador > 1 &&
        contador < linhas.length - (isUltimaLinhaEmBranco ? 3 : 2) &&
        linha.trim() !== ''
      ) {
        // extrai os dados da movimentação
        // da posição 142 até 150 é a data da movimentação
        // da posição 150 até 168 é o valor da movimentação em centavos
        // da posição 168 até 169 é o tipo da movimentação (D ou C)
        // da posição 169 até 176 são informacoes adicionais da movimentação
        // da posição 176 até 225 é a descrição da movimentação
        const linhaComTrim = linha.trim();
        const identificador = linhaComTrim.substring(0, 15);
        const data = linhaComTrim.substring(142, 150);
        const valor = linhaComTrim.substring(150, 168);
        const tipo = linhaComTrim.substring(168, 169);
        const descricao = linhaComTrim.substring(176, 234);
        // formata os dados da movimentação
        movimentacao = {
          ...movimentacao,
          identificador: identificador.trim(),
          data: moment(data, 'DDMMYYYY').format('DD/MM/YYYY'),
          valor: parseFloat(valor) / 100,
          tipo,
          descricao: descricao.trim(),
        };
        // adiciona a movimentação no array de movimentações
        movimentacaoFormatada.movimentacoes.push(movimentacao);
      } else if (linha.trim()) {
        // ignora as linhas em branco
        // cabecalho
        if (contador === 0) {
          const linhaComTrim = linha.trim();
          const agencia = linhaComTrim.substring(53, 57);
          movimentacaoFormatada.agencia = agencia;
        }
        // rodape
        else if (contador === linhas.length - (isUltimaLinhaEmBranco ? 3 : 2)) {
          const linhaComTrim = linha.trim();
          const dataSaldoInicial = linhaComTrim.substring(142, 150);
          const saldoFinal = linhaComTrim.substring(150, 168);
          const situacaoSaldoFinal = linhaComTrim.substring(168, 169);
          movimentacaoFormatada.dataSaldoInicial = moment(dataSaldoInicial, 'DDMMYYYY').format('DD/MM/YYYY');
          movimentacaoFormatada.saldoFinal = parseFloat(saldoFinal) / 100;
          movimentacaoFormatada.situacaoSaldoFinal = situacaoSaldoFinal;
        }
      }
      contador++;
    }
    dadosDosArquivos.push(movimentacaoFormatada);
  }
  console.log(util.inspect(dadosDosArquivos, false, null, true))
  const response = await enviaAsMovimentacoesExtraidasParaAURUMs(dadosDosArquivos);
  console.log(util.inspect(response, false, null, true));
}

main();
