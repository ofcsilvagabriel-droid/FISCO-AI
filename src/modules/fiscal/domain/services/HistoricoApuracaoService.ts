// Service: HISTÓRICO DE APURAÇÃO POR NCM (memória inteligente).
// Toda apuração (automática ou congelada manualmente) é versionada
// por NCM. Em novas notas, a versão corrente válida é reaplicada.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { identificarSeTemPauta } from "../engines/PautaEngine";

const KEY = "fiscoai:historico-apuracao:v1";

export type TipoApuracao = "AUTOMATICO" | "AUTOMATICO_PAUTA" | "CONGELADO_MANUAL" | "MANUAL_CONGELADO";

const digitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");
const novoId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `apu_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function log(msg: string) {
  try {
    // eslint-disable-next-line no-console
    console.info(msg);
  } catch {
    /* noop */
  }
}

function loadAll(): Record<string, any> {
  try {
    const raw = localStorage.getItem(KEY);
    const dados = raw ? JSON.parse(raw) : {};
    if (sanitizarHistoricos(dados)) localStorage.setItem(KEY, JSON.stringify(dados));
    return dados;
  } catch {
    return {};
  }
}

/** Remove valores monetários de registros antigos: a memória guarda apenas a regra fiscal. */
function sanitizarHistoricos(data: Record<string, any>): boolean {
  let alterado = false;
  Object.values(data || {}).forEach((historico: any) => {
    (historico?.apuracoes || []).forEach((apuracao: any) => {
      if (apuracao?.calculo_aplicado?.valores) {
        delete apuracao.calculo_aplicado.valores;
        alterado = true;
      }
      (apuracao?.alteracoes || []).forEach((alteracao: any) => {
        ["de", "para"].forEach((lado) => {
          const registro = alteracao?.[lado];
          if (!registro || typeof registro !== "object") return;
          Object.keys(registro).forEach((chave) => {
            if (/^(valor|base)/i.test(chave)) {
              delete registro[chave];
              alterado = true;
            }
          });
        });
      });
    });
  });
  return alterado;
}

function saveAll(data: Record<string, any>) {
  try {
    sanitizarHistoricos(data);
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

/**
 * AJUSTE 1 — a chave de memória passa a considerar a faixa de alíquota
 * interestadual quando o regime é ST (a MVA ajustada muda com 4/7/12%).
 * Para os demais regimes a faixa é "NA" e a chave permanece empresa::ncm.
 */
export function faixaInterestadual(aliq: unknown): "4" | "7" | "12" {
  const n = Number(aliq || 0);
  if (!n || !isFinite(n)) return "12";
  if (n <= 5) return "4";
  if (n <= 9) return "7";
  return "12";
}

const REGIMES = [
  "ST",
  "DIFAL",
  "ANTECIPACAO",
  "ISENTO",
  "NAO_TRIBUTADO",
  "PRESUNCAO_CREDITO",
  "NORMAL",
] as const;
export type RegimeMemoria = (typeof REGIMES)[number];

/** Deriva o regime tributário a partir do resultado do cálculo. */
export function derivarRegime(c: any): RegimeMemoria {
  const t = String(c?.tributacao || "").toUpperCase();
  const modo = String(c?.decisao_manual?.modo || "").toUpperCase();
  const alvo = modo && modo !== "AUTO" ? modo : t;
  if (/ST/.test(alvo)) return "ST";
  if (/DIFAL/.test(alvo)) return "DIFAL";
  if (/ANTECIPACAO/.test(alvo)) return "ANTECIPACAO";
  if (/ISENT/.test(alvo)) return "ISENTO";
  if (/NAO_TRIBUT|NAO_INCID|IMUNE/.test(alvo)) return "NAO_TRIBUTADO";
  if (c?.icms_proprio_presumido) return "PRESUNCAO_CREDITO";
  return "NORMAL";
}

function origemDecisao(tipoCalculo: string): "AUTOMATICO" | "MANUAL" | "CONGELADO_MANUAL" {
  const t = String(tipoCalculo || "").toUpperCase();
  if (/CONGELADO/.test(t)) return "CONGELADO_MANUAL";
  if (/MANUAL/.test(t)) return "MANUAL";
  return "AUTOMATICO";
}

/** Assinatura da DECISÃO FISCAL (não do resultado em R$). */
function fingerprintDecisao(d: any): string {
  return JSON.stringify([
    d.regime_tributario_aplicado,
    d.origem_decisao,
    d.aliquota_interestadual_faixa,
    d.parametros?.mva_informada ?? null,
    !!d.parametros?.mva_ja_ajustada,
    Number(d.parametros?.fcp_percentual) || 0,
    !!d.parametros?.presuncao_credito,
  ]);
}

const chave = (ncm: unknown, empresaId?: string | null, faixa: string = "NA") =>
  `${empresaId || "_"}::${digitos(ncm)}${faixa && faixa !== "NA" ? `::${faixa}` : ""}`;

function criarHistoricoVazio(ncm: string, empresaId?: string | null, faixa: string = "NA") {
  const agora = new Date().toISOString();
  return {
    id: novoId(),
    empresa_id: empresaId || null,
    ncm,
    aliquota_interestadual_faixa: faixa,
    descricao_ncm_ultima_nota: "",
    apuracoes: [] as any[],
    versao_corrente: null as any,
    total_apuracoes: 0,
    total_alteracoes: 0,
    proxima_versao: 1,
    criado_em: agora,
    atualizado_em: agora,
    visto_em: agora,
    vezes_aplicada: 0,
    ativo: true,
  };
}

/** REGRA 2/AJUSTE 3 — memória é estritamente individual por empresa. */
function exigirEmpresa(fn: string, empresaId: unknown): string {
  const id = String(empresaId ?? "").trim();
  if (!id) throw new Error(`${fn}: empresa_id é obrigatório — memória é estritamente individual por empresa.`);
  return id;
}

/** AJUSTE 3 — nenhum registro de outra empresa pode ser aplicado. */
function validarIsolamento(registro: any, empresaId: string): any {
  if (!registro) return null;
  if (String(registro.empresa_id || "") !== String(empresaId)) {
    log(
      `[MEMORIA_ISOLAMENTO_VIOLADO] Registro NCM ${registro.ncm} pertence à empresa ${registro.empresa_id || "—"} mas foi lido para ${empresaId}. Ignorado.`,
    );
    return null;
  }
  return registro;
}


const KEY_ACESSOS = "fiscoai:memoria-acessos:v1";

export const HistoricoApuracaoService = {
  digitos,
  faixaInterestadual,
  derivarRegime,

  /**
   * Busca a memória do NCM. Quando `faixa` é informada, procura primeiro a
   * variante daquela faixa de alíquota interestadual (ST) e só então o
   * registro base. Nunca retorna registro de outra empresa (Ajuste 3).
   */
  buscarHistoricoNCM(ncm: unknown, empresaId: string, faixa?: string) {
    const emp = exigirEmpresa("buscarHistoricoNCM", empresaId);
    const nd = digitos(ncm);
    if (!nd) return null;
    const all = loadAll();
    const f = faixa || "NA";
    const achado = all[chave(nd, emp, f)] || (f !== "NA" ? all[chave(nd, emp, "NA")] : null) || null;
    return validarIsolamento(achado, emp);
  },

  /** Todas as variantes (faixas de MVA/alíquota) de um NCM da empresa. */
  listarVariantes(ncm: unknown, empresaId: string): any[] {
    const emp = exigirEmpresa("listarVariantes", empresaId);
    const nd = digitos(ncm);
    return Object.entries(loadAll())
      .filter(([k]) => k === chave(nd, emp, "NA") || k.startsWith(`${chave(nd, emp, "NA")}::`))
      .map(([, v]) => v)
      .filter((v: any) => validarIsolamento(v, emp));
  },

  salvarHistoricoNCM(historico: any, empresaId?: string) {
    const emp = exigirEmpresa("salvarHistoricoNCM", empresaId ?? historico?.empresa_id);
    historico.empresa_id = emp;
    const all = loadAll();
    all[chave(historico.ncm, emp, historico.aliquota_interestadual_faixa || "NA")] = historico;
    saveAll(all);
    return historico;
  },


  listar(): any[] {
    const all = loadAll();
    return Object.values(all)
      .filter((h: any) => h?.ativo !== false)
      .sort((a: any, b: any) => String(b.atualizado_em).localeCompare(String(a.atualizado_em)));
  },

  /** Todos os históricos (inclusive arquivados) agrupados por empresa. */
  listarTudo(): any[] {
    return Object.values(loadAll()).sort((a: any, b: any) =>
      String(b.atualizado_em).localeCompare(String(a.atualizado_em)),
    );
  },

  porEmpresa(): Record<string, any[]> {
    const grupos: Record<string, any[]> = {};
    HistoricoApuracaoService.listarTudo().forEach((h: any) => {
      const k = h.empresa_id || "SEM_EMPRESA";
      (grupos[k] = grupos[k] || []).push(h);
    });
    return grupos;
  },

  // --- Auditoria de acessos/alterações da memória protegida
  registrarAcesso(evento: { usuario?: string | null; acao: string; descricao: string; ncm?: string | null }) {
    try {
      const raw = localStorage.getItem(KEY_ACESSOS);
      const lista = raw ? JSON.parse(raw) : [];
      lista.unshift({
        data: new Date().toISOString(),
        usuario: evento.usuario || "Usuário",
        acao: evento.acao,
        descricao: evento.descricao,
        ncm_afetado: evento.ncm || null,
      });
      localStorage.setItem(KEY_ACESSOS, JSON.stringify(lista.slice(0, 1000)));
    } catch {
      /* noop */
    }
  },

  listarAcessos(): any[] {
    try {
      const raw = localStorage.getItem(KEY_ACESSOS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  },

  /** Estatísticas agregadas da memória (dashboard Obsidian). */
  estatisticas() {
    const todos = HistoricoApuracaoService.listarTudo();
    const apuracoes = todos.flatMap((h: any) => h.apuracoes || []);
    const manuais = apuracoes.filter(
      (a: any) =>
        a.calculo_aplicado?.origem_decisao === "MANUAL" ||
        a.calculo_aplicado?.origem_decisao === "CONGELADO_MANUAL" ||
        /MANUAL|CONGELADO/.test(String(a.calculo_aplicado?.tipo_calculo || "")),
    );
    const seteDias = Date.now() - 7 * 864e5;
    // AJUSTE 4 — quantos NCMs possuem mais de uma variante de faixa de MVA
    const porNcm: Record<string, Set<string>> = {};
    todos.forEach((h: any) => {
      const k = `${h.empresa_id}::${h.ncm}`;
      const f = h.aliquota_interestadual_faixa || "NA";
      if (f === "NA") return;
      (porNcm[k] = porNcm[k] || new Set()).add(f);
    });
    return {
      total_ncms: todos.length,
      total_empresas: new Set(todos.map((h: any) => h.empresa_id)).size,
      total_apuracoes: apuracoes.length,
      apuracoes_manuais: manuais.length,
      apuracoes_automaticas: apuracoes.length - manuais.length,
      ncms_com_alteracoes: todos.filter((h: any) => (h.total_alteracoes || 0) > 0).length,
      total_alteracoes: todos.reduce((s: number, h: any) => s + (h.total_alteracoes || 0), 0),
      media_versoes: todos.length ? apuracoes.length / todos.length : 0,
      ncms_novos_7d: todos.filter((h: any) => new Date(h.criado_em).getTime() > seteDias).length,
      apuracoes_7d: apuracoes.filter((a: any) => new Date(a.criado_em).getTime() > seteDias).length,
      st_com_multiplas_faixas_mva: Object.values(porNcm).filter((s) => s.size > 1).length,
    };
  },


  /** Remove o NCM da empresa, incluindo todas as variantes de faixa. */
  remover(ncm: unknown, empresaId: string) {
    const all = loadAll();
    const base = chave(ncm, empresaId, "NA");
    Object.keys(all).forEach((k) => {
      if (k === base || k.startsWith(`${base}::`)) delete all[k];
    });
    saveAll(all);
  },

  limpar() {
    saveAll({});
  },

  exportarJSON(): string {
    return JSON.stringify(
      { data_exportacao: new Date().toISOString(), historicos: HistoricoApuracaoService.listar() },
      null,
      2,
    );
  },

  importarJSON(texto: string): number {
    try {
      const dados = JSON.parse(texto);
      const lista: any[] = Array.isArray(dados) ? dados : dados?.historicos || [];
      const all = loadAll();
      lista.forEach((h) => {
        // mantém o empresa_id original de cada registro (Ajuste 3)
        if (h?.ncm && h?.empresa_id) all[chave(h.ncm, h.empresa_id, h.aliquota_interestadual_faixa || "NA")] = h;
      });
      saveAll(all);
      return lista.length;
    } catch {
      return 0;
    }
  },



  /**
   * Retorna a versão válida (corrente) para o NCM ou null.
   * `aliquotaInterestadual` seleciona a variante de MVA correta (ST).
   * origem_memoria: ALTERADO_MANUAL | CONGELADO_MANUAL_INALTERADO | AUTOMATICO_ANTERIOR
   */
  obterVersaoValidaParaNCM(
    ncm: unknown,
    empresaId: string,
    descricaoProduto?: string,
    aliquotaInterestadual?: number,
  ) {
    const nd = digitos(ncm);
    const faixa = faixaInterestadual(aliquotaInterestadual);
    const historico = HistoricoApuracaoService.buscarHistoricoNCM(nd, empresaId, faixa);
    if (!historico || !historico.apuracoes?.length) {
      log(`[MEMORIA_NCM] NCM ${nd || "—"} SEM histórico anterior — cálculo automático puro.`);
      return null;
    }
    const corrente = historico.versao_corrente;
    const apuracao = historico.apuracoes.find((a: any) => a.id === corrente?.id_apuracao);
    if (!apuracao) {
      log(`[MEMORIA_NCM] NCM ${nd} — versão corrente não encontrada, usando automático.`);
      return null;
    }

    // PAUTA: memória nunca é reaplicada — cada nota usa o PMC/PMPF próprio.
    const pautaAnterior = identificarSeTemPauta(apuracao.calculo_aplicado, descricaoProduto);
    if (pautaAnterior.temPauta && !apuracao.foi_alterado) {
      log(
        `[MEMORIA_PAUTA_IGNORADA] NCM ${nd} — versão anterior usou PAUTA ${pautaAnterior.metodoPauta}. Ignorando memória; cálculo conforme PMC/PMPF da NF atual.`,
      );
      return null;
    }

    const base = {
      ...apuracao.calculo_aplicado,
      versao_apuracao: apuracao.versao,
      aliquota_interestadual_faixa: historico.aliquota_interestadual_faixa || "NA",
      criado_em: apuracao.criado_em,
      alterado_em: apuracao.alterado_em || null,
      alterado_por: apuracao.alterado_por || null,
      nota_origem: apuracao.nota_origem,
      total_alteracoes: apuracao.alteracoes?.length || 0,
    };

    if (apuracao.foi_alterado) {
      log(`[MEMORIA_NCM_ALTERADO] NCM ${nd} — usando versão ALTERADA (v${apuracao.versao}) da apuração anterior.`);
      return { ...base, origem_memoria: "ALTERADO_MANUAL" };
    }
    if (apuracao.calculo_aplicado?.origem_decisao === "CONGELADO_MANUAL" || apuracao.calculo_aplicado?.tipo_calculo === "CONGELADO_MANUAL") {
      log(`[MEMORIA_NCM_CONGELADO] NCM ${nd} — usando cálculo CONGELADO (v${apuracao.versao}) da apuração anterior.`);
      return { ...base, origem_memoria: "CONGELADO_MANUAL_INALTERADO" };
    }
    log(`[MEMORIA_NCM_AUTOMATICO] NCM ${nd} — histórico automático anterior (v${apuracao.versao}) disponível.`);
    return { ...base, origem_memoria: "AUTOMATICO_ANTERIOR" };
  },

  /**
   * Monta a DECISÃO FISCAL memorizável a partir do resultado do cálculo.
   * Guarda exclusivamente os parâmetros da regra fiscal. Valores em R$ são
   * sempre calculados novamente a partir do XML em cada nova nota.
   */
  montarDecisaoFiscal(c: any, tipoCalculo: string, faixa: string) {
    const cc = c || {};
    return {
      tipo_calculo: tipoCalculo,
      regime_tributario_aplicado: derivarRegime(cc),
      origem_decisao: origemDecisao(tipoCalculo),
      aliquota_interestadual_faixa: faixa,
      tributacao: cc.tributacao || "NORMAL",
      modo_decisao: cc.decisao_manual?.modo || "AUTO",
      parametros: {
        mva_informada: cc.mva_informada ?? cc.decisao_manual?.mva_informada ?? cc.mva_utilizada ?? null,
        mva_ja_ajustada: !!(cc.mva_ja_ajustada ?? cc.decisao_manual?.mva_ja_ajustada),
        aliquota_interestadual_referencia: Number(cc.aliquota_interestadual ?? cc.aliq_interestadual) || null,
        fcp_percentual: Number(cc.fcp_percentual) || 0,
        icms_destacado_nf: cc.icms_destacado_nf ?? !cc.icms_proprio_presumido,
        icms_presumido: !!cc.icms_proprio_presumido,
        presuncao_credito: !!cc.icms_proprio_presumido,
        aliquota_presumida: cc.icms_proprio_presumido
          ? Number(cc.aliquota_presumida ?? cc.presuncao_credito_aliq ?? cc.aliquota_aplicada) || 0
          : null,
        pauta_aplicada: cc.fonte_pauta || cc.metodo_pauta || null,
      },
      fundamento: cc.icms_proprio_presumido
        ? `ICMS Próprio presumido (alíquota interestadual ${Number(cc.aliquota_presumida ?? cc.presuncao_credito_aliq ?? cc.aliquota_aplicada) || 0}%) — ${cc.fundamento || cc.obs || ""}`.trim()
        : cc.fundamento || cc.obs || "",
    };
  },

  /** Registra uma nova apuração (nova versão) para o NCM + faixa. */
  registrarNovaApuracao(params: {
    ncm: unknown;
    descricao?: string;
    calculo: any;
    tipoCalculo: TipoApuracao;
    usuario?: string | null;
    notaOrigem?: any;
    empresaId: string;
    aliquotaInterestadual?: number;
  }) {
    const nd = digitos(params.ncm);
    if (!nd) return null;
    const c = params.calculo || {};
    const regime = derivarRegime(c);
    const faixa =
      regime === "ST"
        ? faixaInterestadual(
            params.aliquotaInterestadual ?? c.aliquota_interestadual ?? c.aliq_interestadual,
          )
        : "NA";
    const historico =
      HistoricoApuracaoService.buscarHistoricoNCM(nd, params.empresaId, faixa) ||
      criarHistoricoVazio(nd, params.empresaId, faixa);
    historico.aliquota_interestadual_faixa = faixa;
    const agora = new Date().toISOString();

    const decisao = HistoricoApuracaoService.montarDecisaoFiscal(c, params.tipoCalculo, faixa);

    const nova = {
      id: novoId(),
      versao: historico.proxima_versao,
      nota_origem: params.notaOrigem || null,
      calculo_aplicado: decisao,
      decisao_fingerprint: fingerprintDecisao(decisao),
      criado_em: agora,
      criado_por: params.usuario || "SISTEMA_AUTOMATICO",
      foi_alterado: false,
      alteracoes: [] as any[],
      ativo: true,
      versao_anterior_id: historico.versao_corrente?.id_apuracao || null,
    };

    historico.apuracoes.forEach((a: any) => {
      a.ativo = false;
    });
    historico.apuracoes.push(nova);
    historico.versao_corrente = {
      numero_versao: nova.versao,
      id_apuracao: nova.id,
      criado_em: nova.criado_em,
      foi_alterada: false,
      descricao: `${decisao.origem_decisao} — ${decisao.regime_tributario_aplicado}${faixa !== "NA" ? ` (inter. ${faixa}%)` : ""}`,
    };
    historico.total_apuracoes = (historico.total_apuracoes || 0) + 1;
    historico.proxima_versao = (historico.proxima_versao || 1) + 1;
    historico.descricao_ncm_ultima_nota = params.descricao || historico.descricao_ncm_ultima_nota;
    historico.atualizado_em = agora;
    historico.visto_em = agora;
    historico.vezes_aplicada = (historico.vezes_aplicada || 0) + 1;

    HistoricoApuracaoService.salvarHistoricoNCM(historico, historico.empresa_id);
    log(
      `[DECISAO_MEMORIZADA] NCM ${nd} (faixa ${faixa}) — v${nova.versao} · ${decisao.regime_tributario_aplicado} · ${decisao.origem_decisao}.`,
    );
    return historico;
  },


  /** Registra uma alteração sobre a versão corrente do NCM. */
  registrarAlteracaoApuracao(params: {
    ncm: unknown;
    de: any;
    para: any;
    motivo: string;
    usuario?: string | null;
    empresaId: string;
  }) {
    const nd = digitos(params.ncm);
    const historico = HistoricoApuracaoService.buscarHistoricoNCM(nd, params.empresaId);
    if (!historico?.versao_corrente) return null;
    const apuracao = historico.apuracoes.find((a: any) => a.id === historico.versao_corrente.id_apuracao);
    if (!apuracao) return null;
    const agora = new Date().toISOString();

    apuracao.alteracoes = apuracao.alteracoes || [];
    apuracao.alteracoes.push({
      data: agora,
      por: params.usuario || "SISTEMA",
      de: params.de,
      para: params.para,
      motivo: params.motivo,
    });
    apuracao.foi_alterado = true;
    apuracao.alterado_em = agora;
    apuracao.alterado_por = params.usuario || "SISTEMA";
    historico.versao_corrente.foi_alterada = true;
    historico.total_alteracoes = (historico.total_alteracoes || 0) + 1;
    historico.atualizado_em = agora;

    HistoricoApuracaoService.salvarHistoricoNCM(historico, historico.empresa_id);
    log(`[APURACAO_ALTERADA] NCM ${nd} versão ${apuracao.versao} — ${params.motivo} (por ${params.usuario || "SISTEMA"}).`);
    return historico;
  },

  /** Torna corrente uma versão anterior (reverter). */
  reverterParaVersao(ncm: unknown, versao: number, empresaId: string) {
    const historico = HistoricoApuracaoService.buscarHistoricoNCM(ncm, empresaId);
    if (!historico) return null;
    const alvo = historico.apuracoes.find((a: any) => a.versao === versao);
    if (!alvo) return null;
    historico.apuracoes.forEach((a: any) => {
      a.ativo = a.versao === versao;
    });
    historico.versao_corrente = {
      numero_versao: alvo.versao,
      id_apuracao: alvo.id,
      criado_em: alvo.criado_em,
      foi_alterada: !!alvo.foi_alterado,
      descricao: `Revertido para v${alvo.versao} — ${alvo.calculo_aplicado?.tributacao || "—"}`,
    };
    historico.atualizado_em = new Date().toISOString();
    HistoricoApuracaoService.salvarHistoricoNCM(historico, historico.empresa_id);
    log(`[APURACAO_REVERTIDA] NCM ${historico.ncm} — versão corrente agora é v${versao}.`);
    return historico;
  },

  /** Arquiva/reativa um NCM sem perder o histórico. */
  arquivarNCM(ncm: unknown, empresaId: string, ativo = false) {
    const historico = HistoricoApuracaoService.buscarHistoricoNCM(ncm, empresaId);
    if (!historico) return null;
    historico.ativo = ativo;
    historico.atualizado_em = new Date().toISOString();
    return HistoricoApuracaoService.salvarHistoricoNCM(historico, empresaId);
  },

  /** Bloqueia/desbloqueia edições da memória de um NCM. */
  bloquearEdicoes(ncm: unknown, empresaId: string, bloqueado = true) {
    const historico = HistoricoApuracaoService.buscarHistoricoNCM(ncm, empresaId);
    if (!historico) return null;
    historico.bloqueado = bloqueado;
    historico.atualizado_em = new Date().toISOString();
    return HistoricoApuracaoService.salvarHistoricoNCM(historico, empresaId);
  },

  /** Copia a memória corrente de um NCM para outro (mesma empresa). */
  duplicarParaNCM(ncmOrigem: unknown, ncmDestino: unknown, empresaId: string, usuario?: string | null) {
    const origem = HistoricoApuracaoService.buscarHistoricoNCM(ncmOrigem, empresaId);
    const corrente = origem?.apuracoes?.find((a: any) => a.id === origem.versao_corrente?.id_apuracao);
    if (!corrente) return null;
    return HistoricoApuracaoService.registrarNovaApuracao({
      ncm: ncmDestino,
      descricao: origem.descricao_ncm_ultima_nota,
      calculo: {
        tributacao: corrente.calculo_aplicado?.tributacao,
        mva_informada: corrente.calculo_aplicado?.parametros?.mva_informada,
        mva_ja_ajustada: corrente.calculo_aplicado?.parametros?.mva_ja_ajustada,
        fcp_percentual: corrente.calculo_aplicado?.parametros?.fcp_percentual,
        fundamento: `Duplicado do NCM ${digitos(ncmOrigem)} — ${corrente.calculo_aplicado?.fundamento || ""}`,
        decisao_manual: { modo: corrente.calculo_aplicado?.modo_decisao },
      },
      tipoCalculo: "CONGELADO_MANUAL",
      usuario: usuario || "Usuário",
      empresaId,
    });
  },

  /**
   * REGRA 1 — COBERTURA TOTAL, exceto PAUTA.
   * Cálculos por pauta (PMC/PMPF) NÃO são memorizados: cada nota traz o
   * seu próprio PMC e deve ser sempre recalculada. Decisões manuais /
   * congeladas continuam sendo registradas mesmo com pauta.
   * Nunca lança: falha de memória jamais bloqueia o cálculo.
   */
  registrarAutomaticamenteNaMemoria(params: {
    ncm: unknown;
    descricao?: string;
    calculo: any;
    tipoCalculo?: string;
    notaOrigem?: any;
    usuario?: string | null;
    empresaId: string;
    aliquotaInterestadual?: number;
  }): any {
    try {
      const tipo = (params.tipoCalculo || "AUTOMATICO") as TipoApuracao;
      const manualOuCongelado = /MANUAL|CONGELADO/.test(String(tipo));
      const pauta = identificarSeTemPauta(params.calculo, params.descricao);
      if (pauta.temPauta && !manualOuCongelado) {
        log(
          `[MEMORIA_BLOQUEADA_PAUTA] NCM ${digitos(params.ncm)} — cálculo por pauta (${pauta.metodoPauta} ${pauta.valorPMC ?? "—"}). Não memorizado: cada ocorrência é recalculada conforme PMC na NF.`,
        );
        return {
          sucesso: true,
          bloqueado_por_pauta: true,
          motivo:
            "Pauta PMC: produtos com pauta são recalculados individualmente conforme o PMC informado na NF.",
        };
      }

      // AJUSTE 1 — memoriza DECISÃO, não resultado: se a decisão fiscal é a
      // mesma já registrada, apenas atualiza "visto pela última vez".
      const c = params.calculo || {};
      const regime = derivarRegime(c);
      const faixa =
        regime === "ST"
          ? faixaInterestadual(params.aliquotaInterestadual ?? c.aliquota_interestadual ?? c.aliq_interestadual)
          : "NA";
      const existente = HistoricoApuracaoService.buscarHistoricoNCM(params.ncm, params.empresaId, faixa);
      const corrente = existente?.apuracoes?.find(
        (a: any) => a.id === existente.versao_corrente?.id_apuracao,
      );
      const nova = HistoricoApuracaoService.montarDecisaoFiscal(c, tipo, faixa);
      if (
        corrente &&
        !corrente.foi_alterado &&
        (corrente.decisao_fingerprint || fingerprintDecisao(corrente.calculo_aplicado || {})) ===
          fingerprintDecisao(nova)
      ) {
        const agora = new Date().toISOString();
        existente.visto_em = agora;
        existente.atualizado_em = agora;
        existente.vezes_aplicada = (existente.vezes_aplicada || 0) + 1;
        existente.descricao_ncm_ultima_nota = params.descricao || existente.descricao_ncm_ultima_nota;
        HistoricoApuracaoService.salvarHistoricoNCM(existente, existente.empresa_id);
        log(
          `[MEMORIA_DECISAO_INALTERADA] NCM ${digitos(params.ncm)} (faixa ${faixa}) — decisão ${nova.regime_tributario_aplicado} já memorizada; nenhuma nova versão criada.`,
        );
        return { sucesso: true, sem_alteracao: true };
      }

      const ok = HistoricoApuracaoService.registrarNovaApuracao({ ...params, tipoCalculo: tipo });
      if (ok) {
        log(
          `[MEMORIA_AUTO_REGISTRADA] NCM ${digitos(params.ncm)} — v${ok.versao_corrente?.numero_versao} (${tipo}) — Nota ${params.notaOrigem?.numero || "—"}`,
        );

      }
      return !!ok;
    } catch (erro: any) {
      log(`[MEMORIA_ERRO_REGISTRO] NCM ${digitos(params.ncm)} — ${erro?.message || erro}`);
      return false;
    }
  },

  /**
   * REGRA 3 — PRIORIDADE ABSOLUTA DA ÚLTIMA ALTERAÇÃO MANUAL.
   * Decide qual fórmula aplicar antes de exibir o cálculo do produto.
   * Exceção: cálculo novo por pauta ignora sempre a memória.
   */
  decidirFormulaAplicavel(
    ncm: unknown,
    empresaId: string,
    calculoAutomaticoNovo: any,
    descricaoProduto?: string,
    aliquotaInterestadual?: number,
  ) {
    const pautaNovo = identificarSeTemPauta(calculoAutomaticoNovo, descricaoProduto);
    if (pautaNovo.temPauta) {
      log(
        `[PAUTA_SEMPRE_NOVO] NCM ${digitos(ncm)} — pauta ${pautaNovo.metodoPauta} detectada no cálculo novo. Memória ignorada; recalculando conforme PMC da NF.`,
      );
      return {
        formula: calculoAutomaticoNovo,
        origem: "NOVO_CALCULO_POR_PAUTA",
        apuracao: null,
        explicacao: `Produto com pauta ${pautaNovo.metodoPauta}: ${pautaNovo.valorPMC ?? "—"}. Sempre recalculado conforme a pauta informada na NF.`,
      };
    }
    let historico: any = null;
    try {
      historico = HistoricoApuracaoService.buscarHistoricoNCM(
        ncm,
        empresaId,
        faixaInterestadual(aliquotaInterestadual ?? calculoAutomaticoNovo?.aliquota_interestadual),
      );
    } catch {
      historico = null;
    }
    if (!historico?.apuracoes?.length) {
      return { formula: calculoAutomaticoNovo, origem: "NOVO_NCM_AUTOMATICO", apuracao: null };
    }
    const manual = [...historico.apuracoes]
      .filter(
        (a: any) =>
          a.foi_alterado ||
          ["MANUAL", "CONGELADO_MANUAL"].includes(String(a.calculo_aplicado?.origem_decisao || "")) ||
          /MANUAL|CONGELADO/.test(String(a.calculo_aplicado?.tipo_calculo || "")),
      )
      .sort((a: any, b: any) => String(b.alterado_em || b.criado_em).localeCompare(String(a.alterado_em || a.criado_em)))[0];

    if (manual) {
      log(
        `[MEMORIA_PRIORIDADE_MANUAL] NCM ${digitos(ncm)} (empresa ${empresaId}) — aplicando última decisão manual: ${manual.calculo_aplicado?.tributacao} (${manual.alterado_em || manual.criado_em})`,
      );
      return { formula: manual.calculo_aplicado, origem: "MEMORIA_MANUAL_PRIORITARIA", apuracao: manual };
    }
    const ultimoAuto = [...historico.apuracoes].sort((a: any, b: any) =>
      String(b.criado_em).localeCompare(String(a.criado_em)),
    )[0];
    return {
      formula: ultimoAuto?.calculo_aplicado || calculoAutomaticoNovo,
      origem: "MEMORIA_AUTOMATICA_ANTERIOR",
      apuracao: ultimoAuto || null,
    };
  },


  /** Converte a versão válida numa decisão manual aplicável ao motor. */
  comoDecisaoManual(versao: any) {
    if (!versao) return null;
    const modo = versao.modo_decisao && versao.modo_decisao !== "AUTO"
      ? versao.modo_decisao
      : versao.tributacao === "ICMS_ST"
        ? "ICMS_ST"
        : versao.tributacao === "ANTECIPACAO"
          ? "ANTECIPACAO"
          : versao.tributacao === "DIFAL"
            ? "DIFAL"
            : versao.tributacao === "ISENTO"
              ? "ISENTO"
              : versao.tributacao === "NAO_TRIBUTADO"
                ? "NAO_TRIBUTADO"
                : "AUTO";
    if (modo === "AUTO") return null;
    return {
      modo,
      mva_informada: versao.parametros?.mva_informada ?? null,
      mva_ja_ajustada: !!versao.parametros?.mva_ja_ajustada,
      forcar_st: true,
      origem_memoria: true,
      origem_apuracao: versao.origem_memoria,
      versao_apuracao: versao.versao_apuracao,
      memoria_ncm: versao.nota_origem?.ncm || null,
    };
  },
};
