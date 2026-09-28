import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { identificarST, calcularSTporPauta, calcularSTcomBeneficio, gerarRegraSugerida, normalizarTexto, classificarMatrizST, scoreCSTMatriz, CST_ST_FORTE as MST_CST_FORTE, CST_ST_FRACO as MST_CST_FRACO } from "@/modules/fiscal/engines/motorST";
import { resolverPauta } from "@/modules/fiscal/engines/motorPauta";
import { admitePauta, verificarSeTemPMC } from "@/modules/fiscal/engines/pmcDescritivo";
import { isRegraConvenio, matchConvenioEstrito } from "@/modules/fiscal/engines/motorConvenio";
import { RICMS_BA_ANEXO1 } from "@/modules/fiscal/data/ricmsBaAnexo1";
import { CONV_52_91_INDUSTRIAL, CONV_52_91_AGRICOLA, beneficio5291 } from "@/modules/fiscal/data/conv5291";
import { calcularDIFAL as calcularDIFALMotor, buscarAliquotaInterestadual, buscarAliquotaInterna, isImportadoPorCSTOrig } from "@/modules/fiscal/data/aliquotasUF";
import { interpretarCST, validarCST, validarReducaoBase, descreverCST } from "@/modules/fiscal/engines/motorCST";
import { interpretarCFOP, descreverCFOP } from "@/modules/fiscal/engines/motorCFOP";
import { avaliarLiberacaoCalculo } from "@/modules/fiscal/engines/gateTributario";
import { avaliarCestaBasicaBA } from "@/modules/fiscal/engines/motorCestaBasicaBA";
import { resolverIcmsProprio as resolverIcmsProprioFiscal } from "@/modules/fiscal/domain/engines/IcmsProprioEngine";

import { mvaAjustadaPor, selecionarMVAAutopecas } from "@/modules/fiscal/engines/motorClassificacaoST";
import { ClassificationEngine } from "@/modules/fiscal/domain/engines/ClassificationEngine";
import { DecisoesValidadasService } from "@/modules/fiscal/domain/services/DecisoesValidadasService";
import { DescricaoIAService } from "@/modules/fiscal/domain/services/DescricaoIAService";
import { CongelamentoService } from "@/modules/fiscal/domain/services/CongelamentoService";
import MemoriaObsidian from "@/components/MemoriaObsidian";
import { HistoricoApuracaoService } from "@/modules/fiscal/domain/services/HistoricoApuracaoService";
import { resolverPorReferenciaExterna } from "@/modules/fiscal/engines/resolverReferenciaExterna";
import { parsearNFe } from "@/modules/xml/services/parsearNFe";

import DanfeConsulta from "@/modules/danfe/components/DanfeConsulta";
import { COLORS as DS_COLORS, TYPOGRAPHY as DS_TYPO } from "@/styles/designSystem";
import { StatCard } from "@/components/ui/Stat";

// ============================================================
// ARQUIVO FISCAL — persistência delegada ao ArquivoFiscalService
// (regra centralizada em src/modules/fiscal/domain/services)
// ============================================================
import { ArquivoFiscalService } from "@/modules/fiscal/domain/services";
const loadArquivo = () => ArquivoFiscalService.load();
// Identificação do usuário para rastreabilidade dos congelamentos
const usuarioAtual = (() => { try { return localStorage.getItem("fiscoai:usuario") || "Usuário"; } catch { return "Usuário"; } })();
const saveArquivo = (data) => ArquivoFiscalService.save(data);
const mesAnoFromData = (s) => ArquivoFiscalService.mesAno(s);
const chaveEmpresa = (cnpj, nome) => ArquivoFiscalService.chaveEmpresa(cnpj, nome);
// REGRA 2 — memória de apuração é estritamente individual por empresa.
const empresaIdDe = (nota) => String(nota?.destinatario_cnpj || "").replace(/\D/g, "")
  || (nota?.destinatario_nome ? `NOME:${String(nota.destinatario_nome).toUpperCase().trim()}` : "SEM_EMPRESA");
function upsertRegistroArquivo(arq, nota, produtos, calculos) {
  const dest = {
    cnpj: nota.destinatario_cnpj || "",
    nome: nota.destinatario_nome || "Sem destinatário",
    ie: nota.destinatario_ie || "",
  };
  const key = chaveEmpresa(dest.cnpj, dest.nome);
  const mesAno = mesAnoFromData(nota.data_emissao);
  const valorTotal = produtos.reduce((s, p) => s + (p.valor_total || 0), 0);
  const totais = {
    icmsProprio: calculos.reduce((s, c) => s + (c.valor_icms_proprio || 0), 0),
    icmsST: calculos.reduce((s, c) => s + (c.tributacao === "ICMS_ST" ? (c.valor_icms_st || 0) : 0), 0),
    antecipacao: calculos.reduce((s, c) => s + (c.tributacao === "ANTECIPACAO" ? (c.valor_icms_st || 0) : 0), 0),
    difal: calculos.reduce((s, c) => s + (c.valor_difal || 0), 0),
    ipi: produtos.reduce((s, p) => s + (p.valor_ipi || 0), 0),
    frete: produtos.reduce((s, p) => s + (p.valor_frete || 0), 0),
    icmsCalcTotal: calculos.reduce((s, c) => s + (c.valor_icms_total || 0), 0),
    economia: calculos.reduce((s, c) => s + (c.economia || 0), 0),
  };
  const registro = {
    id: nota.chave || `${nota.numero}-${nota.data_emissao}-${Date.now()}`,
    chaveNFe: nota.chave || "",
    numero: nota.numero || "",
    serie: nota.serie || "",
    dataEmissao: nota.data_emissao || "",
    mesAno,
    naturezaOperacao: nota.natureza_operacao || "",
    destinatarioIe: nota.destinatario_ie || "",
    emitenteNome: nota.emitente_nome || "",
    emitenteCnpj: nota.emitente_cnpj || "",
    ufOrigem: nota.uf_origem || "",
    ufDestino: nota.uf_destino || "",
    valorTotal,
    totaisXml: nota.totais_xml || null,
    totais,
    produtos: produtos.map((p, i) => {
      const c = calculos[i] || {};
      return {
        seq: p.seq, codigo: p.codigo, descricao: p.descricao, ncm: p.ncm,
        cest: p.cest, cfop: p.cfop, cst: p.cst || "",
        unidade: p.unidade || "", quantidade: p.quantidade,
        valor_unitario: p.valor_unitario || 0,
        valor_total: p.valor_total, valor_icms: p.valor_icms,
        valor_desconto: p.valor_desconto || 0,
        valor_frete: p.valor_frete || 0,
        valor_seguro: p.valor_seguro || 0,
        valor_outras_desp: p.valor_outras_desp || 0,
        valor_ipi: p.valor_ipi || 0,
        // valores informados no XML (conferência XML × cálculo)
        xml: {
          base_icms: p.base_icms || 0,
          aliquota_icms: p.aliquota_icms || 0,
          valor_icms: p.valor_icms || 0,
          base_icms_st: p.base_icms_st_xml || 0,
          valor_icms_st: p.valor_icms_st_xml || 0,
          aliquota_icms_st: p.aliquota_icms_st_xml || 0,
          valor_icms_st_ret: p.valor_icms_st_ret || 0,
          mva: p.mva_xml || 0,
          reducao_bc: p.reducao_bc_xml || 0,
          reducao_bc_st: p.reducao_bc_st_xml || 0,
        },
        tributacao: c.tributacao, base_calc: c.base_calc,
        base_st: c.base_st ?? c.base_calc_st ?? null,
        mva: c.mva_utilizada ?? c.mva ?? c.mva_aplicada ?? null,
        mva_informada: c.mva_informada ?? c.decisao_manual?.mva_informada ?? null,
        mva_ja_ajustada: !!(c.mva_ja_ajustada ?? c.decisao_manual?.mva_ja_ajustada),
        metodo_pauta: c.metodo_pauta || null,
        fonte_pauta: c.fonte_pauta || null,
        valor_pmc: c.valor_pmc || 0,
        valor_pauta_unitario: c.valor_pauta_unitario || 0,
        pmc_origem: c.pmc_origem || null,
        pmc_encontrado_em: c.pmc_encontrado_em || null,
        fundamento_pauta: c.fundamento_pauta || null,
        fcp_percentual: c.fcp_percentual || 0,
        valor_fcp: (c.valor_fcp || 0) + (c.valor_fcp_st || 0),
        tipo_calculo: c._congelado ? "Congelado (manual)" : (c.decisao_manual ? (c.decisao_manual.origem_memoria ? "Memória NCM" : "Manual") : "Automático"),
        // ===== CÁLCULO CONGELADO (lock manual definitivo) =====
        calculo_congelado: p.calculo_congelado || { ativo: false },
        status_calculo_lock: c._congelado ? "CONGELADO" : "AUTOMATICO",
        motivo_congelamento: c._motivo_congelamento || "",
        congelado_por: c._congelado_por || "",
        congelado_em: c._congelado_em || "",
        origem_calculo: c._congelado ? "CONGELADO"
          : c.memoria_apuracao ? (c.memoria_apuracao.origem_memoria === "ALTERADO_MANUAL" ? "MEMORIA_ALTERADA"
            : c.memoria_apuracao.origem_memoria === "CONGELADO_MANUAL_INALTERADO" ? "MEMORIA_CONGELADA" : "MEMORIA_AUTOMATICA")
          : "AUTOMATICO",
        versao_apuracao_ncm: c.memoria_apuracao?.versao_apuracao || null,
        icms_foi_presumido: !!c.icms_foi_presumido,
        icms_proprio_presumido: !!c.icms_proprio_presumido,
        reducao_base: c.reducao_base ?? c.percentual_reducao ?? null,
        aliquota_aplicada: c.aliquota_aplicada,
        aliquota_presumida: c.aliquota_presumida ?? null,
        base_icms_presumida: c.base_icms_presumida ?? null,
        aliq_interna: c.aliq_interna,
        valor_icms_proprio: c.valor_icms_proprio,
        valor_icms_st: c.valor_icms_st,
        valor_difal: c.valor_difal || 0,
        valor_icms_total: c.valor_icms_total,
        // rastreabilidade / bloqueios
        status_calculo: c.status || (c.bloqueado ? "BLOQUEADO" : "CALCULADO"),
        bloqueado: !!c.bloqueado,
        bloqueios: c.bloqueios || c.gate_tributario?.bloqueios || [],
        advertencias: c.advertencias || c.gate_tributario?.advertencias || [],
        conflito_cst_cfop: c.gate_tributario?.conflito || false,
        revisao_manual: c.gate_tributario?.revisaoManual || false,
        motivo_bloqueio: c.motivo_bloqueio || c.motivo || "",
        fundamento: c.fundamento || c.regra?.fundamento || "",
        regra: c.regra?.item_ricms || c.regra?.id || "",
        memoria_calculo: c.memoria_calculo || [],
        etapas_calculo: c.etapas_calculo || [],
        obs: c.obs || "",
      };
    }),
    salvoEm: new Date().toISOString(),
  };
  const next = { ...arq };
  const empresa = next[key] ? { ...next[key] } : { cnpj: dest.cnpj, ie: dest.ie, razaoSocial: dest.nome, registros: [] };
  empresa.razaoSocial = dest.nome || empresa.razaoSocial;
  empresa.cnpj = dest.cnpj || empresa.cnpj;
  empresa.ie = dest.ie || empresa.ie || "";
  const idx = empresa.registros.findIndex(r => r.id === registro.id || (r.chaveNFe && r.chaveNFe === registro.chaveNFe));
  if (idx >= 0) empresa.registros[idx] = registro;
  else empresa.registros = [registro, ...empresa.registros];
  next[key] = empresa;
  return { next, key, mesAno };
}
function removerRegistroArquivo(arq, empresaKey, regId) {
  const next = { ...arq };
  if (!next[empresaKey]) return next;
  const emp = { ...next[empresaKey] };
  emp.registros = emp.registros.filter(r => r.id !== regId);
  if (!emp.registros.length) delete next[empresaKey];
  else next[empresaKey] = emp;
  return next;
}
function formatCNPJ(v) {
  const d = (v || "").replace(/\D/g, "");
  if (d.length === 14) return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5");
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, "$1.$2.$3-$4");
  return v || "—";
}
function labelMesAno(ma) {
  const [y, m] = (ma || "").split("-");
  const meses = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const idx = parseInt(m, 10) - 1;
  if (!y || idx < 0 || idx > 11) return ma || "—";
  return `${meses[idx]}/${y}`;
}

// ============================================================
// PDF CONSOLIDADO (jsPDF + autoTable)
// ============================================================
function exportarArquivoPDF(empresa, mesAno, registros, options = {}) {
  const fmt = (v) => "R$ " + parseFloat(v || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();

  // Cabeçalho
  doc.setFillColor(26, 54, 93);
  doc.rect(0, 0, W, 70, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold"); doc.setFontSize(16);
  doc.text("Relatório Fiscal Consolidado — FiscoAI", 40, 30);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Período: ${labelMesAno(mesAno)}   ·   Gerado em ${new Date().toLocaleString("pt-BR")}`, 40, 50);

  // Empresa
  doc.setTextColor(45, 55, 72);
  doc.setFont("helvetica", "bold"); doc.setFontSize(12);
  doc.text(empresa.razaoSocial || "—", 40, 95);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  const ieEmpresa = empresa.ie || registros.find(r => r.destinatarioIe)?.destinatarioIe || "";
  doc.text(`CNPJ: ${formatCNPJ(empresa.cnpj)}   ·   Inscrição Estadual: ${ieEmpresa || "ISENTO / NÃO INFORMADA"}   ·   NF-e no período: ${registros.length}`, 40, 110);

  // Totais
  const tot = registros.reduce((s, r) => ({
    valorTotal: s.valorTotal + (r.valorTotal || 0),
    icmsProprio: s.icmsProprio + (r.totais?.icmsProprio || 0),
    icmsST: s.icmsST + (r.totais?.icmsST || 0),
    antecipacao: s.antecipacao + (r.totais?.antecipacao || 0),
    difal: s.difal + (r.totais?.difal || 0),
    ipi: s.ipi + (r.totais?.ipi || 0),
    frete: s.frete + (r.totais?.frete || 0),
    icmsCalcTotal: s.icmsCalcTotal + (r.totais?.icmsCalcTotal || 0),
  }), { valorTotal:0, icmsProprio:0, icmsST:0, antecipacao:0, difal:0, ipi:0, frete:0, icmsCalcTotal:0 });

  autoTable(doc, {
    startY: 125,
    head: [["Valor Total NF-e", "ICMS Próprio", "ICMS-ST", "Antecipação", "DIFAL", "IPI", "Frete", "ICMS Calc. Total"]],
    body: [[fmt(tot.valorTotal), fmt(tot.icmsProprio), fmt(tot.icmsST), fmt(tot.antecipacao), fmt(tot.difal), fmt(tot.ipi), fmt(tot.frete), fmt(tot.icmsCalcTotal)]],
    headStyles: { fillColor: [45, 55, 72], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 10, fontStyle: "bold" },
    margin: { left: 40, right: 40 },
    theme: "grid",
  });

  // Tabela de NF-e
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 18,
    head: [["#", "NF", "Série", "Emissão", "Emitente", "UF", "Valor", "ICMS Próp.", "ICMS-ST", "Antecip.", "DIFAL"]],
    body: registros.map((r, i) => [
      i + 1, r.numero || "—", r.serie || "—",
      r.dataEmissao ? r.dataEmissao.slice(0, 10) : "—",
      r.emitenteNome || "—",
      `${r.ufOrigem || "?"}→${r.ufDestino || "?"}`,
      fmt(r.valorTotal),
      fmt(r.totais?.icmsProprio),
      fmt(r.totais?.icmsST),
      fmt(r.totais?.antecipacao),
      fmt(r.totais?.difal),
    ]),
    headStyles: { fillColor: [26, 54, 93], textColor: 255, fontSize: 9 },
    bodyStyles: { fontSize: 8 },
    margin: { left: 40, right: 40 },
    theme: "striped",
    didDrawPage: () => {
      const pg = doc.internal.getNumberOfPages();
      doc.setFontSize(8); doc.setTextColor(120);
      doc.text(`FiscoAI · Relatório consolidado · Página ${pg}`, W - 40, doc.internal.pageSize.getHeight() - 15, { align: "right" });
    },
  });

  // ============================================================
  // Detalhamento por NF-e (1 página): dados gerais + tabela de itens.
  // ============================================================
  const pct = (v) => (v === null || v === undefined || v === "" ? "—" : `${parseFloat(v || 0).toFixed(2)}%`);
  const rodape = () => {
    const pg = doc.internal.getNumberOfPages();
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`FiscoAI · Relatório consolidado · Página ${pg}`, W - 40, doc.internal.pageSize.getHeight() - 15, { align: "right" });
  };

  registros.forEach((r) => {
    doc.addPage();
    doc.setFillColor(26, 54, 93);
    doc.rect(0, 0, W, 30, "F");
    doc.setTextColor(255); doc.setFont("helvetica", "bold"); doc.setFontSize(11);
    doc.text(`NF-e ${r.numero}/${r.serie || "—"}  ·  ${r.emitenteNome || ""}`, 40, 20);

    const tx = r.totaisXml || {};
    // --- Dados gerais da NF-e ---
    autoTable(doc, {
      startY: 40,
      head: [["Dados gerais da NF-e", "", "", ""]],
      body: [
        ["Número / Série", `${r.numero || "—"} / ${r.serie || "—"}`, "Emissão", r.dataEmissao ? r.dataEmissao.slice(0, 10) : "—"],
        ["Chave de acesso", (r.chaveNFe || "—").replace(/^NFe/, ""), "Natureza da operação", r.naturezaOperacao || "—"],
        ["Emitente", `${r.emitenteNome || "—"} (${formatCNPJ(r.emitenteCnpj)})`, "Destinatário", `${empresa.razaoSocial || "—"} (${formatCNPJ(empresa.cnpj)}) · IE ${r.destinatarioIe || empresa.ie || "ISENTO"}`],
        ["UF origem → destino", `${r.ufOrigem || "?"} → ${r.ufDestino || "?"}`, "Valor total da NF-e", fmt(tx.valor_total || r.valorTotal)],
        ["Valor dos produtos", fmt(tx.valor_produtos ?? r.valorTotal), "Descontos", fmt(tx.valor_desconto)],
        ["Frete", fmt(tx.valor_frete ?? r.totais?.frete), "Seguro", fmt(tx.valor_seguro)],
        ["Outras despesas", fmt(tx.valor_outras_desp), "IPI", fmt(tx.valor_ipi ?? r.totais?.ipi)],
        ["ICMS próprio (XML)", fmt(tx.valor_icms), "ICMS-ST (XML)", fmt(tx.valor_icms_st)],
        ["ICMS próprio (calculado)", fmt(r.totais?.icmsProprio), "ICMS-ST / Antecip. (calculado)", `${fmt(r.totais?.icmsST)} / ${fmt(r.totais?.antecipacao)}`],
        ["DIFAL (calculado)", fmt(r.totais?.difal), "ICMS total calculado", fmt(r.totais?.icmsCalcTotal)],
      ],
      headStyles: { fillColor: [45, 55, 72], textColor: 255, fontSize: 7.5, cellPadding: 1.5 },
      bodyStyles: { fontSize: 6.5, cellPadding: 1.2 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 110 }, 2: { fontStyle: "bold", cellWidth: 110 } },
      margin: { left: 40, right: 40 },
      theme: "grid",
      didDrawPage: rodape,
    });

    // --- Itens da NF-e ---
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 6,
      head: [["Seq", "Código", "Descrição", "NCM", "CEST", "CFOP", "CST", "Qtd/Un", "Vl. Unit.", "Vl. Total", "Pauta", "Base", "Alíq.", "ICMS Próp.", "Base ST", "MVA", "FCP", "Tipo cálc.", "ST/Antec.", "Situação"]],
      body: (r.produtos || []).map((p) => [
        p.seq, (p.codigo || "—"), (p.descricao || "").slice(0, 42), p.ncm || "—", p.cest || "—",
        p.cfop || "—", p.cst || "—",
        `${(p.quantidade || 0)} ${p.unidade || ""}`.trim(),
        fmt(p.valor_unitario), fmt(p.valor_total),
        (p.metodo_pauta && p.metodo_pauta !== "MVA")
          ? `${p.metodo_pauta} ${fmt(p.valor_pmc || p.valor_pauta_unitario)} → BC ${fmt(p.base_st)}`
          : "—",
        fmt(p.base_calc) + (p.icms_proprio_presumido ? " (presum.)" : ""), pct(p.aliquota_presumida||p.aliquota_aplicada),
        fmt(p.valor_icms_proprio) + (p.icms_proprio_presumido ? " (presum.)" : ""),
        p.base_st ? fmt(p.base_st) : "—",
        p.mva ? pct(p.mva) + (p.tipo_calculo && p.tipo_calculo !== "Automático" ? " (man.)" : "") : "—",
        p.fcp_percentual ? `${pct(p.fcp_percentual)} / ${fmt(p.valor_fcp)}` : "—",
        (p.metodo_pauta && p.metodo_pauta !== "MVA" && (!p.tipo_calculo || p.tipo_calculo === "Automático"))
          ? `Pauta (${p.metodo_pauta}) — individual` : (p.tipo_calculo || "Automático"),
        fmt(p.valor_icms_st),
        p.bloqueado ? "BLOQUEADO" : (p.revisao_manual ? "REVISAR" : (p.tributacao || "NORMAL")),
      ]),
      headStyles: { fillColor: [26, 54, 93], textColor: 255, fontSize: 6.5, cellPadding: 1.2 },
      bodyStyles: { fontSize: 6, cellPadding: 1 },
      margin: { left: 40, right: 40 },
      theme: "striped",
      didParseCell: (d) => {
        if (d.section === "body" && d.column.index === 19) {
          if (d.cell.raw === "BLOQUEADO") { d.cell.styles.textColor = [197, 48, 48]; d.cell.styles.fontStyle = "bold"; }
          else if (d.cell.raw === "REVISAR") { d.cell.styles.textColor = [183, 121, 31]; d.cell.styles.fontStyle = "bold"; }
        }
      },
      didDrawPage: rodape,
    });

    // --- Resumo de métodos de cálculo (pauta x automático x congelado) ---
    const itens = r.produtos || [];
    const porPauta = itens.filter((p) => p.metodo_pauta && p.metodo_pauta !== "MVA");
    const congelados = itens.filter((p) => p.status_calculo_lock === "CONGELADO");
    const automaticos = itens.filter((p) => !(p.metodo_pauta && p.metodo_pauta !== "MVA") && p.status_calculo_lock !== "CONGELADO");
    const somaST = (lista) => lista.reduce((s, p) => s + (p.valor_icms_st || 0), 0);
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 6,
      head: [["Resumo de métodos de cálculo", "Itens", "ICMS-ST / Antecipação"]],
      body: [
        [`Calculados por PAUTA (PMC/PMPF informado no documento) — cálculo individual por produto: não reaproveita histórico; cada ocorrência é recalculada conforme o PMC/PMPF da NF`, String(porPauta.length), fmt(somaST(porPauta))],
        [`Calculados por método AUTOMÁTICO (MVA / base normal)`, String(automaticos.length), fmt(somaST(automaticos))],
        [`Cálculos CONGELADOS (decisão manual)`, String(congelados.length), fmt(somaST(congelados))],
      ],
      headStyles: { fillColor: [45, 55, 72], textColor: 255, fontSize: 7, cellPadding: 1.5 },
      bodyStyles: { fontSize: 6.5, cellPadding: 1.2 },
      columnStyles: { 0: { cellWidth: 320 }, 1: { halign: "center" }, 2: { halign: "right" } },
      margin: { left: 40, right: 40 },
      theme: "grid",
      didDrawPage: rodape,
    });
  });

  const cnpjStr = (empresa.cnpj || "sem-cnpj").replace(/\D/g, "") || "sem-cnpj";
  if (options.returnBase64) {
    const arrayBuffer = doc.output("arraybuffer");
    const bytes = new Uint8Array(arrayBuffer);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }
  doc.save(`FiscoAI_${cnpjStr}_${mesAno}.pdf`);
  return null;
}

// ============================================================
// BANCO DE REGRAS FISCAIS
// ============================================================
const REGRAS_FISCAIS = {
  convenio_101_97: [
    { id:"101_97_001", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8412.80.00", descricao:"Aerogeradores para bombeamento de água e/ou moagem de grãos", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_002", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8413.81.00", descricao:"Bomba para líquidos em sistema solar fotovoltaico em CC até 2 HP", beneficio:true, condicao:"Uso em sistema de energia solar fotovoltaico em corrente contínua, potência ≤ 2 HP" },
    { id:"101_97_003", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8419.12.00", descricao:"Aquecedores solares de água", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_004", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8501.7",     descricao:"Geradores fotovoltaicos de corrente contínua", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_005", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8502.31.00", descricao:"Aerogeradores de energia eólica", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_006", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8541.42.10", descricao:"Células fotovoltaicas não montadas", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_007", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8541.42.20", descricao:"Células fotovoltaicas não montadas", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_008", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8541.43.00", descricao:"Células fotovoltaicas montadas em módulos ou painéis", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_009", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"7308.20.00", descricao:"Torre para suporte de gerador de energia eólica", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_010", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"9406.90.90", descricao:"Torre para suporte de gerador de energia eólica", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_011", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8503.00.90", descricao:"Pá de motor ou turbina eólica", beneficio:true, condicao:"Produto deve ser isento ou tributado à alíquota zero do IPI" },
    { id:"101_97_012", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"7308.90.10", descricao:"Chapas de Aço para torre de gerador eólico", beneficio:true, condicao:"Destinado à fabricação de torres para suporte de gerador de energia eólica" },
    { id:"101_97_013", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8544.49.00", descricao:"Cabos de controle e potência para energia eólica", beneficio:true, condicao:"Destinado à fabricação de torres para suporte de gerador de energia eólica" },
    { id:"101_97_014", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8479.89.99", descricao:"Anéis de Modelagem para aerogeradores", beneficio:true, condicao:"Destinado à fabricação de torres para suporte de gerador de energia eólica" },
    { id:"101_97_015", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8504.40.50", descricao:"Conversor de frequência 1600 kVA e 620V", beneficio:true, condicao:"Destinado à fabricação de Aerogeradores de Energia Eólica NCM 8502.31.00" },
    { id:"101_97_016", tipo:"ISENCAO", fundamento:"Convênio ICMS 101/97", ncm:"8544.11.00", descricao:"Fio retangular de cobre esmaltado / barra de cobre para aerogeradores", beneficio:true, condicao:"Destinado à fabricação de Aerogeradores de Energia Eólica NCM 8502.31.00" },
  ],
  convenio_52_91_industrial: CONV_52_91_INDUSTRIAL,
  convenio_52_91_agricola: CONV_52_91_AGRICOLA,
  ricms_ba_st: [
    { id:"ST_BA_001", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 1.1",  cest:"01.001.00", ncm:"8708",      descricao:"Peças, componentes e acessórios para veículos automotores", acordo:"Prot. ICMS 41/08 / 97/10", mva_original:"71,78%", mva_ajustada_4:"107,43%", mva_ajustada_7:"100,95%", mva_ajustada_12:"90,15%" },
    { id:"ST_BA_002", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 3.3",  cest:"03.003.00", ncm:"2201.1",    descricao:"Água mineral natural – vidro descartável", acordo:"Prot. ICMS 11/91 – Todos, exceto MG, RO, RR, RS e SC", mva_original:"114%", mva_ajustada_4:"158,42%", mva_ajustada_7:"150,34%", mva_ajustada_12:"136,88%" },
    { id:"ST_BA_003", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 3.9",  cest:"03.010.00", ncm:"2202.10",   descricao:"Refrigerantes em vidro descartável", acordo:"Prot. ICMS 11/91 – Todos, exceto RO", mva_original:"114%", mva_ajustada_4:"165,08%", mva_ajustada_7:"156,80%", mva_ajustada_12:"142,99%" },
    { id:"ST_BA_004", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 3.9.1",cest:"03.010.01", ncm:"2202.10",   descricao:"Refrigerantes em embalagem PET", acordo:"Prot. ICMS 11/91 – Todos, exceto RO", mva_original:"114%", mva_ajustada_4:"165,08%", mva_ajustada_7:"156,80%", mva_ajustada_12:"142,99%" },
    { id:"ST_BA_005", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 3.16.0",cest:"03.021.00",ncm:"2203",     descricao:"Cerveja em garrafa de vidro retornável", acordo:"Prot. ICMS 11/91 – Todos", mva_original:"140%", mva_ajustada_4:"215,62%", mva_ajustada_7:"205,75%", mva_ajustada_12:"189,32%" },
    { id:"ST_BA_006", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 3.16.3",cest:"03.021.03",ncm:"2203",     descricao:"Cerveja em lata", acordo:"Prot. ICMS 11/91 – Todos", mva_original:"140%", mva_ajustada_4:"215,62%", mva_ajustada_7:"205,75%", mva_ajustada_12:"189,32%" },
    { id:"ST_BA_007", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 4.1",  cest:"04.001.00", ncm:"2402",      descricao:"Charutos, cigarrilhas e cigarros de tabaco", acordo:"Conv. ICMS 111/17 – Todos", mva_original:"50%", mva_ajustada_4:"105,71%", mva_ajustada_7:"99,29%", mva_ajustada_12:"88,57%" },
    { id:"ST_BA_008", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 5.1",  cest:"05.001.00", ncm:"2523",      descricao:"Cimento", acordo:"Prot. ICMS 11/85 – Todos (exceto AM)", mva_original:"20%", mva_ajustada_4:"44,91%", mva_ajustada_7:"40,38%", mva_ajustada_12:"32,83%" },
    { id:"ST_BA_009", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 7.1",  cest:"09.001.00", ncm:"8539",      descricao:"Lâmpadas elétricas", acordo:"Prot. ICM 17/85 – Todos exceto RS, RN e SC", mva_original:"60,03%", mva_ajustada_4:"93,24%", mva_ajustada_7:"87,20%", mva_ajustada_12:"77,14%" },
    { id:"ST_BA_010", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 7.5",  cest:"09.005.00", ncm:"8539.52",   descricao:"Lâmpadas de LED", acordo:"Prot. ICM 17/85 – Todos exceto RS, RN e SC", mva_original:"63,67%", mva_ajustada_4:"97,64%", mva_ajustada_7:"91,46%", mva_ajustada_12:"81,17%" },
    { id:"ST_BA_011", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 8.22", cest:"10.022.00", ncm:"6810.19",   descricao:"Telhas de concreto", acordo:"Prot. ICMS 104/09 / Prot. ICMS 26/10", mva_original:"55%", mva_ajustada_4:"87,17%", mva_ajustada_7:"81,32%", mva_ajustada_12:"71,57%" },
    { id:"ST_BA_012", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 9.1.0",cest:"13.001.00", ncm:"3003",      descricao:"Medicamentos de referência – Lista Positiva", acordo:"Conv. ICMS 234/17 / Prot. ICMS 105/09", mva_original:"38,24%", mva_ajustada_4:"66,93%", mva_ajustada_7:"61,71%", mva_ajustada_12:"53,02%" },
    { id:"ST_BA_013", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 9.2.0",cest:"13.002.00", ncm:"3004",      descricao:"Medicamentos genéricos – Lista Positiva", acordo:"Conv. ICMS 234/17 / Prot. ICMS 105/09", mva_original:"38,24%", mva_ajustada_4:"66,93%", mva_ajustada_7:"61,71%", mva_ajustada_12:"53,02%" },
    { id:"ST_BA_014", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 10.1", cest:"16.001.00", ncm:"4011",      descricao:"Pneus novos para automóveis de passeio", acordo:"Conv. ICMS 102/17 – Todos, exceto RO", mva_original:"42%", mva_ajustada_4:"71,47%", mva_ajustada_7:"66,11%", mva_ajustada_12:"57,18%" },
    { id:"ST_BA_015", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 10.3", cest:"16.003.00", ncm:"4011",      descricao:"Pneus novos para motocicletas", acordo:"Conv. ICMS 102/17 – Todos", mva_original:"60%", mva_ajustada_4:"93,21%", mva_ajustada_7:"87,17%", mva_ajustada_12:"77,11%" },
    { id:"ST_BA_016", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 11.1", cest:"17.044.00", ncm:"1101.00.1", descricao:"Farinha de trigo em qualquer embalagem", acordo:"Prot. ICMS 46/00 – AL, AM, BA, CE, PB, PE, RN, RO e SE", mva_original:"77,37%", mva_ajustada_4:"70,27%", mva_ajustada_7:"64,95%", mva_ajustada_12:"56,08%" },
    { id:"ST_BA_017", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 15.1", cest:"23.001.00", ncm:"2105",      descricao:"Sorvetes de qualquer espécie", acordo:"Prot. ICMS 20/05 – Todos, exceto CE, RS e SC", mva_original:"70%", mva_ajustada_4:"105,28%", mva_ajustada_7:"98,87%", mva_ajustada_12:"88,18%" },
    { id:"ST_BA_018", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 16.1", cest:"24.001.00", ncm:"3208",      descricao:"Tintas e vernizes", acordo:"Conv. ICMS 118/17 – exceto SC", mva_original:"35%", mva_ajustada_4:"63,02%", mva_ajustada_7:"57,92%", mva_ajustada_12:"49,43%" },
    { id:"ST_BA_019", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 6.1",  cest:"06.001.01", ncm:"2207.10.9", descricao:"Álcool etílico hidratado combustível (AEHC)", acordo:"Conv. ICMS 110/07 – Todos", mva_original:"PMPF", mva_ajustada_4:"PMPF", mva_ajustada_7:"PMPF", mva_ajustada_12:"PMPF" },
    { id:"ST_BA_020", tipo:"ICMS_ST", fundamento:"RICMS/BA – Decreto 13.780/2012 – Anexo 1, Item 6.7",  cest:"06.007.00", ncm:"2710.19.3", descricao:"Óleos lubrificantes", acordo:"Conv. ICMS 110/07 – Todos", mva_original:"Ato COTEPE 61/19", mva_ajustada_4:"Ato COTEPE 61/19", mva_ajustada_7:"Ato COTEPE 61/19", mva_ajustada_12:"Ato COTEPE 61/19" },
  ]
};

// ============================================================
// MOTOR DE REGRAS
// ============================================================
const normNCM  = (n) => n ? String(n).replace(/[.\s-]/g,"").toUpperCase() : "";
const normCEST = (c) => c ? String(c).replace(/[.\s-]/g,"")             : "";

// Stop-words descartadas no match por descrição
const STOP = new Set(["de","da","do","das","dos","e","em","para","com","sem","a","o","os","as","um","uma","no","na","nos","nas","ao","aos","por","ou","tipo","sob","entre","p"]);
function tokens(s){
  return normalizarTexto(s).split(" ").filter(t => t.length >= 4 && !STOP.has(t));
}

// Match assimétrico: a REGRA é o prefixo; o NCM do produto deve começar com ela.
// Retorna quantos dígitos coincidiram (0 se não casar ou prefixo < 4 dígitos).
function ncmPrefixHit(produtoNcm, regraNcm){
  const p = normNCM(produtoNcm), r = normNCM(regraNcm);
  if (!p || !r || r.length < 4) return 0;
  return p.startsWith(r) ? r.length : 0;
}

// Conta dígitos coincidentes no prefixo do NCM (produto x regra)
function ncmCoincidencia(produtoNcm, regraNcm){
  const p = normNCM(produtoNcm), r = normNCM(regraNcm);
  if (!p || !r) return 0;
  const min = Math.min(p.length, r.length);
  let n = 0;
  for (let i=0; i<min; i++){
    if (p[i] === r[i]) n++; else break;
  }
  return n;
}

// Análise semântica da descrição (COMPATÍVEL / PARCIAL / INCOMPATÍVEL)
function analisarDescricao(produto, regra){
  const tProd = new Set(tokens(produto.descricao));
  const tReg  = tokens(regra.descricao);
  if (!tReg.length || !tProd.size) return { nivel: "INDETERMINADA", ajuste: 0, hits: 0, total: tReg.length };
  const hits = tReg.filter(t => tProd.has(t)).length;
  const ratio = hits / Math.min(tReg.length, 5);
  if (ratio >= 0.5) return { nivel: "COMPATIVEL", ajuste: 20, hits, total: tReg.length };
  if (ratio > 0)    return { nivel: "PARCIALMENTE_COMPATIVEL", ajuste: 10, hits, total: tReg.length };
  return { nivel: "INCOMPATIVEL", ajuste: -40, hits, total: tReg.length };
}

// ============================================================
// MOTOR DE ENQUADRAMENTO POR NCM (matriz 2/4/6/8 dígitos)
//   - NCM 2 dig coincid. → 20  (NÃO ENQUADRADO)
//   - NCM 4 dig coincid. → 40  (POSSÍVEL — exige análise da descrição)
//   - NCM 6 dig coincid. → 60  (PROVÁVEL)
//   - NCM 8 dig coincid. → 100 (TOTAL)
// Ajuste da descrição: COMPATÍVEL +20 / PARCIAL +10 / INCOMPATÍVEL −40
// CEST exato confirma enquadramento total; CEST divergente descarta.
// ============================================================
function scoreRegra(produto, regra){
  const por = [];

  // CEST: divergente → descartar
  const cestP = normCEST(produto.cest);
  const cestR = normCEST(regra.cest);
  let cestExato = false;
  if (cestR && cestP){
    if (cestP === cestR || cestP.startsWith(cestR.slice(0,7)) || cestR.startsWith(cestP.slice(0,7))){
      cestExato = true;
    } else {
      return { score: 0, score_ncm: 0, ajuste_desc: 0, nivel_match_ncm: "CEST_DIVERGENTE", analise_descricao: "—", por: [], detalhe: "CEST divergente" };
    }
  }

  // NCM — matriz de dígitos coincidentes
  const coin = ncmCoincidencia(produto.ncm, regra.ncm);
  let scoreNcm = 0;
  let nivel = "SEM_MATCH";
  if (coin >= 8){ scoreNcm = 100; nivel = "8_DIGITOS"; por.push("NCM(8)"); }
  else if (coin >= 6){ scoreNcm = 60; nivel = "6_DIGITOS"; por.push("NCM(6)"); }
  else if (coin >= 4){ scoreNcm = 40; nivel = "4_DIGITOS"; por.push("NCM(4)"); }
  else if (coin >= 2){ scoreNcm = 20; nivel = "2_DIGITOS"; por.push("NCM(2)"); }

  // CEST exato → confirma enquadramento total
  if (cestExato){
    por.push("CEST");
    if (scoreNcm < 100){ scoreNcm = 100; nivel = nivel === "SEM_MATCH" ? "CEST_EXATO" : nivel + "+CEST"; }
  }

  // Análise da descrição
  const ad = analisarDescricao(produto, regra);
  let ajuste = 0;
  if (scoreNcm >= 40 && scoreNcm < 60){
    // Faixa 40-59: análise da descrição é OBRIGATÓRIA
    ajuste = ad.ajuste;
  } else if (scoreNcm >= 60 && ad.nivel === "INCOMPATIVEL"){
    // Protege de falso enquadramento em 60-99
    ajuste = -40;
  } else if (scoreNcm < 40 && ad.nivel === "COMPATIVEL"){
    // Reforço leve quando NCM é fraco mas descrição bate
    ajuste = 10;
  }
  if (ad.nivel !== "INDETERMINADA") por.push("DESC");

  const score = Math.max(0, Math.min(100, scoreNcm + ajuste));

  return {
    score,
    score_ncm: scoreNcm,
    ajuste_desc: ajuste,
    nivel_match_ncm: nivel,
    analise_descricao: ad.nivel,
    desc_hits: ad.hits,
    desc_total: ad.total,
    por,
    detalhe: por.join("+") || "—",
  };
}

// ============================================================
// MOTOR DE ENQUADRAMENTO ESPECÍFICO PARA ICMS-ST
//   Matriz oficial: NCM 60 / Descrição 30 / CST 10  (score 0..100)
//   - NCM: 8dig=60 · 6dig=45 · 4dig=25 · 2dig=10
//   - Descrição: FORTE=30 · MEDIA=20 · PARCIAL=10
//   - CST/CSOSN compatível=10 · possível=5 · incompatível=0
//   - CEST divergente descarta a regra; CEST exato eleva a MÁX(score, 90)
// Classificação: >80 e NCM≥45 = CLASSIFICAR COMO ST · >80 e NCM<45 = VALIDAÇÃO MANUAL
//                66-80 = ALTA PROBABILIDADE · 46-65 = BAIXA/MÉDIA · ≤45 = NÃO SUGERIR
// ============================================================
// Mantidos para compat com trechos legados da UI — apontam para o mesmo Set exportado
const CST_ST_FORTE_UI = MST_CST_FORTE;
const CST_ST_FRACO_UI = MST_CST_FRACO;

function scoreRegraST(produto, regra){
  const por = [];

  // CEST divergente descarta
  const cestP = normCEST(produto.cest);
  const cestR = normCEST(regra.cest);
  let cestExato = false;
  if (cestR && cestP){
    if (cestP === cestR || cestP.startsWith(cestR.slice(0,7)) || cestR.startsWith(cestP.slice(0,7))){
      cestExato = true;
    } else {
      return { score:0, score_ncm:0, score_descricao:0, score_cst:0, nivel_match_ncm:"CEST_DIVERGENTE",
               analise_descricao:"—", nivel_cst:"—", por:[], detalhe:"CEST divergente",
               classificacao:"NAO_SUGERIR" };
    }
  }

  // NCM 60 — matriz oficial
  const coin = ncmCoincidencia(produto.ncm, regra.ncm);
  let scoreNcm = 0, nivelNCM = "SEM_MATCH";
  if      (coin >= 8){ scoreNcm = 60; nivelNCM = "NCM_8_DIGITOS"; por.push("NCM(8)"); }
  else if (coin >= 6){ scoreNcm = 45; nivelNCM = "NCM_6_DIGITOS"; por.push("NCM(6)"); }
  else if (coin >= 4){ scoreNcm = 25; nivelNCM = "NCM_4_DIGITOS"; por.push("NCM(4)"); }
  else if (coin >= 2){ scoreNcm = 10; nivelNCM = "NCM_CAPITULO"; por.push("NCM(2)"); }

  // Descrição 30
  const ad = analisarDescricao(produto, regra);
  let scoreDesc = 0, nivelDESC = "SEM_CORRESPONDENCIA";
  if (ad.nivel === "COMPATIVEL")               { scoreDesc = 30; nivelDESC = "FORTE"; por.push("DESC"); }
  else if (ad.nivel === "PARCIALMENTE_COMPATIVEL"){
    if (scoreNcm >= 25){ scoreDesc = 20; nivelDESC = "MEDIA"; }
    else                { scoreDesc = 10; nivelDESC = "PARCIAL"; }
    por.push("DESC");
  } else if (ad.nivel === "INCOMPATIVEL")      { scoreDesc = 0;  nivelDESC = "INCOMPATIVEL"; }

  // CST 10 — mesma função usada pelo identificarST
  const cstInfo = scoreCSTMatriz(produto.cst || produto.CST || produto.csosn);
  const scoreCst = cstInfo.score;
  const nivelCST = cstInfo.nivel;
  if (scoreCst > 0) por.push("CST");

  if (cestExato){
    por.push("CEST");
    if (nivelNCM === "SEM_MATCH") nivelNCM = "CEST_EXATO";
    else nivelNCM = nivelNCM + "+CEST";
  }

  // Proteção: descrição incompatível com NCM forte reduz confiança
  let scoreDescAplicado = scoreDesc;
  if (ad.nivel === "INCOMPATIVEL" && scoreNcm >= 45 && !cestExato){
    scoreDescAplicado = scoreDesc - 20; // penalidade absorvida no score final
  }

  // Classificação unificada — MESMOS thresholds do identificarST
  const cl = classificarMatrizST({ scoreNcm, scoreDesc: scoreDescAplicado, scoreCst, cestExato });

  return {
    score: cl.score,
    score_ncm: scoreNcm,
    score_descricao: scoreDesc,
    score_cst: scoreCst,
    ajuste_desc: scoreDesc,       // compat com UI existente
    nivel_match_ncm: nivelNCM,
    analise_descricao: nivelDESC,
    nivel_cst: nivelCST,
    cst_consultado: cstInfo.cst,
    desc_hits: ad.hits,
    desc_total: ad.total,
    por,
    detalhe: por.join("+") || "—",
    classificacao: cl.classificacao,
    status: cl.status,
  };
}

// Origem do dataset (PDF/decreto) consumido por cada regra
const FONTE_PDF = {
  convenio_101_97: "PDF Convênio ICMS 101/97 (isenção – energia solar/eólica)",
  convenio_52_91_industrial: "PDF Convênio ICMS 52/91 – Anexo I (industrial)",
  convenio_52_91_agricola: "PDF Convênio ICMS 52/91 – Anexo II (agrícola)",
  ricms_ba_curado: "RICMS/BA – Decreto 13.780/2012 (Anexo 1 – itens curados)",
  ricms_ba_anexo1: "PDF RICMS/BA – Anexo 1 vig. 2025 (Dec. 13.780/2012)",
};

function analisarProduto(produto, ufOrigem, ufDestino) {
  const resultados = [];
  const auditoria = []; // ← MODO AUDITORIA: rastreia decisão por regra avaliada
  // Dedupe RICMS por CEST: regras curadas (REGRAS_FISCAIS.ricms_ba_st) têm prioridade
  const cestsCurados = new Set(REGRAS_FISCAIS.ricms_ba_st.map(r=>normCEST(r.cest)));
  const ricmsExtra = RICMS_BA_ANEXO1.filter(r => !cestsCurados.has(normCEST(r.cest)));
  // Ordem de consulta: RICMS/BA (base primária de ST) ANTES dos convênios.
  // Isso garante que, em empate de score, a legislação citada seja
  // sempre a norma estadual que efetivamente disciplina a ST no destino.
  const todas = [
    ...REGRAS_FISCAIS.ricms_ba_st.map(r=>({...r,_fonte:FONTE_PDF.ricms_ba_curado})),
    ...ricmsExtra.map(r=>({...r,_fonte:FONTE_PDF.ricms_ba_anexo1})),
    ...REGRAS_FISCAIS.convenio_101_97.map(r=>({...r,_fonte:FONTE_PDF.convenio_101_97})),
    ...REGRAS_FISCAIS.convenio_52_91_industrial.map(r=>({...r,_fonte:FONTE_PDF.convenio_52_91_industrial})),
    ...REGRAS_FISCAIS.convenio_52_91_agricola.map(r=>({...r,_fonte:FONTE_PDF.convenio_52_91_agricola})),
  ];
  // Limiar diferenciado conforme matriz de enquadramento:
  //   - ICMS-ST: score_final ≥ 40 (aceita 40-59 com revisão manual obrigatória)
  //   - Demais regras (ISENÇÃO/REDUÇÃO/DIFERIMENTO/BENEFÍCIO): score_final ≥ 60
  const limiarPara = (tipo) => (tipo === "ICMS_ST" ? 40 : 60);
  let descartadasUF = 0;
  for (const r of todas) {
    if (r.tipo==="ICMS_ST" && ufDestino!=="BA" && ufOrigem!=="BA") { descartadasUF++; continue; }

    // -------- CONVÊNIO ICMS: enquadramento ESTRITO --------
    // NCM 8 dígitos idênticos + descrição compatível. Motor de pontuação
    // NÃO é usado para regras cuja fonte é Convênio ICMS.
    if (isRegraConvenio(r)) {
      const est = matchConvenioEstrito(produto, r);
      const decisaoTxt = est.enquadrado ? "ENQUADRADO PELO CONVÊNIO (estrito)" : "NÃO ENQUADRADO PELO CONVÊNIO";
      const justificativa = `[Motor Convênio – estrito] ${est.motivo}`;
      if (est.enquadrado) {
        const regraOut = {
          ...r,
          ncm_encontrado: produto.ncm,
          match_score: 100,
          match_por: ["CONVENIO_ESTRITO"],
          match_detalhe: "NCM 8d + Descrição",
          fonte_pdf: r._fonte,
          motor_enquadramento: "convenio_estrito",
          enquadramento: {
            produto: produto.descricao,
            ncm_informado: produto.ncm || "",
            ncm_regra: r.ncm || "",
            tipo_regra: r.tipo,
            motor: "convenio_estrito",
            ncm_exato: est.ncmExato,
            descricao_compativel: est.descCompativel,
            hits_descricao: est.hits_descricao,
            score_final: 100,
            enquadrado: true,
            confianca: "TOTAL",
            decisao: decisaoTxt,
            justificativa,
          },
          revisao: false,
          validacao_pdf: (r.tipo==="ISENCAO" || r.tipo==="REDUCAO_BC") ? {
            fonte: r._fonte, item_id: r.id, ncm_pdf: r.ncm, cest_pdf: r.cest || null,
            condicao: r.condicao || "Verificar enquadramento no Convênio.",
            status: "APLICADO_REQUER_CONFIRMACAO",
          } : null,
        };
        resultados.push(regraOut);
        auditoria.push({
          decisao: "ACEITA", regra_id: r.id, tipo: r.tipo, fonte_pdf: r._fonte,
          ncm_regra: r.ncm, cest_regra: r.cest || "—", score: 100,
          match_por: ["CONVENIO_ESTRITO"], motivo: justificativa,
        });
      } else {
        auditoria.push({
          decisao: "REJEITADA", regra_id: r.id, tipo: r.tipo, fonte_pdf: r._fonte,
          ncm_regra: r.ncm, cest_regra: r.cest || "—", score: 0,
          match_por: ["CONVENIO_ESTRITO"], motivo: justificativa,
        });
      }
      continue;
    }
    // -------- FIM CONVÊNIO ESTRITO --------

    const m = r.tipo === "ICMS_ST" ? scoreRegraST(produto, r) : scoreRegra(produto, r);
    const LIMIAR = limiarPara(r.tipo);
    // Para ICMS-ST usamos a classificação da matriz (NCM60/Desc30/CST10);
    // NÃO_SUGERIR nunca enquadra, mesmo com score ≥ limiar.
    const enquadrado = r.tipo === "ICMS_ST"
      ? (m.classificacao && m.classificacao !== "NAO_SUGERIR")
      : (m.score >= LIMIAR);
    const confianca = r.tipo === "ICMS_ST"
      ? (m.classificacao === "CLASSIFICAR_ST" ? "TOTAL"
        : m.classificacao === "ALTA_PROBABILIDADE" ? "ALTA"
        : m.classificacao === "BAIXA_MEDIA_PROBABILIDADE" ? "MEDIA"
        : m.classificacao === "VALIDACAO_MANUAL" ? "REVISAR"
        : "BAIXA")
      : (m.score >= 100 ? "TOTAL" : m.score >= 60 ? "ALTA" : m.score >= 40 ? "MEDIA" : "BAIXA");
    const decisaoTxt = r.tipo === "ICMS_ST"
      ? (enquadrado
          ? (m.classificacao === "CLASSIFICAR_ST"    ? "CLASSIFICAR COMO ST"
           : m.classificacao === "ALTA_PROBABILIDADE" ? "ALTA PROBABILIDADE DE ST (revisar)"
           : m.classificacao === "VALIDACAO_MANUAL"   ? "VALIDAÇÃO MANUAL NECESSÁRIA (NCM < 45)"
           : "BAIXA/MÉDIA PROBABILIDADE DE ST (revisar)")
          : "NÃO SUGERIR ST")
      : (enquadrado ? "ENQUADRADO PARA REGRA ICMS" : "SEM ENQUADRAMENTO AUTOMÁTICO");
    const justificativa = r.tipo === "ICMS_ST"
      ? `NCM ${produto.ncm||"—"} × regra ${r.ncm||"—"} → ${m.nivel_match_ncm} (NCM ${m.score_ncm}/60). Descrição: ${m.analise_descricao} (${m.score_descricao}/30). CST ${m.cst_consultado||"—"}: ${m.nivel_cst} (${m.score_cst}/10). Score final ${m.score}/100 → ${decisaoTxt}.`
      : `NCM informado ${produto.ncm||"—"} × regra ${r.ncm||"—"} → ${m.nivel_match_ncm} (score NCM ${m.score_ncm}). Descrição: ${m.analise_descricao} (ajuste ${m.ajuste_desc>=0?"+":""}${m.ajuste_desc}). Score final ${m.score}/100 vs. limiar ${LIMIAR} → ${decisaoTxt}.`;

    if (enquadrado) {
      const regraOut = {
        ...r,
        ncm_encontrado: produto.ncm,
        match_score: m.score,
        match_por: m.por,
        match_detalhe: m.detalhe,
        fonte_pdf: r._fonte,
        // Auditoria por item — exposto para UI e relatório
        enquadramento: {
          produto: produto.descricao,
          ncm_informado: produto.ncm || "",
          ncm_regra: r.ncm || "",
          tipo_regra: r.tipo,
          nivel_match_ncm: m.nivel_match_ncm,
          score_ncm: m.score_ncm,
          score_descricao: m.score_descricao ?? m.ajuste_desc,
          score_cst: m.score_cst ?? 0,
          nivel_cst: m.nivel_cst || "—",
          cst_informado: m.cst_consultado || "",
          analise_descricao: m.analise_descricao,
          ajuste_descricao: m.ajuste_desc,
          score_final: m.score,
          classificacao: m.classificacao || null,
          enquadrado: true,
          confianca,
          decisao: decisaoTxt,
          justificativa,
        },
        // ST: só é "definitivo" quando classificacao = CLASSIFICAR_ST; demais exigem revisão
        revisao: r.tipo === "ICMS_ST" && m.classificacao !== "CLASSIFICAR_ST",
        // Validação contra PDF p/ isenção/redução: condição que precisa ser conferida
        validacao_pdf: (r.tipo==="ISENCAO" || r.tipo==="REDUCAO_BC") ? {
          fonte: r._fonte,
          item_id: r.id,
          ncm_pdf: r.ncm,
          cest_pdf: r.cest || null,
          condicao: r.condicao || "Sem condicionante explícita no PDF — verificar enquadramento.",
          status: "APLICADO_REQUER_CONFIRMACAO",
        } : null,
      };
      resultados.push(regraOut);
      auditoria.push({
        decisao: "ACEITA",
        regra_id: r.id,
        tipo: r.tipo,
        fonte_pdf: r._fonte,
        ncm_regra: r.ncm,
        cest_regra: r.cest || "—",
        score: m.score,
        score_ncm: m.score_ncm,
        ajuste_desc: m.ajuste_desc,
        nivel_match_ncm: m.nivel_match_ncm,
        analise_descricao: m.analise_descricao,
        confianca,
        match_por: m.por,
        motivo: justificativa,
      });
    } else if (m.score > 0) {
      auditoria.push({
        decisao: "REJEITADA",
        regra_id: r.id,
        tipo: r.tipo,
        fonte_pdf: r._fonte,
        ncm_regra: r.ncm,
        cest_regra: r.cest || "—",
        score: m.score,
        score_ncm: m.score_ncm,
        ajuste_desc: m.ajuste_desc,
        nivel_match_ncm: m.nivel_match_ncm,
        analise_descricao: m.analise_descricao,
        confianca,
        match_por: m.por,
        motivo: justificativa,
      });
    } else if (m.detalhe === "CEST divergente") {
      auditoria.push({
        decisao: "DESCARTADA",
        regra_id: r.id,
        tipo: r.tipo,
        fonte_pdf: r._fonte,
        ncm_regra: r.ncm,
        cest_regra: r.cest || "—",
        score: 0,
        match_por: [],
        motivo: `CEST do produto (${produto.cest||"—"}) divergente do CEST da regra (${r.cest}). Regra descartada antes da análise de NCM/descrição.`,
      });
    }
  }
  if (descartadasUF) {
    auditoria.unshift({
      decisao: "FILTRO_UF",
      regra_id: "—",
      tipo: "ICMS_ST",
      fonte_pdf: "—",
      score: 0,
      match_por: [],
      motivo: `${descartadasUF} regras de ICMS-ST ignoradas porque nem origem (${ufOrigem}) nem destino (${ufDestino}) é BA.`,
    });
  }
  // Ordena por score desc; desempate: RICMS/BA (curado > Anexo 1) tem prioridade
  // sobre convênios federais, para evitar citar convênio quando a norma
  // estadual da BA já disciplina o item.
  const rankFonte = (x) => {
    const f = x.fonte_pdf || x._fonte || "";
    if (f === FONTE_PDF.ricms_ba_curado) return 0;
    if (f === FONTE_PDF.ricms_ba_anexo1) return 1;
    return 2;
  };
  resultados.sort((a,b) => {
    const d = (b.match_score||0) - (a.match_score||0);
    return d !== 0 ? d : rankFonte(a) - rankFonte(b);
  });

  // Motor inteligente: anexa sugestão se NÃO houver ICMS_ST já cadastrado
  const jaTemST = resultados.some(r => r.tipo === "ICMS_ST");
  if (!jaTemST) {
    const sug = gerarRegraSugerida(produto);
    if (sug) {
      // Enriquecimento: tenta localizar o item EXATO do RICMS/BA Anexo 1 que
      // corresponde ao NCM do produto. Se encontrar, usa o fundamento oficial
      // do item (com CEST/descrição). Caso contrário, deixa explícito que a
      // sugestão é heurística e NÃO cita item específico do decreto.
      const ncmDig = normNCM(produto.ncm);
      let melhorRicms = null;
      let melhorLen = 0;
      if (ncmDig) {
        for (const it of RICMS_BA_ANEXO1) {
          const itNcm = normNCM(it.ncm);
          if (!itNcm) continue;
          if (ncmDig.startsWith(itNcm) && itNcm.length > melhorLen) {
            melhorRicms = it; melhorLen = itNcm.length;
          }
        }
      }
      if (melhorRicms) {
        sug.fundamento = `${melhorRicms.fundamento} — Item ${melhorRicms.id}${melhorRicms.cest?` (CEST ${melhorRicms.cest})`:""}`;
        sug._regraOrigem = melhorRicms;
        sug.fonte_pdf = FONTE_PDF.ricms_ba_anexo1;
      } else {
        // Sem item específico → não citar o decreto como se fosse a fonte da regra
        sug.fundamento = sug.segmento
          ? `Sugestão heurística (segmento "${sug.segmento}" — Convênio ICMS 142/18). Nenhum item específico do RICMS/BA Anexo 1 localizado por NCM — revisão manual obrigatória antes de citar a legislação.`
          : `Sugestão heurística — nenhum item específico do RICMS/BA Anexo 1 localizado. Revisão manual obrigatória antes de citar a legislação.`;
        sug.fonte_pdf = "Motor de Identificação ST (heurística — sem item RICMS/BA correspondente)";
      }
      resultados.push(sug);
      auditoria.push({
        decisao: "SUGESTAO_MOTOR_ST",
        regra_id: melhorRicms ? melhorRicms.id : "motor_v3",
        tipo: "ST_SUGERIDA",
        fonte_pdf: sug.fonte_pdf,
        score: sug.score,
        match_por: [sug.metodo_identificacao],
        motivo: melhorRicms
          ? `Nenhuma regra ICMS_ST bateu por CEST/descrição; motor localizou item ${melhorRicms.id} do RICMS/BA Anexo 1 por prefixo NCM (${melhorLen} díg.) e usou seu fundamento oficial.`
          : `Nenhuma regra ICMS_ST do dataset bateu e nenhum item do RICMS/BA Anexo 1 corresponde ao NCM ${produto.ncm||"—"}. Sugestão heurística por segmento ${sug.segmento||"—"} (score ${sug.score}) — não cita item específico do decreto.`,
      });
    }
  }

  // ============================================================
  // NOVO MOTOR (2026) — Classificação ST por NCM + descrição.
  // Substitui a decisão de "produto é ST?" do motor antigo.
  // O status ST_CONFIRMADA é a ÚNICA condição para cálculo automático de ST.
  // Demais status mantêm apenas sinalização e removem ICMS_ST do conjunto
  // (o item passa a ser tratado como Antecipação/DIFAL/Normal).
  // ============================================================
  const classificacaoV2 = resolverPorReferenciaExterna(
    ClassificationEngine.classificar({
      ncm: produto.ncm, descricao: produto.descricao, cest: produto.cest,
      cst: produto.cst, cfop: produto.cfop, ufOrigem, ufDestino,
      valor: produto.valor_total,
    }),
    {
      gtin: produto.gtin || null,
      cEAN: produto.cEAN || produto.ean || null,
      registroAnvisa: produto.registro_anvisa || null,
    },
  );
  const podeCalcularST = classificacaoV2.status === "ST_CONFIRMADA";
  if (!podeCalcularST) {
    for (let i = resultados.length - 1; i >= 0; i--) {
      if (resultados[i].tipo === "ICMS_ST") resultados.splice(i, 1);
    }
    auditoria.push({
      decisao: "MOTOR_CLASSIFICACAO_ST_2026",
      regra_id: classificacaoV2.regra?.id || "—",
      tipo: "ICMS_ST",
      fonte_pdf: "motor_classificacao_st (2026)",
      score: classificacaoV2.score_ncm,
      match_por: [],
      motivo: classificacaoV2.status === "ST_CONFIRMADA_MVA_PENDENTE"
        ? `ST CONFIRMADA, MVA PENDENTE — o NCM confirma o segmento (${classificacaoV2.grupo_id}), mas a lei distingue os sub-itens por ${classificacaoV2.modo_desambiguacao}. Faixa de MVA ${classificacaoV2.mva_faixa?.minima ?? "—"}%–${classificacaoV2.mva_faixa?.maxima ?? "—"}%. Dado necessário: ${classificacaoV2.dado_necessario}`
        : `Classificação ${classificacaoV2.status} — ICMS-ST NÃO aplicado automaticamente. ${
            classificacaoV2.evidencias_negativas.join(" ") || classificacaoV2.condicoes_pendentes.join(" ") || ""
          }`.trim(),
    });
  } else {
    auditoria.push({
      decisao: "MOTOR_CLASSIFICACAO_ST_2026",
      regra_id: classificacaoV2.regra?.id || "—",
      tipo: "ICMS_ST",
      fonte_pdf: "motor_classificacao_st (2026)",
      score: classificacaoV2.score_ncm,
      match_por: ["NCM_DIG_A_DIG","DESC","CEST","UF"],
      motivo: `Classificação ST_CONFIRMADA — NCM ${classificacaoV2.ncm_produto} × regra ${classificacaoV2.ncm_regra} (${classificacaoV2.nivel_correspondencia}). ${classificacaoV2.evidencias_positivas.join(" ")}`,
    });
  }

  // ============================================================
  // FALLBACK CONVÊNIO ICMS 142/18 — AUTOPEÇAS
  // Só entra quando nenhuma regra de ICMS-ST do RICMS/BA foi confirmada.
  // ============================================================
  if (!resultados.some(r => r.tipo === "ICMS_ST") && produto.ncm) {
    const aliqInterFB = getAliqInterestadual(ufOrigem, ufDestino);
    const selAuto = selecionarMVAAutopecas(produto.ncm, ufDestino, aliqInterFB, ALIQ_INTERNA_BA, ufOrigem);
    if (selAuto && selAuto.origem === "CONV_142_18") {
      resultados.push({
        tipo: "ICMS_ST",
        id: "conv_142_18",
        ncm: produto.ncm,
        cest: selAuto.cest || "999999",
        item_ricms: selAuto.regra,
        descricao_legal: "Autopeça — Convênio ICMS 142/18",
        descricao: "Autopeça — Convênio ICMS 142/18",
        mva_original: `${(selAuto.mva).toFixed(2).replace(".", ",")}%`,
        mva_ajustada_4: `${selAuto.mvaAjustada.toFixed(2).replace(".", ",")}%`,
        mva_ajustada_7: `${selAuto.mvaAjustada.toFixed(2).replace(".", ",")}%`,
        mva_ajustada_12: `${selAuto.mvaAjustada.toFixed(2).replace(".", ",")}%`,
        fundamento: selAuto.fundamento,
        fonte_pdf: "Convênio ICMS 142/18 (fallback autopeças)",
        _fonte: "Convênio ICMS 142/18 (fallback autopeças)",
        match_score: 45,
        revisao: true,
        avisos: ["Enquadramento por fallback ao Convênio ICMS 142/18 — revisão manual recomendada."],
      });
      auditoria.push({
        decisao: "FALLBACK_CONV_142_18",
        regra_id: "conv_142_18",
        tipo: "ICMS_ST",
        fonte_pdf: "Convênio ICMS 142/18",
        score: 45,
        match_por: ["NCM_AUTOPECA"],
        motivo: `[FALLBACK] Convênio ICMS 142/18 — autopeça NCM ${produto.ncm} não regulamentada no Anexo 1 do RICMS/BA. MVA original ${selAuto.mva.toFixed(2)}% → MVA ajustada ${selAuto.mvaAjustada.toFixed(4)}% (alíq. inter ${aliqInterFB}% × interna ${ALIQ_INTERNA_BA}%).`,
      });
    }
  }



  if (!resultados.length) {
    const out = [{tipo:"NAO_ENCONTRADO", mensagem:"Não foi encontrada regra fiscal cadastrada para este produto.", ncm_consultado:produto.ncm}];
    out.auditoria = auditoria;
    out._classificacao_v2 = classificacaoV2;
    return out;
  }
  resultados.auditoria = auditoria;
  resultados._classificacao_v2 = classificacaoV2;
  return resultados;
}


// ============================================================
// MOTOR DE CÁLCULO ICMS AUTOMÁTICO
// ============================================================
// Determina a alíquota interestadual com base nas UFs
function getAliqInterestadual(ufOrigem, ufDestino) {
  const sulSudeste = ["SP","RJ","MG","ES","RS","SC","PR"];
  if (sulSudeste.includes(ufOrigem) && !sulSudeste.includes(ufDestino)) return 7;
  return 12;
}

// Converte string de porcentagem "8,80%" → 8.80
function parsePct(str) {
  if (!str) return null;
  const s = str.replace("%","").replace(",",".");
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// Determina a MVA ajustada SEMPRE conforme a alíquota destacada na NF-e.
// Fórmula oficial (Conv. ICMS 142/18):
//   MVA_aj = [(1 + MVA_orig) × (1 - ALQ_destacada) / (1 - ALQ_interna)] - 1
// Se a alíquota destacada não estiver disponível, faz fallback para os
// buckets tabelados (4/7/12) apenas como último recurso.
function getMvaAjustada(regra, aliqDestacada, aliqInterna = ALIQ_INTERNA_BA) {
  const mvaOrig = parsePct(regra?.mva_original);
  const aliqDest = Number(aliqDestacada);
  const aliqInt = Number(aliqInterna);
  if (mvaOrig != null && !isNaN(aliqDest) && aliqDest > 0 && aliqDest < 100 && aliqInt > 0 && aliqInt < 100) {
    // Mesma UF ou destacada ≥ interna → não há ajuste (usa MVA original)
    if (aliqDest >= aliqInt) return mvaOrig;
    const mvaAj = ((1 + mvaOrig/100) * (1 - aliqDest/100) / (1 - aliqInt/100)) - 1;
    return +(mvaAj * 100).toFixed(4);
  }
  // Fallback (dados especiais como PMPF/Ato COTEPE, ou alíquota ausente)
  if (!isNaN(aliqDest)) {
    if (aliqDest <= 4) return parsePct(regra?.mva_ajustada_4);
    if (aliqDest <= 7) return parsePct(regra?.mva_ajustada_7);
    return parsePct(regra?.mva_ajustada_12);
  }
  return parsePct(regra?.mva_ajustada_12);
}

// Alíquota interna BA padrão
const ALIQ_INTERNA_BA = 20.5;

/**
 * Calcula o ICMS de um produto com base na primeira regra encontrada na análise.
 * Retorna objeto com todos os campos de cálculo preenchidos.
 */
function calcAntecipacaoParcial(produto, ufOrigem, ufDestino, aliqInter, vProd, forcado=false, bloquearReducao=false, icmsProprioApurado=null) {
  const comp = extrairComponentesBaseICMS(produto);
  const vFrete = comp.frete;
  const vDesc = comp.desconto;
  // ICMS próprio da operação: usa o valor já apurado pelo motor (destacado no
  // XML OU presumido pela alíquota interestadual). Só cai no XML/presunção
  // local quando o motor não informou nada.
  const icmsDestacado = (Number(icmsProprioApurado) > 0)
    ? Number(icmsProprioApurado)
    : (Number(produto.valor_icms) > 0 ? Number(produto.valor_icms) : (vProd * aliqInter / 100));
  const baseAntecip = calcularBaseICMS(vProd, comp.frete, comp.seguro, comp.outrasDespesas, comp.desconto);
  const aliqInterna = ALIQ_INTERNA_BA;


  // Convênio ICMS 52/91 — verificação AUTOMÁTICA por NCM.
  // Se enquadrado, aplica base reduzida = base × (carga_efetiva / aliq_interna).
  // ICMS de origem (destacado) NÃO é alterado — apenas a BC de destino.
  // PROTEÇÃO: quando o CST da NF já indica base reduzida (ex.: 20/70), a nova
  // redução via Convênio é vedada — dupla redução não é permitida.
  const b5291bruto = beneficio5291(produto.ncm, ufOrigem, ufDestino, aliqInterna);
  const b5291 = (b5291bruto && !bloquearReducao) ? b5291bruto : null;
  const baseFinal = b5291 ? baseAntecip * b5291.perc_base_reduzida : baseAntecip;
  const icmsDestino = baseFinal * (aliqInterna / 100);
  // Estorno proporcional do crédito: quando a base é reduzida no destino,
  // o ICMS de origem só pode ser abatido na mesma proporção da base
  // (RICMS/BA c/c Convênio ICMS 52/91). Sem isso, o crédito integral zera
  // indevidamente a antecipação.
  const creditoAbativel = b5291
    ? icmsDestacado * b5291.perc_base_reduzida
    : icmsDestacado;
  const vAntecip = Math.max(0, icmsDestino - creditoAbativel);
  const icmsSemBenef = baseAntecip * (aliqInterna / 100);

  const obsBase = `Antecipação: BC ${baseAntecip.toFixed(2)}${
    b5291 ? ` → reduzida a ${baseFinal.toFixed(2)} (${(b5291.perc_base_reduzida*100).toFixed(4)}%)` : ""
  } × ${aliqInterna}% − ICMS próprio ${icmsDestacado.toFixed(2)}${
    b5291 ? ` (crédito proporcional ${creditoAbativel.toFixed(2)})` : ""
  } = R$ ${vAntecip.toFixed(2)}`;
  const obs5291 = b5291
    ? ` · Conv. ICMS 52/91 (Anexo ${b5291.anexo} — ${b5291.tipo}) carga efetiva ${b5291.carga_efetiva.toFixed(2)}%`
    : "";
  const obsUF = (ufDestino!=="BA" || ufOrigem==="BA") ? " · ATENÇÃO: UF não usual para antecipação BA" : "";

  return {
    tributacao: "ANTECIPACAO",
    fundamento: "RICMS/BA — Art. 12-A (Antecipação Parcial do ICMS)"
      + (forcado ? " · modo forçado" : "")
      + (b5291 ? ` + Convênio ICMS 52/91 (Anexo ${b5291.anexo} — ${b5291.tipo})` : ""),
    base_calc: baseAntecip,
    aliquota_aplicada: aliqInter,
    valor_icms_proprio: icmsDestacado,
    base_st: baseFinal,
    mva_utilizada: 0,
    aliq_interna: aliqInterna,
    valor_icms_st: vAntecip,
    valor_icms_total: icmsDestacado + vAntecip,
    economia: b5291 ? Math.max(0, icmsSemBenef - icmsDestino) : 0,
    icms_nf_original: produto.valor_icms || 0,
    valor_frete: vFrete,
    valor_seguro: comp.seguro,
    valor_outras_desp: comp.outrasDespesas,
    valor_ipi: produto.valor_ipi || 0,
    valor_desconto: vDesc,
    beneficio_5291: b5291 || null,
    obs: obsBase + obs5291 + obsUF,
  };
}


// Aplica FCP (Fundo de Combate à Pobreza) sobre um cálculo já feito.
// Para ICMS-ST o FCP-ST já é aplicado dentro de calcularSTcomBeneficio;
// nos demais tributos o FCP incide sobre a base própria de ICMS.
function aplicarFCP(calc, fcpPct) {
  if (!fcpPct || fcpPct <= 0) return calc;
  const pct = fcpPct / 100;
  if (calc.tributacao === "ICMS_ST") {
    // FCP-ST já embutido em valor_icms_total quando fcp_percentual foi passado
    // ao motor. Se não, calcula agora a partir da BC ST reduzida disponível.
    if (calc.valor_fcp_st > 0) return { ...calc, fcp_percentual: fcpPct };
    const bcFCP = calc.base_st || calc.base_st_original || 0;
    const fcpST = bcFCP * pct;
    return {
      ...calc,
      fcp_percentual: fcpPct,
      valor_fcp_st: fcpST,
      valor_icms_total: (calc.valor_icms_total || 0) + fcpST,
      obs: (calc.obs || "") + ` · FCP-ST ${fcpPct}% aplicado`,
    };
  }
  if (calc.tributacao === "ANTECIPACAO") {
    const bc = calc.base_st || calc.base_calc || 0;
    const fcp = bc * pct;
    return {
      ...calc,
      fcp_percentual: fcpPct,
      valor_fcp: fcp,
      valor_icms_total: (calc.valor_icms_total || 0) + fcp,
      obs: (calc.obs || "") + ` · FCP ${fcpPct}% aplicado sobre BC de antecipação`,
    };
  }
  if (calc.tributacao === "DIFAL") {
    const bc = calc.base_st || calc.base_calc || 0;
    const fcp = bc * pct;
    return {
      ...calc,
      fcp_percentual: fcpPct,
      valor_fcp: fcp,
      valor_icms_total: (calc.valor_icms_total || 0) + fcp,
      obs: (calc.obs || "") + ` · FCP ${fcpPct}% aplicado sobre BC do DIFAL`,
    };
  }
  if (calc.tributacao === "NORMAL" || calc.tributacao === "REDUCAO_BC") {
    const bc = calc.base_calc || 0;
    const fcp = bc * pct;
    return {
      ...calc,
      fcp_percentual: fcpPct,
      valor_fcp: fcp,
      valor_icms_total: (calc.valor_icms_total || 0) + fcp,
      obs: (calc.obs || "") + ` · FCP ${fcpPct}%`,
    };
  }
  return calc;
}

function calcularICMSProduto(produto, ufOrigem, ufDestino, modo = "AUTO") {
  const regras = produto.analise.filter(a => a.tipo !== "NAO_ENCONTRADO" && a.tipo !== "ST_SUGERIDA");
  const sugerida = produto.analise.find(a => a.tipo === "ST_SUGERIDA");
  let vProd = produto.valor_total || 0;
  const aliqInter = getAliqInterestadual(ufOrigem, ufDestino);


  // ============================================================
  // ETAPA 1 — INTERPRETAÇÃO OBRIGATÓRIA DO CST/CSOSN
  // Nenhum cálculo pode ocorrer antes desta interpretação.
  // ============================================================
  const permCST = produto.permissoes_cst || interpretarCST(produto.cst);
  const logTecnico = [...(permCST.log || [])];
  const alertas = [];
  const memoriaCalc = [];

  // ============================================================
  // DECISÃO EFETIVA (manual do usuário) + MEMÓRIA POR NCM
  // Se não houver decisão manual explícita, aplica automaticamente
  // a memória de cálculo gravada para o NCM do produto.
  // ============================================================
  const dmProduto = produto.decisao_manual || null;
  let decisaoManual = (dmProduto && dmProduto.modo && dmProduto.modo !== "AUTO") ? dmProduto : null;
  let versaoApuracao = null;
  // PAUTA (PMC/PMPF na NF): nunca usa memória — sempre recalcula conforme o
  // preço informado no próprio documento fiscal.
  const admissaoMemoria = admitePauta(produto);
  const descProdutoPauta = `${produto.descricao || ""} ${produto.info_adicional || ""}`;
  const bloquearMemoriaPauta = !!admissaoMemoria.admitida;
  if (bloquearMemoriaPauta) {
    logTecnico.push(`[MEMORIA_PAUTA_IGNORADA] NCM ${produto.ncm || "—"} — produto com ${admissaoMemoria.tipo} (R$ ${Number(admissaoMemoria.valor || 0).toFixed(2)}) na NF: histórico protegido não reaplicado, recálculo individual por pauta.`);
  }
  if (!bloquearMemoriaPauta && !decisaoManual && !(dmProduto && dmProduto.modo === "AUTO")) {
    // 2) Histórico de apuração por NCM (ALTERADO > CONGELADO > AUTOMÁTICO)
    try { versaoApuracao = HistoricoApuracaoService.obterVersaoValidaParaNCM(produto.ncm, produto.empresa_id || "SEM_EMPRESA", descProdutoPauta, aliqInter); }
    catch { versaoApuracao = null; }
    if (versaoApuracao && versaoApuracao.origem_memoria !== "AUTOMATICO_ANTERIOR") {
      const dmHist = HistoricoApuracaoService.comoDecisaoManual(versaoApuracao);
      if (dmHist) {
        decisaoManual = dmHist;
        logTecnico.push(`[MEMORIA_APURACAO] NCM ${produto.ncm} — aplicando versão v${versaoApuracao.versao_apuracao} (${versaoApuracao.origem_memoria}) da apuração anterior.`);
        alertas.push({
          tipo: "MEMORIA_APURACAO_APLICADA",
          mensagem: `Memória de apuração do NCM ${produto.ncm} (v${versaoApuracao.versao_apuracao}, ${versaoApuracao.origem_memoria === "ALTERADO_MANUAL" ? "alterada" : "congelada"}) aplicada automaticamente.`,
          fundamento: versaoApuracao.fundamento || "",
        });
      }
    } else if (versaoApuracao) {
      alertas.push({
        tipo: "MEMORIA_APURACAO_DISPONIVEL",
        mensagem: `NCM ${produto.ncm} possui histórico de cálculo automático anterior (v${versaoApuracao.versao_apuracao} — ${versaoApuracao.tributacao}).`,
        fundamento: versaoApuracao.fundamento || "",
      });
    }
  }






  // Regras cadastradas relevantes (para validações cruzadas)
  const temRegraReducao  = regras.some(r => r.tipo === "REDUCAO_BC");
  const temRegraIsencao  = regras.some(r => r.tipo === "ISENCAO");
  const temRegraST       = regras.some(r => r.tipo === "ICMS_ST");
  const val = validarCST({
    permCST, ncm: produto.ncm, cfop: produto.cfop,
    temConvenioReducao: temRegraReducao,
    temBeneficio: temRegraReducao || temRegraIsencao,
    temProtocoloST: temRegraST,
    ufOrigem, ufDestino,
  });
  val.advertencias.forEach(a => {
    alertas.push({ tipo:a.tipo, mensagem:a.mensagem, fundamento: permCST.fundamento });
    logTecnico.push(`[AVISO] ${a.tipo}: ${a.mensagem}`);
  });

  // ============================================================
  // ETAPA 1.B — INTERPRETAÇÃO DO CFOP + GATE DE LIBERAÇÃO
  // Ordem: CST → CFOP → incidência → ST já recolhida → decisão.
  // Nenhuma fórmula é executada antes desta avaliação.
  // ============================================================
  const permCFOP = interpretarCFOP(produto.cfop);
  const gate = avaliarLiberacaoCalculo({
    permCST, permCFOP,
    cst: produto.cst, cfop: produto.cfop, ncm: produto.ncm, cest: produto.cest,
    valorIcmsStXml: produto.valor_icms_st || 0,
    valorIcmsStRetido: produto.valor_icms_st_ret || 0,
    valorIcmsXml: produto.valor_icms || 0,
    sujeitoST: false,
  });
  (permCFOP.log || []).forEach(l => logTecnico.push(l));
  gate.advertencias.forEach(a => {
    alertas.push({ tipo:a.tipo, mensagem:a.mensagem, fundamento: a.fundamento || permCFOP.fundamento });
    logTecnico.push(`[AVISO] ${a.tipo}: ${a.mensagem}`);
  });
  memoriaCalc.push(...gate.memoria);

  // ============================================================
  // ETAPA 1.C — CESTA BÁSICA/BA (identificação por NCM)
  // Somente identifica e registra memória/divergências. Não altera
  // CST/CFOP do XML nem concede benefício sem previsão na matriz.
  // ============================================================
  const cestaBasica = avaliarCestaBasicaBA({
    ncm: produto.ncm, descricao: produto.descricao,
    cfop: produto.cfop, cst: produto.cst, csosn: produto.csosn,
    ufOrigem, ufDestino, dataEmissao: produto.data_emissao, gate,
  });
  memoriaCalc.push(...cestaBasica.memoria);
  cestaBasica.divergencias.forEach(d => {
    alertas.push({ tipo:d.tipo, mensagem:d.mensagem, fundamento: cestaBasica.fundamentoLegal || null });
    logTecnico.push(`[CESTA BÁSICA] ${d.tipo}: ${d.mensagem}`);
  });

  // ============================================================
  // ICMS PRÓPRIO — FONTE ÚNICA DE VERDADE (IcmsProprioEngine)
  // Hierarquia da alíquota: XML válida → presumida pelo motor →
  // não determinada. Isenção/não incidência nunca geram ICMS,
  // mesmo havendo alíquota presumida disponível.
  // ============================================================
  const icmsDestacadoXml = Number(produto.valor_icms) || 0;
  const situacaoIcms = permCST.isento
    ? "ISENTA"
    : (permCST.naoTributado || permCFOP.geraICMS === false)
      ? "NAO_INCIDENCIA"
      : (!gate.liberado.ICMS_PROPRIO ? "SEM_TRIBUTACAO" : "TRIBUTADA");
  const resIcms = resolverIcmsProprioFiscal({
    valorIcmsXml: icmsDestacadoXml,
    baseIcmsXml: produto.base_icms,
    aliquotaXml: produto.aliquota_icms,
    valorTotal: produto.valor_total,
    aliquotaPresumida: aliqInter,
    situacao: situacaoIcms,
  });
  resIcms.logs.forEach(l => logTecnico.push(l));
  const baseIcmsPresuncao = resIcms.base_calculo_icms;
  const houvePresuncaoIcms = resIcms.presumido;
  const valorIcmsPresumido = houvePresuncaoIcms ? resIcms.icms_proprio_calculado : 0;
  const icmsProprioFinal = resIcms.icms_proprio_calculado;
  const aliquotaIcmsUtilizada = resIcms.aliquota_icms_utilizada;
  if (houvePresuncaoIcms) {
    memoriaCalc.push(`ICMS calculado por alíquota presumida: Base R$ ${baseIcmsPresuncao.toFixed(2)} × ${aliquotaIcmsUtilizada}% = R$ ${valorIcmsPresumido.toFixed(2)} (usado como ICMS próprio/destacado na NF)`);
    produto.icms_presumido_valor = valorIcmsPresumido;
    produto.icms_presumido_aliq = aliquotaIcmsUtilizada;
    produto.icms_presumido_base = baseIcmsPresuncao;
  }
  const resolverIcmsProprio = () => icmsProprioFinal;


  const anexarGate = (obj) => ({
    ...obj,
    permissoes_cfop: permCFOP,
    gate_tributario: gate,
    bloqueios: gate.bloqueios,
    revisao_manual_cfop: gate.revisaoManual,
    conflito_cst_cfop: gate.conflito,
  });

  // Tributações que legitimamente não geram ICMS próprio (não preencher).
  const TRIB_SEM_ICMS_PROPRIO = new Set([
    "ISENCAO","NAO_TRIBUTADO","SUSPENSAO","DIFERIMENTO","SEM_TRIBUTACAO",
    "SEM_INCIDENCIA_CFOP","CFOP_INVALIDO","ST_RETIDA_ANTERIOR","ST_JA_RETIDA","BLOQUEADO",
  ]);
  // Nunca devolve ICMS próprio zerado quando a operação é tributada e o motor
  // apurou um valor (destacado no XML ou presumido pela alíquota).
  const icmsProprioDe = (obj) => {
    const v = Number(obj?.valor_icms_proprio) || 0;
    if (v > 0) return v;
    if (obj?.bloqueado || TRIB_SEM_ICMS_PROPRIO.has(obj?.tributacao)) return 0;
    if (resIcms.situacao_tributaria_icms !== "TRIBUTADA") return 0;
    return icmsProprioFinal || 0;
  };

  // Base helper — anexa contexto do CST em qualquer retorno

  const withCST = (obj) => ({
    ...obj,
    permissoes_cfop: permCFOP,
    gate_tributario: gate,
    bloqueios: gate.bloqueios,
    permissoes_cst: permCST,
    memoria_calculo: [ ...memoriaCalc, ...(obj.etapas_calculo?.map(e=>`${e.etapa}: R$ ${(e.valor||0).toFixed(2)}`) || []) ],
    log_tecnico: [ ...logTecnico, ...(obj.log_tecnico||[]) ],
    alertas: [ ...alertas, ...(obj.alertas||[]) ],
    validacoes: val,
    cesta_basica: cestaBasica,
    memoria_apuracao: versaoApuracao || null,

    icms_destacado_nf: icmsProprioFinal > 0,
    icms_foi_presumido: houvePresuncaoIcms,
    icms_presumido: houvePresuncaoIcms,
    icms_proprio_presumido: houvePresuncaoIcms,
    presuncao_credito: houvePresuncaoIcms,
    presuncao_credito_aliq: houvePresuncaoIcms ? aliquotaIcmsUtilizada : null,
    aliquota_presumida: houvePresuncaoIcms ? aliquotaIcmsUtilizada : null,
    base_icms_presumida: houvePresuncaoIcms ? baseIcmsPresuncao : 0,
    valor_icms_presumido: houvePresuncaoIcms ? valorIcmsPresumido : 0,

    // estrutura canônica — fonte única de verdade do ICMS próprio
    situacao_tributaria_icms: resIcms.situacao_tributaria_icms,
    base_calculo_icms: resIcms.base_calculo_icms,
    aliquota_icms_utilizada: aliquotaIcmsUtilizada,
    origem_aliquota_icms: resIcms.origem_aliquota_icms,
    icms_proprio_calculado: icmsProprioDe(obj),
    valor_icms_xml: icmsDestacadoXml,

    // base/alíquota do ICMS próprio: nunca zeradas quando a operação é
    // tributada — completam com o que o motor apurou (XML ou presunção).
    base_calc: (Number(obj.base_calc) > 0 || resIcms.situacao_tributaria_icms !== "TRIBUTADA")
      ? obj.base_calc
      : (resIcms.base_calculo_icms || obj.base_calc || 0),
    aliquota_aplicada: (Number(obj.aliquota_aplicada) > 0 || resIcms.situacao_tributaria_icms !== "TRIBUTADA")
      ? obj.aliquota_aplicada
      : (aliquotaIcmsUtilizada || obj.aliquota_aplicada || 0),

    // "ICMS na NF" / "ICMS destacado na NF" — recebem o valor fiscal apurado
    icms_nf_original: houvePresuncaoIcms
      ? valorIcmsPresumido
      : (Number(obj.icms_nf_original) > 0 ? obj.icms_nf_original : (icmsDestacadoXml || icmsProprioDe(obj))),
    valor_icms_proprio: icmsProprioDe(obj),





    ...(bloqueioRecalcManual
      ? { bloqueio_recalculo_manual: true, motivo_bloqueio: bloqueioRecalcManual }
      : {}),
  });
  let bloqueioRecalcManual = null;


  // Bloqueio total de ICMS pelo CFOP (sem incidência / CFOP título)
  if (permCFOP.geraICMS === false && !gate.liberado.ICMS_PROPRIO && !gate.liberado.ICMS_ST) {
    const bloqIcms = gate.bloqueios.find(b => b.tributo === "ICMS_PROPRIO") || gate.bloqueios[0];
    logTecnico.push(`[AÇÃO] Cálculo de ICMS bloqueado pelo CFOP ${permCFOP.codigo}.`);
    return anexarGate(withCST({
      tributacao: permCFOP.titulo ? "CFOP_INVALIDO" : "SEM_INCIDENCIA_CFOP",
      status: "BLOQUEADO",
      bloqueado: true,
      fundamento: permCFOP.fundamento,
      base_calc:0, aliquota_aplicada:0, valor_icms_proprio:0,
      base_st:0, mva_utilizada:0, valor_icms_st:0, valor_icms_total:0,
      economia:0, icms_nf_original: produto.valor_icms || 0,
      obs: bloqIcms?.motivo || `Cálculo de ICMS bloqueado pelo CFOP ${permCFOP.codigo}: operação classificada como não geradora de ICMS.`,
    }));
  }


  // -----------------------------------------------------------
  // ETAPA 2 — EARLY-RETURNS conforme CST (proibições legais)
  // -----------------------------------------------------------
  if (!decisaoManual && permCST.isento && permCST.codigo === "40") {
    logTecnico.push("[OK] CST 40 — Operação isenta. Nenhum imposto calculado.");
    if (temRegraST) logTecnico.push("[AVISO] Legislação de ST encontrada, mas CST 40 impede a incidência.");
    return withCST({
      tributacao:"ISENCAO", fundamento:`${permCST.fundamento}`,
      base_calc:0, aliquota_aplicada:0, valor_icms_proprio:0,
      base_st:0, mva_utilizada:0, valor_icms_st:0, valor_icms_total:0,
      economia: produto.valor_icms || 0, icms_nf_original: produto.valor_icms || 0,
      obs:"CST 40 — Operação isenta. Verifique se o CST informado está compatível com a legislação encontrada.",
    });
  }
  if (!decisaoManual && permCST.naoTributado) {
    logTecnico.push("[OK] CST 41 — Operação não tributada. Nenhum imposto calculado.");
    return withCST({
      tributacao:"NAO_TRIBUTADO", fundamento:permCST.fundamento,
      base_calc:0, aliquota_aplicada:0, valor_icms_proprio:0,
      base_st:0, mva_utilizada:0, valor_icms_st:0, valor_icms_total:0,
      economia:0, icms_nf_original: produto.valor_icms || 0,
      obs:"CST 41 — Operação não tributada.",
    });
  }
  if (!decisaoManual && permCST.suspenso) {
    logTecnico.push("[OK] CST 50 — Suspensão. Nenhum imposto calculado.");
    return withCST({
      tributacao:"SUSPENSAO", fundamento:permCST.fundamento,
      base_calc:0, aliquota_aplicada:0, valor_icms_proprio:0,
      base_st:0, mva_utilizada:0, valor_icms_st:0, valor_icms_total:0,
      economia:0, icms_nf_original: produto.valor_icms || 0,
      obs:"CST 50 — Operação com suspensão.",
    });
  }
  if (!decisaoManual && permCST.stRetidaAnterior) {
    logTecnico.push("[OK] CST 60 — ST já retida anteriormente. Novo cálculo de ST bloqueado.");
    const stRet = produto.valor_icms_st_ret || 0;
    return withCST({
      tributacao:"ST_RETIDA_ANTERIOR", fundamento:permCST.fundamento,
      base_calc:vProd, aliquota_aplicada:0, valor_icms_proprio:0,
      base_st:0, mva_utilizada:0,
      valor_icms_st: stRet,
      valor_icms_total: stRet,
      economia:0, icms_nf_original: produto.valor_icms || 0,
      obs:`ICMS-ST retido anteriormente pelo remetente${stRet>0?` (R$ ${stRet.toFixed(2)})`:""}. Vedado novo cálculo salvo complementação prevista.`,
    });
  }
  if (!decisaoManual && permCST.temDiferimento) {
    logTecnico.push("[OK] CST 51 — Diferimento. Cálculo apenas conforme % previsto na legislação.");
    return withCST({
      tributacao:"DIFERIMENTO", fundamento:permCST.fundamento,
      base_calc:vProd, aliquota_aplicada:0, valor_icms_proprio:0,
      base_st:0, mva_utilizada:0, valor_icms_st:0, valor_icms_total:0,
      economia:0, icms_nf_original: produto.valor_icms || 0,
      obs:"CST 51 — Diferimento. Recolhimento diferido conforme legislação específica.",
    });
  }

  // -----------------------------------------------------------
  // ETAPA 3 — Sinalizador de proteção contra REDUÇÃO DUPLICADA
  // (CST 20/70 → base já foi reduzida na origem; qualquer nova
  //  redução por Convênio/Benefício deve ser BLOQUEADA).
  // -----------------------------------------------------------
  const bloquearReducaoConvenio = !!permCST.baseReduzida;
  if (bloquearReducaoConvenio) {
    logTecnico.push(`[OK] CST ${permCST.codigo} — base já reduzida no XML.`);
    memoriaCalc.push(`Base Original (vProd): R$ ${vProd.toFixed(2)}`);
    memoriaCalc.push(`Base Reduzida no XML (vBC): R$ ${(produto.base_icms||0).toFixed(2)}`);
    // Quando o CST indica base já reduzida (ex.: CST 20/70), o sistema NÃO deve
    // aplicar qualquer nova redução e deve considerar como base de cálculo o
    // valor da coluna "B. Calc. ICMS" (vBC) da NF-e, e não o valor total do item.
    if ((produto.base_icms || 0) > 0) {
      logTecnico.push(`[AÇÃO] CST ${permCST.codigo} — usando vBC (R$ ${produto.base_icms.toFixed(2)}) como base de cálculo em vez do valor total (R$ ${vProd.toFixed(2)}).`);
      vProd = produto.base_icms;
    }
    // Remove qualquer regra de REDUCAO_BC do conjunto para impedir enquadramento
    // em outras reduções — vedada dupla redução.
    const antes = regras.length;
    for (let i = regras.length - 1; i >= 0; i--) {
      if (regras[i].tipo === "REDUCAO_BC") regras.splice(i, 1);
    }
    if (antes !== regras.length) {
      alertas.push({
        tipo:"REDUCAO_BLOQUEADA",
        mensagem:`CST ${permCST.codigo} — base já reduzida na NF. Enquadramento em outras reduções foi ignorado.`,
        fundamento: permCST.fundamento,
      });
      logTecnico.push(`[AÇÃO] Regras de REDUCAO_BC descartadas — CST ${permCST.codigo} não admite nova redução.`);
    }
  }



  // ================================================================
  // DECISÃO MANUAL DO USUÁRIO (ou memória de cálculo por NCM)
  // A decisão manual é SEMPRE executada, independentemente do CST —
  // eventuais vedações de CST são apenas advertidas ao usuário.
  // ================================================================
  if (decisaoManual) {
    const dm = decisaoManual;
    const motivoCST = permCST.stRetidaAnterior ? "ST já retida anteriormente"
      : permCST.isento ? "operação isenta"
      : permCST.naoTributado ? "operação não tributada"
      : permCST.suspenso ? "operação com suspensão"
      : !gate.liberado.ICMS_ST ? "gate tributário (CST/CFOP) não libera novo ICMS-ST"
      : null;
    if (motivoCST) {
      logTecnico.push(`[MANUAL_FORCADO] Recálculo manual forçado para ${dm.modo} — CST ${permCST.codigo} normalmente bloquearia (${motivoCST}), mas usuário solicitou.`);
      alertas.push({ tipo:"CALC_MANUAL_FORCADO", mensagem:`Cálculo ${dm.modo} forçado manualmente apesar de ${motivoCST} (CST ${permCST.codigo}).`, motivo: motivoCST, cst: permCST.codigo, fundamento: permCST.fundamento });
    }

    if (dm.modo === "ISENTO" || dm.modo === "NAO_TRIBUTADO") {
      const isento = dm.modo === "ISENTO";
      logTecnico.push(isento
        ? "[MANUAL_ISENTO] Usuário reclassificou como isento (cesta básica)."
        : "[MANUAL_NAO_TRIBUTADO] Usuário reclassificou como não tributado (cesta básica).");
      return withCST({
        tributacao: isento ? "ISENTO" : "NAO_TRIBUTADO",
        fundamento: cestaBasica?.fundamentoLegal
          || (isento ? "Decisão manual — isenção (cesta básica)" : "Decisão manual — não tributado (cesta básica)"),
        base_calc: 0, aliquota_aplicada: 0, valor_icms_proprio: 0,
        base_st: 0, mva_utilizada: 0, valor_icms_st: 0, valor_icms_total: 0,
        economia: produto.valor_icms || 0,
        icms_nf_original: produto.valor_icms || 0,
        decisao_manual: dm,
        decisao_manual_forcada: true,
        obs: `[Cálculo manual] ${isento ? "Isento" : "Não tributado"} — decisão do usuário${dm.origem_memoria ? ` (memória NCM ${dm.memoria_ncm})` : ""}.`,
      });
    }

    if (dm.modo === "DIFAL") {
      modo = "DIFAL";
    } else if (dm.modo === "ANTECIPACAO") {
      logTecnico.push("[MANUAL] Usuário solicitou recálculo como Antecipação Parcial.");
      const rc = calcAntecipacaoParcial(produto, ufOrigem, ufDestino, aliqInter, vProd, true, bloquearReducaoConvenio, icmsProprioFinal);
      return withCST({ ...rc, decisao_manual: dm, decisao_manual_forcada: true, obs: `[Cálculo manual] ${rc.obs || ""}` });
    } else if (dm.modo === "ICMS_ST") {
      const aliqDest = (produto.aliquota_icms != null && produto.aliquota_icms > 0) ? produto.aliquota_icms : (aliquotaIcmsUtilizada || aliqInter);
      const mvaInf = Number(dm.mva_informada) || 0;
      const mvaAj = dm.mva_ja_ajustada
        ? mvaInf
        : (aliqDest >= ALIQ_INTERNA_BA
            ? mvaInf
            : +(((1 + mvaInf/100) * (1 - aliqDest/100) / (1 - ALIQ_INTERNA_BA/100) - 1) * 100).toFixed(4));
      const vICMSProprio = resolverIcmsProprio();
      const baseICMSm = extrairComponentesBaseICMS(produto);
      const rST = calcularSTcomBeneficio({
        valorProduto: vProd,
        frete: baseICMSm.frete,
        seguro: baseICMSm.seguro,
        outrasDespesas: baseICMSm.outrasDespesas,
        desconto: baseICMSm.desconto,
        mva: mvaAj, mvaAjustada: mvaAj, mvaOriginal: mvaInf,
        cargaEfetiva: null, aliquotaInterna: ALIQ_INTERNA_BA,
        icmsProprio: vICMSProprio, fcpPercentual: produto.fcp_percentual || 0,
        fundamentoST: "Cálculo manual — decisão do usuário",
        fundamentoBeneficio: null,
      });
      logTecnico.push(`[MANUAL] Recálculo como ICMS-ST · MVA informada ${mvaInf}% ${dm.mva_ja_ajustada ? "(já ajustada)" : `(ajustada p/ ${mvaAj}%)`}${dm.origem_memoria ? ` · via memória NCM ${dm.memoria_ncm}` : ""}.`);
      return withCST({
        tributacao: "ICMS_ST",
        fundamento: `Cálculo manual (usuário) · MVA ${mvaAj}% ${dm.mva_ja_ajustada ? "(já ajustada)" : "(ajuste automático)"}${dm.origem_memoria ? " · memória por NCM" : ""}`,
        base_calc: vProd, aliquota_aplicada: aliqInter,
        valor_icms_proprio: vICMSProprio,
        base_st: rST.bc_st_reduzida, mva_utilizada: mvaAj, mva_informada: mvaInf,
        mva_ja_ajustada: !!dm.mva_ja_ajustada, aliq_interna: ALIQ_INTERNA_BA,
        valor_icms_st: rST.icms_st,
        valor_icms_total: vICMSProprio + rST.icms_st + rST.fcp_st,
        valor_fcp_st: rST.fcp_st,
        fcp_percentual: produto.fcp_percentual || 0,
        etapas_calculo: rST.etapas, memoria_calculo: rST.memoria,
        icms_nf_original: produto.valor_icms || 0,
        decisao_manual: dm,
        decisao_manual_forcada: true,
        obs: `[Cálculo manual] ICMS-ST · MVA ${mvaAj}% · ICMS-ST R$ ${rST.icms_st.toFixed(2)}`,
      });
    }
  }


  // ----------------------------------------------------------------
  // MODO DIFAL — EC 87/2015 (operações interestaduais a consumidor
  // final). Usa motor calcularDIFAL com tabelas de alíquotas oficiais.
  // ICMS de origem: se vier destacado no item (vICMS) usa o destacado,
  // caso contrário, calcula via alíquota interestadual da tabela.
  // ----------------------------------------------------------------

  if (modo === "DIFAL") {
    const importado = isImportadoPorCSTOrig(produto.orig);
    const baseICMSd = extrairComponentesBaseICMS(produto);
    const r = calcularDIFALMotor({
      produto: vProd,
      frete: baseICMSd.frete,
      seguro: baseICMSd.seguro,
      outras: baseICMSd.outrasDespesas,
      desconto: baseICMSd.desconto,
      ufOrigem, ufDestino, importado,
      icmsOrigemDestacado: icmsProprioFinal > 0 ? icmsProprioFinal : produto.valor_icms,
    });

    // Convênio ICMS 52/91 — se enquadrado, aplica base reduzida também no DIFAL.
    // Regra de proteção: se CST 20/70 (base já reduzida na origem), NÃO aplicar
    // nova redução no destino — evita dupla redução de base.
    const b5291 = beneficio5291(produto.ncm, ufOrigem, ufDestino, r.aliq_interna);
    let baseFinal = r.base_calculo;
    let icmsDestinoFinal = r.icms_destino;
    let difalFinal = r.difal;
    if (b5291 && !bloquearReducaoConvenio) {
      baseFinal = r.valor_operacao * b5291.perc_base_reduzida;
      icmsDestinoFinal = baseFinal * (r.aliq_interna / 100);
      difalFinal = icmsDestinoFinal - r.icms_origem;
    } else if (b5291 && bloquearReducaoConvenio) {
      logTecnico.push("[AÇÃO] Convênio 52/91 previa redução da base no DIFAL, mas base já reduzida via CST — segunda redução BLOQUEADA.");
      alertas.push({ tipo:"REDUCAO_BLOQUEADA", mensagem:"Redução prevista em Convênio ignorada. Motivo: base já reduzida conforme CST da NF-e.", fundamento: permCST.fundamento });
    }


    return withCST({
      tributacao: "DIFAL",
      fundamento: `DIFAL — EC 87/2015 c/c LC 190/22 (${ufOrigem}→${ufDestino}${importado?" · importado 4%":""})`
        + (b5291 && !bloquearReducaoConvenio ? ` + Convênio ICMS 52/91 (Anexo ${b5291.anexo} — ${b5291.tipo}) base reduzida` : ""),
      base_calc: r.valor_operacao,
      aliquota_aplicada: r.aliq_interestadual,
      aliq_interna: r.aliq_interna,
      valor_icms_proprio: r.icms_origem,
      base_st: baseFinal,
      mva_utilizada: 0,
      valor_icms_st: 0,
      valor_difal: Math.max(0, difalFinal),
      valor_icms_total: r.icms_origem + Math.max(0, difalFinal),
      economia: (b5291 && !bloquearReducaoConvenio) ? Math.max(0, r.difal - difalFinal) : 0,
      icms_nf_original: produto.valor_icms || 0,
      icms_destino: icmsDestinoFinal,
      icms_origem_fonte: r.icms_origem_fonte,
      importado,
      beneficio_5291: (b5291 && !bloquearReducaoConvenio) ? b5291 : null,
      obs: (b5291 && !bloquearReducaoConvenio)
        ? `DIFAL c/ Conv. 52/91 (Anexo ${b5291.anexo} — ${b5291.tipo}, carga ${b5291.carga_efetiva.toFixed(2)}%): Base reduzida = ${r.valor_operacao.toFixed(2)} × ${(b5291.perc_base_reduzida*100).toFixed(4)}% = ${baseFinal.toFixed(2)} · ICMS destino ${icmsDestinoFinal.toFixed(2)} − ICMS origem ${r.icms_origem.toFixed(2)} = R$ ${difalFinal.toFixed(2)}`
        : `DIFAL = ICMS destino (BC ${r.base_calculo.toFixed(2)} × ${r.aliq_interna}%) − ICMS origem (${r.icms_origem.toFixed(2)} · ${r.icms_origem_fonte==="NF"?"destacado NF":"tabela"}) = R$ ${r.difal.toFixed(2)}`
          + (bloquearReducaoConvenio && b5291 ? " · [Redução do Conv. 52/91 bloqueada — CST já reduzido]" : ""),
    });
  }





  // -------------------------------------------------------------
  // PMC / PMPF informado na NF-e (tag <vPMC>) ou na descrição/infAdProd
  // → ICMS-ST calculado pelo motor de pauta (PMC > PMPF > MVA).
  // Aplica-se a qualquer produto com PMC/PMPF presente, conforme
  // regra_icms_st_pmc + Convênio ICMS 142/18.
  // -------------------------------------------------------------
  const pautaCtx = {
    ncm: produto.ncm || null,
    cest: produto.cest || null,
    ean: produto.ean || produto.cEAN || null,
    uf: ufDestino || "BA",
    data: produto.data_emissao || null,
  };
  // GATE OBRIGATÓRIO: só há pauta se o próprio documento informar
  // PMC (tag <vPMC> ou "PMC:" no descritivo/infAdProd) ou PMPF.
  const admissao = admitePauta(produto);
  const pautaResolvida = admissao.admitida
    ? resolverPauta({
        ...pautaCtx,
        vPMC: admissao.tipo === "PMC" ? admissao.valor : 0,
        pmpf: admissao.tipo === "PMPF" ? admissao.valor : 0,
      })
    : { metodo: "MVA", valorUnitario: 0, fonte: null, fundamento: null, avisos: [], pautaEsperada: false };
  const temPauta = admissao.admitida && pautaResolvida.metodo !== "MVA";
  if (!admissao.admitida) {
    logTecnico.push(`[PAUTA_BLOQUEADA] Produto "${produto.descricao}" (NCM ${produto.ncm || "—"}) NÃO contém "PMC:" no descritivo — cálculo de pauta rejeitado. Usando cálculo automático normal.`);
    if (produto.vPMC > 0 || produto.pmpf > 0) {
      alertas.push({
        tipo: "PAUTA_SEM_PMC",
        mensagem: `Produto sem PMC no descritivo. Pauta bloqueada — cálculo automático aplicado.`,
        fundamento: admissao.motivo,
      });
    }
  } else if (!temPauta) {
    logTecnico.push(`[PAUTA_NAO_ENCONTRADA] Produto "${produto.descricao}" (NCM ${produto.ncm || "—"}) TEM ${admissao.tipo} (R$ ${admissao.valor.toFixed(2)}) MAS pauta não foi resolvida — usando automático.`);
  } else {
    logTecnico.push(`[PAUTA_CALCULADA] Produto "${produto.descricao}" (NCM ${produto.ncm || "—"}) — ${admissao.tipo} encontrado: R$ ${admissao.valor.toFixed(2)} (${admissao.origem}) — aplicando pauta ${pautaResolvida.metodo}.`);
  }
  if (temPauta || pautaResolvida.avisos.length) {
    pautaResolvida.avisos.forEach(a => alertas.push(a));
  }
  if (temPauta) {
    const regraST = regras.find(r => r.tipo === "ICMS_ST");
    const fundamentoBase = regraST?.fundamento
      || sugerida?.fundamento
      || "RICMS/BA – Decreto 13.780/2012 c/c Convênio ICMS 142/18 (pauta PMC/PMPF/MVA)";
    const aliqDestacada = (produto.aliquota_icms != null && produto.aliquota_icms > 0) ? produto.aliquota_icms : (aliquotaIcmsUtilizada || aliqInter);
    const mvaFallback = regraST ? (getMvaAjustada(regraST, aliqDestacada) || 0) : 0;
    // ICMS próprio = sempre o vICMS destacado no item da NF-e (fallback só se ausente)
    const icmsProprio = resolverIcmsProprio();
    const r = calcularSTporPauta({
      ...pautaCtx,
      vPMC: admissao.tipo === "PMC" ? admissao.valor : 0,
      pmpf: admissao.tipo === "PMPF" ? admissao.valor : 0,
      mva: mvaFallback,
      quantidade: produto.quantidade || 1,
      valorProduto: vProd,
      frete: produto.valor_frete || 0,
      seguro: produto.valor_seguro || 0,
      despesas: (produto.outrasDespesas || produto.valor_outras_desp || 0) - (produto.valor_desconto || 0),
      aliquotaInterna: ALIQ_INTERNA_BA,
      icmsProprio,
    });
    logTecnico.push(`[PAUTA_RECALCULADA] NCM ${produto.ncm || "—"} — ${admissao.tipo} R$ ${Number(admissao.valor || 0).toFixed(2)} (desta NF) → ICMS-ST R$ ${Number(r.icms_st || 0).toFixed(2)} · cálculo individual, sem uso de memória.`);
    return withCST({
      tributacao: "ICMS_ST",
      fundamento: `${fundamentoBase} — pauta ${r.metodo}`,
      base_calc: vProd,
      aliquota_aplicada: aliqInter,
      valor_icms_proprio: icmsProprio,
      base_st: r.base_calculo,
      mva_utilizada: r.metodo === "MVA" ? mvaFallback : 0,
      aliq_interna: ALIQ_INTERNA_BA,
      valor_icms_st: r.icms_st,
      valor_icms_total: icmsProprio + r.icms_st,
      economia: 0,
      icms_nf_original: produto.valor_icms || 0,
      metodo_pauta: r.metodo,
      fonte_pauta: r.fonte_pauta,
      pmc_origem: admissao.origem,
      valor_pmc: admissao.tipo === "PMC" ? admissao.valor : 0,
      valor_pauta_unitario: r.valor_unitario_pauta ?? admissao.valor,
      pmc_encontrado_em: admissao.encontradoEm,
      fundamento_pauta: pautaResolvida.fundamento || fundamentoBase,
      revisao: !regraST || (r.avisos || []).length > 0,
      alertas: r.avisos || [],
      obs: `Pauta ${r.metodo} aplicada: ${r.formula} · ICMS-ST = (BC × ${ALIQ_INTERNA_BA}%) − ICMS próprio (${icmsProprio.toFixed(2)}) = ${r.icms_st.toFixed(2)}${admissao.origem==="descricao" ? ` · ${admissao.tipo} extraído do descritivo (${admissao.encontradoEm})` : ""}${(r.avisos||[]).length ? ` · ⚠ ${r.avisos.map(a=>a.mensagem).join(" ")}` : ""}`,
    });
  }



  // Antecipação Parcial RICMS/BA (Art. 12-A) — destino BA, origem ≠ BA,
  // produto destinado a comercialização sem ICMS-ST específico.
  const ehAntecipacao = ufDestino === "BA" && ufOrigem !== "BA";

  // Sem regra — aplica antecipação parcial quando aplicável, senão tributação normal
  if (!regras.length) {
    if (ehAntecipacao) {
      return withCST(calcAntecipacaoParcial(produto, ufOrigem, ufDestino, aliqInter, vProd, false, bloquearReducaoConvenio, icmsProprioFinal));
    }
    return withCST({
      tributacao: "NORMAL",
      fundamento: "Tributação normal — sem benefício fiscal identificado",
      base_calc: produto.base_icms || vProd,
      aliquota_aplicada: produto.aliquota_icms || 0,
      valor_icms_proprio: icmsProprioFinal,
      base_st: 0,
      mva_utilizada: 0,
      valor_icms_st: 0,
      valor_icms_total: icmsProprioFinal || produto.valor_icms || 0,
      economia: 0,
      icms_nf_original: produto.valor_icms || 0,
      obs: "Valores originais da NF mantidos",
    });
  }


  // Prioridade: ISENCAO > REDUCAO_BC > ICMS_ST
  const regra = regras.find(r=>r.tipo==="ISENCAO") || regras.find(r=>r.tipo==="REDUCAO_BC") || regras[0];

  if (regra.tipo === "ISENCAO") {
    return withCST({
      tributacao: "ISENCAO",
      fundamento: regra.fundamento,
      base_calc: 0,
      aliquota_aplicada: 0,
      valor_icms_proprio: 0,
      base_st: 0,
      mva_utilizada: 0,
      valor_icms_st: 0,
      valor_icms_total: 0,
      economia: produto.valor_icms || 0,
      icms_nf_original: produto.valor_icms || 0,
      obs: `Isenção — ${regra.condicao || "Convênio ICMS 101/97"}`,
    });
  }

  if (regra.tipo === "REDUCAO_BC") {
    // Validador de redução de base — impede dupla redução (CST 20/70 + Convênio)
    const vr = validarReducaoBase({
      permCST, beneficioReducao: true,
      baseOriginal: vProd, baseReduzidaXML: produto.base_icms,
    });
    logTecnico.push(...vr.log);
    if (vr.bloqueioReducao) {
      alertas.push({
        tipo:"REDUCAO_BLOQUEADA",
        mensagem:"Redução prevista na legislação não aplicada por já constar redução tributária no documento fiscal (CST "+permCST.codigo+").",
        fundamento: permCST.fundamento,
      });
      const bcFinal = produto.base_icms || vProd;
      const aliqNominal = produto.aliquota_icms || aliqInter;
      const valorICMS = bcFinal * (aliqNominal/100);
      memoriaCalc.push(
        `Base Original: R$ ${vProd.toFixed(2)}`,
        `Base Reduzida no XML: R$ ${bcFinal.toFixed(2)}`,
        `Convênio previa nova redução: SIM`,
        `Nova redução BLOQUEADA (dupla redução vedada)`,
        `Base Final utilizada: R$ ${bcFinal.toFixed(2)}`,
      );
      return withCST({
        tributacao:"REDUCAO_BC",
        fundamento: regra.fundamento + " · [REDUÇÃO DO CONVÊNIO BLOQUEADA — base já reduzida via CST "+permCST.codigo+"]",
        base_calc: bcFinal, aliquota_aplicada: aliqNominal,
        valor_icms_proprio: valorICMS, base_st:0, mva_utilizada:0,
        valor_icms_st:0, valor_icms_total: valorICMS,
        economia:0, icms_nf_original: produto.valor_icms || 0,
        obs:"Convênio previa nova redução, porém CST "+permCST.codigo+" já indica base reduzida. Segunda redução vedada.",
      });
    }

    // Determina carga efetiva conforme tipo de operação
    const sulSudeste = ["SP","RJ","MG","ES","RS","SC","PR"];
    let cargaStr;
    if (ufOrigem === ufDestino) {
      cargaStr = regra.carga_interna;
    } else if (sulSudeste.includes(ufOrigem) && !sulSudeste.includes(ufDestino)) {
      cargaStr = regra.carga_inter_sul_sudeste;
    } else {
      cargaStr = regra.carga_inter_demais;
    }
    const cargaEfetiva = parsePct(cargaStr) || 8.80;
    // Alíquota nominal interestadual
    const aliqNominal = aliqInter; // ex: 12%
    // Base reduzida: BC = vProd × (carga_efetiva / aliq_nominal)
    const fatorReducao = cargaEfetiva / aliqNominal;
    const baseReduzida = vProd * fatorReducao;
    const valorICMS = baseReduzida * (aliqNominal / 100);
    const icmsOriginal = icmsProprioFinal || produto.valor_icms || (vProd * aliqNominal / 100);
    return withCST({
      tributacao: "REDUCAO_BC",
      fundamento: regra.fundamento,
      base_calc: baseReduzida,
      aliquota_aplicada: aliqNominal,
      carga_efetiva: cargaEfetiva,
      fator_reducao: fatorReducao,
      valor_icms_proprio: valorICMS,
      base_st: 0,
      mva_utilizada: 0,
      valor_icms_st: 0,
      valor_icms_total: valorICMS,
      economia: Math.max(0, icmsOriginal - valorICMS),
      icms_nf_original: produto.valor_icms || 0,
      obs: `Redução de BC — Carga efetiva: ${cargaStr}`,
    });
  }

  if (regra.tipo === "ICMS_ST" && !gate.liberado.ICMS_ST) {
    // Regime de ST ≠ ST devida nesta operação.
    const bloq = gate.bloqueios.find(b => b.tributo === "ICMS_ST");
    logTecnico.push(`[BLOQUEIO] ICMS-ST não calculado — ${bloq?.motivo || "operação não exige novo recolhimento."}`);
    const stXml = produto.valor_icms_st_ret || produto.valor_icms_st || 0;
    return anexarGate(withCST({
      tributacao: "ICMS_ST_BLOQUEADO",
      status: "BLOQUEADO",
      bloqueado: true,
      tributo_bloqueado: "ICMS_ST",
      fundamento: bloq?.fundamento || regra.fundamento,
      base_calc: vProd, aliquota_aplicada: 0,
      valor_icms_proprio: gate.liberado.ICMS_PROPRIO ? icmsProprioFinal : 0,
      base_st: 0, mva_utilizada: 0,
      valor_icms_st: 0,
      valor_icms_st_xml: stXml,
      valor_icms_total: gate.liberado.ICMS_PROPRIO ? (icmsProprioFinal || produto.valor_icms || 0) : 0,
      economia: 0, icms_nf_original: produto.valor_icms || 0,
      obs: bloq?.motivo || "Cálculo de ICMS-ST bloqueado: ICMS-ST já identificado/recolhido na operação.",
    }));
  }

  if (regra.tipo === "ICMS_ST") {
    // ICMS próprio = vICMS destacado no item da NF-e (fallback ao calculado se ausente)
    const vICMSProprio = resolverIcmsProprio();

    // MVA ajustada é SEMPRE calculada com base na alíquota destacada no item da NF-e
    const aliqDestacada = (produto.aliquota_icms != null && produto.aliquota_icms > 0) ? produto.aliquota_icms : (aliquotaIcmsUtilizada || aliqInter);
    const mvaAjustada = getMvaAjustada(regra, aliqDestacada);
    if (mvaAjustada === null) {
      // MVA especial (PMPF, Ato COTEPE) — não calcula automaticamente
      return withCST({
        tributacao: "ICMS_ST",
        fundamento: regra.fundamento,
        base_calc: vProd,
        aliquota_aplicada: aliqInter,
        valor_icms_proprio: vICMSProprio,
        base_st: 0,
        mva_utilizada: 0,
        valor_icms_st: 0,
        valor_icms_total: vICMSProprio,
        economia: 0,
        icms_nf_original: produto.valor_icms || 0,
        obs: `ICMS-ST com MVA especial (${regra.mva_original}) — cálculo manual necessário`,
      });
    }
    // Convênio 52/91 aplicável? → aplica ST + Redução cumulativamente
    // PROTEÇÃO: se CST 20/70, a base já foi reduzida na origem → NÃO aplicar
    // nova redução via Convênio (dupla redução vedada).
    const b5291bruto = beneficio5291(produto.ncm, ufOrigem, ufDestino, ALIQ_INTERNA_BA);
    const b5291 = (b5291bruto && !bloquearReducaoConvenio) ? b5291bruto : null;
    if (b5291bruto && bloquearReducaoConvenio) {
      alertas.push({
        tipo:"REDUCAO_BLOQUEADA",
        mensagem:`Convênio ICMS 52/91 previa nova redução da base, mas CST ${permCST.codigo} já indica base reduzida. Segunda redução BLOQUEADA.`,
        fundamento: permCST.fundamento,
      });
      logTecnico.push(
        "[OK] Convênio ICMS 52/91 prevê redução adicional.",
        `[AÇÃO] Segunda redução BLOQUEADA — base já reduzida via CST ${permCST.codigo}.`,
        "[RESULTADO] Cálculo realizado sem duplicidade de benefício.",
      );
    }
    const fcpPct = produto.fcp_percentual || 0;
    const baseICMSst = extrairComponentesBaseICMS(produto);
    const rST = calcularSTcomBeneficio({
      valorProduto: vProd,
      frete: baseICMSst.frete,
      seguro: baseICMSst.seguro,
      outrasDespesas: baseICMSst.outrasDespesas,
      desconto: baseICMSst.desconto,
      mva: mvaAjustada,
      mvaAjustada, mvaOriginal: regra.mva_original,
      cargaEfetiva: b5291 ? b5291.carga_efetiva : null,
      aliquotaInterna: ALIQ_INTERNA_BA,
      icmsProprio: vICMSProprio,
      fcpPercentual: fcpPct,
      fundamentoST: regra.fundamento,
      fundamentoBeneficio: b5291 ? `Convênio ICMS 52/91 (Anexo ${b5291.anexo} — ${b5291.tipo})` : null,
    });
    return withCST({
      tributacao: "ICMS_ST",
      fundamento: rST.fundamento + (b5291bruto && bloquearReducaoConvenio ? " · [Redução Conv. 52/91 bloqueada — CST já reduzido]" : ""),
      base_calc: vProd,
      aliquota_aplicada: aliqInter,
      valor_icms_proprio: vICMSProprio,
      base_st: rST.bc_st_reduzida,
      base_st_original: rST.bc_st_original,
      mva_utilizada: mvaAjustada,
      aliq_interna: ALIQ_INTERNA_BA,
      valor_icms_st: rST.icms_st,
      valor_icms_total: vICMSProprio + rST.icms_st + rST.fcp_st,
      valor_fcp: 0,
      valor_fcp_st: rST.fcp_st,
      fcp_percentual: fcpPct,
      percentual_reducao: rST.percentual_reducao,
      carga_efetiva_beneficio: rST.carga_efetiva,
      etapas_calculo: rST.etapas,
      memoria_calculo: rST.memoria,
      beneficio_5291: b5291 || null,
      economia: b5291 ? Math.max(0, (rST.bc_st_original - rST.bc_st_reduzida) * (ALIQ_INTERNA_BA/100)) : 0,
      icms_nf_original: produto.valor_icms || 0,
      obs: `MVA ajustada ${mvaAjustada}% (base: alíq. destacada NF-e ${aliqDestacada}%, interna BA ${ALIQ_INTERNA_BA}%)` +
           (b5291 ? ` · Conv. 52/91 (${b5291.tipo}) carga ${b5291.carga_efetiva.toFixed(2)}% → redução ${(rST.percentual_reducao*100).toFixed(2)}%` : "") +
           (fcpPct > 0 ? ` · FCP-ST ${fcpPct}%` : ""),
    });
  }

  // Fallback
  return withCST({
    tributacao: "NORMAL",
    fundamento: "—",
    base_calc: produto.base_icms || vProd,
    aliquota_aplicada: produto.aliquota_icms || 0,
    valor_icms_proprio: icmsProprioFinal,
    base_st: 0,
    mva_utilizada: 0,
    valor_icms_st: 0,
    valor_icms_total: icmsProprioFinal || produto.valor_icms || 0,
    economia: 0,
    icms_nf_original: produto.valor_icms || 0,
    obs: "—",
  });
}

// ============================================================
// BASE DE CÁLCULO DO ICMS — Lei Kandir (LC 87/96)
// BC = Produto + Frete + Seguro + Outras Despesas − Desconto
// Não integram a base: IPI, PIS, COFINS.
// ============================================================
function calcularBaseICMS(valorProduto, frete = 0, seguro = 0, outrasDespesas = 0, desconto = 0) {
  const base = (valorProduto || 0) + (frete || 0) + (seguro || 0) + (outrasDespesas || 0) - (desconto || 0);
  return Math.max(0, base);
}

/** Extrai os componentes corretos da base de cálculo ICMS de um item da NF-e. */
function extrairComponentesBaseICMS(produto) {
  return {
    valorProduto: produto.valor_total || 0,
    frete: produto.valor_frete || 0,
    seguro: produto.valor_seguro || 0,
    outrasDespesas: produto.outrasDespesas || produto.valor_outras_desp || 0,
    desconto: produto.valor_desconto || 0,
    // IPI propositalmente não incluído (já destacado na NF-e)
  };
}

// ============================================================
// CALCULADORA ST (manual)
// ============================================================
function calcularST(vProd, aliqInterna, mvaPercent, aliqInterestadual, frete=0, seguro=0, outrasDespesas=0, desconto=0) {
  const mva = parseFloat(mvaPercent) / 100;
  const aliqInt = parseFloat(aliqInterna) / 100;
  const aliqInter = parseFloat(aliqInterestadual) / 100;
  const vOperacao = calcularBaseICMS(vProd, frete, seguro, outrasDespesas, desconto);
  const vICMSProprio = vOperacao * aliqInter;
  const vBCST = vOperacao * (1 + mva);
  const vICMSST = (vBCST * aliqInt) - vICMSProprio;
  return { vOperacao, vICMSProprio, vBCST, vICMSST: Math.max(0, vICMSST), aliqInt, aliqInter, mva };
}

// ============================================================
// PARSER XML
// ============================================================
// parsearNFe foi extraído para src/modules/xml/services/parsearNFe.js
// (mesmo comportamento, apenas movido para modularizar a arquitetura).

// ============================================================
// EXPORTAR CSV
// ============================================================
function exportarCSV(nota, produtos, calculos = []) {
  const header = ["Seq","Código","Descrição","NCM","CEST","CFOP","Qtd","Valor Total","CST","Tributação","Fundamento Legal","Benefício","Status_Calculo","Motivo_Congelamento","Origem_Calculo","Versao_Apuracao_NCM","Tipo_Calculo","PMC_Encontrado","Valor_PMC","Fundamento_Pauta"];
  const rows = produtos.map((p,i) => {
    const r = p.analise.filter(a=>a.tipo!=="NAO_ENCONTRADO");
    const tipos = [...new Set(p.analise.map(a=>a.tipo))].join(" | ");
    const funds = [...new Set(r.map(a=>a.fundamento))].join(" | ");
    const ben = r.some(a=>a.beneficio) ? "SIM" : "NÃO";
    const c = calculos[i] || {};
    const congelado = !!(c._congelado || p.calculo_congelado?.ativo);
    const origem = congelado ? "CONGELADO"
      : c.memoria_apuracao?.origem_memoria === "ALTERADO_MANUAL" ? "MEMORIA_ALTERADA"
      : c.memoria_apuracao?.origem_memoria === "CONGELADO_MANUAL_INALTERADO" ? "MEMORIA_CONGELADA"
      : c.memoria_apuracao ? "MEMORIA_AUTOMATICA" : "AUTOMATICO";
    const motivo = c._motivo_congelamento || p.calculo_congelado?.motivo || "";
    const porPauta = !!(c.metodo_pauta && c.metodo_pauta !== "MVA");
    const pmcDesc = verificarSeTemPMC(`${p.descricao||""} ${p.info_adicional||""}`);
    const tipoCalculo = congelado ? "CONGELADO_MANUAL" : porPauta ? "PAUTA" : "AUTOMATICO";
    return [p.seq,p.codigo,`"${p.descricao}"`,p.ncm,p.cest||"",p.cfop||"",p.quantidade,p.valor_total.toFixed(2),p.cst||"",tipos,`"${funds}"`,ben,
      congelado?"CONGELADO":"AUTOMATICO",`"${motivo}"`,origem,c.memoria_apuracao?.versao_apuracao||"",
      tipoCalculo, pmcDesc.temPMC?"SIM":"NÃO", pmcDesc.valorPMC ? pmcDesc.valorPMC.toFixed(2) : "",
      `"${porPauta ? (c.fundamento_pauta||c.fundamento||"") : ""}"`].join(",");
  });
  const nf = nota ? `NF ${nota.numero} – ${nota.emitente_nome}` : "Análise Fiscal";
  const csvContent = `FiscoAI – ${nf}\n\n`+header.join(",")+"\n"+rows.join("\n");
  const blob = new Blob(["\uFEFF"+csvContent],{type:"text/csv;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href=url; a.download=`fiscalai_nf${nota?.numero||"_"}.csv`; a.click();
  URL.revokeObjectURL(url);
}

// ============================================================
// EXPORTAR PDF — RELATÓRIO TÉCNICO A4 PAISAGEM
// ------------------------------------------------------------
// Layout: A4 297×210 mm, paisagem, sem cortes, tabelas com
// quebra automática e cabeçalho fixo. Contém cabeçalho fiscal,
// resumo executivo, tabela de itens com todas as colunas
// exigidas, memória por nota, painel de alertas e log técnico.
// ============================================================
function exportarRelatorioPDF(nota, produtos, calculos) {
  const fmt = (v) => "R$ " + parseFloat(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtPct = (v) => parseFloat(v||0).toFixed(2).replace(".",",") + "%";
  const esc = (s) => String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  const dNow = new Date();
  const dataAtual = dNow.toLocaleDateString("pt-BR");
  const horaAtual = dNow.toLocaleTimeString("pt-BR");

  const totalNF = produtos.reduce((s,p)=>s+(p.valor_total||0),0);
  const totalICMSNF = calculos.reduce((s,c)=>s+(c.valor_icms_proprio||0),0);
  const totalICMSCalc = calculos.reduce((s,c)=>s+(c.valor_icms_total||0),0);
  const totalICMSST = calculos.reduce((s,c)=>s+(c.tributacao==="ICMS_ST" ? (c.valor_icms_st||0) : 0),0);
  const totalAntecipacao = calculos.reduce((s,c)=>s+(c.tributacao==="ANTECIPACAO" ? (c.valor_icms_st||0) : 0),0);
  const totalDIFAL = calculos.reduce((s,c)=>s+(c.valor_difal||0),0);
  const totalFCP = calculos.reduce((s,c)=>s+((c.valor_fcp||0)+(c.valor_fcp_st||0)),0);
  const totalBeneficios = calculos.reduce((s,c)=>s+(c.economia||0),0);
  const temPresuncaoICMSNF = calculos.some(c=>c.icms_foi_presumido||c.icms_proprio_presumido);

  // Resumo executivo por classificação
  const contarPor = (fn) => calculos.filter(fn).length;
  const resumo = {
    total: produtos.length,
    comICMS: contarPor(c => (c.valor_icms_proprio||0) > 0),
    isentas: contarPor(c => c.tributacao==="ISENCAO" || c.tributacao==="NAO_TRIBUTADO"),
    st: contarPor(c => c.tributacao==="ICMS_ST" || c.tributacao==="ST_RETIDA_ANTERIOR"),
    reducao: contarPor(c => c.tributacao==="REDUCAO_BC"),
    diferimento: contarPor(c => c.tributacao==="DIFERIMENTO"),
    erros: contarPor(c => c.tributacao==="NORMAL" && (c.valor_icms_proprio||0)===0 && (produtos[calculos.indexOf(c)]?.valor_icms||0)>0),
    divergencia: contarPor(c => (c.alertas||[]).length > 0),
  };

  const chipColor = (t) => ({
    ISENCAO:"#276749", NAO_TRIBUTADO:"#4a5568", SUSPENSAO:"#4a5568",
    ST_RETIDA_ANTERIOR:"#2c5282", DIFERIMENTO:"#6b46c1",
    REDUCAO_BC:"#744210", ICMS_ST:"#1a365d", ANTECIPACAO:"#975a16", DIFAL:"#2b6cb0",
  }[t] || "#2d3748");
  const chipLabel = (t) => ({
    ISENCAO:"Isenção", NAO_TRIBUTADO:"Não Tributado", SUSPENSAO:"Suspensão",
    ST_RETIDA_ANTERIOR:"ST Retida", DIFERIMENTO:"Diferimento",
    REDUCAO_BC:"Redução BC", ICMS_ST:"ICMS-ST", ANTECIPACAO:"Antecipação", DIFAL:"DIFAL",
  }[t] || "Normal");

  // Linhas da tabela de itens (colunas conforme especificação)
  const itensRows = produtos.map((p,i) => {
    const c = calculos[i] || {};
    const perm = p.permissoes_cst || c.permissoes_cst || {};
    const percRed = c.percentual_reducao ? (c.percentual_reducao*100) : (c.fator_reducao ? (1-c.fator_reducao)*100 : 0);
    const status = (c.alertas||[]).length > 0 ? "⚠ Revisar" : "OK";
    const obs = [];
    if (c.obs) obs.push(c.obs);
    (c.alertas||[]).forEach(a => obs.push(`⚠ ${a.mensagem}`));
    return `
      <tr>
        <td class="c">${p.seq}</td>
        <td class="c mono">${esc(p.codigo||"")}</td>
        <td class="l">${esc(p.descricao||"")}</td>
        <td class="c mono">${esc(p.ncm||"")}</td>
        <td class="c mono">${esc(p.cest||"")}</td>
        <td class="c mono">${esc(p.cfop||"")}</td>
        <td class="c mono">${esc(p.cst||"")}</td>
        <td class="c mono">${esc(p.orig||"")}</td>
        <td class="c"><span class="chip" style="background:${chipColor(c.tributacao)}">${chipLabel(c.tributacao)}</span></td>
        <td class="l">${esc(c.beneficio_5291 ? `Conv. 52/91 (Anexo ${c.beneficio_5291.anexo})` : (c.tributacao==="ISENCAO"?"Isenção":(c.tributacao==="REDUCAO_BC"?"Redução BC":"—")))}</td>
        <td class="l small">${esc(c.fundamento||"—")}</td>
        <td class="r">${fmt(p.valor_total)}</td>
        <td class="r">${percRed>0 ? fmtPct(percRed) : "—"}</td>
        <td class="r">${fmt(c.base_calc)}</td>
        <td class="r">${c.mva_utilizada ? fmtPct(c.mva_utilizada) : "—"}</td>
        <td class="r">${c.base_st ? fmt(c.base_st) : "—"}</td>
        <td class="c">${c.aliq_interna ? fmtPct(c.aliq_interna) : "—"}</td>
        <td class="c">${c.aliquota_aplicada ? fmtPct(c.aliquota_aplicada) : "—"}</td>
        <td class="r">${fmt(c.valor_icms_proprio)}</td>
        <td class="r">${c.tributacao==="ICMS_ST" ? fmt(c.valor_icms_st||0) : "—"}</td>
        <td class="r">${c.valor_difal ? fmt(c.valor_difal) : "—"}</td>
        <td class="r">${((c.valor_fcp||0)+(c.valor_fcp_st||0)) ? fmt((c.valor_fcp||0)+(c.valor_fcp_st||0)) : "—"}</td>
        <td class="r">${c.tributacao==="ANTECIPACAO" ? fmt(c.valor_icms_st||0) : "—"}</td>
        <td class="r bold">${fmt(c.valor_icms_total)}</td>
        <td class="c small">${status}</td>
        <td class="l small">${esc(obs.join(" · "))}</td>
      </tr>`;
  }).join("");

  // ── Conferência item a item (NF x sistema) ──────────────────
  const conferencias = produtos.map((p,i) => {
    const c = calculos[i] || {};
    const icmsNF = p.valor_icms || 0;
    const icmsCalc = c.valor_icms_proprio || 0;
    const delta = icmsCalc - icmsNF;
    return { diverge: Math.abs(delta) > 0.01, icmsNF, icmsCalc, delta };
  });
  const qtdDivergencias = conferencias.filter(x=>x.diverge).length;

  // ── Detalhe completo por item (o usuário não precisa abrir a NF) ──
  const detalheItens = produtos.map((p,i) => {
    const c = calculos[i] || {};
    const perm = p.permissoes_cst || c.permissoes_cst || {};
    const conf = conferencias[i];
    const subtotal = (p.quantidade||0) * (p.valor_unitario||0);
    const baseKandir = (p.valor_total||0) + (p.valor_frete||0) + (p.valor_seguro||0) + (p.valor_outras_desp||0) - (p.valor_desconto||0);
    const etapas = c.etapas_calculo || [];
    const linha = (l,v,extra="") => `<div class="drow"><span class="dl">${l}</span><span class="dv ${extra}">${v}</span></div>`;
    return `
      <div class="det">
        <div class="det-h">
          <div><b>ITEM ${p.seq}: ${esc(p.descricao||"—")}</b> <span class="mono muted">cód. ${esc(p.codigo||"—")}</span></div>
          <span class="chip" style="background:${chipColor(c.tributacao)}">${chipLabel(c.tributacao)}</span>
        </div>
        <div class="det-cols">
          <div class="det-col">
            <div class="det-t">🏷️ Identificação</div>
            ${linha("NCM", `<span class="mono">${esc(p.ncm||"—")}</span>`)}
            ${linha("CEST", `<span class="mono">${esc(p.cest||"não aplicável")}</span>`)}
            ${linha("CFOP", `<span class="mono">${esc(p.cfop||"—")}</span>`)}
            ${linha("CST/CSOSN", `<span class="mono">${esc(p.cst||"—")}</span> — ${esc(perm.nome||"—")}`)}
            ${linha("Origem da mercadoria", esc(p.orig||"—"))}
            ${linha("GTIN/EAN", `<span class="mono">${esc(p.ean||p.cEAN||"SEM GTIN")}</span>`)}
            ${linha("Quantidade", `${p.quantidade||0} ${esc(p.unidade||"un")}`)}
          </div>
          <div class="det-col">
            <div class="det-t">💰 Valores</div>
            ${linha("Valor unitário", fmt(p.valor_unitario))}
            ${linha("Subtotal (qtd × unit.)", fmt(subtotal))}
            ${linha("Valor total do item", fmt(p.valor_total))}
            ${linha("Frete", fmt(p.valor_frete))}
            ${linha("Seguro", fmt(p.valor_seguro))}
            ${linha("Outras despesas", fmt(p.valor_outras_desp))}
            ${linha("Desconto", `− ${fmt(p.valor_desconto)}`)}
            ${linha("Base ICMS (LC 87/96)", fmt(baseKandir), "bold")}
            ${linha("IPI (não integra a BC)", fmt(p.valor_ipi))}
            ${p.pmc ? linha("PMC informado", fmt(p.pmc)) : ""}
            ${p.pmpf ? linha("PMPF", fmt(p.pmpf)) : ""}
          </div>
          <div class="det-col">
            <div class="det-t">🧮 Cálculo de ICMS</div>
            ${linha("Tributação", chipLabel(c.tributacao))}
            ${c._congelado
              ? linha("Estado do cálculo", `<b>❄️ CONGELADO (manual)</b> — modo ${esc(c.decisao_manual?.modo||c.tributacao)}`, "bold")
                + linha("Congelado por", `${esc(c._congelado_por||"—")} em ${c._congelado_em?new Date(c._congelado_em).toLocaleString("pt-BR"):"—"}`)
                + linha("Motivo do congelamento", esc(c._motivo_congelamento||"—"))
                + (c._parametros_congelados?.mva_informada!=null ? linha("MVA informada", fmtPct(c._parametros_congelados.mva_informada) + (c._parametros_congelados.mva_ja_ajustada?" (já ajustada)":" (ajuste automático)")) : "")
                + (c._parametros_congelados?.presuncao_credito ? linha("Presunção de crédito", `Sim — ${fmtPct(c._parametros_congelados.presuncao_credito_aliq)}`) : "")
              : c.memoria_apuracao
                ? linha("Estado do cálculo", `💾 MEMÓRIA DE APURAÇÃO — v${esc(c.memoria_apuracao.versao_apuracao)} (${esc(c.memoria_apuracao.origem_memoria)})`)
                  + (c.memoria_apuracao.nota_origem?.numero ? linha("Origem da memória", `Nota ${esc(c.memoria_apuracao.nota_origem.numero)} — ${esc(String(c.memoria_apuracao.nota_origem.data||"").slice(0,10))}`) : "")
                  + (c.memoria_apuracao.alterado_em ? linha("Última alteração", `${new Date(c.memoria_apuracao.alterado_em).toLocaleString("pt-BR")} por ${esc(c.memoria_apuracao.alterado_por||"—")}`) : "")
                : linha("Estado do cálculo", "⚙️ AUTOMÁTICO (sistema)")}
            ${linha("Fundamento legal", esc(c.fundamento||"—"))}
            ${c.icms_proprio_presumido
              ? linha("ICMS Próprio (Presumido)", `${fmt(c.valor_icms_proprio)} · Alíquota ${fmtPct(c.aliquota_presumida||c.presuncao_credito_aliq||c.aliquota_aplicada)} (interestadual) · Base ${fmt(c.base_icms_presumida||c.base_calc)} — fundamento: ausência de destaque na NF; aplicado como ICMS próprio em ST/DIFAL/antecipação`, "bold")
              : (c.valor_icms_proprio > 0 ? linha("ICMS Próprio (Destacado)", `${fmt(c.valor_icms_proprio)} — conforme destaque na NF`) : "")}
            ${c.beneficio_5291 ? linha("Benefício", `Conv. ICMS 52/91 · Anexo ${esc(c.beneficio_5291.anexo)} — carga ${fmtPct(c.beneficio_5291.carga_efetiva)}`) : ""}
            ${c.percentual_reducao||c.fator_reducao ? linha("Redução de base", fmtPct(c.percentual_reducao ? c.percentual_reducao*100 : (1-c.fator_reducao)*100)) : ""}
            ${linha("Base de cálculo aplicada", fmt(c.base_calc))}
            ${c.aliq_interna ? linha("Alíquota interna (destino)", fmtPct(c.aliq_interna)) : ""}
            ${c.aliquota_aplicada ? linha("Alíquota aplicada", fmtPct(c.aliquota_aplicada)) : ""}
            ${c.mva_utilizada ? linha("MVA utilizada", fmtPct(c.mva_utilizada)) : ""}
            ${c.base_st ? linha("Base ST", fmt(c.base_st)) : ""}
            ${linha("ICMS próprio calculado", fmt(c.valor_icms_proprio))}
            ${c.tributacao==="ICMS_ST" ? linha("ICMS-ST calculado", fmt(c.valor_icms_st)) : ""}
            ${c.tributacao==="ANTECIPACAO" ? linha("Antecipação parcial", fmt(c.valor_icms_st)) : ""}
            ${c.valor_difal ? linha("DIFAL", fmt(c.valor_difal)) : ""}
            ${((c.valor_fcp||0)+(c.valor_fcp_st||0)) ? linha("FCP", fmt((c.valor_fcp||0)+(c.valor_fcp_st||0))) : ""}
            ${linha("ICMS total do item", fmt(c.valor_icms_total), "bold")}
            ${linha("ICMS destacado na NF", fmt(conf.icmsNF))}
            ${linha("Conferência", conf.diverge
              ? `<span class="tag-warn">⚠ Divergência de ${fmt(Math.abs(conf.delta))}</span>`
              : `<span class="tag-ok">✓ Conferido (sem divergência)</span>`)}
          </div>
        </div>
        ${etapas.length ? `
          <div class="det-t" style="margin-top:6px">📐 Fórmulas aplicadas</div>
          <table class="etapas">
            <thead><tr><th>Etapa</th><th>Valor</th><th>Fórmula</th></tr></thead>
            <tbody>${etapas.map(e=>`<tr><td>${esc(e.etapa)}</td><td class="r">${fmt(e.valor)}</td><td class="mono small">${esc(e.formula||"")}</td></tr>`).join("")}</tbody>
          </table>` : ""}
        ${(c.alertas||[]).length ? `<div class="avisos">${(c.alertas||[]).map(a=>`⚠️ <b>${esc(a.tipo)}</b>: ${esc(a.mensagem)}${a.fundamento?` <span class="muted">(${esc(a.fundamento)})</span>`:""}`).join("<br/>")}</div>` : ""}
      </div>`;
  }).join("");

  // Memória de cálculo por item
  const memoriaSecoes = produtos.map((p,i) => {
    const c = calculos[i] || {};
    const perm = p.permissoes_cst || c.permissoes_cst || {};
    const etapas = c.etapas_calculo || [];
    const conf = conferencias[i];
    return `
      <div class="mem-item">
        <div class="mem-h">${p.seq}. ${esc(p.descricao||"")} <span class="mono muted">[NCM ${esc(p.ncm||"—")} · CST ${esc(p.cst||"—")}]</span></div>
        <div class="mem-sub">
          <b>CST:</b> ${esc(perm.codigo||"—")} — ${esc(perm.nome||"—")}<br/>
          <b>Legislação:</b> ${esc(c.fundamento||"—")}<br/>
          ${c.beneficio_5291 ? `<b>Convênio:</b> ICMS 52/91 · Anexo ${c.beneficio_5291.anexo} (${c.beneficio_5291.tipo}) — carga ${fmtPct(c.beneficio_5291.carga_efetiva)}<br/>` : ""}
          <b>Tributação:</b> ${chipLabel(c.tributacao)} · <b>Conferência:</b> ${conf.diverge ? `⚠ divergência de ${fmt(Math.abs(conf.delta))}` : "✓ NF e sistema coincidem"}
        </div>
        ${etapas.length ? `
          <table class="etapas">
            <thead><tr><th>Etapa</th><th>Valor</th><th>Fórmula</th></tr></thead>
            <tbody>${etapas.map(e=>`<tr><td>${esc(e.etapa)}</td><td class="r">${fmt(e.valor)}</td><td class="mono small">${esc(e.formula||"")}</td></tr>`).join("")}</tbody>
          </table>` : ""}
      </div>`;
  }).join("");

  // Painel de alertas
  const todosAlertas = [];
  calculos.forEach((c,i) => (c.alertas||[]).forEach(a => todosAlertas.push({...a, seq: produtos[i]?.seq, desc: produtos[i]?.descricao})));
  const alertasHTML = todosAlertas.length ? `
    <ul class="alertas">
      ${todosAlertas.map(a=>`<li><b>[${esc(a.tipo)}]</b> Item ${esc(a.seq)} — ${esc(a.desc)}: ${esc(a.mensagem)}${a.fundamento?` <span class="muted">(${esc(a.fundamento)})</span>`:""}</li>`).join("")}
    </ul>` : `<div class="muted">Nenhum alerta registrado.</div>`;

  // Índice de legislação citada
  const usa = (fn) => calculos.filter(fn).length;
  const fundamentosCitados = [...new Set(calculos.map(c=>c.fundamento).filter(Boolean))];
  const baseLegal = [
    { norma:"Lei Complementar 87/1996 (Lei Kandir)", det:"Art. 13 — composição da base de cálculo do ICMS (produto + frete + seguro + outras despesas − desconto; IPI não integra a BC).", qtd: produtos.length },
    { norma:"Decreto RICMS/BA 13.780/2012 — Anexo 1", det:"Relação de mercadorias sujeitas à substituição tributária e respectivas MVAs.", qtd: usa(c=>c.tributacao==="ICMS_ST"||c.tributacao==="ST_RETIDA_ANTERIOR") },
    { norma:"RICMS/BA — Art. 12-A", det:"Antecipação parcial do ICMS nas entradas interestaduais.", qtd: usa(c=>c.tributacao==="ANTECIPACAO") },
    { norma:"Convênio ICMS 52/91", det:"Redução de base de cálculo — máquinas industriais e implementos agrícolas.", qtd: usa(c=>!!c.beneficio_5291) },
    { norma:"Convênio ICMS 142/18", det:"Regime de substituição tributária (inclusive autopeças).", qtd: usa(c=>/142\/18/.test(String(c.fundamento||""))) },
    { norma:"Protocolos ICMS 41/08 e 97/10", det:"ST de peças, componentes e acessórios para veículos automotores.", qtd: usa(c=>/41\/08|97\/10/.test(String(c.fundamento||""))) },
    { norma:"EC 87/2015 e LC 190/2022", det:"Diferencial de alíquotas (DIFAL) nas operações interestaduais.", qtd: usa(c=>(c.valor_difal||0)>0) },
  ];
  const baseLegalHTML = `
    <table class="etapas">
      <thead><tr><th>Norma</th><th>Aplicação</th><th class="c">Itens</th><th class="c">Situação</th></tr></thead>
      <tbody>${baseLegal.map(b=>`<tr>
        <td><b>${esc(b.norma)}</b></td>
        <td class="small">${esc(b.det)}</td>
        <td class="c">${b.qtd}</td>
        <td class="c">${b.qtd>0?"Aplicada":"Não aplicável neste período"}</td>
      </tr>`).join("")}</tbody>
    </table>
    ${fundamentosCitados.length ? `<div class="small" style="margin-top:6px"><b>Fundamentos citados pelo motor:</b> ${esc(fundamentosCitados.join(" · "))}</div>` : ""}`;

  // Log técnico consolidado
  const logHTML = calculos.map((c,i) => {
    const linhas = c.log_tecnico || [];
    if (!linhas.length) return "";
    return `<div class="log-item"><div class="log-h">Item ${produtos[i]?.seq} · ${esc(produtos[i]?.descricao||"")}</div><pre>${esc(linhas.join("\n"))}</pre></div>`;
  }).join("") || `<div class="muted">Sem eventos de log registrados.</div>`;


  const html = `<!DOCTYPE html>
<html lang="pt-BR"><head><meta charset="UTF-8"/>
<title>Relatório Fiscal — FiscoAI</title>
<style>
  @page { size: A4 landscape; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10px; color:#1a202c; margin:0; padding:0; }
  .hdr { display:flex; justify-content:space-between; align-items:flex-start; padding:8px 12px; border-bottom:3px solid #2b6cb0; margin-bottom:10px; }
  .hdr h1 { margin:0; font-size:16px; color:#1a365d; letter-spacing:-0.02em; }
  .hdr .sub { font-size:10px; color:#4a5568; }
  .hdr .meta { text-align:right; font-size:9px; color:#4a5568; }
  h2 { font-size:12px; color:#1a365d; margin:12px 0 6px; text-transform:uppercase; letter-spacing:0.04em; border-bottom:1px solid #cbd5e0; padding-bottom:3px; }
  .grid { display:grid; grid-template-columns:repeat(6,1fr); gap:6px; font-size:9px; }
  .cell { background:#f7fafc; border:1px solid #e2e8f0; border-radius:4px; padding:5px 7px; }
  .cell .lbl { color:#718096; font-size:8px; text-transform:uppercase; letter-spacing:0.03em; }
  .cell .val { color:#1a202c; font-weight:700; font-size:11px; margin-top:2px; }
  table.itens { width:100%; border-collapse:collapse; font-size:8.5px; table-layout:auto; }
  table.itens thead { display:table-header-group; }
  table.itens th { background:#2b6cb0; color:#fff; padding:5px 4px; border:1px solid #2b6cb0; font-size:8px; text-align:center; }
  table.itens td { padding:4px 4px; border:1px solid #e2e8f0; vertical-align:top; word-wrap:break-word; }
  table.itens tbody tr:nth-child(even) td { background:#f8fafc; }
  .c { text-align:center; } .r { text-align:right; } .l { text-align:left; }
  .mono { font-family: 'Courier New', monospace; font-size:8px; }
  .small { font-size:8px; color:#4a5568; }
  .muted { color:#a0aec0; }
  .bold { font-weight:700; color:#276749; }
  .chip { color:#fff; padding:1px 5px; border-radius:8px; font-size:7.5px; font-weight:700; white-space:nowrap; }
  .mem-item { margin-bottom:10px; padding:8px 10px; border:1px solid #e2e8f0; border-radius:5px; background:#f8fafc; page-break-inside:avoid; }
  .mem-h { font-weight:700; color:#1a365d; font-size:10px; margin-bottom:3px; }
  .mem-sub { font-size:9px; color:#4a5568; margin-bottom:5px; line-height:1.5; }
  table.etapas { width:100%; border-collapse:collapse; font-size:8.5px; margin-top:4px; }
  table.etapas th { background:#edf2f7; padding:3px 5px; border:1px solid #cbd5e0; text-align:left; }
  table.etapas td { padding:3px 5px; border:1px solid #e2e8f0; }
  ul.alertas { margin:0; padding-left:16px; font-size:9px; color:#7b341e; }
  ul.alertas li { margin-bottom:3px; }
  .log-item { margin-bottom:6px; page-break-inside:avoid; }
  .log-h { font-weight:700; color:#2d3748; font-size:9px; }
  .log-item pre { margin:2px 0; padding:5px 7px; background:#1a202c; color:#e2e8f0; font-size:8.5px; border-radius:4px; white-space:pre-wrap; font-family:'Courier New',monospace; }
  .pb { page-break-before: always; }
  .foot { position:fixed; bottom:5mm; left:10mm; right:10mm; font-size:8px; color:#718096; border-top:1px solid #e2e8f0; padding-top:3px; display:flex; justify-content:space-between; }
  .det { border:1px solid #cbd5e0; border-radius:6px; margin-bottom:8px; page-break-inside:avoid; overflow:hidden; }
  .det-h { display:flex; justify-content:space-between; align-items:center; background:#edf2f7; padding:5px 8px; font-size:10px; color:#1a365d; }
  .det-cols { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:7px 8px; }
  .det-col { border-right:1px solid #edf2f7; padding-right:8px; }
  .det-col:last-child { border-right:none; }
  .det-t { font-size:9px; font-weight:700; color:#2b6cb0; text-transform:uppercase; letter-spacing:0.03em; margin-bottom:3px; }
  .drow { display:flex; justify-content:space-between; gap:6px; font-size:8.5px; padding:1.5px 0; border-bottom:1px dotted #edf2f7; }
  .dl { color:#718096; } .dv { color:#1a202c; text-align:right; }
  .tag-ok { color:#276749; font-weight:700; }
  .tag-warn { color:#9b2c2c; font-weight:700; }
  .avisos { background:#fffaf0; border-top:1px solid #fbd38d; padding:5px 8px; font-size:8.5px; color:#7b341e; }
  @media print { .no-print { display:none !important; } }
</style></head>
<body>

<!-- CABEÇALHO -->
<div class="hdr">
  <div>
    <h1>⚖️ FiscoAI — Relatório Técnico Fiscal</h1>
    <div class="sub">Análise de ICMS · Substituição Tributária · Antecipação · DIFAL · Benefícios Fiscais</div>
  </div>
  <div class="meta">
    <div><b>Data:</b> ${dataAtual} · <b>Hora:</b> ${horaAtual}</div>
    <div>RICMS/BA · Conv. ICMS 52/91 · 101/97 · 142/18 · Prot. 41/08-97/10</div>
  </div>
</div>

<!-- DADOS DA EMPRESA / NF -->
<h2>📄 Cabeçalho Fiscal</h2>
<div class="grid">
  <div class="cell"><div class="lbl">Empresa (Emitente)</div><div class="val">${esc(nota?.emitente_nome||"—")}</div></div>
  <div class="cell"><div class="lbl">CNPJ</div><div class="val mono">${esc(nota?.emitente_cnpj||"—")}</div></div>
  <div class="cell"><div class="lbl">Destinatário</div><div class="val">${esc(nota?.destinatario_nome||"—")}</div></div>
  <div class="cell"><div class="lbl">CNPJ Destinatário</div><div class="val mono">${esc(nota?.destinatario_cnpj||"—")}</div></div>
  <div class="cell"><div class="lbl">IE Destinatário</div><div class="val mono">${esc(nota?.destinatario_ie||"ISENTO / NÃO INFORMADA")}</div></div>
  <div class="cell"><div class="lbl">Competência</div><div class="val">${esc((nota?.data_emissao||"").substring(0,7)||"—")}</div></div>
  <div class="cell"><div class="lbl">UF Origem → Destino</div><div class="val">${esc(nota?.uf_origem||"—")} → ${esc(nota?.uf_destino||"—")}</div></div>
  <div class="cell"><div class="lbl">NF-e (Nº/Série)</div><div class="val">${esc(nota?.numero||"—")}/${esc(nota?.serie||"—")}</div></div>
  <div class="cell"><div class="lbl">Chave</div><div class="val mono small">${esc((nota?.chave||"").replace(/^NFe/,""))}</div></div>
  <div class="cell"><div class="lbl">Natureza</div><div class="val small">${esc(nota?.natureza_operacao||"—")}</div></div>
  <div class="cell"><div class="lbl">Qtd Itens</div><div class="val">${produtos.length}</div></div>
  <div class="cell"><div class="lbl">Valor Total NF</div><div class="val">${fmt(totalNF)}</div></div>
  <div class="cell"><div class="lbl">Total ICMS</div><div class="val">${fmt(totalICMSCalc)}</div></div>
  <div class="cell"><div class="lbl">Total ST</div><div class="val">${fmt(totalICMSST)}</div></div>
  <div class="cell"><div class="lbl">Total DIFAL</div><div class="val">${fmt(totalDIFAL)}</div></div>
  <div class="cell"><div class="lbl">Total Antecipação</div><div class="val">${fmt(totalAntecipacao)}</div></div>
  <div class="cell"><div class="lbl">Total FCP</div><div class="val">${fmt(totalFCP)}</div></div>
  <div class="cell"><div class="lbl">Total Benefícios</div><div class="val">${fmt(totalBeneficios)}</div></div>
</div>

<!-- RESUMO EXECUTIVO -->
<h2>📊 Resumo Executivo</h2>
<div class="grid" style="grid-template-columns:repeat(8,1fr)">
  <div class="cell"><div class="lbl">Total Itens</div><div class="val">${resumo.total}</div></div>
  <div class="cell"><div class="lbl">Com ICMS</div><div class="val">${resumo.comICMS}</div></div>
  <div class="cell"><div class="lbl">Isentas / N.Trib.</div><div class="val">${resumo.isentas}</div></div>
  <div class="cell"><div class="lbl">Com ST</div><div class="val">${resumo.st}</div></div>
  <div class="cell"><div class="lbl">Com Redução</div><div class="val">${resumo.reducao}</div></div>
  <div class="cell"><div class="lbl">Diferimento</div><div class="val">${resumo.diferimento}</div></div>
  <div class="cell"><div class="lbl">Divergências</div><div class="val">${qtdDivergencias}</div></div>
  <div class="cell"><div class="lbl">Erros</div><div class="val">${resumo.erros}</div></div>
</div>
<div class="small" style="margin-top:5px">
  ${qtdDivergencias
    ? `<span class="tag-warn">⚠ ${qtdDivergencias} item(ns) com diferença entre o ICMS destacado na NF-e e o ICMS recalculado — detalhamento na seção "Detalhe Completo por Item".</span>`
    : `<span class="tag-ok">✓ Todos os itens conferem com o ICMS destacado na NF-e.</span>`}
</div>

<!-- TABELA CONSOLIDADA -->
<h2>📋 Tabela Consolidada — Itens da NF-e</h2>
<table class="itens">
  <thead><tr>
    <th>Seq</th><th>Código</th><th>Descrição</th><th>NCM</th><th>CEST</th><th>CFOP</th><th>CST</th><th>Orig</th>
    <th>Tributação</th><th>Benefício</th><th>Legislação</th>
    <th>Base Orig.</th><th>% Red.</th><th>Base c/ Red.</th><th>MVA</th><th>Base ST</th>
    <th>Alíq. Int.</th><th>Alíq. Inter.</th>
    <th>ICMS Próprio</th><th>ICMS-ST</th><th>DIFAL</th><th>FCP</th><th>Antecipação</th>
    <th>Total Item</th><th>Status</th><th>Observações</th>
  </tr></thead>
  <tbody>${itensRows}</tbody>
</table>

<!-- DETALHE COMPLETO POR ITEM -->
<div class="pb"></div>
<h2>🔍 Detalhe Completo por Item — Conferência sem abrir a NF-e</h2>
${detalheItens}

<!-- MEMÓRIA DE CÁLCULO -->
<div class="pb"></div>
<h2>🧮 Memória de Cálculo</h2>
${memoriaSecoes}

<!-- PAINEL DE ALERTAS -->
<div class="pb"></div>
<h2>⚠️ Painel de Alertas</h2>
${alertasHTML}

<!-- LOG TÉCNICO -->
<h2>📋 Log Técnico do Motor</h2>
${logHTML}

<!-- ÍNDICE DE LEGISLAÇÃO -->
<div class="pb"></div>
<h2>📚 Índice de Legislação Citada</h2>
${baseLegalHTML}

<div class="foot">
  <span>FiscoAI · Relatório Técnico Fiscal · Legislações: RICMS/BA Dec. 13.780/12 · Conv. ICMS 52/91 · 101/97 · 142/18 · Prot. 41/08 e 97/10 · EC 87/2015 · LC 190/22</span>
  <span>Gerado em ${dataAtual} ${horaAtual}</span>
</div>

<div class="no-print" style="text-align:center;margin:20px 0">
  <button onclick="window.print()" style="padding:10px 28px;background:#2b6cb0;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer">🖨️ Imprimir / Salvar PDF</button>
</div>

</body></html>`;

  const blob = new Blob([html], {type:"text/html;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (w) {
    w.addEventListener("load", () => {
      setTimeout(() => { w.focus(); w.print(); }, 500);
    });
  }
}

// ============================================================
// XML EXEMPLO
// ============================================================
const XML_EXEMPLO = `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe">
  <NFe><infNFe Id="NFe29240100012345678901550010000000011234567890">
    <ide><cUF>29</cUF><natOp>Venda de Mercadoria</natOp><serie>1</serie><nNF>1</nNF><dhEmi>2024-06-11T10:00:00-03:00</dhEmi></ide>
    <emit><CNPJ>00123456789101</CNPJ><xNome>EMPRESA TESTE LTDA</xNome><enderEmit><UF>SP</UF></enderEmit></emit>
    <dest><CNPJ>98765432100012</CNPJ><xNome>CLIENTE BAHIA LTDA</xNome><enderDest><UF>BA</UF></enderDest></dest>
    <det nItem="1"><prod><cProd>AERO001</cProd><xProd>Aerogerador de Energia Eolica</xProd><NCM>85023100</NCM><CFOP>6102</CFOP><uCom>UN</uCom><qCom>2</qCom><vUnCom>15000.00</vUnCom><vProd>30000.00</vProd></prod><imposto><ICMS><ICMS00><CST>00</CST><vBC>30000.00</vBC><pICMS>12</pICMS><vICMS>3600.00</vICMS></ICMS00></ICMS></imposto></det>
    <det nItem="2"><prod><cProd>SOLAR002</cProd><xProd>Painel Solar Fotovoltaico 450W</xProd><NCM>85414300</NCM><CFOP>6102</CFOP><uCom>UN</uCom><qCom>10</qCom><vUnCom>900.00</vUnCom><vProd>9000.00</vProd></prod><imposto><ICMS><ICMS00><CST>00</CST><vBC>9000.00</vBC><pICMS>12</pICMS><vICMS>1080.00</vICMS></ICMS00></ICMS></imposto></det>
    <det nItem="3"><prod><cProd>TINTA003</cProd><xProd>Tinta Acrilica Premium Branca 18L</xProd><NCM>32089000</NCM><CEST>24001000</CEST><CFOP>6102</CFOP><uCom>GL</uCom><qCom>5</qCom><vUnCom>120.00</vUnCom><vProd>600.00</vProd></prod><imposto><ICMS><ICMS10><CST>10</CST><vBC>600.00</vBC><pICMS>12</pICMS><vICMS>72.00</vICMS></ICMS10></ICMS></imposto></det>
    <det nItem="4"><prod><cProd>TRATOR004</cProd><xProd>Trator Agricola 4x4 100cv</xProd><NCM>87019100</NCM><CFOP>6102</CFOP><uCom>UN</uCom><qCom>1</qCom><vUnCom>150000.00</vUnCom><vProd>150000.00</vProd></prod><imposto><ICMS><ICMS00><CST>00</CST><vBC>150000.00</vBC><pICMS>12</pICMS><vICMS>18000.00</vICMS></ICMS00></ICMS></imposto></det>
    <det nItem="5"><prod><cProd>REFRIG005</cProd><xProd>Refrigerante Cola 350ml Lata CX12</xProd><NCM>22021000</NCM><CEST>03010200</CEST><CFOP>6102</CFOP><uCom>CX</uCom><qCom>20</qCom><vUnCom>18.00</vUnCom><vProd>360.00</vProd></prod><imposto><ICMS><ICMS10><CST>10</CST><vBC>360.00</vBC><pICMS>12</pICMS><vICMS>43.20</vICMS></ICMS10></ICMS></imposto></det>
  </infNFe></NFe>
</nfeProc>`;

// ============================================================
// ESTILOS
// ============================================================
const C = {
  bg:DS_COLORS.surface.base, card:DS_COLORS.surface.raised, border:DS_COLORS.surface.border,
  blue:DS_COLORS.primary.rgb, green:DS_COLORS.success.rgb, yellow:DS_COLORS.warning.rgb, gray:DS_COLORS.neutral.rgb, red:DS_COLORS.danger.rgb,
  text:"#e6edf7", muted:"#8494ac", sub:"#aab8ca",
};
const FONT_SANS=DS_TYPO.fontFamily.sans;
const FONT_MONO=DS_TYPO.fontFamily.mono;
const S = {
  app:{minHeight:"100vh",background:DS_COLORS.gradients.app,backgroundAttachment:"fixed",fontFamily:FONT_SANS,color:C.text,WebkitFontSmoothing:"antialiased"},
  hdr:{background:"rgba(11,17,32,0.72)",borderBottom:`1px solid ${C.border}`,padding:"0 22px",display:"flex",alignItems:"center",justifyContent:"space-between",height:64,position:"sticky",top:0,zIndex:100,backdropFilter:"blur(16px)",gap:12},
  logo:{display:"flex",alignItems:"center",gap:10,fontWeight:800,fontSize:17,letterSpacing:"-0.03em",color:C.text},
  logoMark:{display:"grid",placeItems:"center",width:36,height:36,borderRadius:12,background:DS_COLORS.gradients.primary,boxShadow:DS_COLORS.shadows.glow,fontSize:18},
  badge:{background:`rgba(${C.blue},0.14)`,border:`1px solid rgba(${C.blue},0.32)`,borderRadius:999,padding:"3px 9px",fontSize:10,color:`rgb(${C.blue})`,fontWeight:700,letterSpacing:"0.06em",textTransform:"uppercase"},
  shell:{display:"grid",gridTemplateColumns:"236px minmax(0,1fr)",gap:22,maxWidth:1560,margin:"0 auto",padding:"22px 20px 60px",alignItems:"start"},
  sidebar:{position:"sticky",top:86,display:"flex",flexDirection:"column",gap:4,padding:12,borderRadius:18,background:DS_COLORS.gradients.subtle,border:`1px solid ${C.border}`,boxShadow:DS_COLORS.shadows.md,backdropFilter:"blur(10px)"},
  navItem:(a,d)=>({display:"flex",alignItems:"center",gap:10,width:"100%",textAlign:"left",padding:"10px 12px",borderRadius:12,border:"1px solid transparent",fontSize:12.5,fontWeight:a?700:500,cursor:d?"not-allowed":"pointer",opacity:d?0.4:1,background:a?`linear-gradient(135deg, rgba(${C.blue},0.22), rgba(${C.blue},0.08))`:"transparent",borderColor:a?`rgba(${C.blue},0.35)`:"transparent",color:a?"#dbe7ff":C.sub,transition:"all .18s cubic-bezier(.4,0,.2,1)"}),
  main:{minWidth:0},
  card:{background:DS_COLORS.gradients.subtle,border:`1px solid ${C.border}`,borderRadius:18,padding:22,marginBottom:20,boxShadow:DS_COLORS.shadows.md,backdropFilter:"blur(10px)"},
  cardTitle:{fontSize:12,fontWeight:700,color:C.text,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:16,display:"flex",alignItems:"center",gap:8},
  statsGrid:{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:14,marginBottom:20},
  stat:(col)=>({background:`linear-gradient(135deg, rgba(${col},0.14) 0%, rgba(255,255,255,0.02) 100%)`,border:`1px solid rgba(${col},0.24)`,borderRadius:16,padding:"16px 18px",textAlign:"left",boxShadow:DS_COLORS.shadows.sm}),
  statN:(col)=>({fontSize:28,fontWeight:800,color:`rgb(${col})`,lineHeight:1.1,marginBottom:4,letterSpacing:"-0.02em"}),
  statL:{fontSize:10.5,color:C.muted,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.07em"},
  btn:(v="primary")=>({padding:"9px 16px",borderRadius:10,border:"1px solid transparent",fontWeight:600,fontSize:12.5,cursor:"pointer",transition:"all .18s cubic-bezier(.4,0,.2,1)",display:"inline-flex",alignItems:"center",gap:6,fontFamily:"inherit",...(v==="primary"?{background:DS_COLORS.gradients.primary,color:"#fff",boxShadow:DS_COLORS.shadows.glow}:v==="success"?{background:DS_COLORS.gradients.success,color:"#eafff3",boxShadow:"0 6px 18px -8px rgba(34,197,94,0.6)"}:v==="danger"?{background:`rgba(${C.red},0.14)`,color:`rgb(${C.red})`,borderColor:`rgba(${C.red},0.35)`}:v==="pdf"?{background:DS_COLORS.gradients.danger,color:"#fff",boxShadow:"0 6px 18px -8px rgba(239,68,68,0.6)"}:{background:"rgba(255,255,255,0.05)",color:C.sub,borderColor:C.border})}),
  inp:{width:"100%",padding:"10px 12px",background:"rgba(2,6,23,0.4)",border:`1px solid ${C.border}`,borderRadius:10,color:C.text,fontSize:13,outline:"none",boxSizing:"border-box",fontFamily:"inherit",transition:"all .18s"},
  textarea:{width:"100%",padding:"12px 14px",background:"rgba(2,6,23,0.5)",border:`1px solid ${C.border}`,borderRadius:12,color:C.sub,fontSize:12,fontFamily:FONT_MONO,outline:"none",resize:"vertical",lineHeight:1.6,boxSizing:"border-box"},
  table:{width:"100%",borderCollapse:"collapse",fontSize:12},
  th:{padding:"10px 12px",background:"rgba(255,255,255,0.04)",borderBottom:`1px solid ${C.border}`,textAlign:"left",fontSize:10,fontWeight:700,color:C.muted,letterSpacing:"0.08em",textTransform:"uppercase",whiteSpace:"nowrap"},
  td:{padding:"10px 12px",borderBottom:`1px solid rgba(148,163,184,0.09)`,verticalAlign:"top"},
  tag:{display:"inline-block",padding:"2px 8px",borderRadius:6,fontSize:11,fontWeight:600,background:`rgba(${C.blue},0.14)`,color:`rgb(${C.blue})`,fontFamily:FONT_MONO},
  divider:{borderTop:`1px solid ${C.border}`,margin:"16px 0"},
  alert:(t)=>({padding:"12px 15px",borderRadius:12,marginBottom:14,fontSize:12.5,display:"flex",gap:9,alignItems:"flex-start",lineHeight:1.5,...(t==="error"?{background:`rgba(${C.red},0.1)`,border:`1px solid rgba(${C.red},0.3)`,color:`rgb(${C.red})`}:t==="success"?{background:`rgba(${C.green},0.1)`,border:`1px solid rgba(${C.green},0.3)`,color:`rgb(${C.green})`}:{background:`rgba(${C.yellow},0.1)`,border:`1px solid rgba(${C.yellow},0.3)`,color:`rgb(${C.yellow})`})}),
  chip:(t)=>{const m={ISENCAO:[C.green,"Isento"],REDUCAO_BC:[C.yellow,"Redução BC"],ICMS_ST:[C.blue,"ICMS-ST"],ANTECIPACAO:[C.yellow,"Antecipação"],DIFAL:[C.blue,"DIFAL"],NAO_ENCONTRADO:[C.gray,"Sem Regra"],NORMAL:[C.green,"ICMS Normal"],ST_SUGERIDA:[C.yellow,"⚠ ST Sugerida"]};const[col,lbl]=m[t]||[C.gray,t];return{style:{display:"inline-flex",alignItems:"center",padding:"3px 10px",borderRadius:999,fontSize:10,fontWeight:700,background:`rgba(${col},0.15)`,color:`rgb(${col})`,border:`1px solid rgba(${col},0.32)`,whiteSpace:"nowrap"},label:lbl};},
  tab:(a)=>({padding:"8px 16px",borderRadius:10,border:"1px solid transparent",fontWeight:600,fontSize:12,cursor:"pointer",transition:"all .18s",background:a?`rgba(${C.blue},0.16)`:"transparent",color:a?`rgb(${C.blue})`:C.muted,borderColor:a?`rgba(${C.blue},0.3)`:"transparent"}),
  dropzone:(drag)=>({border:`2px dashed rgba(${C.blue},${drag?0.75:0.28})`,borderRadius:16,padding:"40px 24px",textAlign:"center",background:drag?`rgba(${C.blue},0.08)`:"rgba(2,6,23,0.28)",transition:"all .2s",cursor:"pointer"}),
  calcBox:{background:"rgba(2,6,23,0.4)",border:`1px solid ${C.border}`,borderRadius:14,padding:16},
  histItem:(sel)=>({padding:"12px 14px",borderRadius:12,border:`1px solid ${sel?`rgba(${C.blue},0.35)`:C.border}`,background:sel?`rgba(${C.blue},0.1)`:"rgba(255,255,255,0.025)",cursor:"pointer",marginBottom:8,transition:"all .18s"}),
};

// ============================================================
// COMPONENTES AUXILIARES
// ============================================================
function Chip({tipo}){const{style,label}=S.chip(tipo);return <span style={style}>{label}</span>;}

const STAT_TONE={[C.blue]:"primary",[C.green]:"success",[C.yellow]:"warning",[C.red]:"danger",[C.gray]:"neutral"};
function Stat({label,value,col,sub,icon}){
  return <StatCard label={label} value={value} trend={sub} icon={icon} color={STAT_TONE[col]||"primary"} />;
}

function RegraCard({regra}){
  if(regra.tipo==="NAO_ENCONTRADO") return(
    <div style={{padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:8,marginTop:8,fontSize:12,color:C.muted}}>
      ⚠️ {regra.mensagem} &nbsp;<span style={S.tag}>NCM: {regra.ncm_consultado||"—"}</span>
    </div>
  );
  const{style:cs,label:cl}=S.chip(regra.tipo);
  return(
    <div style={{background:"rgba(0,0,0,0.25)",border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginTop:10}}>
      <div style={{display:"flex",justifyContent:"space-between",flexWrap:"wrap",gap:6,marginBottom:10}}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <span style={cs}>{cl}</span>
          {regra.beneficio&&<span style={{...S.chip("ISENCAO").style,fontSize:10}}>✅ Benefício Fiscal</span>}
        </div>
        <span style={S.tag}>{regra.ncm_encontrado}</span>
      </div>
      {regra.match_por?.length>0&&(
        <div style={{fontSize:10,color:C.muted,marginBottom:8,fontFamily:"monospace"}}>
          🎯 Match por: <span style={{color:`rgb(${C.blue})`,fontWeight:700}}>{regra.match_por.join(" + ")}</span> · score <strong style={{color:C.text}}>{regra.match_score}/100</strong>
          {regra.enquadramento&&(
            <span style={{color:C.muted}}> · NCM <strong style={{color:C.text}}>{regra.enquadramento.nivel_match_ncm}</strong> ({regra.enquadramento.score_ncm}{regra.tipo==="ICMS_ST"?"/60":""}) · Desc <strong style={{color:C.text}}>{regra.enquadramento.analise_descricao}</strong> ({regra.tipo==="ICMS_ST"?`${regra.enquadramento.score_descricao}/30`:`${regra.enquadramento.ajuste_descricao>=0?"+":""}${regra.enquadramento.ajuste_descricao}`}){regra.tipo==="ICMS_ST"&&(<> · CST <strong style={{color:C.text}}>{regra.enquadramento.cst_informado||"—"}</strong> ({regra.enquadramento.score_cst}/10)</>)} · confiança <strong style={{color:C.text}}>{regra.enquadramento.confianca}</strong>{regra.enquadramento.classificacao&&(<> · <strong style={{color:`rgb(${C.blue})`}}>{regra.enquadramento.classificacao.replace(/_/g," ")}</strong></>)}</span>
          )}
        </div>
      )}
      {regra.enquadramento&&(
        <div style={{fontSize:10,color:C.sub,marginBottom:8,padding:"6px 8px",background:"rgba(0,0,0,0.18)",borderLeft:`3px solid rgba(${C.blue},0.5)`,borderRadius:4,lineHeight:1.5}}>
          📋 <strong>{regra.enquadramento.decisao}</strong> — {regra.enquadramento.justificativa}
        </div>
      )}
      <div style={{marginBottom:8}}>
        <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Fundamento Legal</div>
        <div style={{color:`rgb(${C.blue})`,fontWeight:600,marginTop:2}}>⚖️ {regra.fundamento}</div>
      </div>
      {regra.descricao&&<div style={{marginBottom:8}}><div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.05em"}}>Produto Enquadrado</div><div style={{color:C.text,fontSize:12,marginTop:2}}>{regra.descricao}</div></div>}
      {regra.condicao&&<div style={{...S.alert("warn"),marginBottom:0,marginTop:8,fontSize:12}}>⚠️ <span>{regra.condicao}</span></div>}
      {regra.tipo==="ICMS_ST"&&(
        <>
          {regra.revisao&&(
            <div style={{...S.alert("warn"),marginBottom:0,marginTop:8,fontSize:11,flexDirection:"column",alignItems:"flex-start"}}>
              <div style={{fontWeight:700,marginBottom:3}}>⚠️ Enquadramento ST aplicado — REVISÃO MANUAL recomendada</div>
              <div>Score do motor: <strong>{regra.match_score}/100</strong> (match por {regra.match_por?.join("+")||"—"}). O cálculo foi efetuado conforme RICMS/BA Anexo 1, mas a correspondência NCM/CEST/Descrição não é exata. Confira o item antes de transmitir.</div>
            </div>
          )}
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:7,marginTop:10}}>
            {[["MVA Original",regra.mva_original],["MVA Ajustada 12%",regra.mva_ajustada_12],["MVA Ajustada 7%",regra.mva_ajustada_7],["MVA Ajustada 4%",regra.mva_ajustada_4]].map(([l,v])=>(
              <div key={l} style={{background:`rgba(${C.blue},0.07)`,borderRadius:6,padding:"7px 10px"}}>
                <div style={{fontSize:10,color:C.muted}}>{l}</div>
                <div style={{fontSize:13,fontWeight:700,color:`rgb(${C.blue})`}}>{v||"—"}</div>
              </div>
            ))}
            {regra.cest&&<div style={{background:`rgba(${C.yellow},0.07)`,borderRadius:6,padding:"7px 10px"}}><div style={{fontSize:10,color:C.muted}}>CEST</div><div style={{fontSize:12,fontWeight:700,color:`rgb(${C.yellow})`,fontFamily:"monospace"}}>{regra.cest}</div></div>}
            {regra.acordo&&<div style={{background:`rgba(${C.yellow},0.07)`,borderRadius:6,padding:"7px 10px"}}><div style={{fontSize:10,color:C.muted}}>Acordo</div><div style={{fontSize:11,fontWeight:600,color:`rgb(${C.yellow})`}}>{regra.acordo}</div></div>}
          </div>
        </>
      )}
      {regra.tipo==="REDUCAO_BC"&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginTop:10}}>
          {[["Carga Interna",regra.carga_interna],["Sul/SE→N/NE/CO/ES",regra.carga_inter_sul_sudeste],["Demais Interestaduais",regra.carga_inter_demais]].map(([l,v])=>(
            <div key={l} style={{background:`rgba(${C.yellow},0.07)`,borderRadius:6,padding:"7px 10px"}}>
              <div style={{fontSize:10,color:C.muted}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:`rgb(${C.yellow})`}}>{v}</div>
            </div>
          ))}
        </div>
      )}
      {regra.tipo==="ISENCAO"&&(
        <div style={{...S.alert("success"),marginBottom:0,marginTop:8,fontSize:12,flexDirection:"column",alignItems:"flex-start"}}>
          <div>✅ <strong>Operação isenta de ICMS</strong> conforme {regra.fundamento}.</div>
          {regra.validacao_pdf && (
            <div style={{marginTop:6,fontSize:11,color:C.sub,lineHeight:1.5}}>
              <div>📄 <strong>Validação contra PDF:</strong> {regra.validacao_pdf.fonte}</div>
              <div>Item <strong>{regra.validacao_pdf.item_id}</strong> · NCM PDF <strong>{regra.validacao_pdf.ncm_pdf}</strong>{regra.validacao_pdf.cest_pdf?` · CEST PDF ${regra.validacao_pdf.cest_pdf}`:""}</div>
              <div style={{marginTop:3,color:`rgb(${C.yellow})`}}>⚠ Condição a confirmar: {regra.validacao_pdf.condicao}</div>
            </div>
          )}
        </div>
      )}
      {regra.tipo==="REDUCAO_BC"&&regra.validacao_pdf&&(
        <div style={{...S.alert("success"),marginBottom:0,marginTop:8,fontSize:11,flexDirection:"column",alignItems:"flex-start"}}>
          <div>📄 <strong>Validação contra PDF:</strong> {regra.validacao_pdf.fonte}</div>
          <div style={{color:C.sub}}>Item <strong>{regra.validacao_pdf.item_id}</strong> · NCM PDF <strong>{regra.validacao_pdf.ncm_pdf}</strong></div>
          <div style={{marginTop:3,color:`rgb(${C.yellow})`}}>⚠ Condição a confirmar: {regra.validacao_pdf.condicao}</div>
        </div>
      )}
      {regra.fonte_pdf&&regra.tipo!=="ISENCAO"&&regra.tipo!=="REDUCAO_BC"&&(
        <div style={{fontSize:10,color:C.muted,marginTop:8,fontFamily:"monospace"}}>📄 Fonte: {regra.fonte_pdf}</div>
      )}
      {regra.tipo==="ST_SUGERIDA"&&(()=>{
        const isConfirmada = regra.status === "ST_CONFIRMADA";
        const isAutopecas = regra.segmento === "Autopecas";
        const corBase = isConfirmada ? C.blue : C.yellow;
        return (
          <>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:7,marginTop:10}}>
              {[
                ["Status",regra.status],
                ["Score Final",`${regra.score}/100`],
                ["Score NCM",`${regra.score_ncm ?? "—"}/60`],
                ["Score Descrição",`${regra.score_descricao ?? "—"}/30`],
                ["Score CST",`${regra.score_cst ?? "—"}/10`],
                ["Segmento",regra.segmento||"—"],
                ["Usa PMC",regra.usa_pmc?"Sim":"Não"],
              ].map(([l,v])=>(
                <div key={l} style={{background:`rgba(${corBase},0.07)`,borderRadius:6,padding:"7px 10px"}}>
                  <div style={{fontSize:10,color:C.muted}}>{l}</div>
                  <div style={{fontSize:12,fontWeight:700,color:`rgb(${corBase})`}}>{v}</div>
                </div>
              ))}
            </div>
            {regra.evidencias?.length>0&&(
              <div style={{marginTop:10,background:"rgba(0,0,0,0.18)",border:`1px solid rgba(${corBase},0.25)`,borderRadius:8,padding:10}}>
                <div style={{fontSize:11,fontWeight:700,color:`rgb(${corBase})`,marginBottom:6}}>
                  🧠 Como o motor chegou a esta sugestão (trilha de raciocínio)
                </div>
                {regra.evidencias.map((ev,i)=>(
                  <div key={i} style={{display:"flex",gap:8,padding:"6px 0",borderTop:i===0?"none":"1px dashed rgba(255,255,255,0.07)"}}>
                    <div style={{minWidth:54,fontSize:11,fontWeight:700,color:`rgb(${corBase})`,fontFamily:"monospace"}}>{ev.peso}</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:600,color:C.text}}>{ev.etapa}</div>
                      <div style={{fontSize:11,color:C.muted,lineHeight:1.5}}>{ev.detalhe}</div>
                    </div>
                  </div>
                ))}
                {regra.conclusao&&(
                  <div style={{marginTop:8,paddingTop:8,borderTop:`1px solid rgba(${corBase},0.25)`,fontSize:11,color:C.text,lineHeight:1.5}}>
                    <strong style={{color:`rgb(${corBase})`}}>Conclusão:</strong> {regra.conclusao}
                  </div>
                )}
              </div>
            )}
            <div style={{marginTop:10,fontSize:11,color:C.muted,background:"rgba(0,0,0,0.12)",borderRadius:6,padding:"7px 10px",lineHeight:1.5}}>
              📚 <strong>Fundamento legal:</strong> {regra.fundamento}
            </div>
            {regra.alertas?.length>0&&(
              <div style={{...S.alert("warn"),marginBottom:0,marginTop:10,fontSize:12,flexDirection:"column",alignItems:"flex-start"}}>
                <div style={{fontWeight:700,marginBottom:4}}>⚠️ Alertas do Motor de Identificação ST</div>
                {regra.alertas.map((a,i)=><div key={i} style={{fontSize:11}}>• {a}</div>)}
              </div>
            )}
            {isConfirmada ? (
              <div style={{...S.alert("success"),marginBottom:0,marginTop:10,fontSize:11}}>
                ✅ <span><strong>ST identificada com alta confiança</strong> ({regra.status}). {isAutopecas
                  ? "Aplicação dos Protocolos ICMS 41/08 e 97/10 c/c Convênio 142/18 (autopeças)."
                  : "Enquadramento segundo o RICMS/BA – Decreto 13.780/2012."} Confirme a pauta aplicável (<strong>PMC → PMPF → MVA</strong>) na Calculadora ST para emitir o documento.</span>
              </div>
            ) : (
              <div style={{...S.alert("warn"),marginBottom:0,marginTop:10,fontSize:11}}>
                ⚠️ <span><strong>Enquadramento incerto</strong> ({regra.status}, score {regra.score}/100). Revise manualmente o NCM/CEST/descrição antes de aplicar ICMS-ST. Cálculo NÃO aplicado automaticamente.</span>
              </div>
            )}
          </>
        );
      })()}

    </div>
  );
}

// ============================================================
// ZONA DE UPLOAD (DRAG & DROP)
// ============================================================
function DropZone({onFiles, disabled}){
  const[drag,setDrag]=useState(false);
  const ref=useRef();
  const processar=(files)=>{
    const list=Array.from(files||[]).filter(f=>f.name.toLowerCase().endsWith(".xml"));
    if(!list.length){alert("Selecione um ou mais arquivos .xml");return;}
    onFiles(list);
  };
  return(
    <div style={{...S.dropzone(drag),opacity:disabled?0.5:1,pointerEvents:disabled?"none":"auto"}}
      onDragOver={e=>{e.preventDefault();setDrag(true);}}
      onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);processar(e.dataTransfer.files);}}
      onClick={()=>ref.current.click()}
    >
      <input ref={ref} type="file" accept=".xml" multiple style={{display:"none"}} onChange={e=>processar(e.target.files)} />
      <div style={{fontSize:36,marginBottom:8}}>📂</div>
      <div style={{fontWeight:700,color:`rgb(${C.blue})`,marginBottom:4}}>Arraste XMLs de NF-e aqui</div>
      <div style={{fontSize:12,color:C.muted}}>ou clique para selecionar — <strong>1 arquivo</strong> abre no detalhamento · <strong>vários</strong> importam em lote</div>
      <div style={{marginTop:10,fontSize:11,color:"rgba(160,174,192,0.5)"}}>Cada NF-e é analisada, calculada, salva no Arquivo Fiscal e adicionada ao Histórico.</div>
    </div>
  );
}



// ============================================================
// CALCULADORA ICMS-ST (manual)
// ============================================================
function CalculadoraST(){
  const[form,setForm]=useState({vProd:"1000",mva:"42",aliqInterna:"20.5",aliqInter:"12",frete:"0",seguro:"0",outrasDespesas:"0",desconto:"0"});
  const[res,setRes]=useState(null);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const calcular=()=>{
    const r=calcularST(parseFloat(form.vProd||0),form.aliqInterna,form.mva,form.aliqInter,parseFloat(form.frete||0),parseFloat(form.seguro||0),parseFloat(form.outrasDespesas||0),parseFloat(form.desconto||0));
    setRes(r);
  };
  const fmt=(v)=>"R$ "+parseFloat(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const fields=[
    {k:"vProd",l:"Valor do Produto (R$)",ph:"ex: 1000.00"},
    {k:"mva",  l:"MVA (%) – da tabela RICMS",ph:"ex: 42"},
    {k:"aliqInterna",l:"Alíquota Interna BA (%)",ph:"ex: 20.5"},
    {k:"aliqInter",  l:"Alíquota Interestadual (%)",ph:"ex: 12"},
    {k:"frete",  l:"Frete (R$)",ph:"ex: 50.00"},
    {k:"seguro", l:"Seguro (R$)",ph:"ex: 0"},
    {k:"outrasDespesas", l:"Outras Despesas (R$)", ph:"ex: 0"},
    {k:"desconto",l:"Desconto (R$)",ph:"ex: 0"},
  ];
  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12,marginBottom:16}}>
        {fields.map(({k,l,ph})=>(
          <div key={k}>
            <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:4}}>{l}</div>
            <input style={S.inp} value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} />
          </div>
        ))}
      </div>
      <button style={S.btn("primary")} onClick={calcular}>🧮 Calcular ICMS-ST</button>
      {res&&(
        <div style={{marginTop:18}}>
          <div style={S.divider}/>
          <div style={{fontSize:12,fontWeight:700,color:`rgb(${C.blue})`,marginBottom:12,textTransform:"uppercase",letterSpacing:"0.05em"}}>Resultado do Cálculo</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
            {[
              {l:"Valor da Operação",v:fmt(res.vOperacao),col:C.blue},
              {l:"ICMS Próprio (interestadual)",v:fmt(res.vICMSProprio),col:C.yellow},
              {l:"Base de Cálculo ST",v:fmt(res.vBCST),col:C.yellow},
              {l:"ICMS-ST a Recolher",v:fmt(res.vICMSST),col:res.vICMSST>0?C.green:C.gray},
              {l:"Total da NF",v:fmt(res.vOperacao+res.vICMSST),col:C.green},
            ].map(({l,v,col})=>(
              <div key={l} style={{background:`rgba(${col},0.08)`,border:`1px solid rgba(${col},0.2)`,borderRadius:9,padding:"12px 14px"}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{l}</div>
                <div style={{fontSize:15,fontWeight:800,color:`rgb(${col})`}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:14,padding:"10px 14px",background:"rgba(0,0,0,0.2)",borderRadius:8,fontSize:11,color:C.muted,lineHeight:1.7}}>
            <strong style={{color:C.sub}}>Fórmula:</strong><br/>
            BC ST = Valor Operação × (1 + MVA%) = {fmt(res.vOperacao)} × (1 + {(res.mva*100).toFixed(2)}%) = <strong style={{color:`rgb(${C.yellow})`}}>{fmt(res.vBCST)}</strong><br/>
            ICMS ST = (BC ST × Alíq. Interna) − ICMS Próprio = ({fmt(res.vBCST)} × {(res.aliqInt*100).toFixed(1)}%) − {fmt(res.vICMSProprio)} = <strong style={{color:`rgb(${C.green})`}}>{fmt(res.vICMSST)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// CALCULADORA ICMS DIFAL (Diferencial de Alíquotas)
// ============================================================
function CalculadoraDIFAL(){
  const[form,setForm]=useState({vOper:"1000",aliqInterna:"20.5",aliqInter:"12"});
  const[res,setRes]=useState(null);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const calcular=()=>{
    const vOper=parseFloat(form.vOper||0);
    const aliqInt=parseFloat(form.aliqInterna||0)/100;
    const aliqInter=parseFloat(form.aliqInter||0)/100;
    const baseDifal = aliqInt < 1 ? vOper/(1-aliqInt) : vOper;
    const icmsDestino = baseDifal * aliqInt;
    const icmsOrigem = vOper * aliqInter;
    const difal = Math.max(0, icmsDestino - icmsOrigem);
    setRes({vOper,aliqInt,aliqInter,baseDifal,icmsDestino,icmsOrigem,difal});
  };
  const fmt=(v)=>"R$ "+parseFloat(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const fields=[
    {k:"vOper",l:"Valor da Operação (R$)",ph:"ex: 1000.00"},
    {k:"aliqInterna",l:"Alíquota Interna BA (%)",ph:"ex: 20.5"},
    {k:"aliqInter",l:"Alíquota Interestadual (%)",ph:"ex: 12"},
  ];
  return(
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:12,marginBottom:16}}>
        {fields.map(({k,l,ph})=>(
          <div key={k}>
            <div style={{fontSize:11,color:C.muted,fontWeight:600,marginBottom:4}}>{l}</div>
            <input style={S.inp} value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={ph} />
          </div>
        ))}
      </div>
      <button style={S.btn("primary")} onClick={calcular}>🧮 Calcular DIFAL</button>
      {res&&(
        <div style={{marginTop:18}}>
          <div style={S.divider}/>
          <div style={{fontSize:12,fontWeight:700,color:`rgb(${C.purple||C.blue})`,marginBottom:12,textTransform:"uppercase",letterSpacing:"0.05em"}}>Resultado do DIFAL</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(170px,1fr))",gap:10}}>
            {[
              {l:"Valor da Operação",v:fmt(res.vOper),col:C.blue},
              {l:"Base DIFAL (c/ gross-up)",v:fmt(res.baseDifal),col:C.yellow},
              {l:"ICMS Destino (Interno)",v:fmt(res.icmsDestino),col:C.yellow},
              {l:"ICMS Origem (Interest.)",v:fmt(res.icmsOrigem),col:C.yellow},
              {l:"DIFAL a Recolher",v:fmt(res.difal),col:res.difal>0?C.green:C.gray},
            ].map(({l,v,col})=>(
              <div key={l} style={{background:`rgba(${col},0.08)`,border:`1px solid rgba(${col},0.2)`,borderRadius:9,padding:"12px 14px"}}>
                <div style={{fontSize:10,color:C.muted,marginBottom:4}}>{l}</div>
                <div style={{fontSize:15,fontWeight:800,color:`rgb(${col})`}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{marginTop:14,padding:"10px 14px",background:"rgba(0,0,0,0.2)",borderRadius:8,fontSize:11,color:C.muted,lineHeight:1.7}}>
            <strong style={{color:C.sub}}>Fórmula:</strong><br/>
            Base = Valor Operação ÷ (1 − Alíq. Interna) = {fmt(res.vOper)} ÷ (1 − {(res.aliqInt*100).toFixed(2)}%) = <strong style={{color:`rgb(${C.yellow})`}}>{fmt(res.baseDifal)}</strong><br/>
            DIFAL = (Base × Alíq. Interna) − (Valor Operação × Alíq. Interestadual) = ({fmt(res.baseDifal)} × {(res.aliqInt*100).toFixed(2)}%) − ({fmt(res.vOper)} × {(res.aliqInter*100).toFixed(2)}%) = <strong style={{color:`rgb(${C.green})`}}>{fmt(res.difal)}</strong>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// HISTÓRICO DE APURAÇÕES POR NCM — versionamento das apurações
// (automáticas e congeladas manualmente) reaplicadas em novas notas
// ============================================================
function HistoricoApuracoesPanel({historicos,selecionado,onSelecionar,onChange}){
  const[q,setQ]=useState("");
  const fmtData=(v)=>v?new Date(v).toLocaleString("pt-BR"):"—";
  const money=(v)=>"R$ "+parseFloat(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2});
  const lista=(historicos||[]).filter(h=>!q||String(h.ncm).includes(q.replace(/\D/g,""))||String(h.descricao_ncm_ultima_nota||"").toLowerCase().includes(q.toLowerCase()));
  const det=lista.find(h=>h.ncm===selecionado)||null;
  const exportar=()=>{
    const blob=new Blob([HistoricoApuracaoService.exportarJSON()],{type:"application/json"});
    const a=document.createElement("a");a.href=URL.createObjectURL(blob);
    a.download=`historico-apuracoes-ncm-${new Date().toISOString().slice(0,10)}.json`;a.click();
  };
  const cel={padding:"8px 6px",borderBottom:`1px solid ${C.border}`};
  return (
    <div style={{background:C.card,border:`1px solid ${C.border}`,borderRadius:14,padding:20}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap",marginBottom:14}}>
        <div>
          <h2 style={{margin:0,fontSize:18,color:C.text}}>📊 Histórico de Apurações por NCM</h2>
          <p style={{margin:"4px 0 0",fontSize:12,color:C.sub}}>Cada apuração é versionada. A versão corrente (alterada ou congelada) é reaplicada automaticamente em novas notas.</p>
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={exportar} style={{padding:"8px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:"transparent",color:C.text,cursor:"pointer",fontSize:12}}>⬇️ Exportar histórico</button>
          <button onClick={()=>{if(confirm("Remover TODO o histórico de apurações por NCM?")){HistoricoApuracaoService.limpar();onChange?.();}}}
            style={{padding:"8px 12px",borderRadius:8,border:"1px solid rgba(239,68,68,.5)",background:"transparent",color:"#f87171",cursor:"pointer",fontSize:12}}>🗑️ Limpar</button>
        </div>
      </div>
      <input value={q} onChange={e=>setQ(e.target.value)} placeholder="Filtrar por NCM ou descrição…"
        style={{width:"100%",padding:"10px 12px",borderRadius:8,border:`1px solid ${C.border}`,background:"rgba(0,0,0,.25)",color:C.text,fontSize:13,marginBottom:14}}/>
      {lista.length===0?(
        <div style={{color:C.sub,fontSize:13,padding:"24px 0",textAlign:"center"}}>Nenhuma apuração registrada ainda. Importe uma NF-e para começar o histórico.</div>
      ):(
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
            <thead><tr style={{color:C.sub,textAlign:"left"}}>
              {["NCM","Descrição","Última versão","Atualizado","Tipo","Alterações",""].map(h=><th key={h} style={cel}>{h}</th>)}
            </tr></thead>
            <tbody>
              {lista.map(h=>{
                const apu=(h.apuracoes||[]).find(a=>a.id===h.versao_corrente?.id_apuracao);
                const tipo=apu?.foi_alterado?"Alterado manual":(apu?.calculo_aplicado?.tipo_calculo==="CONGELADO_MANUAL"?"Congelado manual":"Automático");
                return (
                  <tr key={`${h.empresa_id||"_"}-${h.ncm}`} style={{color:C.text}}>
                    <td style={{...cel,fontFamily:"monospace"}}>{h.ncm}</td>
                    <td style={{...cel,maxWidth:260}}>{h.descricao_ncm_ultima_nota||"—"}</td>
                    <td style={cel}>v{h.versao_corrente?.numero_versao||"—"}{apu?.foi_alterado?" (alterado)":""}</td>
                    <td style={{...cel,color:C.sub}}>{fmtData(h.atualizado_em)}</td>
                    <td style={cel}>{tipo}</td>
                    <td style={cel}>{h.total_alteracoes||0}</td>
                    <td style={cel}>
                      <button onClick={()=>onSelecionar?.(h.ncm===selecionado?null:h.ncm)}
                        style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.text,cursor:"pointer",fontSize:11,marginRight:6}}>Detalhes</button>
                      <button onClick={()=>{if(confirm(`Remover o histórico do NCM ${h.ncm}?`)){HistoricoApuracaoService.remover(h.ncm,h.empresa_id);onChange?.();}}}
                        style={{padding:"4px 8px",borderRadius:6,border:"1px solid rgba(239,68,68,.5)",background:"transparent",color:"#f87171",cursor:"pointer",fontSize:11}}>Remover</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {det&&(
        <div style={{marginTop:16,border:`1px solid ${C.border}`,borderRadius:12,padding:14,background:"rgba(0,0,0,.2)"}}>
          <div style={{fontSize:13,fontWeight:700,color:C.text,marginBottom:8}}>
            HISTÓRICO DE APURAÇÃO — NCM {det.ncm} ({det.descricao_ncm_ultima_nota||"—"})
          </div>
          {[...(det.apuracoes||[])].sort((a,b)=>b.versao-a.versao).map(a=>{
            const corrente=a.id===det.versao_corrente?.id_apuracao;
            const p=a.calculo_aplicado?.parametros||{};
            return (
              <div key={a.id} style={{borderLeft:`3px solid ${corrente?"#63b3ed":C.border}`,paddingLeft:10,marginBottom:12}}>
                <div style={{fontSize:12,fontWeight:700,color:corrente?"#63b3ed":C.text}}>
                  {corrente?"📍 VERSÃO CORRENTE ":"📍 "}v{a.versao} — {a.foi_alterado?"ALTERADO MANUAL":(a.calculo_aplicado?.tipo_calculo==="CONGELADO_MANUAL"?"CONGELADO MANUAL":"AUTOMÁTICO")}
                </div>
                <div style={{fontSize:11.5,color:C.sub,lineHeight:1.6}}>
                  Criado em {fmtData(a.criado_em)}{a.nota_origem?.numero?` (Nota ${a.nota_origem.numero})`:""} por {a.criado_por}<br/>
                  Modo: {a.calculo_aplicado?.tributacao||"—"}{p.mva_informada!=null?` | MVA: ${p.mva_informada}%`:""}{p.fcp_percentual?` | FCP: ${p.fcp_percentual}%`:""}<br/>
                  Valores monetários são calculados a partir do XML da nota atual.
                </div>
                {(a.alteracoes||[]).map((alt,i)=>(
                  <div key={i} style={{fontSize:11,color:"#f6ad55",marginTop:4}}>
                    ↳ {fmtData(alt.data)} — {alt.por}: {alt.motivo} ({JSON.stringify(alt.de)} → {JSON.stringify(alt.para)})
                  </div>
                ))}
                {!corrente&&(
                  <button onClick={()=>{HistoricoApuracaoService.reverterParaVersao(det.ncm,a.versao,det.empresa_id);onChange?.();}}
                    style={{marginTop:6,padding:"4px 8px",borderRadius:6,border:`1px solid ${C.border}`,background:"transparent",color:C.text,cursor:"pointer",fontSize:11}}>↺ Usar esta versão</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ============================================================
// CONSULTA POR NCM — RICMS/BA, Conv. 52/91, 101/97, 142/18
// ============================================================
function ConsultaNCM(){
  const[q,setQ]=useState("");
  const[tipoFiltro,setTipoFiltro]=useState("TODOS");

  const resultados = useMemo(()=>{
    const termo = (q||"").trim();
    if (!termo) return null;
    const termoNum = termo.replace(/[.\s-]/g,"").toUpperCase();
    const termoLow = termo.toLowerCase();
    const ehNCM  = /^\d{4,8}$/.test(termoNum);
    const ehCEST = /^\d{5,7}$/.test(termoNum);
    // Tokens de keyword (≥4 letras, exclui stop-words)
    const termoTokens = tokens(termo);
    const cestsCurados = new Set(REGRAS_FISCAIS.ricms_ba_st.map(r=>normCEST(r.cest)));
    const ricmsExtra = RICMS_BA_ANEXO1.filter(r => !cestsCurados.has(normCEST(r.cest)));
    const todas = [
      ...REGRAS_FISCAIS.ricms_ba_st.map(r=>({...r,_grupo:"RICMS/BA — ICMS-ST (Anexo 1 — curado)"})),
      ...ricmsExtra.map(r=>({...r,_grupo:"RICMS/BA — ICMS-ST (Anexo 1 — Dec. 13.780/2012 vig. 2025)"})),
      ...REGRAS_FISCAIS.convenio_52_91_industrial.map(r=>({...r,_grupo:"Convênio ICMS 52/91 — Industrial"})),
      ...REGRAS_FISCAIS.convenio_52_91_agricola.map(r=>({...r,_grupo:"Convênio ICMS 52/91 — Agrícola"})),
      ...REGRAS_FISCAIS.convenio_101_97.map(r=>({...r,_grupo:"Convênio ICMS 101/97 — Isenção"})),
    ];
    // Cada item recebe um score; mantemos apenas score > 0 e ordenamos desc
    const scored = todas.map(r=>{
      const ncm = normNCM(r.ncm);
      const cest = normCEST(r.cest||"");
      const desc = (r.descricao||"").toLowerCase();
      const descTokens = new Set(tokens(r.descricao||""));
      let s = 0;
      const por = [];
      // 1) NCM: prefix match assimétrico (regra ⊂ produto ou produto ⊂ regra)
      if (ehNCM && ncm) {
        if (ncm.startsWith(termoNum) || termoNum.startsWith(ncm)) {
          s += 60 + Math.min(ncm.length, termoNum.length);
          por.push("NCM");
        }
      }
      // 2) CEST: match completo ou parcial
      if (ehCEST && cest) {
        if (cest === termoNum || cest.startsWith(termoNum) || termoNum.startsWith(cest)) {
          s += 70; por.push("CEST");
        }
      }
      // 3) substring na descrição
      if (!ehNCM && !ehCEST && desc.includes(termoLow)) { s += 40; por.push("DESC"); }
      // 4) keyword match por tokens (mais robusto p/ múltiplas palavras)
      if (termoTokens.length) {
        const hits = termoTokens.filter(t => descTokens.has(t) || desc.includes(t)).length;
        if (hits > 0) {
          s += Math.min(50, hits * 20);
          if (!por.includes("DESC")) por.push("KEYWORD");
        }
      }
      // 5) fallback: NCM digitado mas tb cabe como CEST (números curtos) — busca também em CEST
      if (ehNCM && !por.length && cest && cest.includes(termoNum)) {
        s += 20; por.push("CEST~");
      }
      return s>0 ? {...r, _score:s, _matchPor:por} : null;
    }).filter(Boolean);
    scored.sort((a,b)=>b._score-a._score);
    if (tipoFiltro==="TODOS") return scored;
    return scored.filter(r=>r.tipo===tipoFiltro);
  },[q,tipoFiltro]);

  const grupos = useMemo(()=>{
    if (!resultados) return null;
    const g = {};
    for (const r of resultados) (g[r._grupo] = g[r._grupo]||[]).push(r);
    return g;
  },[resultados]);

  return (
    <div>
      <div style={S.card}>
        <div style={S.cardTitle}>🔎 Consulta de NCM nas Legislações</div>
        <div style={{fontSize:12,color:C.muted,marginBottom:12,lineHeight:1.6}}>
          Pesquise por <strong>NCM</strong>, <strong>CEST</strong>, <strong>palavras-chave</strong> ou parte da descrição. A busca usa <strong>match por prefixo</strong> de NCM/CEST e <strong>tokens</strong> de palavras-chave (mín. 4 letras), ranqueando os resultados por score. Cobre <strong>RICMS/BA (Dec. 13.780/2012)</strong>, <strong>Conv. ICMS 52/91</strong>, <strong>101/97</strong> e <strong>142/18</strong>. <em>Lembrete: Conv. 142/18 e Prot. 41/08/97/10 aplicam-se exclusivamente a peças, componentes e acessórios para veículos automotores (autopeças).</em>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:10}}>
          <input
            style={{...S.inp,maxWidth:340}}
            placeholder="Ex.: 8708, 03.021, cerveja em lata, pastilha freio, painel solar…"
            value={q}
            onChange={e=>setQ(e.target.value)}
            autoFocus
          />
          <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
            {[["TODOS","Todos"],["ICMS_ST","ICMS-ST"],["ISENCAO","Isenção"],["REDUCAO_BC","Redução BC"]].map(([k,l])=>(
              <button key={k} style={S.tab(tipoFiltro===k)} onClick={()=>setTipoFiltro(k)}>{l}</button>
            ))}
          </div>
        </div>
        {!q.trim() && (
          <div style={{...S.alert("warn"),fontSize:12}}>
            ℹ️ Digite um NCM, CEST ou termo da descrição para iniciar a consulta.
          </div>
        )}
        {q.trim() && resultados && resultados.length===0 && (
          <div style={{...S.alert("error"),fontSize:12}}>
            ❌ Nenhum enquadramento encontrado para <strong>"{q}"</strong> nas legislações cadastradas. Verifique o NCM ou consulte diretamente o RICMS/BA.
          </div>
        )}
        {grupos && Object.entries(grupos).map(([nome, regras])=>(
          <div key={nome} style={{marginTop:14}}>
            <div style={{fontSize:12,fontWeight:700,color:`rgb(${C.blue})`,marginBottom:8,letterSpacing:"0.04em",textTransform:"uppercase"}}>
              ⚖️ {nome} <span style={{color:C.muted,fontWeight:500,textTransform:"none",letterSpacing:0}}>({regras.length})</span>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={S.table}>
                <thead>
                  <tr>{["NCM","CEST","Descrição","Tipo","Detalhes","Fundamento"].map(h=><th key={h} style={S.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {regras.map(r=>(
                    <tr key={r.id}>
                      <td style={S.td}><span style={S.tag}>{r.ncm}</span></td>
                      <td style={{...S.td,fontFamily:"monospace",fontSize:10,color:C.muted}}>{r.cest||"—"}</td>
                      <td style={{...S.td,maxWidth:260}}><div style={{fontWeight:600,color:C.text,fontSize:12}}>{r.descricao}</div>{r._matchPor?.length>0&&<div style={{fontSize:10,color:`rgb(${C.blue})`,marginTop:3,fontFamily:"monospace"}}>🎯 {r._matchPor.join("+")} · score {r._score}</div>}{r.condicao&&<div style={{fontSize:10,color:`rgb(${C.yellow})`,marginTop:3}}>⚠ {r.condicao}</div>}{r.acordo&&<div style={{fontSize:10,color:C.muted,marginTop:3}}>{r.acordo}</div>}</td>
                      <td style={S.td}><Chip tipo={r.tipo}/></td>
                      <td style={{...S.td,fontSize:11,color:C.sub,minWidth:180}}>
                        {r.tipo==="ICMS_ST"&&(
                          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:4}}>
                            <div>MVA orig.: <strong>{r.mva_original}</strong></div>
                            <div>MVA 12%: <strong>{r.mva_ajustada_12}</strong></div>
                            <div>MVA 7%: <strong>{r.mva_ajustada_7}</strong></div>
                            <div>MVA 4%: <strong>{r.mva_ajustada_4}</strong></div>
                          </div>
                        )}
                        {r.tipo==="REDUCAO_BC"&&(
                          <div>
                            <div>Interna: <strong>{r.carga_interna}</strong></div>
                            <div>Sul/SE→N/NE/CO/ES: <strong>{r.carga_inter_sul_sudeste}</strong></div>
                            <div>Demais inter.: <strong>{r.carga_inter_demais}</strong></div>
                          </div>
                        )}
                        {r.tipo==="ISENCAO"&&(
                          <div style={{color:`rgb(${C.green})`,fontWeight:700}}>Operação isenta de ICMS</div>
                        )}
                      </td>
                      <td style={{...S.td,fontSize:11,color:`rgb(${C.blue})`,maxWidth:260}}>{r.fundamento}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
      <div style={S.card}>
        <div style={S.cardTitle}>📚 Bases legais consultadas</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:10,fontSize:12,color:C.sub,lineHeight:1.6}}>
          <div><strong style={{color:`rgb(${C.blue})`}}>RICMS/BA – Decreto 13.780/2012</strong><br/><span style={{color:C.muted}}>Anexo 1 – Produtos sujeitos à Substituição Tributária no Estado da Bahia (MVA original e ajustada).</span></div>
          <div><strong style={{color:`rgb(${C.yellow})`}}>Convênio ICMS 52/91</strong><br/><span style={{color:C.muted}}>Redução da base de cálculo do ICMS nas operações com equipamentos industriais (Anexo I) e máquinas/implementos agrícolas (Anexo II).</span></div>
          <div><strong style={{color:`rgb(${C.green})`}}>Convênio ICMS 101/97</strong><br/><span style={{color:C.muted}}>Isenção do ICMS nas operações com equipamentos e componentes para o aproveitamento de energia solar e eólica.</span></div>
          <div><strong style={{color:`rgb(${C.blue})`}}>Convênio ICMS 142/18</strong><br/><span style={{color:C.muted}}>Normas gerais aplicáveis à ST e antecipação do ICMS — neste sistema aplicado em conjunto com os Protocolos 41/08 e 97/10, <strong>exclusivamente para autopeças</strong>.</span></div>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// CARD DE CÁLCULO ICMS POR PRODUTO
// ============================================================

function FCPPopover({seq, inicialAtivo, inicialPct, onConfirmar, onFechar}) {
  const [pct, setPct] = useState(inicialPct || 2.00);
  return (
    <div style={{position:"absolute",top:44,right:12,zIndex:20,background:"#1a202c",border:`1px solid rgba(${C.yellow},0.5)`,borderRadius:10,padding:14,minWidth:270,boxShadow:"0 8px 24px rgba(0,0,0,0.5)"}}>
      <div style={{fontSize:12,fontWeight:800,color:"#f6ad55",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.04em"}}>🔥 Fundo de Combate à Pobreza</div>
      <div style={{fontSize:11,color:C.muted,marginBottom:8,lineHeight:1.5}}>
        Informe o % e clique em <strong style={{color:"#f6ad55"}}>Aplicar</strong> para recalcular este produto.
      </div>
      <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:10}}>
        <span style={{fontSize:11,color:C.muted}}>Alíquota FCP:</span>
        <input type="number" step="0.01" min="0" max="10" value={pct} autoFocus
          onChange={e=>setPct(parseFloat(e.target.value)||0)}
          style={{width:80,padding:"4px 8px",borderRadius:6,border:`1px solid rgba(${C.muted},0.3)`,background:"rgba(0,0,0,0.3)",color:C.text,fontSize:12}}/>
        <span style={{fontSize:11,color:C.muted}}>%</span>
      </div>
      <div style={{display:"flex",gap:6,justifyContent:"space-between",alignItems:"center"}}>
        {inicialAtivo ? (
          <button onClick={()=>onConfirmar(seq, false, 0)} style={{...S.btn("ghost"),fontSize:11,padding:"5px 10px",color:"#fc8181",borderColor:"rgba(252,129,129,0.4)"}}>🗑️ Remover</button>
        ) : <span/>}
        <div style={{display:"flex",gap:6}}>
          <button onClick={onFechar} style={{...S.btn("ghost"),fontSize:11,padding:"5px 10px"}}>Cancelar</button>
          <button onClick={()=>onConfirmar(seq, true, pct)} disabled={!pct || pct<=0} style={{...S.btn("primary"),fontSize:11,padding:"5px 10px",opacity:(!pct||pct<=0)?0.5:1}}>✅ Aplicar</button>
        </div>
      </div>
    </div>
  );
}

function CalcCard({produto, calculo, fcpConfig, onToggleFCP, popoverAberto, onAbrirPopover, onFecharPopover}) {
  const fmt = (v) => "R$ " + parseFloat(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});
  const fmtPct = (v) => parseFloat(v||0).toFixed(2).replace(".",",") + "%";

  const borderColor = {
    ISENCAO: `rgba(${C.green},0.4)`,
    REDUCAO_BC: `rgba(${C.yellow},0.4)`,
    ICMS_ST: `rgba(${C.blue},0.4)`,
    ANTECIPACAO: `rgba(${C.yellow},0.4)`,
    NORMAL: `rgba(${C.gray},0.3)`,
  }[calculo.tributacao] || `rgba(${C.gray},0.3)`;

  const bgColor = {
    ISENCAO: `rgba(${C.green},0.05)`,
    REDUCAO_BC: `rgba(${C.yellow},0.05)`,
    ICMS_ST: `rgba(${C.blue},0.05)`,
    ANTECIPACAO: `rgba(${C.yellow},0.05)`,
    NORMAL: "rgba(255,255,255,0.02)",
  }[calculo.tributacao] || "rgba(255,255,255,0.02)";

  const fcpAtivo = !!fcpConfig?.ativo;
  const fcpPct = fcpConfig?.percentual || 2.00;

  return (
    <div style={{background:bgColor,border:`1px solid ${borderColor}`,borderRadius:12,padding:16,marginBottom:14,position:"relative"}}>
      {/* Cabeçalho */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:8}}>
        <div>
          <div style={{fontWeight:700,fontSize:13,color:C.text}}>{produto.seq}. {produto.descricao}</div>
          <div style={{fontSize:11,color:C.muted,marginTop:2}}>NCM: <span style={{fontFamily:"monospace",color:`rgb(${C.blue})`}}>{produto.ncm}</span> · CFOP: {produto.cfop||"—"} · Qtd: {produto.quantidade} {produto.unidade}</div>
        </div>
        <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
          <button
            onClick={()=>onAbrirPopover && onAbrirPopover(produto.seq)}
            title={fcpAtivo?`FCP ${fcpPct}% aplicado — clique para alterar/remover`:"Aplicar Fundo de Combate à Pobreza (FCP)"}
            style={{
              cursor:"pointer",
              fontSize:11, fontWeight:700, padding:"4px 10px", borderRadius:16,
              border:`1px solid rgba(${fcpAtivo?"246,173,85":C.muted.replace(/[^0-9,]/g,"") || "160,174,192"},0.5)`,
              background: fcpAtivo?"rgba(246,173,85,0.18)":"rgba(255,255,255,0.03)",
              color: fcpAtivo?"#f6ad55":C.muted,
            }}
          >🔥 FCP{fcpAtivo?` ${fcpPct.toFixed(2).replace(".",",")}%`:""}</button>
          <Chip tipo={calculo.tributacao}/>
          <span style={{fontSize:11,fontWeight:700,color:"#68d391"}}>R$ {produto.valor_total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</span>
        </div>
      </div>

      {popoverAberto && (
        <FCPPopover
          seq={produto.seq}
          inicialAtivo={fcpAtivo}
          inicialPct={fcpPct}
          onConfirmar={onToggleFCP}
          onFechar={onFecharPopover}
        />
      )}

      {/* Estado do cálculo: CONGELADO (manual) × AUTOMÁTICO */}
      {calculo._congelado?(
        <div style={{marginBottom:10,padding:"9px 12px",borderRadius:10,background:"rgba(99,179,237,0.12)",border:"1px solid rgba(99,179,237,0.45)",color:"#bee3f8",fontSize:11.5,lineHeight:1.6}}
          title={calculo._motivo_congelamento||""}>
          <strong>❄️ CONGELADO (manual)</strong>
          <div>Modo: {calculo.decisao_manual?.modo||calculo.tributacao}{calculo.mva_utilizada?` | MVA: ${fmtPct(calculo.mva_utilizada)}`:""}{calculo.valor_icms_st?` | ${calculo.tributacao==="ANTECIPACAO"?"Antecipação":"ICMS-ST"}: ${fmt(calculo.valor_icms_st)}`:""}</div>
          {calculo._parametros_congelados?.presuncao_credito&&<div>Presunção de crédito: {fmtPct(calculo._parametros_congelados.presuncao_credito_aliq)}</div>}
          <div style={{color:C.sub}}>👤 {calculo._congelado_por} · 📅 {calculo._congelado_em?new Date(calculo._congelado_em).toLocaleString("pt-BR"):"—"}</div>
          <div style={{color:C.sub}}>Motivo: {calculo._motivo_congelamento}</div>
        </div>
      ):(
        <div style={{marginBottom:10,fontSize:11,color:C.muted}}>
          ⚙️ AUTOMÁTICO (sistema){calculo.memoria_apuracao?` · memória de apuração NCM v${calculo.memoria_apuracao.versao_apuracao} disponível`:""}
        </div>
      )}
      {/* ICMS próprio — destacado na NF ou presumido pela alíquota interestadual */}
      {(calculo.valor_icms_proprio>0||calculo.icms_proprio_presumido)&&(
        calculo.icms_proprio_presumido?(
          <div style={{marginBottom:10,padding:"8px 11px",borderRadius:10,background:"rgba(129,140,248,0.12)",border:"1px solid rgba(129,140,248,0.45)",color:"#c7d2fe",fontSize:11.5,lineHeight:1.6}}>
            <strong>💾 ICMS calculado por alíquota presumida</strong>
            <div>Valor: {fmt(calculo.icms_proprio_calculado??calculo.valor_icms_proprio)} · Alíquota: {fmtPct(calculo.aliquota_icms_utilizada||calculo.aliquota_presumida||calculo.presuncao_credito_aliq||calculo.aliquota_aplicada)} · Base: {fmt(calculo.base_calculo_icms||calculo.base_icms_presumida||calculo.base_calc)} · Origem: {calculo.origem_aliquota_icms||"PRESUMIDA"}</div>
            <div style={{color:C.sub}}>XML sem alíquota/valor válido (vICMS original: {fmt(calculo.valor_icms_xml||0)}) — valor apurado usado como ICMS próprio em ST, DIFAL, antecipação, arquivo fiscal e fechamento.</div>

          </div>
        ):(
          <div style={{marginBottom:10,padding:"8px 11px",borderRadius:10,background:"rgba(52,211,153,0.10)",border:"1px solid rgba(52,211,153,0.35)",color:"#a7f3d0",fontSize:11.5,lineHeight:1.6}}>
            <strong>💾 ICMS Próprio (DESTACADO)</strong>
            <div>Valor: {fmt(calculo.valor_icms_proprio)} · Base: {fmt(calculo.base_calc)}</div>
            <div style={{color:C.sub}}>Conforme destaque na NF.</div>
          </div>
        )
      )}

      {/* Fundamento */}
      <div style={{fontSize:11,color:`rgb(${C.blue})`,marginBottom:10}}>⚖️ {calculo.fundamento}</div>

      {/* Bases e parâmetros de cálculo (transparência obrigatória) */}
      {(()=>{
        const dm=calculo.decisao_manual||null;
        const partes=[];
        partes.push(`Base ICMS ${fmt(calculo.base_calc)}${calculo.icms_proprio_presumido?" (crédito presumido)":""}`);
        if(calculo.aliquota_aplicada)partes.push(`Alíq ${fmtPct(calculo.aliquota_aplicada)} → ICMS ${fmt(calculo.valor_icms_proprio)}`);
        if(calculo.metodo_pauta&&calculo.metodo_pauta!=="MVA")partes.push(`Pauta ${calculo.metodo_pauta} ${fmt(calculo.base_st)}${calculo.fonte_pauta?` (${calculo.fonte_pauta})`:""}`);
        if(calculo.base_st>0)partes.push(`Base ST ${fmt(calculo.base_st)}`);
        if(calculo.mva_utilizada>0)partes.push(`MVA ${fmtPct(calculo.mva_utilizada)}${dm?(dm.origem_memoria?" (memória)":" (manual)"):" (automática)"}`);
        if(calculo.aliq_interna)partes.push(`Alíq ST ${fmtPct(calculo.aliq_interna)}`);
        if((calculo.valor_fcp_st||calculo.valor_fcp)>0)partes.push(`FCP ${fmtPct(calculo.fcp_percentual)} = ${fmt(calculo.valor_fcp_st||calculo.valor_fcp)}`);
        partes.push(`Cálculo: ${dm?(dm.origem_memoria?"memória protegida":"manual"):"automático"}`);
        return (
          <div style={{fontSize:10.5,color:C.sub,background:"rgba(0,0,0,0.22)",border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",marginBottom:10,lineHeight:1.6}}>
            📊 <strong style={{color:C.text}}>Bases:</strong> {partes.join(" | ")}
            {(calculo.tributacao==="ISENTO"||calculo.tributacao==="NAO_TRIBUTADO")&&dm&&<div style={{marginTop:4,color:`rgb(${C.green})`,fontWeight:600}}>🔒 {calculo.tributacao==="ISENTO"?"Isento (memória)":"Não Tributado (memória)"}</div>}
          </div>
        );
      })()}

      {/* Cálculo por PAUTA (só existe quando há PMC/PMPF no documento) */}
      {calculo.metodo_pauta && calculo.metodo_pauta !== "MVA" && (
        <div style={{marginBottom:10,padding:"9px 12px",borderRadius:10,background:"rgba(72,187,120,0.10)",border:"1px solid rgba(72,187,120,0.4)",fontSize:11,lineHeight:1.7,color:C.text}}>
          <strong>📊 CÁLCULO POR PAUTA ({calculo.metodo_pauta})</strong>
          <div>{calculo.metodo_pauta === "PMC" ? "PMC (Preço Máximo ao Consumidor)" : "PMPF"}: {fmt(calculo.valor_pmc||calculo.valor_pauta_unitario)} {calculo.pmc_encontrado_em?`· encontrado em "${calculo.pmc_encontrado_em}" (${calculo.pmc_origem||"tag"})`:""}</div>
          <div>Base de cálculo da ST: {fmt(calculo.base_st)} · Alíquota interna: {fmtPct(calculo.aliq_interna)} · ICMS-ST: {fmt(calculo.valor_icms_st)}</div>
          <div>Status: <strong>INDIVIDUAL (não memorizado)</strong> · 🔄 Recalculado conforme {calculo.metodo_pauta} na NF</div>
          <div style={{color:C.sub}}>Fundamento: {calculo.fundamento_pauta||calculo.fundamento}{calculo.fonte_pauta?` · Origem: ${calculo.fonte_pauta}`:""}</div>
        </div>
      )}
      {(calculo.alertas||[]).some(a=>a.tipo==="PAUTA_SEM_PMC") && (
        <div style={{marginBottom:10,padding:"9px 12px",borderRadius:10,background:"rgba(245,101,101,0.10)",border:"1px solid rgba(245,101,101,0.45)",fontSize:11,lineHeight:1.7,color:"#feb2b2"}}>
          <strong>⚠️ ATENÇÃO — Pauta bloqueada</strong>
          <div>Produto sem <strong>PMC:</strong> no descritivo. O cálculo por pauta foi rejeitado e o cálculo automático foi aplicado ({fmt(calculo.valor_icms_total)}).</div>
        </div>
      )}
      {(calculo.valor_fcp_st>0 || calculo.valor_fcp>0) && (
        <div style={{fontSize:11,color:"#f6ad55",marginBottom:8,background:"rgba(246,173,85,0.08)",padding:"6px 10px",borderRadius:6}}>
          ✔ Fundo de Combate à Pobreza — {calculo.fcp_percentual?.toFixed(2).replace(".",",")}% · Base R$ {(calculo.base_st||calculo.base_calc||0).toFixed(2)} · Valor R$ {(calculo.valor_fcp_st||calculo.valor_fcp||0).toFixed(2)}
        </div>
      )}
      {calculo.etapas_calculo?.length > 0 && (
        <div style={{fontSize:11,color:C.muted,background:"rgba(0,0,0,0.2)",borderRadius:7,padding:"8px 12px",marginBottom:8,lineHeight:1.7}}>
          <strong style={{color:C.sub}}>Memória de cálculo:</strong>
          <ol style={{margin:"4px 0 0 20px",padding:0}}>
            {calculo.etapas_calculo.map((e,i)=>(
              <li key={i}>{e.etapa} = <strong>R$ {e.valor.toFixed(2)}</strong> — <span style={{color:C.muted}}>{e.formula}</span>{e.fundamento?<span style={{color:`rgb(${C.blue})`}}> · {e.fundamento}</span>:null}</li>
            ))}
          </ol>
        </div>
      )}


      {/* Campos de cálculo */}
      {calculo.tributacao === "ISENCAO" && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8}}>
          {[
            ["Valor do Produto", fmt(produto.valor_total), C.blue],
            ["Base de Cálculo", fmt(calculo.base_calc), C.green],
            ["Alíquota ICMS", "0,00%", C.green],
            ["ICMS Calculado", fmt(calculo.valor_icms_total), C.green],
            ["ICMS na NF", fmt(calculo.icms_foi_presumido ? calculo.valor_icms_proprio : calculo.icms_nf_original) + (calculo.icms_foi_presumido ? " (presum.)" : ""), C.gray],
            ["Economia Fiscal", fmt(calculo.economia), C.green],
          ].map(([l,v,col])=>(
            <div key={l} style={{background:`rgba(${col},0.08)`,borderRadius:8,padding:"9px 12px"}}>
              <div style={{fontSize:10,color:C.muted}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:`rgb(${col})`,marginTop:2}}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {calculo.tributacao === "REDUCAO_BC" && (
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8,marginBottom:10}}>
            {[
              ["Valor do Produto", fmt(produto.valor_total), C.blue],
              ["Base Reduzida", fmt(calculo.base_calc), C.yellow],
              ["Alíq. Interestadual", fmtPct(calculo.aliquota_aplicada), C.yellow],
              ["Carga Efetiva", fmtPct(calculo.carga_efetiva), C.yellow],
              ["ICMS Calculado", fmt(calculo.valor_icms_total), C.green],
              ["Economia Fiscal", fmt(calculo.economia), C.green],
            ].map(([l,v,col])=>(
              <div key={l} style={{background:`rgba(${col},0.08)`,borderRadius:8,padding:"9px 12px"}}>
                <div style={{fontSize:10,color:C.muted}}>{l}</div>
                <div style={{fontSize:13,fontWeight:700,color:`rgb(${col})`,marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:C.muted,background:"rgba(0,0,0,0.2)",borderRadius:7,padding:"8px 12px",lineHeight:1.7}}>
            <strong style={{color:C.sub}}>Fórmula:</strong> Base Reduzida = {fmt(produto.valor_total)} × ({fmtPct(calculo.carga_efetiva||0)} ÷ {fmtPct(calculo.aliquota_aplicada||0)}) = <strong style={{color:`rgb(${C.yellow})`}}>{fmt(calculo.base_calc)}</strong> | ICMS = {fmt(calculo.base_calc)} × {fmtPct(calculo.aliquota_aplicada||0)} = <strong style={{color:`rgb(${C.green})`}}>{fmt(calculo.valor_icms_total)}</strong>
          </div>
        </>
      )}

      {calculo.tributacao === "ICMS_ST" && (
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:10}}>
            {[
              ["Valor Operação", fmt(calculo.base_calc), C.blue],
              ["ICMS Próprio", fmt(calculo.valor_icms_proprio), C.yellow],
              ["MVA Ajustada", calculo.mva_utilizada ? fmtPct(calculo.mva_utilizada) : "—", C.yellow],
              ["BC Substituição", fmt(calculo.base_st), C.blue],
              ["Alíq. Interna BA", fmtPct(calculo.aliq_interna||ALIQ_INTERNA_BA), C.blue],
              ["ICMS-ST", fmt(calculo.valor_icms_st), C.green],
              ["ICMS Total", fmt(calculo.valor_icms_total), C.green],
            ].map(([l,v,col])=>(
              <div key={l} style={{background:`rgba(${col},0.08)`,borderRadius:8,padding:"9px 12px"}}>
                <div style={{fontSize:10,color:C.muted}}>{l}</div>
                <div style={{fontSize:13,fontWeight:700,color:`rgb(${col})`,marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:C.muted,background:"rgba(0,0,0,0.2)",borderRadius:7,padding:"8px 12px",lineHeight:1.7}}>
            <strong style={{color:C.sub}}>Fórmula:</strong> BC ST = {fmt(calculo.base_calc)} × (1 + {fmtPct(calculo.mva_utilizada||0)}) = <strong style={{color:`rgb(${C.yellow})`}}>{fmt(calculo.base_st)}</strong> | ICMS-ST = ({fmt(calculo.base_st)} × {fmtPct(calculo.aliq_interna||ALIQ_INTERNA_BA)}) − {fmt(calculo.valor_icms_proprio)} = <strong style={{color:`rgb(${C.green})`}}>{fmt(calculo.valor_icms_st)}</strong>
          </div>
        </>
      )}

      {calculo.tributacao === "ANTECIPACAO" && (
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:10}}>
            {[
              ["Valor do Produto", fmt(produto.valor_total), C.blue],
              ["Frete", fmt(produto.valor_frete||0), C.blue],
              ["IPI", fmt(produto.valor_ipi||0), C.blue],
              ["Desconto", fmt(produto.valor_desconto||0), C.yellow],
              ["Base de Cálculo", fmt(calculo.base_calc), C.yellow],
              ["Alíq. Interna BA", fmtPct(calculo.aliq_interna||ALIQ_INTERNA_BA), C.blue],
              ["ICMS Destacado na NF", fmt(calculo.valor_icms_proprio), C.yellow],
              ["Antecipação a Recolher", fmt(calculo.valor_icms_st), C.green],
            ].map(([l,v,col])=>(
              <div key={l} style={{background:`rgba(${col},0.08)`,borderRadius:8,padding:"9px 12px"}}>
                <div style={{fontSize:10,color:C.muted}}>{l}</div>
                <div style={{fontSize:13,fontWeight:700,color:`rgb(${col})`,marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:C.muted,background:"rgba(0,0,0,0.2)",borderRadius:7,padding:"8px 12px",lineHeight:1.7}}>
            <strong style={{color:C.sub}}>Fórmula:</strong> Antecipação = (Valor + Frete + Seguro + Outras Desp. − Desconto) × Alíq. Interna − ICMS Destacado = ({fmt(produto.valor_total)} + {fmt(produto.valor_frete||0)} + {fmt(produto.valor_seguro||0)} + {fmt(produto.outrasDespesas||produto.valor_outras_desp||0)} − {fmt(produto.valor_desconto||0)}) × {fmtPct(calculo.aliq_interna||ALIQ_INTERNA_BA)} − {fmt(calculo.valor_icms_proprio)} = <strong style={{color:`rgb(${C.green})`}}>{fmt(calculo.valor_icms_st)}</strong> <span style={{color:C.muted}}>(IPI não integra a BC — LC 87/96)</span>
          </div>
        </>
      )}


      {calculo.tributacao === "DIFAL" && (
        <>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:10}}>
            {[
              ["Valor Operação", fmt(calculo.base_calc), C.blue],
              ["Alíq. Interestadual", fmtPct(calculo.aliquota_aplicada), C.blue],
              ["Alíq. Interna Destino", fmtPct(calculo.aliq_interna), C.blue],
              ["Base DIFAL (por dentro)", fmt(calculo.base_st), C.yellow],
              [`ICMS Origem (${calculo.icms_origem_fonte==="NF"?"NF":"tabela"})`, fmt(calculo.valor_icms_proprio), C.yellow],
              ["ICMS Destino", fmt(calculo.icms_destino||0), C.yellow],
              ["DIFAL a Recolher", fmt(calculo.valor_difal||0), C.green],
              ["ICMS Total", fmt(calculo.valor_icms_total), C.green],
            ].map(([l,v,col])=>(
              <div key={l} style={{background:`rgba(${col},0.08)`,borderRadius:8,padding:"9px 12px"}}>
                <div style={{fontSize:10,color:C.muted}}>{l}</div>
                <div style={{fontSize:13,fontWeight:700,color:`rgb(${col})`,marginTop:2}}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{fontSize:11,color:C.muted,background:"rgba(0,0,0,0.2)",borderRadius:7,padding:"8px 12px",lineHeight:1.7}}>
            <strong style={{color:C.sub}}>Fórmula:</strong> Base = (Valor × (1 − {fmtPct(calculo.aliquota_aplicada)})) ÷ (1 − {fmtPct(calculo.aliq_interna)}) = <strong style={{color:`rgb(${C.yellow})`}}>{fmt(calculo.base_st)}</strong> | DIFAL = ICMS destino − ICMS origem = {fmt(calculo.icms_destino||0)} − {fmt(calculo.valor_icms_proprio)} = <strong style={{color:`rgb(${C.green})`}}>{fmt(calculo.valor_difal||0)}</strong>
          </div>
        </>
      )}

      {calculo.tributacao === "NORMAL" && (
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:8}}>
          {[
            ["Valor do Produto", fmt(produto.valor_total), C.blue],
            ["Base de Cálculo", fmt(calculo.base_calc), C.gray],
            ["Alíquota ICMS", fmtPct(calculo.aliquota_aplicada), C.gray],
            ["ICMS Calculado", fmt(calculo.valor_icms_total), C.gray],
          ].map(([l,v,col])=>(
            <div key={l} style={{background:`rgba(${col},0.08)`,borderRadius:8,padding:"9px 12px"}}>
              <div style={{fontSize:10,color:C.muted}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:`rgb(${col})`,marginTop:2}}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {/* Obs */}
      {calculo.obs && calculo.obs !== "—" && (
        <div style={{marginTop:8,fontSize:11,color:C.muted}}>📝 {calculo.obs}</div>
      )}
    </div>
  );
}

// ============================================================
// APP PRINCIPAL
// ============================================================
export default function App(){
  const[tab,setTab]=useState("importar");
  const[xmlInput,setXmlInput]=useState("");
  const[nota,setNota]=useState(null);
  const[produtos,setProdutos]=useState([]);
  const[calculos,setCalculos]=useState([]);
  // Contingência para XMLs sem UF; na operação normal os dados vêm do XML.
  const[ufOrigem]=useState("SP");
  const[ufDestino]=useState("BA");
  const[erro,setErro]=useState(null);
  const[expandido,setExpandido]=useState(null);
  const[analisado,setAnalisado]=useState(false);
  const[busca,setBusca]=useState("");
  const[filtroTipo,setFiltroTipo]=useState("TODOS");
  const[auditMode,setAuditMode]=useState(false);
  const[historico,setHistorico]=useState([]);
  const[histSel,setHistSel]=useState(null);
  const[histBusca,setHistBusca]=useState("");
  const[histEmpresaAberta,setHistEmpresaAberta]=useState(null);
  const[modoUpload,setModoUpload]=useState("drag");
  const[modoCalculo]=useState("AUTO"); // A tributação é determinada a partir do XML e das regras fiscais.
  const[arquivo,setArquivo]=useState({});
  useEffect(()=>{setArquivo(loadArquivo());},[]);
  const[arqEmpresaSel,setArqEmpresaSel]=useState(null);
  const[arqMesSel,setArqMesSel]=useState(null);
  const[arqMsg,setArqMsg]=useState(null);
  const[loteStatus,setLoteStatus]=useState(null); // {processando,total,ok,erro,empresas,detalhes:[]}
  const[stDecisoes,setStDecisoes]=useState({}); // {seq: "VALIDADA"|"MANTIDA"}
  const[fcpPorProduto,setFcpPorProduto]=useState({}); // {seq: {ativo,percentual}}
  const[fcpPopover,setFcpPopover]=useState(null); // seq atual do popover
  const[selCalc,setSelCalc]=useState(()=>new Set()); // seqs selecionados p/ recálculo manual
  const[modalRecalc,setModalRecalc]=useState(null); // {modo, mva, mvaAj} ou null
  const[confirmMod,setConfirmMod]=useState(null); // {seq,ncm,descricao,regraId} ou null
  const[confirmMsg,setConfirmMsg]=useState({}); // {seq: texto}

  // Camada de decisões validadas manualmente (consultada antes do motor)
  useEffect(()=>{ DecisoesValidadasService.carregar(); },[]);

  const confirmarClassificacao = useCallback(async (alvo, status) => {
    try {
      await DecisoesValidadasService.registrar({
        ncm: alvo.ncm, descricao: alvo.descricao, status, regraId: alvo.regraId || null,
      });
      setConfirmMsg(m=>({...m,[alvo.seq]: status === "ST_CONFIRMADA"
        ? "✅ Classificação confirmada como ICMS-ST. Produtos futuros com o mesmo padrão serão classificados automaticamente."
        : "🚫 Classificação confirmada como NÃO ENQUADRADO. Produtos futuros com o mesmo padrão não passarão por revisão."}));
    } catch (e) {
      setConfirmMsg(m=>({...m,[alvo.seq]:`Falha ao gravar a validação: ${e?.message||e}`}));
    }
    setConfirmMod(null);
  }, []);

  useEffect(()=>{ saveArquivo(arquivo); },[arquivo]);
  const analisarRef=useRef(null);

  // Wrapper: aplica FCP configurado no produto (produto.seq) sobre o cálculo.
  // Se o produto tiver cálculo CONGELADO, o congelado sempre prevalece.
  const calcularProdComFCP = useCallback((pr, orig, dest, modo, fcpMap = fcpPorProduto) => {
    const cfg = fcpMap?.[pr.seq];
    const fcpPct = cfg?.ativo ? (cfg.percentual || 0) : 0;
    // Passa fcp_percentual para o motor ST usar dentro de calcularSTcomBeneficio
    const prCom = { ...pr, fcp_percentual: fcpPct };
    const calc = aplicarFCP(calcularICMSProduto(prCom, orig, dest, modo), fcpPct);
    return CongelamentoService.obterCalculoExibivel(pr, calc);
  }, [fcpPorProduto]);

  // Cálculo "cru" (ignora o congelamento) — usado para gerar um novo
  // congelamento a partir do estado atual dos parâmetros.
  const calcularCru = useCallback((pr, orig, dest, modo, fcpPct = 0) => {
    const prCom = { ...pr, fcp_percentual: fcpPct, calculo_congelado: undefined };
    return aplicarFCP(calcularICMSProduto(prCom, orig, dest, modo), fcpPct);
  }, []);

  // Aplica/altera FCP num único produto e recalcula APENAS aquele item.
  // A alteração de FCP é uma intervenção manual → congela o cálculo.
  const aplicarFCPProduto = useCallback((seq, ativo, percentual = 2.00) => {
    const pct = parseFloat(percentual) || 0;
    const orig = nota?.uf_origem || ufOrigem;
    const dest = nota?.uf_destino || ufDestino;
    setFcpPorProduto(prevFcp => {
      const fcpNext = { ...prevFcp };
      if (ativo && pct > 0) fcpNext[seq] = { ativo: true, percentual: pct };
      else delete fcpNext[seq];
      const fcpPct = ativo && pct > 0 ? pct : 0;
      const idx = produtos.findIndex(p => p.seq === seq);
      if (idx >= 0) {
        const base = produtos[idx];
        const cru = calcularCru(base, orig, dest, base.decisao_manual?.modo === "DIFAL" ? "DIFAL" : modoCalculo, fcpPct);
        const empresaIdFcp = base.empresa_id || empresaIdDe(nota);
        const congelado = CongelamentoService.congelarCalculoComMemoria(
          base, cru,
          fcpPct > 0 ? `Usuário alterou FCP para ${fcpPct}%` : "Usuário removeu o FCP do item",
          usuarioAtual,
          empresaIdFcp,
        );
        const calcExib = CongelamentoService.obterCalculoExibivel(congelado, cru);
        setProdutos(prods => prods.map((p,i)=> i===idx ? congelado : p));
        setCalculos(prevCalcs => { const arr=[...prevCalcs]; arr[idx]=calcExib; return arr; });
        HistoricoApuracaoService.registrarAutomaticamenteNaMemoria({
          ncm: base.ncm, descricao: base.descricao, calculo: calcExib,
          tipoCalculo: "MANUAL_CONGELADO", usuario: usuarioAtual,
          notaOrigem: nota ? { numero: nota.numero, serie: nota.serie, chave_acesso: nota.chave, data: nota.data_emissao } : null,
          empresaId: empresaIdFcp,
          aliquotaInterestadual: getAliqInterestadual(orig, dest),
        });
      }
      return fcpNext;
    });
    setFcpPopover(null);
  }, [nota, ufOrigem, ufDestino, produtos, modoCalculo, calcularCru]);



  // Importação em lote: processa cada XML, salva no Arquivo Fiscal e
  // adiciona ao Histórico (para aparecer no detalhamento).
  const importarLote=useCallback(async(files)=>{
    setLoteStatus({processando:true,total:files.length,ok:0,erro:0,empresas:new Set(),detalhes:[]});
    let arqAcc=arquivo;
    const novosHist=[];
    const detalhes=[]; const empresas=new Set(); let ok=0, erro=0;
    for(const file of files){
      try{
        const xml=typeof file?.text === "function" ? await file.text() : String(file?.xml || "");
        const fileName=file?.name || "arquivo.xml";
        const{nota:n,produtos:p,erro:e}=parsearNFe(xml);
        if(e||!n||!p.length){
          erro++; detalhes.push({arquivo:fileName,status:"erro",motivo:e||"XML inválido"});
          continue;
        }
        const orig=n.uf_origem||ufOrigem;
        const dest=n.uf_destino||ufDestino;
        const empId=empresaIdDe(n);
        const prods=p.map(pr=>({...pr,empresa_id:empId,analise:analisarProduto(pr,orig,dest)}));
        const calcs=prods.map(pr=>calcularProdComFCP(pr,orig,dest,modoCalculo));
        const notaFinal={...n,uf_origem:orig,uf_destino:dest,modo_calculo:modoCalculo};
        // REGRA 1 — cobertura total também na importação em lote
        try{
          const notaOrigem={numero:n.numero,serie:n.serie,chave_acesso:n.chave,data:n.data_emissao,uf_origem:orig,uf_destino:dest};
          prods.forEach((pr,i)=>{
            const c=calcs[i]||{};
            HistoricoApuracaoService.registrarAutomaticamenteNaMemoria({
              ncm:pr.ncm,descricao:pr.descricao,calculo:c,
              tipoCalculo:(c.metodo_pauta&&c.metodo_pauta!=="MVA")?"AUTOMATICO_PAUTA":"AUTOMATICO",
              usuario:"SISTEMA_AUTOMATICO",notaOrigem,empresaId:empId,
              aliquotaInterestadual:getAliqInterestadual(orig,dest),
            });
          });
        }catch{/* memória é auxiliar */}
        const {next,key,mesAno}=upsertRegistroArquivo(arqAcc,notaFinal,prods,calcs);
        arqAcc=next; empresas.add(key); ok++;
        novosHist.push({id:Date.now()+Math.random(),data:new Date().toLocaleString("pt-BR"),nota:notaFinal,produtos:prods,calculos:calcs,xml,modoCalculo,origem:"lote"});
        detalhes.push({arquivo:fileName,status:"ok",numero:notaFinal.numero,empresa:notaFinal.destinatario_nome||"—",mesAno});
      }catch(ex){
        erro++; detalhes.push({arquivo:fileName,status:"erro",motivo:ex.message||"Falha na leitura"});
      }
    }
    setArquivo(arqAcc);
    if(novosHist.length){
      setHistorico(h=>[...novosHist,...h].slice(0,50));
    }
    const resumo={processando:false,total:files.length,ok,erro,empresas:Array.from(empresas),detalhes};
    setLoteStatus(resumo);
    setArqMsg({tipo:ok?"ok":"error",txt:`Lote processado: ${ok} NF-e salvas, ${erro} erros, ${empresas.size} empresa(s) atualizada(s).`});
    setTimeout(()=>setArqMsg(null),5000);
    return resumo;
  },[arquivo,ufOrigem,ufDestino,modoCalculo]);

  // ============================================================
  // PONTE DO AGENTE LOCAL — usada pela API localhost do Electron.
  // Não expõe dados para a internet; a API escuta apenas em 127.0.0.1.
  // ============================================================
  useEffect(()=>{
    if(!window.fiscoaiDesktop?.isDesktop) return;
    window.__FISCOAI_AGENT__={
      importXmlBatch: async(files)=>{
        const result=await importarLote(files||[]);
        return result;
      },
      getArchive: ()=>loadArquivo(),
      exportFiscalPdfBase64: (empresa, mesAno, registros)=>exportarArquivoPDF(empresa, mesAno, registros, {returnBase64:true}),
    };
    return()=>{ try{ delete window.__FISCOAI_AGENT__; }catch{} };
  },[importarLote]);

  // Handler unificado do DropZone (aceita 1 ou N arquivos)
  const handleFilesUpload=useCallback(async(files)=>{
    if(!files||!files.length) return;
    if(files.length===1){
      const xml=await files[0].text();
      setXmlInput(xml); setErro(null);
      analisarRef.current(xml);
    }else{
      await importarLote(files);
    }
  },[importarLote]);



  const salvarNoArquivo=useCallback(()=>{
    if(!nota||!produtos.length){setArqMsg({tipo:"error",txt:"Nenhuma NF-e analisada."});return;}
    const {next,key,mesAno}=upsertRegistroArquivo(arquivo,nota,produtos,calculos);
    setArquivo(next);
    setArqEmpresaSel(key); setArqMesSel(mesAno);
    setArqMsg({tipo:"ok",txt:`NF-e ${nota.numero} salva no arquivo (${labelMesAno(mesAno)}).`});
    setTimeout(()=>setArqMsg(null),3500);
  },[arquivo,nota,produtos,calculos]);

  // Decisão manual do usuário sobre ICMS-ST sugerido pelo motor.
  // "VALIDADA"  → promove ST_SUGERIDA a ICMS_ST e recalcula o produto.
  // "MANTIDA"   → mantém como Antecipação Parcial (comportamento padrão).
  // null        → reverte para o estado original.
  const decidirST = useCallback((seq, decisao) => {
    setStDecisoes(prev => {
      const next = {...prev};
      if (decisao == null) delete next[seq]; else next[seq] = decisao;
      return next;
    });
    const orig = nota?.uf_origem || ufOrigem;
    const dest = nota?.uf_destino || ufDestino;
    setProdutos(prods => {
      const novos = prods.map(p => {
        if (p.seq !== seq) return p;
        const original = p._analiseOriginal || p.analise;
        let analise;
        if (decisao === "VALIDADA") {
          // Reanalisa o produto: busca a melhor regra ICMS-ST cadastrada
          // (RICMS/BA Anexo 1) por prefixo de NCM e usa suas MVAs oficiais.
          // Assim o cálculo utiliza a regra encontrada, não a sugestão vazia.
          const ncmProd = normNCM(p.ncm);
          const melhor = REGRAS_FISCAIS.ricms_ba_st
            .map(r => ({ r, len: ncmPrefixHit(ncmProd, r.ncm) }))
            .filter(x => x.len > 0)
            .sort((a,b) => b.len - a.len)[0]?.r || null;
          analise = original.map(a => a.tipo === "ST_SUGERIDA"
            ? {
                ...a,
                ...(melhor ? {
                  cest: melhor.cest || a.cest,
                  acordo: melhor.acordo,
                  mva_original:    melhor.mva_original,
                  mva_ajustada_4:  melhor.mva_ajustada_4,
                  mva_ajustada_7:  melhor.mva_ajustada_7,
                  mva_ajustada_12: melhor.mva_ajustada_12,
                } : {}),
                tipo: "ICMS_ST",
                fundamento: (melhor?.fundamento || a.fundamento || "")
                  + " · validado manualmente pelo usuário"
                  + (melhor ? ` (regra ${melhor.id})` : " (sem MVA cadastrada – revisão)"),
                _validadoManualmente: true,
                _regraOrigem: melhor?.id || "SUGESTAO_MOTOR",
              }
            : a);
        } else if (decisao === "MANTIDA") {
          // Força tratamento como Antecipação: remove qualquer ST/ST_SUGERIDA
          // para que calcularICMSProduto caia no fluxo de Antecipação Parcial
          // (destino BA, origem ≠ BA) ou tributação normal.
          const semST = original.filter(a => a.tipo !== "ST_SUGERIDA" && a.tipo !== "ICMS_ST");
          analise = semST.length ? semST : [{
            tipo: "NAO_ENCONTRADO",
            fundamento: "Mantido como Antecipação Parcial por decisão do usuário",
          }];
        } else {
          analise = original;
        }
        return {...p, _analiseOriginal: original, analise};
      });
      const calcs = novos.map(pr => calcularProdComFCP(pr, orig, dest, modoCalculo));
      setCalculos(calcs);
      return novos;
    });
  }, [nota, ufOrigem, ufDestino, modoCalculo]);

  const analisar=useCallback((xmlStr,ufO,ufD)=>{
    const xml=xmlStr||xmlInput;
    if(!xml.trim()){setErro("Cole ou carregue o XML da NF-e antes de analisar.");return;}
    const{nota:n,produtos:p,erro:e}=parsearNFe(xml);
    if(e){setErro(e);return;}
    if(!n||!p.length){setErro("XML inválido ou sem produtos encontrados.");return;}
    const orig=ufO||n.uf_origem||ufOrigem;
    const dest=ufD||n.uf_destino||ufDestino;
    const empId=empresaIdDe(n);
    const prods=p.map(pr=>({...pr,empresa_id:empId,analise:analisarProduto(pr,orig,dest)}));
    // Calcular ICMS automaticamente para cada produto
    const calcs=prods.map(pr=>calcularProdComFCP(pr,orig,dest,modoCalculo));
    const notaFinal={...n,uf_origem:orig,uf_destino:dest,modo_calculo:modoCalculo};
    setNota(notaFinal); setProdutos(prods); setCalculos(calcs); setErro(null); setAnalisado(true); setTab("calculo");
    setStDecisoes({});
    // Memória inteligente: registra a apuração automática dos NCMs ainda sem histórico
    try{
      const notaOrigem={numero:n.numero,serie:n.serie,chave_acesso:n.chave,data:n.data_emissao,uf_origem:orig,uf_destino:dest};
      // REGRA 1 — COBERTURA TOTAL: todo produto de toda nota entra na memória.
      prods.forEach((pr,i)=>{
        const c=calcs[i]||{};
        HistoricoApuracaoService.registrarAutomaticamenteNaMemoria({
          ncm:pr.ncm,descricao:pr.descricao,calculo:c,
          tipoCalculo:c._congelado?"MANUAL_CONGELADO":((c.metodo_pauta&&c.metodo_pauta!=="MVA")?"AUTOMATICO_PAUTA":"AUTOMATICO"),
          usuario:"SISTEMA_AUTOMATICO",notaOrigem,empresaId:empId,
          aliquotaInterestadual:getAliqInterestadual(orig,dest),
        });
      });
      setHistApuracoes(HistoricoApuracaoService.listar());
    }catch{/* histórico é auxiliar */}
    setHistorico(h=>{
      const entry={id:Date.now(),data:new Date().toLocaleString("pt-BR"),nota:notaFinal,produtos:prods,calculos:calcs,xml,modoCalculo};
      return [entry,...h].slice(0,20);
    });
    // Etapa auxiliar: expande abreviações comerciais por IA e reanalisa
    // (a IA nunca decide o status — apenas alimenta a comparação textual).
    DescricaoIAService.preparar(p.map(pr=>pr.descricao)).then(()=>{
      const prods2=p.map(pr=>({...pr,analise:analisarProduto(pr,orig,dest)}));
      const calcs2=prods2.map(pr=>calcularProdComFCP(pr,orig,dest,modoCalculo));
      setProdutos(prods2); setCalculos(calcs2);
    }).catch(()=>{});
  },[xmlInput,ufOrigem,ufDestino,modoCalculo]);
  useEffect(()=>{ analisarRef.current=analisar; },[analisar]);

  const[histApuracoes,setHistApuracoes]=useState([]);
  // mapa cnpj(dígitos) -> nome, para exibir empresas na memória protegida
  const empresasNomesMemoria=useMemo(()=>{
    const m={};
    Object.values(arquivo?.empresas||{}).forEach(e=>{
      const id=String(e?.cnpj||"").replace(/\D/g,"")||(e?.nome?`NOME:${String(e.nome).toUpperCase().trim()}`:"");
      if(id) m[id]=e?.nome?`${e.nome} · ${e.cnpj||"sem CNPJ"}`:id;
    });
    return m;
  },[arquivo]);
  const[histApuSel,setHistApuSel]=useState(null);
  useEffect(()=>{ setHistApuracoes(HistoricoApuracaoService.listar()); },[]);

  const carregarDoHistorico=(entry)=>{
    setNota(entry.nota); setProdutos(entry.produtos); setCalculos(entry.calculos||[]); setXmlInput(entry.xml);
    setAnalisado(true); setHistSel(entry.id); setTab("calculo"); setStDecisoes({});
  };

  const limparHistorico=(id)=>setHistorico(h=>h.filter(e=>e.id!==id));

  const reset=()=>{setXmlInput("");setNota(null);setProdutos([]);setCalculos([]);setErro(null);setAnalisado(false);setTab("importar");setBusca("");setExpandido(null);setStDecisoes({});};


  const stats=useMemo(()=>{
    const total=produtos.length;
    const isentos=produtos.filter(p=>p.analise.some(a=>a.tipo==="ISENCAO")).length;
    const comST=produtos.filter(p=>p.analise.some(a=>a.tipo==="ICMS_ST")).length;
    const comBeneficio=produtos.filter(p=>p.analise.some(a=>a.tipo==="REDUCAO_BC")).length;
    const semRegra=produtos.filter(p=>p.analise.every(a=>a.tipo==="NAO_ENCONTRADO")).length;
    const totalICMSNF=calculos.reduce((s,c)=>s+(c.valor_icms_proprio||0),0);
    const totalICMSCalc=calculos.reduce((s,c)=>s+(c.valor_icms_total||0),0);
    const totalICMSST=calculos.reduce((s,c)=>s+(c.tributacao==="ICMS_ST"?(c.valor_icms_st||0):0),0);
    const totalAntecipacao=calculos.reduce((s,c)=>s+(c.tributacao==="ANTECIPACAO"?(c.valor_icms_st||0):0),0);
    const totalDIFAL=calculos.reduce((s,c)=>s+(c.valor_difal||0),0);
    const totalEconomia=calculos.reduce((s,c)=>s+(c.economia||0),0);
    const totalFCP=calculos.reduce((s,c)=>s+(c.valor_fcp||0)+(c.valor_fcp_st||0),0);
    const temPresuncaoICMSNF=calculos.some(c=>c.icms_foi_presumido||c.icms_proprio_presumido);
    return{total,isentos,comST,comBeneficio,semRegra,totalICMSNF,totalICMSCalc,totalICMSST,totalAntecipacao,totalDIFAL,totalEconomia,totalFCP,temPresuncaoICMSNF};
  },[produtos,calculos]);

  const prodsFiltrados=useMemo(()=>produtos.filter(p=>{
    const mb=!busca||p.descricao.toLowerCase().includes(busca.toLowerCase())||p.ncm.includes(busca)||p.cest.includes(busca);
    const mf=filtroTipo==="TODOS"||p.analise.some(a=>a.tipo===filtroTipo);
    return mb&&mf;
  }),[produtos,busca,filtroTipo]);

  const TABS=[
    {id:"importar",icon:"📂",label:"Importar NF-e"},
    {id:"danfe",icon:"📥",label:"Consultar DANFE"},
    {id:"analise",icon:"🔍",label:"Análise Fiscal",disabled:!analisado},
    {id:"calculo",icon:"🧾",label:"Cálculo ICMS",disabled:!analisado},
    {id:"calculadora",icon:"🧮",label:"Calculadora ST"},
    {id:"consulta",icon:"🔎",label:"Consulta NCM"},
    {id:"historico",icon:"📋",label:`Histórico${historico.length?` (${historico.length})`:""}`,},
    {id:"arquivo",icon:"🗄️",label:`Arquivo Fiscal${Object.keys(arquivo).length?` (${Object.keys(arquivo).length})`:""}`},
    {id:"obsidian",icon:"🔒",label:"Memória Protegida"},
  ];


  const fmt=(v)=>"R$ "+parseFloat(v||0).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2});

  return(
    <div style={S.app} className="fisco-app">
      {/* HEADER */}
      <header style={S.hdr}>
        <div style={{display:"flex",alignItems:"center",gap:12,minWidth:0}}>
          <span style={S.logoMark}>⚖️</span>
          <div style={{minWidth:0}}>
            <div style={S.logo}>
              <span>FiscoAI</span>
              <span style={S.badge}>v3</span>
            </div>
            <div style={{fontSize:10,color:C.muted,letterSpacing:"0.04em",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>
              Inteligência tributária · RICMS/BA · Conv. 52/91 · 101/97 · 142/18
            </div>
          </div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
          {analisado&&<span style={{...S.badge,background:`rgba(${C.green},0.12)`,color:`rgb(${C.green})`,borderColor:`rgba(${C.green},0.3)`}}>{produtos.length} produtos</span>}
          {analisado&&<button style={S.btn("pdf")} onClick={()=>exportarRelatorioPDF(nota,produtos,calculos)}>📄 PDF</button>}
          {analisado&&<button style={S.btn("primary")} onClick={salvarNoArquivo}>💾 Salvar</button>}
          {analisado&&<button style={S.btn("success")} onClick={()=>exportarCSV(nota,produtos,calculos)}>⬇️ CSV</button>}
          {analisado&&<button style={S.btn("ghost")} onClick={reset}>🔄 Nova</button>}
        </div>
      </header>

      <div style={S.shell} className="fisco-shell">
        {/* SIDEBAR */}
        <aside style={S.sidebar}>
          <div style={{fontSize:9.5,fontWeight:700,color:C.muted,letterSpacing:"0.12em",textTransform:"uppercase",padding:"4px 12px 8px"}}>Navegação</div>
          {TABS.map(t=>(
            <button key={t.id} style={S.navItem(tab===t.id,t.disabled)} onClick={()=>!t.disabled&&setTab(t.id)} disabled={t.disabled} title={t.disabled?"Analise uma NF-e primeiro":t.label}>
              <span style={{fontSize:15,width:20,textAlign:"center"}}>{t.icon}</span>
              <span style={{flex:1,minWidth:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.label}</span>
              {tab===t.id&&<span style={{width:6,height:6,borderRadius:999,background:`rgb(${C.blue})`,boxShadow:`0 0 10px rgb(${C.blue})`}}/>}
            </button>
          ))}
          <div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,fontSize:10,color:C.muted,lineHeight:1.6,padding:"10px 12px 4px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <span style={{width:7,height:7,borderRadius:999,background:`rgb(${C.green})`}} className="animate-softPulse"/>
              Motores tributários ativos
            </div>
          </div>
        </aside>

        <main style={S.main} className="animate-fadeIn" key={tab}>


        {/* ═══════════ IMPORTAR ═══════════ */}
        {tab==="importar"&&(
          <>
            {erro&&<div style={S.alert("error")}>❌ {erro}</div>}
            <div style={{display:"grid",gridTemplateColumns:"minmax(0, 1fr)",alignItems:"start"}}>
              <div style={S.card}>
                <div style={S.cardTitle}>📄 Importar XML da NF-e</div>
                <div style={{display:"flex",gap:6,marginBottom:14}}>
                  {[["drag","📂 Arquivo"],["colar","✏️ Colar XML"]].map(([m,l])=>(
                    <button key={m} style={{...S.btn(modoUpload===m?"primary":"ghost"),fontSize:12,padding:"6px 14px"}} onClick={()=>setModoUpload(m)}>{l}</button>
                  ))}
                </div>
                {modoUpload==="drag"?(
                  <DropZone onFiles={handleFilesUpload} disabled={loteStatus?.processando} />
                ):(
                  <textarea style={{...S.textarea,minHeight:260}} placeholder="Cole aqui o XML da NF-e (padrão SEFAZ)..." value={xmlInput} onChange={e=>{setXmlInput(e.target.value);setErro(null);}} />
                )}
                {xmlInput&&(
                  <div style={{marginTop:6,fontSize:11,color:C.muted}}>
                    ✅ XML carregado — {(xmlInput.length/1024).toFixed(1)} KB
                  </div>
                )}
                <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
                  <button style={S.btn("primary")} onClick={()=>analisar()}>🔍 Analisar e Calcular ICMS</button>
                  <button style={S.btn("ghost")} onClick={()=>{setXmlInput(XML_EXEMPLO);setModoUpload("colar");setErro(null);}}>⭐ Carregar Exemplo</button>
                  {xmlInput&&<button style={S.btn("ghost")} onClick={()=>setXmlInput("")}>Limpar</button>}
                </div>

                {loteStatus?.processando&&(
                  <div style={{...S.alert("info"),marginTop:14,fontSize:12}}>⏳ Processando lote de {loteStatus.total} arquivo(s)…</div>
                )}
                {loteStatus&&!loteStatus.processando&&(
                  <div style={{marginTop:14,paddingTop:14,borderTop:`1px dashed ${C.border}`}}>
                    <div style={{fontSize:13,fontWeight:700,color:`rgb(${C.green})`,marginBottom:8}}>📦 Resultado do lote</div>
                    <div style={S.alert(loteStatus.erro?(loteStatus.ok?"warn":"error"):"success")}>
                      ✅ {loteStatus.ok} NF-e salvas · ❌ {loteStatus.erro} erro(s) · 🏢 {loteStatus.empresas.length} empresa(s) atualizada(s) · 📋 adicionadas ao Histórico
                    </div>
                    <div style={{maxHeight:180,overflow:"auto",marginTop:8,border:`1px solid ${C.border}`,borderRadius:8,padding:8,background:"rgba(0,0,0,0.15)"}}>
                      {loteStatus.detalhes.map((d,i)=>(
                        <div key={i} style={{fontSize:11,padding:"3px 0",color:d.status==="ok"?"#68d391":"#fc8181",fontFamily:"ui-monospace,monospace"}}>
                          {d.status==="ok"?"✔":"✖"} {d.arquivo} {d.status==="ok"?`→ NF-e ${d.numero} · ${d.empresa} · ${labelMesAno(d.mesAno)}`:`— ${d.motivo}`}
                        </div>
                      ))}
                    </div>
                    <div style={{marginTop:10,display:"flex",gap:8,flexWrap:"wrap"}}>
                      <button style={S.btn("primary")} onClick={()=>setTab("historico")}>📋 Ver Histórico</button>
                      <button style={S.btn("ghost")} onClick={()=>setTab("arquivo")}>🗄️ Abrir Arquivo Fiscal</button>
                      <button style={S.btn("ghost")} onClick={()=>setLoteStatus(null)}>Limpar</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {/* ═══════════ CONSULTAR DANFE (API MeuDanfe) ═══════════ */}
        {tab==="danfe"&&(
          <DanfeConsulta/>
        )}

        {/* ═══════════ ANÁLISE ═══════════ */}
        {tab==="analise"&&analisado&&(
          <>
            {nota&&(
              <div style={S.card}>
                <div style={S.cardTitle}>📄 Dados da NF-e</div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:10}}>
                  {[["Nº / Série",`${nota.numero||"—"} / ${nota.serie||"—"}`],["Emissão",nota.data_emissao?.substring(0,10)||"—"],["Natureza",nota.natureza_operacao||"—"],["UF Origem→Destino",`${nota.uf_origem||"—"} → ${nota.uf_destino||"—"}`],["Emitente",nota.emitente_nome||"—"],["Destinatário",nota.destinatario_nome||"—"]].map(([l,v])=>(
                    <div key={l}><div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.04em"}}>{l}</div><div style={{fontSize:12,color:C.text,marginTop:2}}>{v}</div></div>
                  ))}
                </div>
              </div>
            )}
            <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
              <input style={{...S.inp,maxWidth:260}} placeholder="Buscar descrição, NCM ou CEST..." value={busca} onChange={e=>setBusca(e.target.value)} />
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                {[["TODOS","Todos"],["ISENCAO","Isenção"],["ICMS_ST","ICMS-ST"],["REDUCAO_BC","Redução BC"],["NAO_ENCONTRADO","Sem Regra"]].map(([k,l])=>(
                  <button key={k} style={S.tab(filtroTipo===k)} onClick={()=>setFiltroTipo(k)}>{l}</button>
                ))}
              </div>
              <button
                style={{...S.btn(auditMode?"primary":"ghost"),fontSize:11,padding:"6px 14px",marginLeft:"auto"}}
                onClick={()=>setAuditMode(v=>!v)}
                title="Mostra, por item, todas as regras avaliadas, por que cada uma foi aceita/rejeitada e qual PDF/dataset originou o dado."
              >
                {auditMode?"🛡️ Auditoria: ON":"🛡️ Modo Auditoria"}
              </button>
            </div>
            <div style={S.card}>
              <div style={S.cardTitle}>📦 Produtos ({prodsFiltrados.length})</div>
              <div style={{overflowX:"auto"}}>
                <table style={S.table}>
                  <thead><tr>{["#","Cód.","Descrição","NCM","CEST","CFOP","Qtd","Valor","CST","Tributação",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                  <tbody>
                    {prodsFiltrados.map(p=>{
                      const tipos=[...new Set(p.analise.map(a=>a.tipo))];
                      const exp=expandido===p.seq;
                      return(
                        <>
                          <tr key={p.seq} style={{cursor:"pointer",background:exp?"rgba(99,179,237,0.03)":"transparent"}} onClick={()=>setExpandido(exp?null:p.seq)}>
                            <td style={{...S.td,color:C.muted,fontWeight:700}}>{p.seq}</td>
                            <td style={{...S.td,fontFamily:"monospace",fontSize:11,color:C.sub}}>{p.codigo}</td>
                            <td style={{...S.td,maxWidth:200}}><div style={{fontWeight:600,color:C.text}}>{p.descricao}</div></td>
                            <td style={S.td}><span style={S.tag}>{p.ncm}</span></td>
                            <td style={{...S.td,fontFamily:"monospace",fontSize:10,color:C.muted}}>{p.cest||"—"}</td>
                            <td style={{...S.td,fontFamily:"monospace",fontSize:11,color:C.sub}}>{p.cfop||"—"}</td>
                            <td style={{...S.td,color:C.text}}>{p.quantidade}</td>
                            <td style={{...S.td,fontWeight:700,color:"#68d391",whiteSpace:"nowrap"}}>R$ {p.valor_total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</td>
                            <td style={{...S.td,fontFamily:"monospace",fontSize:11,color:C.sub}}>{p.cst||"—"}</td>
                            <td style={S.td}><div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{tipos.map(t=><Chip key={t} tipo={t}/>)}</div></td>
                            <td style={{...S.td,color:C.muted,fontSize:16}}>{exp?"▲":"▼"}</td>
                          </tr>
                          {exp&&(
                            <tr key={p.seq+"-d"}>
                              <td colSpan={11} style={{padding
:"0 12px 14px",background:"rgba(0,0,0,0.12)"}}>
                                <div style={{paddingTop:8}}>
                                  <div style={{fontSize:11,fontWeight:700,color:C.muted,marginBottom:6,textTransform:"uppercase",letterSpacing:"0.05em"}}>Resultado da Análise Fiscal</div>
                                  {p.analise.map((r,i)=><RegraCard key={i} regra={r}/>)}
                                  {(() => {
                                    const base = p._analiseOriginal || p.analise;
                                    const sug = base.find(a => a.tipo === "ST_SUGERIDA");
                                    if (!sug) return null;
                                    const decisao = stDecisoes[p.seq];
                                    const isVal = decisao === "VALIDADA";
                                    const isMant = decisao === "MANTIDA";
                                    return (
                                      <div style={{marginTop:10,padding:12,borderRadius:10,background:`rgba(${C.yellow},0.06)`,border:`1px solid rgba(${C.yellow},0.35)`}}>
                                        <div style={{fontSize:12,fontWeight:800,color:`rgb(${C.yellow})`,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>
                                          ⚖️ Decisão do usuário — ICMS-ST sugerido
                                        </div>
                                        <div style={{fontSize:11,color:C.muted,lineHeight:1.5,marginBottom:10}}>
                                          O motor sugeriu ICMS-ST para este item (score {sug.score}/100 · {sug.status}). Escolha entre validar a sugestão (o cálculo passa a usar ICMS-ST) ou manter como <strong>Antecipação Parcial</strong> (comportamento padrão sem confirmação).
                                        </div>
                                        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                          <button
                                            style={{...S.btn(isVal?"primary":"ghost"),fontSize:11,padding:"7px 14px"}}
                                            onClick={(e)=>{e.stopPropagation();decidirST(p.seq,"VALIDADA");}}
                                          >✅ Validar como ST</button>
                                          <button
                                            style={{...S.btn(isMant?"primary":"ghost"),fontSize:11,padding:"7px 14px"}}
                                            onClick={(e)=>{e.stopPropagation();decidirST(p.seq,"MANTIDA");}}
                                          >📋 Manter como Antecipação</button>
                                          {decisao && (
                                            <button
                                              style={{...S.btn("ghost"),fontSize:11,padding:"7px 14px"}}
                                              onClick={(e)=>{e.stopPropagation();decidirST(p.seq,null);}}
                                            >↩ Reverter decisão</button>
                                          )}
                                        </div>
                                        {decisao && (
                                          <div style={{marginTop:8,fontSize:11,color:C.text,background:"rgba(0,0,0,0.15)",padding:"6px 10px",borderRadius:6}}>
                                            {isVal
                                              ? "✅ Validado como ICMS-ST — o cálculo foi recomputado usando a sugestão do motor."
                                              : "📋 Mantido como Antecipação Parcial — a sugestão foi apenas registrada e o cálculo segue pela regra padrão."}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  {(() => {
                                    const base = p._analiseOriginal || p.analise;
                                    const cls = (p.analise && p.analise._classificacao_v2) || (base && base._classificacao_v2);
                                    const temSugestao = (base || []).some?.(a => a.tipo === "ST_SUGERIDA");
                                    const status = cls?.status;
                                    if (status !== "REVISAO_NECESSARIA" && !(status === "ST_SUGERIDA" || temSugestao)) return null;
                                    const msg = confirmMsg[p.seq];
                                    return (
                                      <div style={{marginTop:10,padding:12,borderRadius:10,background:"rgba(99,179,237,0.05)",border:`1px solid rgba(${C.blue},0.3)`}}>
                                        <div style={{fontSize:12,fontWeight:800,color:`rgb(${C.blue})`,marginBottom:4,textTransform:"uppercase",letterSpacing:"0.04em"}}>
                                          🧠 Classificação validada manualmente
                                        </div>
                                        <div style={{fontSize:11,color:C.muted,lineHeight:1.5,marginBottom:10}}>
                                          Status atual: <strong>{status || "ST_SUGERIDA"}</strong>. Confirmar grava o padrão (NCM {p.ncm||"—"} + descrição normalizada) para que itens futuros iguais sejam classificados automaticamente, sem nova revisão.
                                        </div>
                                        <button
                                          style={{...S.btn("ghost"),fontSize:11,padding:"7px 14px"}}
                                          onClick={(e)=>{e.stopPropagation();setConfirmMod({seq:p.seq,ncm:p.ncm,descricao:p.descricao,regraId:cls?.regra?.id||null});}}
                                        >🧠 Confirmar classificação</button>
                                        {msg && (
                                          <div style={{marginTop:8,fontSize:11,color:C.text,background:"rgba(0,0,0,0.15)",padding:"6px 10px",borderRadius:6}}>{msg}</div>
                                        )}
                                      </div>
                                    );
                                  })()}
                                  {auditMode && p.analise.auditoria && (
                                    <div style={{marginTop:14,background:"rgba(99,179,237,0.04)",border:`1px dashed rgba(${C.blue},0.35)`,borderRadius:10,padding:12}}>
                                      <div style={{fontSize:11,fontWeight:800,color:`rgb(${C.blue})`,marginBottom:8,textTransform:"uppercase",letterSpacing:"0.05em"}}>
                                        🛡️ Trilha de Auditoria — Item #{p.seq}
                                      </div>
                                      <div style={{fontSize:10,color:C.muted,marginBottom:8,lineHeight:1.5}}>
                                        Dados extraídos da NF-e: <strong>NCM</strong> {p.ncm||"—"} · <strong>CEST</strong> {p.cest||"—"} · <strong>CFOP</strong> {p.cfop||"—"} · <strong>CST</strong> {p.cst||"—"} · <strong>vICMS</strong> R$ {(p.valor_icms||0).toFixed(2)} · <strong>vPMC</strong> {p.vPMC?`R$ ${p.vPMC.toFixed(2)} (${p.pmc_origem||"tag"})`:"—"}
                                      </div>
                                      {p.analise.auditoria.length===0 && (
                                        <div style={{fontSize:11,color:C.muted,fontStyle:"italic"}}>Nenhuma regra do dataset apresentou score &gt; 0 para este item.</div>
                                      )}
                                      <div style={{display:"grid",gap:6}}>
                                        {p.analise.auditoria.map((a,idx)=>{
                                          const cor = a.decisao==="ACEITA"?C.green : a.decisao==="REJEITADA"?C.yellow : a.decisao==="DESCARTADA"?"252,129,129" : a.decisao==="SUGESTAO_MOTOR_ST"?C.blue : C.muted;
                                          return (
                                            <div key={idx} style={{background:"rgba(0,0,0,0.25)",borderLeft:`3px solid rgba(${cor},0.6)`,padding:"6px 10px",borderRadius:4}}>
                                              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",fontSize:10}}>
                                                <span style={{color:`rgb(${cor})`,fontWeight:800,letterSpacing:"0.05em"}}>{a.decisao}</span>
                                                <span style={{fontFamily:"monospace",color:C.sub}}>{a.regra_id}</span>
                                                <span style={S.tag}>{a.tipo}</span>
                                                {a.ncm_regra && <span style={{color:C.muted}}>NCM: <strong>{a.ncm_regra}</strong></span>}
                                                {a.cest_regra && a.cest_regra!=="—" && <span style={{color:C.muted}}>CEST: <strong>{a.cest_regra}</strong></span>}
                                                <span style={{color:C.muted}}>score <strong style={{color:`rgb(${cor})`}}>{a.score}</strong></span>
                                                {a.match_por?.length>0 && <span style={{color:C.muted}}>por {a.match_por.join("+")}</span>}
                                              </div>
                                              <div style={{fontSize:11,color:C.sub,marginTop:3}}>{a.motivo}</div>
                                              {a.fonte_pdf && a.fonte_pdf!=="—" && <div style={{fontSize:10,color:`rgb(${C.blue})`,marginTop:2}}>📄 Fonte: {a.fonte_pdf}</div>}
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  )}
                                  {p.base_icms>0&&(
                                    <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:7,marginTop:10}}>
                                      {[["Base ICMS na NF",`R$ ${p.base_icms.toLocaleString("pt-BR",{minimumFractionDigits:2})}`],["Alíquota ICMS na NF",`${p.icms_presumido_valor>0?p.icms_presumido_aliq:p.aliquota_icms}%${p.icms_presumido_valor>0?" (presum.)":""}`],["Valor ICMS na NF",`R$ ${(p.icms_presumido_valor>0?p.icms_presumido_valor:(p.valor_icms||0)).toLocaleString("pt-BR",{minimumFractionDigits:2})}${p.icms_presumido_valor>0?" (presum.)":""}`]].map(([l,v])=>(
                                        <div key={l} style={{background:"rgba(255,255,255,0.03)",borderRadius:6,padding:"8px 11px"}}>
                                          <div style={{fontSize:10,color:C.muted}}>{l}</div>
                                          <div style={{fontSize:13,fontWeight:700,color:C.text,marginTop:2}}>{v}</div>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                    {!prodsFiltrados.length&&(
                      <tr><td colSpan={11} style={{...S.td,textAlign:"center",color:C.muted,padding:28}}>Nenhum produto encontrado com os filtros aplicados.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ═══════════ CÁLCULO ICMS ═══════════ */}
        {tab==="calculo"&&analisado&&(
          <>
            {/* Resumo de totais */}
            <div style={{...S.statsGrid,gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",marginBottom:20}}>
              <Stat label="Total Produtos"      value={stats.total}                                                                                    col={C.blue}/>
              <Stat label="Valor Total NF"      value={`R$ ${produtos.reduce((s,p)=>s+p.valor_total,0).toLocaleString("pt-BR",{minimumFractionDigits:2})}`} col={C.blue}/>
              <Stat label="ICMS na NF"          value={fmt(stats.totalICMSNF) + (stats.temPresuncaoICMSNF ? " (presum.)" : "")}                           col={C.gray}  sub="original"/>
              <Stat label="ICMS Calculado"      value={fmt(stats.totalICMSCalc)}                                                                       col={C.green} sub="após regras"/>
              <Stat label="ICMS-ST a Recolher"  value={fmt(stats.totalICMSST)}                                                                         col={C.blue}  sub="RICMS/BA"/>
              <Stat label="ICMS Antecipação"    value={fmt(stats.totalAntecipacao)}                                                                    col={C.yellow} sub="parcial BA"/>
              <Stat label="DIFAL a Recolher"    value={fmt(stats.totalDIFAL)}                                                                          col={C.blue}  sub="EC 87/15"/>
              <Stat label="FCP a Recolher"      value={fmt(stats.totalFCP)}                                                                            col={C.yellow} sub="Fundo Combate Pobreza"/>
              <Stat label="Economia Fiscal"     value={fmt(stats.totalEconomia)}                                                                       col={C.green} sub="benefícios"/>
            </div>

            {/* Alerta informativo */}
            <div style={{...S.alert("warn"),marginBottom:16}}>
              ℹ️ Os valores abaixo foram calculados automaticamente com base nas regras fiscais identificadas na análise. Alíquota interna BA: <strong>20,5%</strong>. Verifique sempre com a legislação vigente antes de emitir documentos fiscais.
            </div>

            {/* Botão exportar PDF */}
            <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16,gap:8}}>
              <button style={S.btn("pdf")} onClick={()=>exportarRelatorioPDF(nota,produtos,calculos)}>
                📄 Exportar Relatório PDF
              </button>
              <button style={S.btn("success")} onClick={()=>exportarCSV(nota,produtos,calculos)}>
                ⬇️ Exportar CSV
              </button>
            </div>

            {/* Barra de recálculo manual (seleção múltipla) */}
            <div style={{...S.card,marginBottom:12,padding:"12px 14px",display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
              <strong style={{fontSize:12,color:C.text}}>🛠️ Recalcular manualmente</strong>
              <span style={{fontSize:11,color:C.muted}}>{selCalc.size} produto(s) selecionado(s)</span>
              <button style={{...S.btn("ghost"),fontSize:11,padding:"4px 10px"}} onClick={()=>setSelCalc(new Set(produtos.map(p=>p.seq)))}>Selecionar todos</button>
              <button style={{...S.btn("ghost"),fontSize:11,padding:"4px 10px"}} onClick={()=>setSelCalc(new Set())}>Limpar</button>
              <button
                style={{...S.btn(selCalc.size?"primary":"ghost"),fontSize:11,padding:"4px 12px"}}
                disabled={!selCalc.size}
                onClick={()=>setModalRecalc({modo:"ICMS_ST",mva:"",mvaAj:false})}
              >Alterar cálculo selecionado</button>
              {(()=>{
                const congeladosSel=produtos.filter(p=>selCalc.has(p.seq)&&p.calculo_congelado?.ativo).length;
                const totalCongelados=produtos.filter(p=>p.calculo_congelado?.ativo).length;
                return (
                  <>
                    <span style={{fontSize:11,color:"#63b3ed"}}>❄️ {totalCongelados} congelado(s)</span>
                    <button
                      style={{...S.btn(congeladosSel?"primary":"ghost"),fontSize:11,padding:"4px 10px",marginLeft:"auto"}}
                      disabled={!congeladosSel}
                      title={congeladosSel?"Descongelar os produtos selecionados":"Selecione ao menos um produto congelado"}
                      onClick={()=>{
                        if(!window.confirm(`Deseja descongelar ${congeladosSel} produto(s)? O cálculo voltará ao automático.`))return;
                        const seqs=new Set(selCalc);
                        const orig=nota?.uf_origem||ufOrigem, dest=nota?.uf_destino||ufDestino;
                        setProdutos(prods=>{
                          const novos=prods.map(p=>{
                            if(!seqs.has(p.seq)||!p.calculo_congelado?.ativo)return p;
                            return {...CongelamentoService.descongelarCalculo(p),decisao_manual:{modo:"AUTO",alterado_em:new Date().toISOString()}};
                          });
                          const calcs=novos.map(pr=>calcularProdComFCP(pr,orig,dest,modoCalculo));
                          setCalculos(calcs);
                          if(nota){const {next}=upsertRegistroArquivo(arquivo,nota,novos,calcs);setArquivo(next);}
                          setArqMsg({tipo:"ok",txt:`${congeladosSel} produto(s) descongelado(s) — voltando ao cálculo automático.`});
                          setTimeout(()=>setArqMsg(null),4000);
                          return novos;
                        });
                        setSelCalc(new Set());
                      }}
                    >↺ Voltar ao automático</button>
                  </>
                );
              })()}

            </div>


            {/* Modal de confirmação de classificação validada */}
            {confirmMod&&(
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setConfirmMod(null)}>
                <div style={{...S.card,maxWidth:520,width:"100%"}} onClick={e=>e.stopPropagation()}>
                  <div style={S.cardTitle}>🧠 Confirmar classificação — item #{confirmMod.seq}</div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:12,lineHeight:1.5}}>
                    NCM <strong>{confirmMod.ncm||"—"}</strong> · {confirmMod.descricao}
                    <br/>A decisão será gravada e aplicada automaticamente a produtos futuros com o mesmo padrão.
                  </div>
                  <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                    <button style={{...S.btn("primary"),fontSize:11,padding:"7px 14px"}} onClick={()=>confirmarClassificacao(confirmMod,"ST_CONFIRMADA")}>✅ ST_CONFIRMADA</button>
                    <button style={{...S.btn("ghost"),fontSize:11,padding:"7px 14px"}} onClick={()=>confirmarClassificacao(confirmMod,"NAO_ENQUADRADO")}>🚫 NAO_ENQUADRADO</button>
                    <button style={{...S.btn("ghost"),fontSize:11,padding:"7px 14px"}} onClick={()=>setConfirmMod(null)}>Cancelar</button>
                  </div>
                </div>
              </div>
            )}

            {/* Modal de recálculo manual */}
            {modalRecalc&&(
              <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.7)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={()=>setModalRecalc(null)}>
                <div style={{...S.card,maxWidth:560,width:"100%"}} onClick={e=>e.stopPropagation()}>
                  <div style={S.cardTitle}>🛠️ Recalcular {selCalc.size} produto(s)</div>
                  <div style={{fontSize:11,color:C.muted,marginBottom:10}}>Escolha o modo de cálculo. A alteração será salva automaticamente no Arquivo Fiscal.</div>
                  <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
                    {[["ICMS_ST","ICMS-ST"],["ANTECIPACAO","Antecipação Parcial"],["DIFAL","DIFAL"],["ISENTO","Isento (cesta básica)"],["NAO_TRIBUTADO","Não Tributado (cesta básica)"]].map(([k,l])=>(
                      <button key={k} style={{...S.btn(modalRecalc.modo===k?"primary":"ghost"),fontSize:11,padding:"6px 12px"}} onClick={()=>setModalRecalc({...modalRecalc,modo:k})}>{l}</button>
                    ))}
                  </div>
                  {modalRecalc.modo==="ICMS_ST"&&(
                    <div style={{marginBottom:12}}>
                      <div style={{fontSize:11,color:C.muted,marginBottom:4}}>MVA aplicável (%) *</div>
                      <input style={S.inp} type="number" step="0.01" min="0" max="1000" value={modalRecalc.mva} onChange={e=>setModalRecalc({...modalRecalc,mva:e.target.value})} placeholder="Ex: 45.67"/>
                      <label style={{display:"flex",gap:6,alignItems:"center",marginTop:8,fontSize:11,color:C.muted}}>
                        <input type="checkbox" checked={modalRecalc.mvaAj} onChange={e=>setModalRecalc({...modalRecalc,mvaAj:e.target.checked})}/>
                        A MVA informada já está ajustada
                      </label>
                    </div>
                  )}
                  {/* === FCP em Lote === */}
                  <div style={{marginBottom:12,borderTop:`1px solid ${C.border}`,paddingTop:12}}>
                    <div style={{fontSize:11,fontWeight:"bold",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>🛡️ Fundo de Combate à Pobreza (FCP)</div>
                    <label style={{display:"flex",gap:8,alignItems:"center",marginBottom:8,fontSize:11,cursor:"pointer"}}>
                      <input type="checkbox" checked={!!modalRecalc.fcpAtivo} onChange={e=>setModalRecalc({...modalRecalc,fcpAtivo:e.target.checked})}/>
                      <span>Aplicar FCP em lote</span>
                    </label>
                    {modalRecalc.fcpAtivo&&(
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <input style={{...S.inp,width:120}} type="number" step="0.01" min="0" max="15" value={modalRecalc.fcpPct??""} onChange={e=>setModalRecalc({...modalRecalc,fcpPct:parseFloat(e.target.value)||0})} placeholder="Percentual"/>
                        <span style={{fontSize:10,color:C.muted}}>% sobre todos os itens selecionados</span>
                      </div>
                    )}
                  </div>
                  <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                    <button style={S.btn("ghost")} onClick={()=>setModalRecalc(null)}>Cancelar</button>
                    <button style={S.btn("primary")} onClick={()=>{
                      if(modalRecalc.modo==="ICMS_ST"){
                        const m=parseFloat(modalRecalc.mva);
                        if(isNaN(m)||m<0||m>1000){alert("Informe uma MVA válida (0-1000%).");return;}
                      }
                      const seqs=new Set(selCalc);
                      const orig=nota?.uf_origem||ufOrigem, dest=nota?.uf_destino||ufDestino;
                      const base={modo:modalRecalc.modo,mva_informada:modalRecalc.modo==="ICMS_ST"?parseFloat(modalRecalc.mva):null,mva_ja_ajustada:!!modalRecalc.mvaAj,forcar_st:true,alterado_em:new Date().toISOString()};
                      const notaOrigem=nota?{numero:nota.numero,chave_acesso:nota.chave,data:nota.data_emissao,uf_origem:orig,uf_destino:dest}:null;
                      const fcpAplicados={};
                      const rodar=(dmAtual)=>{
                        const novos=[];
                        const calcs=[];
                        produtos.forEach(p=>{
                          if(!seqs.has(p.seq)){
                            novos.push(p);
                            calcs.push(calcularProdComFCP(p,orig,dest,p.decisao_manual?.modo==="DIFAL"?"DIFAL":modoCalculo));
                            return;
                          }
                          const alvo={...p,decisao_manual:dmAtual};
                          const fcpLote=(modalRecalc.fcpAtivo&&modalRecalc.fcpPct>0)?modalRecalc.fcpPct:null;
                          const fcpPct=fcpLote!=null?fcpLote:(fcpPorProduto?.[p.seq]?.ativo?(fcpPorProduto[p.seq].percentual||0):0);
                          if(fcpLote!=null)fcpAplicados[p.seq]={ativo:true,percentual:fcpLote};
                          const cru=calcularCru(alvo,orig,dest,dmAtual.modo==="DIFAL"?"DIFAL":modoCalculo,fcpPct);
                          const jaCongelado=!!p.calculo_congelado?.ativo;
                          const motivo=`Usuário recalculou como ${dmAtual.modo}${dmAtual.mva_informada!=null?` · MVA informada ${dmAtual.mva_informada}%`:""}${fcpLote!=null?` · FCP ${fcpLote}%`:""}`;
                          const empresaIdProd=p.empresa_id||empresaIdDe(nota);
                          const congelado=CongelamentoService.congelarCalculoComMemoria(alvo,cru,motivo,usuarioAtual,empresaIdProd);
                          const calcExib=CongelamentoService.obterCalculoExibivel(congelado,cru);
                          novos.push(congelado);
                          calcs.push(calcExib);
                          // Histórico de apuração por NCM
                          if(jaCongelado){
                            HistoricoApuracaoService.registrarAlteracaoApuracao({
                              ncm:p.ncm,
                              de:{tributacao:p.calculo_congelado.tributacao,mva:p.calculo_congelado.parametros_utilizados?.mva_utilizada,valor:p.calculo_congelado.valor_icms_st},
                              para:{tributacao:calcExib.tributacao,mva:calcExib.mva_utilizada,valor:calcExib.valor_icms_st},
                              motivo,usuario:usuarioAtual,empresaId:p.empresa_id||empresaIdDe(nota),
                            });
                          }
                          HistoricoApuracaoService.registrarAutomaticamenteNaMemoria({
                            ncm:p.ncm,descricao:p.descricao,calculo:calcExib,
                            tipoCalculo:"MANUAL_CONGELADO",usuario:usuarioAtual,notaOrigem,
                            empresaId:p.empresa_id||empresaIdDe(nota),
                            aliquotaInterestadual:getAliqInterestadual(ufOrigem,ufDestino),
                          });
                        });
                        return {novos,calcs};
                      };
                      const dm=base;
                      const {novos,calcs}=rodar(dm);
                      const forcados=calcs.reduce((a,c)=>a+((c?.alertas||[]).some(x=>x?.tipo==="CALC_MANUAL_FORCADO")?1:0),0);
                      setProdutos(novos);
                      setCalculos(calcs);
                      if(Object.keys(fcpAplicados).length)setFcpPorProduto(prev=>({...prev,...fcpAplicados}));
                      setHistApuracoes(HistoricoApuracaoService.listar());

                      const fcpMsg=(modalRecalc.fcpAtivo&&modalRecalc.fcpPct>0)?` + FCP ${modalRecalc.fcpPct}%`:"";
                      if(nota){
                        const {next}=upsertRegistroArquivo(arquivo,nota,novos,calcs);
                        setArquivo(next);
                        setArqMsg({tipo:forcados>0?"erro":"ok",txt:`${seqs.size} produto(s) recalculado(s) como ${dm.modo}${fcpMsg}${forcados>0?` · ${forcados} com cálculo FORÇADO apesar de vedação de CST`:""} · decisão registrada na Memória Protegida.`});
                        setTimeout(()=>setArqMsg(null),7000);
                      }
                      setSelCalc(new Set());
                      setModalRecalc(null);
                    }}>Concluído e recalcular</button>

                  </div>
                </div>
              </div>
            )}

            {/* Cards de cálculo por produto */}
            {produtos.map((p,i)=>(
              <div key={p.seq} style={{position:"relative"}}>
                <label style={{position:"absolute",top:10,right:10,zIndex:5,display:"flex",gap:5,alignItems:"center",fontSize:11,color:C.muted,background:"rgba(0,0,0,0.4)",padding:"3px 7px",borderRadius:6,cursor:"pointer"}}>
                  <input type="checkbox" checked={selCalc.has(p.seq)} onChange={e=>{const n=new Set(selCalc);if(e.target.checked)n.add(p.seq);else n.delete(p.seq);setSelCalc(n);}}/>
                  Selecionar
                </label>
                {p.decisao_manual&&p.decisao_manual.modo!=="AUTO"&&(
                  <div style={{position:"absolute",top:10,left:10,zIndex:5,fontSize:10,fontWeight:700,color:"#000",background:`rgb(${C.yellow})`,padding:"3px 8px",borderRadius:6}}>
                    🛠️ Cálculo manual: {p.decisao_manual.modo}
                  </div>
                )}
                {(calculos[i]?.alertas||[]).some(a=>a?.tipo==="CALC_MANUAL_BLOQUEADO")&&(()=>{
                  const al=(calculos[i].alertas||[]).find(a=>a?.tipo==="CALC_MANUAL_BLOQUEADO");
                  return (
                    <div style={{marginTop:8,marginBottom:-12,padding:"10px 12px",borderRadius:12,background:`rgba(${C.red},0.14)`,border:`1px solid rgba(${C.red},0.4)`,color:"#ffd9d9",fontSize:11.5,fontWeight:600,lineHeight:1.5}}>
                      ⚠️ Recálculo manual como ICMS-ST não aplicado — CST {al.cst||calculos[i]?.permissoes_cst?.codigo||"—"} impede esse cálculo ({al.motivo||al.mensagem}). O valor exibido é o automático.
                      {al.fundamento&&<div style={{fontWeight:400,color:C.sub,marginTop:4}}>Fundamento: {al.fundamento}</div>}
                    </div>
                  );
                })()}

                <CalcCard
                  produto={p}
                  calculo={calculos[i]||{}}
                  fcpConfig={fcpPorProduto[p.seq]}
                  popoverAberto={fcpPopover===p.seq}
                  onAbrirPopover={(seq)=>setFcpPopover(seq)}
                  onFecharPopover={()=>setFcpPopover(null)}
                  onToggleFCP={aplicarFCPProduto}
                />
              </div>
            ))}


            {/* Totais consolidados */}
            <div style={{...S.card,marginTop:8}}>
              <div style={S.cardTitle}>📊 Consolidado Final</div>
              <div style={{overflowX:"auto"}}>
                <table style={S.table}>
                  <thead>
                    <tr>
                      {["#","Produto","NCM","Valor Prod.","Tributação","Base ICMS","Alíq.","ICMS Próprio","ICMS-ST","Antecipação","ICMS Total","Economia"].map(h=>(
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {produtos.map((p,i)=>{
                      const c=calculos[i]||{};
                      return(
                        <tr key={p.seq} style={{cursor:"pointer"}} onClick={()=>setTab("analise")}>
                          <td style={{...S.td,color:C.muted,fontWeight:700}}>{p.seq}</td>
                          <td style={{...S.td,maxWidth:180}}><div style={{fontWeight:600,color:C.text,fontSize:12}}>{p.descricao}</div></td>
                          <td style={S.td}><span style={S.tag}>{p.ncm}</span></td>
                          <td style={{...S.td,fontWeight:700,color:"#68d391",whiteSpace:"nowrap"}}>{fmt(p.valor_total)}</td>
                          <td style={S.td}><Chip tipo={c.tributacao||"NORMAL"}/></td>
                          <td style={{...S.td,color:C.sub,whiteSpace:"nowrap"}}>{fmt(c.base_calc)}</td>
                          <td style={{...S.td,color:C.muted,whiteSpace:"nowrap"}}>{c.aliquota_aplicada ? `${parseFloat(c.aliquota_aplicada).toFixed(2).replace(".",",")}%` : "—"}</td>
                          <td style={{...S.td,color:C.sub,whiteSpace:"nowrap"}}>{fmt(c.valor_icms_proprio)}</td>
                          <td style={{...S.td,color:`rgb(${C.blue})`,fontWeight:700,whiteSpace:"nowrap"}}>{c.tributacao==="ICMS_ST"&&c.valor_icms_st>0?fmt(c.valor_icms_st):"—"}</td>
                          <td style={{...S.td,color:`rgb(${C.yellow})`,fontWeight:700,whiteSpace:"nowrap"}}>{c.tributacao==="ANTECIPACAO"&&c.valor_icms_st>0?fmt(c.valor_icms_st):"—"}</td>
                          <td style={{...S.td,fontWeight:700,color:"#68d391",whiteSpace:"nowrap"}}>{fmt(c.valor_icms_total)}</td>
                          <td style={{...S.td,color:c.economia>0?`rgb(${C.green})`:C.muted,fontWeight:c.economia>0?700:400,whiteSpace:"nowrap"}}>{c.economia>0?fmt(c.economia):"—"}</td>
                        </tr>
                      );
                    })}
                    {/* Linha de totais */}
                    <tr style={{background:"rgba(255,255,255,0.06)",fontWeight:700}}>
                      <td colSpan={3} style={{...S.td,color:C.text}}>TOTAIS</td>
                      <td style={{...S.td,color:"#68d391",whiteSpace:"nowrap"}}>{fmt(produtos.reduce((s,p)=>s+p.valor_total,0))}</td>
                      <td style={S.td}/>
                      <td style={S.td}/>
                      <td style={S.td}/>
                      <td style={{...S.td,color:C.sub,whiteSpace:"nowrap"}}>{fmt(calculos.reduce((s,c)=>s+(c.valor_icms_proprio||0),0))}</td>
                      <td style={{...S.td,color:`rgb(${C.blue})`,whiteSpace:"nowrap"}}>{fmt(stats.totalICMSST)}</td>
                      <td style={{...S.td,color:`rgb(${C.yellow})`,whiteSpace:"nowrap"}}>{fmt(stats.totalAntecipacao)}</td>
                      <td style={{...S.td,color:"#68d391",whiteSpace:"nowrap"}}>{fmt(stats.totalICMSCalc)}</td>
                      <td style={{...S.td,color:`rgb(${C.green})`,whiteSpace:"nowrap"}}>{fmt(stats.totalEconomia)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {/* ═══════════ CALCULADORA ST ═══════════ */}
        {tab==="calculadora"&&(
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(420px,1fr))",gap:20}}>
            <div style={S.card}>
              <div style={S.cardTitle}>🧮 Calculadora ICMS-ST</div>
              <div style={{...S.alert("warn"),marginBottom:16}}>
                ℹ️ Informe a MVA da tabela RICMS/BA (Anexo 1). A alíquota interna da BA é geralmente 20,5% ou 17%.
              </div>
              <CalculadoraST/>
            </div>
            <div style={S.card}>
              <div style={S.cardTitle}>🧮 Calculadora ICMS DIFAL</div>
              <div style={{...S.alert("warn"),marginBottom:16}}>
                ℹ️ Diferencial de Alíquotas (EC 87/2015) para operações interestaduais destinadas a consumidor final na BA. Cálculo com gross-up (base dupla).
              </div>
              <CalculadoraDIFAL/>
            </div>
          </div>
        )}

        {/* ═══════════ CONSULTA NCM ═══════════ */}
        {tab==="consulta"&&<ConsultaNCM/>}

        {tab==="obsidian"&&<MemoriaObsidian empresasNomes={empresasNomesMemoria}/>}



        {/* ═══════════ HISTÓRICO ═══════════ */}
        {tab==="historico"&&(
          <div style={{display:"grid",gridTemplateColumns:"minmax(0,320px) minmax(0,1fr)",gap:20,alignItems:"start"}}>
            <div style={{...S.card,position:"sticky",top:16,maxHeight:"calc(100vh - 120px)",overflowY:"auto"}}>
              <div style={S.cardTitle}>📋 Notas Analisadas</div>
              <div style={{display:"flex",gap:6,marginBottom:10}}>
                <input
                  value={histBusca}
                  onChange={e=>setHistBusca(e.target.value)}
                  placeholder="Pesquisar por nº da nota"
                  style={{flex:1,background:"rgba(255,255,255,0.04)",border:`1px solid ${C.border}`,borderRadius:8,padding:"7px 10px",color:C.text,fontSize:12,outline:"none"}}
                />
                <button style={{...S.btn("ghost"),padding:"6px 10px"}} onClick={()=>setHistBusca("")} title="Limpar pesquisa">🔍</button>
              </div>
              {!historico.length&&(
                <div style={{color:C.muted,fontSize:12,textAlign:"center",padding:"20px 0"}}>Nenhuma nota analisada ainda.</div>
              )}
              {(()=>{
                const termo=histBusca.replace(/\D/g,"");
                const filtrados=historico.filter(h=>!termo||String(h.nota.numero||"").replace(/\D/g,"").includes(termo));
                if(historico.length&&!filtrados.length)
                  return <div style={{color:C.muted,fontSize:12,textAlign:"center",padding:"16px 0"}}>Nenhuma nota com o número “{histBusca}”.</div>;
                const grupos=new Map();
                filtrados.forEach(h=>{
                  const nome=h.nota.destinatario_nome||"Sem destinatário";
                  const cnpj=h.nota.destinatario_cnpj||"";
                  const k=(cnpj.replace(/\D/g,"")||nome.toUpperCase());
                  if(!grupos.has(k)) grupos.set(k,{key:k,nome,cnpj,itens:[]});
                  grupos.get(k).itens.push(h);
                });
                const lista=[...grupos.values()];
                return (
                  <div style={{display:"grid",gap:8}}>
                    {lista.map(g=>{
                      const aberta=termo?true:histEmpresaAberta===g.key;
                      return (
                        <div key={g.key} style={{border:`1px solid ${aberta?"rgba(99,179,237,0.3)":C.border}`,borderRadius:10,background:aberta?`rgba(${C.blue},0.05)`:"rgba(255,255,255,0.02)",overflow:"hidden"}}>
                          <div
                            onClick={()=>setHistEmpresaAberta(aberta&&!termo?null:g.key)}
                            style={{display:"grid",gridTemplateColumns:"14px minmax(0,1fr) auto",alignItems:"center",gap:8,padding:"10px 11px",cursor:"pointer"}}
                          >
                            <span style={{fontSize:10,color:C.muted,transform:aberta?"rotate(90deg)":"none",transition:"transform 0.15s"}}>▶</span>
                            <div style={{minWidth:0}}>
                              <div style={{fontSize:11.5,fontWeight:800,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{g.nome}</div>
                              <div style={{fontSize:9.5,color:C.muted,fontFamily:"monospace",marginTop:2}}>{g.cnpj?formatCNPJ(g.cnpj):"—"}</div>
                            </div>
                            <span style={{fontSize:10,fontWeight:700,color:C.muted,background:"rgba(255,255,255,0.05)",borderRadius:20,padding:"2px 8px",whiteSpace:"nowrap"}}>{g.itens.length} NF</span>
                          </div>
                          {aberta&&(
                            <div style={{display:"grid",gap:6,padding:"0 8px 8px"}}>
                              {g.itens.map(h=>(
                                <div key={h.id} style={{...S.histItem(histSel===h.id),padding:"8px 9px",marginBottom:0}} onClick={()=>carregarDoHistorico(h)}>
                                  <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) auto",alignItems:"center",gap:8}}>
                                    <div style={{minWidth:0}}>
                                      <div style={{fontWeight:700,fontSize:11,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>NF {h.nota.numero||"—"} · {h.nota.uf_origem}→{h.nota.uf_destino}</div>
                                      <div style={{fontSize:10,color:C.muted,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginTop:2}}>{h.nota.emitente_nome||"Emitente"}</div>
                                      <div style={{fontSize:9,color:"rgba(160,174,192,0.5)",marginTop:2}}>{h.produtos.length} itens · {h.data}</div>
                                    </div>
                                    <button style={{...S.btn("danger"),padding:"1px 6px",fontSize:10,flexShrink:0}} onClick={e=>{e.stopPropagation();limparHistorico(h.id);}}>✕</button>
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {historico.length>0&&(
                <button style={{...S.btn("ghost"),width:"100%",justifyContent:"center",marginTop:8}} onClick={()=>{setHistorico([]);setHistSel(null);}}>
                  🗑️ Limpar histórico
                </button>
              )}
            </div>
            <div>
              {histSel?(()=>{
                const h=historico.find(x=>x.id===histSel);
                if(!h) return null;
                const calcs=h.calculos||[];
                const totalICMSCalc=calcs.reduce((s,c)=>s+(c.valor_icms_total||0),0);
                const totalEconomia=calcs.reduce((s,c)=>s+(c.economia||0),0);
                return(
                  <div style={S.card}>
                    <div style={S.cardTitle}>📄 {h.nota.emitente_nome} — NF {h.nota.numero}</div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:16}}>
                      {[["Data",h.data],["UF",`${h.nota.uf_origem}→${h.nota.uf_destino}`],["Itens",h.produtos.length],["Isentos",h.produtos.filter(p=>p.analise.some(a=>a.tipo==="ISENCAO")).length],["ICMS-ST",h.produtos.filter(p=>p.analise.some(a=>a.tipo==="ICMS_ST")).length],["ICMS Calc.",fmt(totalICMSCalc)],["Economia",fmt(totalEconomia)]].map(([l,v])=>(
                        <div key={l} style={{background:"rgba(255,255,255,0.03)",borderRadius:7,padding:"9px 12px"}}>
                          <div style={{fontSize:10,color:C.muted}}>{l}</div>
                          <div style={{fontSize:14,fontWeight:700,color:C.text,marginTop:2}}>{v}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{overflowX:"auto"}}>
                      <table style={S.table}>
                        <thead><tr>{["#","Descrição","NCM","Valor","Tributação","ICMS Calc."].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                        <tbody>
                          {h.produtos.map((p,i)=>{
                            const c=calcs[i]||{};
                            return(
                              <tr key={p.seq}>
                                <td style={{...S.td,color:C.muted}}>{p.seq}</td>
                                <td style={{...S.td,fontWeight:600,color:C.text,fontSize:12}}>{p.descricao}</td>
                                <td style={S.td}><span style={S.tag}>{p.ncm}</span></td>
                                <td style={{...S.td,color:"#68d391",fontWeight:700,whiteSpace:"nowrap"}}>R$ {p.valor_total.toLocaleString("pt-BR",{minimumFractionDigits:2})}</td>
                                <td style={S.td}><div style={{display:"flex",gap:3}}>{[...new Set(p.analise.map(a=>a.tipo))].map(t=><Chip key={t} tipo={t}/>)}</div></td>
                                <td style={{...S.td,fontWeight:700,color:"#68d391",whiteSpace:"nowrap"}}>{fmt(c.valor_icms_total)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div style={{marginTop:14,display:"flex",gap:8}}>
                      <button style={S.btn("primary")} onClick={()=>carregarDoHistorico(h)}>🧾 Ver Cálculo ICMS</button>
                      <button style={S.btn("pdf")} onClick={()=>exportarRelatorioPDF(h.nota,h.produtos,calcs)}>📄 Exportar PDF</button>
                      <button style={S.btn("success")} onClick={()=>exportarCSV(h.nota,h.produtos)}>⬇️ Exportar CSV</button>
                    </div>
                  </div>
                );
              })():(
                <div style={{...S.card,textAlign:"center",padding:"40px 24px",color:C.muted}}>
                  <div style={{fontSize:32,marginBottom:10}}>📋</div>
                  <div>Selecione uma nota à esquerda para ver o resumo.</div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════ ARQUIVO FISCAL ═══════════ */}
        {tab==="arquivo"&&(()=>{
          const empresas=Object.entries(arquivo).map(([k,e])=>({key:k,...e}));
          const empSel=arqEmpresaSel?arquivo[arqEmpresaSel]:null;
          const meses=empSel?[...new Set(empSel.registros.map(r=>r.mesAno))].sort().reverse():[];
          const mesAtivo=arqMesSel&&meses.includes(arqMesSel)?arqMesSel:(meses[0]||null);
          const regsDoMes=empSel&&mesAtivo?empSel.registros.filter(r=>r.mesAno===mesAtivo).sort((a,b)=>(a.dataEmissao||"").localeCompare(b.dataEmissao||"")):[];
          const totaisMes=regsDoMes.reduce((s,r)=>({
            valorTotal:s.valorTotal+(r.valorTotal||0),
            icmsProprio:s.icmsProprio+(r.totais?.icmsProprio||0),
            icmsST:s.icmsST+(r.totais?.icmsST||0),
            antecipacao:s.antecipacao+(r.totais?.antecipacao||0),
            difal:s.difal+(r.totais?.difal||0),
            icmsCalcTotal:s.icmsCalcTotal+(r.totais?.icmsCalcTotal||0),
          }),{valorTotal:0,icmsProprio:0,icmsST:0,antecipacao:0,difal:0,icmsCalcTotal:0});
          return(
            <div style={{display:"grid",gridTemplateColumns:"300px 1fr",gap:20,alignItems:"start"}}>
              <div style={S.card}>
                <div style={S.cardTitle}>🏢 Empresas</div>
                {arqMsg&&<div style={{...S.alert(arqMsg.tipo==="ok"?"success":"error"),marginBottom:10,fontSize:11}}>{arqMsg.txt}</div>}
                {!empresas.length&&<div style={{color:C.muted,fontSize:12,textAlign:"center",padding:"20px 0"}}>Nenhuma NF-e salva ainda. Analise uma NF-e e clique em <b>Salvar no Arquivo</b>.</div>}
                {empresas.map(e=>(
                  <div key={e.key} style={S.histItem(arqEmpresaSel===e.key)} onClick={()=>{setArqEmpresaSel(e.key);setArqMesSel(null);}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                      <div style={{minWidth:0,flex:1}}>
                        <div style={{fontWeight:700,fontSize:12,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.razaoSocial}</div>
                        <div style={{fontSize:10,color:C.muted,marginTop:2,fontFamily:"monospace"}}>{formatCNPJ(e.cnpj)}</div>
                        <div style={{fontSize:10,color:C.muted,marginTop:2}}>{e.registros.length} NF-e</div>
                      </div>
                      <button style={{...S.btn("danger"),padding:"2px 7px",fontSize:11}} onClick={ev=>{ev.stopPropagation();if(confirm(`Excluir ${e.registros.length} NF-e de ${e.razaoSocial}?`)){const next={...arquivo};delete next[e.key];setArquivo(next);if(arqEmpresaSel===e.key){setArqEmpresaSel(null);setArqMesSel(null);}}}}>✕</button>
                    </div>
                  </div>
                ))}
                {empresas.length>0&&(
                  <button style={{...S.btn("ghost"),width:"100%",justifyContent:"center",marginTop:8}} onClick={()=>{if(confirm("Excluir TODO o arquivo fiscal?")){setArquivo({});setArqEmpresaSel(null);setArqMesSel(null);}}}>🗑️ Limpar arquivo</button>
                )}
              </div>
              <div>
                {!empSel?(
                  <div style={{...S.card,textAlign:"center",padding:"40px 24px",color:C.muted}}>
                    <div style={{fontSize:32,marginBottom:10}}>🗄️</div>
                    <div>Selecione uma empresa à esquerda para ver os cálculos salvos por mês.</div>
                  </div>
                ):(
                  <div style={S.card}>
                    <div style={S.cardTitle}>📅 {empSel.razaoSocial} — {formatCNPJ(empSel.cnpj)}{empSel.ie?` · IE ${empSel.ie}`:""}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
                      {meses.map(m=>(
                        <button key={m} style={S.tab(mesAtivo===m)} onClick={()=>setArqMesSel(m)}>{labelMesAno(m)} <span style={{opacity:0.6,marginLeft:4}}>({empSel.registros.filter(r=>r.mesAno===m).length})</span></button>
                      ))}
                    </div>
                    {!mesAtivo?(
                      <div style={{color:C.muted,fontSize:12,textAlign:"center",padding:"20px 0"}}>Sem registros para esta empresa.</div>
                    ):(
                      <>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,marginBottom:16}}>
                          {[
                            ["NF-e no mês",regsDoMes.length],
                            ["Valor Total",fmt(totaisMes.valorTotal)],
                            ["ICMS Próprio",fmt(totaisMes.icmsProprio)],
                            ["ICMS-ST",fmt(totaisMes.icmsST)],
                            ["Antecipação",fmt(totaisMes.antecipacao)],
                            ["DIFAL",fmt(totaisMes.difal)],
                            ["ICMS Calc. Total",fmt(totaisMes.icmsCalcTotal)],
                          ].map(([l,v])=>(
                            <div key={l} style={{background:"rgba(255,255,255,0.03)",borderRadius:7,padding:"9px 12px"}}>
                              <div style={{fontSize:10,color:C.muted}}>{l}</div>
                              <div style={{fontSize:14,fontWeight:700,color:C.text,marginTop:2}}>{v}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{overflowX:"auto"}}>
                          <table style={S.table}>
                            <thead><tr>{["NF","Série","Emissão","Emitente","UF","Valor","ICMS Próp.","ICMS-ST","Antecip.","DIFAL","Itens",""].map(h=><th key={h} style={S.th}>{h}</th>)}</tr></thead>
                            <tbody>
                              {regsDoMes.map(r=>(
                                <tr key={r.id}>
                                  <td style={{...S.td,fontWeight:700,color:C.text}}>{r.numero}</td>
                                  <td style={S.td}>{r.serie||"—"}</td>
                                  <td style={{...S.td,whiteSpace:"nowrap"}}>{(r.dataEmissao||"").slice(0,10)}</td>
                                  <td style={{...S.td,fontSize:11,maxWidth:200,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{r.emitenteNome}</td>
                                  <td style={{...S.td,fontSize:11}}>{r.ufOrigem}→{r.ufDestino}</td>
                                  <td style={{...S.td,whiteSpace:"nowrap",fontWeight:700,color:"#68d391"}}>{fmt(r.valorTotal)}</td>
                                  <td style={{...S.td,whiteSpace:"nowrap"}}>{fmt(r.totais?.icmsProprio)}</td>
                                  <td style={{...S.td,whiteSpace:"nowrap",color:"#63b3ed"}}>{fmt(r.totais?.icmsST)}</td>
                                  <td style={{...S.td,whiteSpace:"nowrap",color:"#f6ad55"}}>{fmt(r.totais?.antecipacao)}</td>
                                  <td style={{...S.td,whiteSpace:"nowrap",color:"#b794f4"}}>{fmt(r.totais?.difal)}</td>
                                  <td style={{...S.td,textAlign:"center"}}>{r.produtos?.length||0}</td>
                                  <td style={S.td}><button style={{...S.btn("danger"),padding:"2px 7px",fontSize:11}} onClick={()=>{if(confirm(`Excluir NF-e ${r.numero}?`)){setArquivo(prev=>removerRegistroArquivo(prev,arqEmpresaSel,r.id));}}}>✕</button></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <div style={{marginTop:14,display:"flex",gap:8,flexWrap:"wrap"}}>
                          <button style={S.btn("pdf")} onClick={()=>exportarArquivoPDF(empSel,mesAtivo,regsDoMes)}>📄 Exportar PDF Consolidado</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })()}

        </main>
      </div>
    </div>
  );
}
