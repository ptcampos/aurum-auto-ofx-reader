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

const dotenv = require("dotenv");
dotenv.config();

// Define as variáveis
const dir = process.env.OFX_DIR;
const padraoNome = "ext_";
// LISTA COM AS URLS DAS AURUMs
const URLAURUMsParaEnviar = [
    "https://aurum-v2.sistemaaurum.com",
    "http://grupoyes.sistemaaurum.com",
];

const DIAS_PARA_REGREDIR = 1;

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
    const responses = [];
    const errorResponses = [];
    for (const url of URLAURUMsParaEnviar) {
        const headers = {
            "Content-Type": "application/json",
        };
        try {
            const response = await axios.post(
                `${url}/api/ext-salva-movimentacoes-externas`,
                {
                    movimentacoesPorArquivo,
                },
                { headers }
            );
            responses.push({
                arquivosEnviados: movimentacoesPorArquivo.length,
                serverResponse: response.data,
                url,
            });
        } catch (error) {
            let formattedServerResponse = error;
            if (isAxiosError(error)) {
                formattedServerResponse = get(error, "response.data", error);
            }
            errorResponses.push({
                url,
                arquivosEnviados: movimentacoesPorArquivo.length,
                serverResponse: formattedServerResponse,
            });
        }
    }
    return {
        responses,
        errorResponses,
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
                    identificador: identificador.trim(),
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
