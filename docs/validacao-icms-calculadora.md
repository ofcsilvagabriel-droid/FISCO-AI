# Consistência do ICMS e calculadora flutuante

## 1. Resumo executivo

Correção de alíquota e ICMS próprio na importação, recálculo, memória por faixa, exibição e relatórios. Inclusão de calculadora livre, móvel e redimensionável. Validação realizada em 12/10/2026.

## 2. Escopo, premissas e fontes

O XML original é a referência documental; valores apurados e simulações são identificados separadamente. Percentuais vêm do item, com fallback na tabela existente quando ausentes. Não foram alteradas as bases de NCM nem as regras de enquadramento dos convênios.

Referência semântica dos campos pICMS (alíquota) e vICMS (valor): [documentação oficial da NF-e, NT 2013.005](https://www.nfe.fazenda.gov.br/Portal/exibirArquivo.aspx?AspxAutoDetectCookieSupport=1&conteudo=OeljCPBB1ds%3D). O trabalho valida a consistência do software, sem certificar a validade tributária de todos os enquadramentos cadastrados.

## 3. Estado atual e lacunas

Falhas reproduzidas antes da correção:

- Rotinas exibiam a alíquota definida pelas UFs, apesar de usarem o destaque do XML para o ICMS próprio.
- Memórias de MVA eram registradas/consultadas por uma faixa diferente da alíquota do item.
- Campos chamados ICMS original/na NF recebiam valores presumidos.
- Uma base já reduzida era multiplicada novamente, substituindo o destaque e seus centavos.
- A análise auxiliar assíncrona perdia a identificação da empresa e podia substituir um recálculo manual já realizado.

## 4. Arquitetura ou modelo proposto

Arquivos e funções alterados:

| Arquivo | Funções/componentes | Alteração |
|---|---|---|
| `src/components/FiscoAI.jsx` | `getAliqInterestadual`, `analisarProduto`, `calcularICMSProduto`, `calcAntecipacaoParcial` | Alíquota do item e ICMS próprio coerentes; zero explícito preservado; destaque mantido na base já reduzida. |
| Mesmo arquivo | `upsertRegistroArquivo`, `exportarArquivoPDF`, `exportarRelatorioPDF`, `CalcCard`, `App` | Dados originais separados dos apurados; base própria identificada; metadados persistidos; proteção contra respostas atrasadas; calculadora integrada. |
| `src/modules/xml/services/parsearNFe.js` | `parsearNFe` | Snapshot do ICMS original e indicação de campos presentes, distinguindo ausência de zero. |
| `src/modules/fiscal/domain/engines/IcmsProprioEngine.ts` | `resolverIcmsProprio` | Preservação do destaque, zero explícito e números finitos; compatibilidade com registros sem os marcadores novos. |
| `src/modules/fiscal/data/aliquotasUF.js` | `calcularDIFAL` | Recebe a alíquota já resolvida para o item e preserva ICMS de origem zero informado. |
| `src/modules/fiscal/domain/services/HistoricoApuracaoService.ts` | `registrarNovaApuracao`, `registrarAutomaticamenteNaMemoria` | Faixa de MVA determinada pelos parâmetros efetivamente usados no item. |
| `src/modules/fiscal/domain/engines/simulacaoFiscal.js` | `aplicarOverrides` | Alteração explícita de alíquota recalcula a simulação mantendo o original do XML. |
| `src/components/CalculadoraFlutuante.jsx` e `.css` | `CalculadoraFlutuante`, `limitar`, controles de movimento, tamanho e teclado | Janela não modal, acessível pelo botão fixo, com limites de tela, arraste e redimensionamento. |
| `src/components/calculadora.js` | `atualizarCalculadora` | Operações sequenciais, decimais, percentuais, sinal, exclusão e tratamento de divisão por zero; sem executar expressões como código. |
| `src/components/__tests__/consistenciaIcms.test.js`, `calculadora.test.js` | Casos de regressão | Cobertura das falhas reproduzidas, histórico, simulação, nota mista, isenção e operações da calculadora. |

`ArquivoFiscalService` e `CongelamentoService` foram lidos e mantidos. Registros antigos e congelamentos continuam abrindo sem exigir os novos campos.

## 5. Alternativas e decisão

Foi adotada a resolução consistente por item, mantendo os motores existentes e alterando somente os caminhos envolvidos. A calculadora é um componente independente, sem ligação com os valores fiscais da nota.

## 6. Riscos, controles e licenças

Nenhuma dependência adicionada. Nenhum XML real incluído no repositório; a regressão usa somente os dados necessários, sanitizados. Congelamentos e arquivos antigos não são recalculados em massa: representam resultados salvos. Para conferir a correção em uma nota anteriormente processada, reimporte o XML ou faça o recálculo explícito do item.

## 7. Plano por fases e dependências

Falhas reproduzidas por testes, correção localizada, suíte completa e compilação. Publicação segue a integração GitHub/Vercel existente. A calculadora pode ser testada na versão local aberta na porta 3000.

## 8. Testes e gates de produção

Suíte completa: **201 testes aprovados em 23 arquivos**.
Compilação de produção (`npm run build`), verificação de tipos (`npx tsc --noEmit`) e checagem de diff aprovadas. A compilação mantém avisos preexistentes de dependências e tamanho de pacotes.

Regressão financeira extraída da NF 580476/1 fornecida como referência:

| Item | ICMS próprio | Antecipação |
|---|---:|---:|
| 1 | R$ 1.013,40 | R$ 717,82 |
| 2 | R$ 844,56 | R$ 598,23 |
| Total da antecipação | | R$ 1.316,05 |

O motor não contém identificação nem tratamento específico para essa nota. As orientações de conformidade fiscal guiaram a comparação XML → cálculo → congelamento; as orientações de interface guiaram o painel não modal e os controles de teclado.

Teste manual com pelo menos três tipos de nota:

1. **Nota com destaque de 4% e antecipação:** importe, confira alíquota/ICMS original, selecione o item e recalcule como antecipação. O destaque deve permanecer igual ao XML. Repita com FCP.
2. **Nota com ST e itens de 4%, 7% e 12%:** confira cada alíquota, altere a MVA de cada faixa e reimporte outra nota da mesma empresa. Cada faixa deve recuperar sua própria MVA e usar os valores da nova nota.
3. **Nota com base reduzida/CST 20 ou 70, com frete, seguro, desconto, outras despesas e IPI:** compare o ICMS próprio com vICMS do XML. Recalcule e confirme que o destaque não sofre nova multiplicação nem perde centavos.
4. **Nota mista com isentos/não tributados e DIFAL:** itens isentos não devem receber presunção indevida; os tributados devem manter os dados próprios. Importe também um lote para conferir que os itens de uma nota não trocam suas alíquotas com os de outra.
5. **Calculadora:** abra no canto inferior direito; arraste o cabeçalho e o canto inferior; use +/− para tamanho, teclado numérico, vírgula e Escape. Confira `100 + 10 % = 110`, `100 − 20 % = 80`, `0,1 + 0,2 = 0,3` e a mensagem ao dividir por zero. Repita em janela estreita e ao trocar de módulo.

## 9. Definition of Done

Testes das inconsistências aprovados, XML original preservado, regressões existentes aprovadas, calculadora incluída e arquivos históricos compatíveis. A validação visual de arraste, toque e redimensionamento permanece pendente: a política do navegador bloqueou o acesso automatizado à página local, sem tentativa de contornar o bloqueio.

## 10. Itens a confirmar

Ficaram de fora a revisão jurídica de todos os regimes, a reclassificação de NCMs e a migração automática de decisões históricas incorretas. Não integram o pedido e modificariam resultados fiscais já salvos. A conferência visual manual indicada acima continua necessária.
