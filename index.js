/** AURUM - OFX
 *
 * Script para ler os arquivos em uma pasta cujo nome possua "ext_"
 * e também a data do dia e a data do dia anterior no formato DDMMYY.
 * Ler o arquivo que salva as movimentações usando string de posição, extrair os dados de movimentações bancárias e enviar para o AURUM
 * @author Paulo Campos - ptharso@gmail.com
 * @version 1.0.0
 */

// Importa as bibliotecas
const fs = require("fs");
const moment = require("moment-timezone");
const util = require("util");
const axios = require("axios");
const { isAxiosError } = require("axios");
const nodeCron = require("node-cron");
const { get } = require("lodash");
const { v4: uuidv4 } = require("uuid");
const crypto = require("crypto");
const path = require("path");

// Configure dotenv with explicit path to handle PM2 working directory issues
const dotenv = require("dotenv");
const envPath = path.resolve(__dirname, '.env');
const result = dotenv.config({ path: envPath });

if (result.error) {
    console.warn(`⚠️  Aviso: Não foi possível carregar o arquivo .env de ${envPath}`);
    console.warn("🔍 Verificando variáveis de ambiente do sistema...");
} else {
    console.log(`✅ Arquivo .env carregado com sucesso de ${envPath}`);
}

// Define as variáveis
const dir = process.env.OFX_DIR;
const padraoNome = "ext_";

// Validação das variáveis de ambiente obrigatórias
if (!dir) {
    console.error("❌ ERRO: A variável de ambiente OFX_DIR não está configurada!");
    console.error("📝 Por favor, configure OFX_DIR no seu arquivo .env com o caminho para a pasta dos arquivos OFX.");
    console.error("💡 Exemplo: OFX_DIR=/caminho/para/seus/arquivos/ofx");
    process.exit(1);
}

if (!fs.existsSync(dir)) {
    console.error(`❌ ERRO: O diretório especificado não existe: ${dir}`);
    console.error("📝 Por favor, verifique se o caminho está correto e se o diretório existe.");
    process.exit(1);
}

console.log(`📁 Diretório configurado: ${dir}`);

// LISTA COM AS URLs DAS AURUMs
const URLAURUMsParaEnviar = [
    "https://aurum-v2.sistemaaurum.com",
    "http://grupoyes.sistemaaurum.com",
    "https://puketcuritiba.sistemaaurum.com"
];

const DIAS_PARA_REGREDIR = 1;

// Configurações para evitar sobrecarga do servidor
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE) || 2; // Número de arquivos por lote
const DELAY_BETWEEN_BATCHES = parseInt(process.env.DELAY_BETWEEN_BATCHES) || 2000; // Delay em ms entre lotes
const DELAY_BETWEEN_SERVICES = parseInt(process.env.DELAY_BETWEEN_SERVICES) || 1000; // Delay em ms entre serviços

// Função para adicionar delay
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Função para dividir array em chunks
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

// Função para ler os arquivos
async function retornaOsArquivosOfxDeXDiasAtrasAteHoje(
    dirname,
    diasParaRegredir
) {
    return new Promise((resolve, reject) => {
        fs.readdir(dirname, (err, filenames) => {
            if (err) {
                reject(err);
                return;
            }
            resolve(
                filenames.filter((filename) => {
                    const dataHoje = moment().format("DDMMYY");
                    const dataAnterior = moment()
                        .subtract(diasParaRegredir, "days")
                        .format("DDMMYY");
                    return (
                        filename.includes(padraoNome) &&
                        (filename.includes(dataHoje) ||
                            filename.includes(dataAnterior))
                    );
                })
            );
        });
    });
}

async function enviaAsMovimentacoesExtraidasParaAURUMs(
    movimentacoesPorArquivo
) {
    console.log(`\n🚀 Iniciando envio de ${movimentacoesPorArquivo.length} arquivo(s) em lotes de ${BATCH_SIZE}`);

    const allResponses = [];
    const allErrorResponses = [];

    // Divide os arquivos em lotes
    const batches = chunkArray(movimentacoesPorArquivo, BATCH_SIZE);

    console.log(`📦 Total de lotes a processar: ${batches.length}`);

    for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(`\n📤 Processando lote ${batchIndex + 1}/${batches.length} (${batch.length} arquivo(s))`);

        // Envia para cada serviço sequencialmente com delay
        for (let serviceIndex = 0; serviceIndex < URLAURUMsParaEnviar.length; serviceIndex++) {
            const url = URLAURUMsParaEnviar[serviceIndex];
            console.log(`  ⏳ Enviando para serviço ${serviceIndex + 1}/${URLAURUMsParaEnviar.length}: ${url}`);

            const headers = {
                "Content-Type": "application/json",
            };

            try {
                const response = await axios.post(
                    `${url}/api/ext-salva-movimentacoes-externas`,
                    {
                        movimentacoesPorArquivo: batch,
                    },
                    {
                        headers,
                        timeout: 30000 // 30 segundos de timeout
                    }
                );

                allResponses.push({
                    lote: batchIndex + 1,
                    servico: serviceIndex + 1,
                    arquivosEnviados: batch.length,
                    serverResponse: response.data,
                    url,
                });

                console.log(`  ✅ Sucesso no envio para ${url}`);

            } catch (error) {
                let formattedServerResponse = error;
                if (isAxiosError(error)) {
                    formattedServerResponse = get(error, "response.data", error);
                }

                allErrorResponses.push({
                    lote: batchIndex + 1,
                    servico: serviceIndex + 1,
                    url,
                    arquivosEnviados: batch.length,
                    serverResponse: formattedServerResponse,
                });

                console.log(`  ❌ Erro no envio para ${url}:`, error.message);
            }

            // Delay entre serviços (exceto no último serviço)
            if (serviceIndex < URLAURUMsParaEnviar.length - 1) {
                console.log(`  ⏱️  Aguardando ${DELAY_BETWEEN_SERVICES}ms antes do próximo serviço...`);
                await sleep(DELAY_BETWEEN_SERVICES);
            }
        }

        // Delay entre lotes (exceto no último lote)
        if (batchIndex < batches.length - 1) {
            console.log(`\n⏱️  Aguardando ${DELAY_BETWEEN_BATCHES}ms antes do próximo lote...`);
            await sleep(DELAY_BETWEEN_BATCHES);
        }
    }

    console.log(`\n✨ Processamento concluído! Total de respostas: ${allResponses.length}, Erros: ${allErrorResponses.length}`);

    return {
        responses: allResponses,
        errorResponses: allErrorResponses,
    };
}

async function main() {
    const arquivos = await retornaOsArquivosOfxDeXDiasAtrasAteHoje(
        dir,
        DIAS_PARA_REGREDIR
    );
    const dadosDosArquivos = [];
    for (const nomeArquivo of arquivos) {
        // extrai o conteúdo do arquivo
        const conteudo = fs.readFileSync(`${dir}/${nomeArquivo}`, "utf8");
        const codigoBanco = nomeArquivo.split("_")[1];
        const agencia = nomeArquivo.split("_")[2];
        let numeroDaContaSemDigito = nomeArquivo.split("_")[3];
        // remove .000.ret do final do numero da conta
        numeroDaContaSemDigito = numeroDaContaSemDigito.split(".")[0];
        console.log(
            "Data:",
            moment().tz("UTC").format("DD/MM/YYYY HH:mm:ss z")
        );
        console.log(
            "Arquivo:",
            nomeArquivo,
            "Banco:",
            codigoBanco,
            "Agência:",
            agencia,
            "Conta:",
            numeroDaContaSemDigito
        );
        const movimentacaoFormatada = {
            dataLeitura: moment().tz("UTC").format("DD/MM/YYYY HH:mm:ss z"),
            nomeArquivo,
            agencia,
            codigoBanco,
            numeroConta: numeroDaContaSemDigito,
            movimentacoes: [],
        };

        const createHash = (codigoBanco, agencia, numeroDaContaSemDigito, identificador, data, valor, tipo, descricao) => {
            return crypto
                .createHash("sha256")
                .update(`${codigoBanco}-${agencia}-${numeroDaContaSemDigito}-${identificador}-${data}-${valor}-${tipo}-${descricao}`)
                .digest("hex");
        };
        // recupera as linhas do arquivo
        const linhas = conteudo.split("\n");
        // percorre as linhas do arquivo
        const isUltimaLinhaEmBranco = linhas[linhas.length - 1].trim() === "";
        let contador = 0;
        for (const linha of linhas) {
            let movimentacao = {};
            // verifica se a linha é uma movimentação
            // ignore as duas primeiras linhas, as duas últimas e as linhas em branco
            if (
                contador > 1 &&
                contador < linhas.length - (isUltimaLinhaEmBranco ? 3 : 2) &&
                linha.trim() !== ""
            ) {
                // extrai os dados da movimentação
                // da posição 142 até 150 é a data da movimentação
                // da posição 150 até 168 é o valor da movimentação em centavos
                // da posição 168 até 169 é o tipo da movimentação (D ou C)
                // da posição 169 até 176 são informacoes adicionais da movimentação
                // da posição 176 até 225 é a descrição da movimentação
                const linhaComTrim = linha.trim();
                // const identificador = linhaComTrim.substring(0, 15);
                const identificador = linhaComTrim.substring(0, 17);
                const data = linhaComTrim.substring(142, 150);
                const valor = linhaComTrim.substring(150, 168);
                const tipo = linhaComTrim.substring(168, 169);
                const descricao = linhaComTrim.substring(176, 234);
                // formata os dados da movimentação
                movimentacao = {
                    ...movimentacao,
                    identificador: createHash(
                        codigoBanco,
                        agencia,
                        numeroDaContaSemDigito,
                        identificador,
                        data,
                        valor,
                        tipo,
                        descricao
                    ),
                    data: moment(data, "DDMMYYYY").format("DD/MM/YYYY"),
                    valor: parseFloat(valor) / 100,
                    tipo,
                    descricao: descricao.trim(),
                };
                // movimentacao.identificador = `${data}-${valor}-${tipo}-${descricao}`;
                // adiciona a movimentação no array de movimentações
                movimentacaoFormatada.movimentacoes.push(movimentacao);
            } else if (linha.trim()) {
                // rodape
                if (
                    contador ===
                    linhas.length - (isUltimaLinhaEmBranco ? 3 : 2)
                ) {
                    const linhaComTrim = linha.trim();
                    const dataSaldoInicial = linhaComTrim.substring(142, 150);
                    const saldoFinal = linhaComTrim.substring(150, 168);
                    const situacaoSaldoFinal = linhaComTrim.substring(168, 169);
                    movimentacaoFormatada.dataSaldoInicial = moment(
                        dataSaldoInicial,
                        "DDMMYYYY"
                    ).format("DD/MM/YYYY");
                    movimentacaoFormatada.saldoFinal =
                        parseFloat(saldoFinal) / 100;
                    movimentacaoFormatada.situacaoSaldoFinal =
                        situacaoSaldoFinal;
                }
            }
            contador++;
        }
        dadosDosArquivos.push(movimentacaoFormatada);
    }
    // console.log(util.inspect(dadosDosArquivos, false, null, true))
    const response = await enviaAsMovimentacoesExtraidasParaAURUMs(
        dadosDosArquivos
    );
    console.log(util.inspect(response, false, null, true));
}

main();
const cronStr = process.env.CRON_STR || "*/1 * * * *";
const job = nodeCron.schedule(cronStr, main, {
    scheduled: false,
    timezone: "America/Sao_Paulo",
});

job.start();
