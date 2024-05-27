import os
import glob
import json
import requests
from datetime import datetime, timedelta
from pytz import timezone
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Define constants
DIR = os.getenv('OFX_DIR')
PADRAO_NOME = 'ext_'
URL_AURUMS_PARA_ENVIAR = [
    'https://aurum-v2.sistemaaurum.com',
    'http://grupoyes.sistemaaurum.com'
]

# Function to get files from the last two days
def retorna_os_arquivos_ofx_de_dois_dias_atras_ate_hoje(dirname):
    data_hoje = datetime.now().strftime('%d%m%y')
    data_ontem = (datetime.now() - timedelta(days=2)).strftime('%d%m%y')
    files = glob.glob(os.path.join(dirname, f"{PADRAO_NOME}*{data_hoje}*")) + glob.glob(os.path.join(dirname, f"{PADRAO_NOME}*{data_ontem}*"))
    return files

# Function to send extracted transactions to AURUMs
def envia_as_movimentacoes_extraidas_para_aurums(movimentacoes_por_arquivo):
    responses = []
    error_responses = []
    headers = {'Content-Type': 'application/json'}
    
    for url in URL_AURUMS_PARA_ENVIAR:
        try:
            response = requests.post(
                f"{url}/api/ext-salva-movimentacoes-externas",
                json={'movimentacoesPorArquivo': movimentacoes_por_arquivo},
                headers=headers
            )
            responses.append({
                'arquivosEnviados': len(movimentacoes_por_arquivo),
                'serverResponse': response.json(),
                'url': url
            })
        except requests.exceptions.RequestException as e:
            error_responses.append({
                'url': url,
                'arquivosEnviados': len(movimentacoes_por_arquivo),
                'serverResponse': str(e)
            })
    return {'responses': responses, 'errorResponses': error_responses}

# Main function
def main():
    print('Data:', datetime.now(timezone('UTC')).strftime('%d/%m/%Y %H:%M:%S %Z'))
    arquivos = retorna_os_arquivos_ofx_de_dois_dias_atras_ate_hoje(DIR)
    dados_dos_arquivos = []
    
    for nome_arquivo in arquivos:
        with open(nome_arquivo, 'r', encoding='utf-8') as file:
            conteudo = file.read()
        partes_nome_arquivo = nome_arquivo.split('_')
        codigo_banco = partes_nome_arquivo[1]
        agencia = partes_nome_arquivo[2]
        numero_da_conta_sem_digito = partes_nome_arquivo[3].split('.')[0]

        print('Data:', datetime.now(timezone('UTC')).strftime('%d/%m/%Y %H:%M:%S %Z'))
        print('Arquivo:', nome_arquivo, 'Banco:', codigo_banco, 'Agência:', agencia, 'Conta:', numero_da_conta_sem_digito)

        movimentacao_formatada = {
            'dataLeitura': datetime.now(timezone('UTC')).strftime('%d/%m/%Y %H:%M:%S %Z'),
            'nomeArquivo': nome_arquivo,
            'agencia': agencia,
            'codigoBanco': codigo_banco,
            'numeroConta': numero_da_conta_sem_digito,
            'movimentacoes': []
        }
        
        linhas = conteudo.split('\n')
        is_ultima_linha_em_branco = linhas[-1].strip() == ''
        
        for contador, linha in enumerate(linhas):
            if contador > 1 and contador < len(linhas) - (3 if is_ultima_linha_em_branco else 2) and linha.strip():
                movimentacao = {
                    'identificador': linha[0:15].strip(),
                    'data': datetime.strptime(linha[142:150], '%d%m%Y').strftime('%d/%m/%Y'),
                    'valor': float(linha[150:168]) / 100,
                    'tipo': linha[168:169],
                    'descricao': linha[176:234].strip()
                }
                movimentacao_formatada['movimentacoes'].append(movimentacao)
            elif linha.strip():
                if contador == 0:
                    movimentacao_formatada['agencia'] = linha[53:57].strip()
                elif contador == len(linhas) - (3 if is_ultima_linha_em_branco else 2):
                    movimentacao_formatada.update({
                        'dataSaldoInicial': datetime.strptime(linha[142:150], '%d%m%Y').strftime('%d/%m/%Y'),
                        'saldoFinal': float(linha[150:168]) / 100,
                        'situacaoSaldoFinal': linha[168:169]
                    })

        dados_dos_arquivos.append(movimentacao_formatada)
    
    response = envia_as_movimentacoes_extraidas_para_aurums(dados_dos_arquivos)
    print(json.dumps(response, indent=4))

# Scheduler setup
import schedule
import time

cron_str = os.getenv('CRON_STR', '*/1 * * * *')

def job():
    main()

schedule.every(1).minutes.do(job)

while True:
    schedule.run_pending()
    time.sleep(1)

if __name__ == '__main__':
    main()
