// Parser de NF-e extraído de FiscoAI.jsx (comportamento preservado 1:1).
import { interpretarCST } from "@/modules/fiscal/engines/motorCST";

export function parsearNFe(xmlStr) {
  try {
    const doc = new DOMParser().parseFromString(xmlStr, "text/xml");
    const get = (el,tag) => { const f=el?.getElementsByTagName(tag)[0]; return f?f.textContent.trim():""; };
    const ide=doc.getElementsByTagName("ide")[0], emit=doc.getElementsByTagName("emit")[0],
          dest=doc.getElementsByTagName("dest")[0], inf=doc.getElementsByTagName("infNFe")[0];
    // UF de origem e destino — busca prioritariamente nos blocos de endereço
    // (enderEmit/enderDest), com fallback para <UF> direto em <emit>/<dest> e,
    // por último, para o código IBGE (cUF/UFDest/cUFDest) convertido em sigla.
    const IBGE_UF = {11:"RO",12:"AC",13:"AM",14:"RR",15:"PA",16:"AP",17:"TO",21:"MA",22:"PI",23:"CE",24:"RN",25:"PB",26:"PE",27:"AL",28:"SE",29:"BA",31:"MG",32:"ES",33:"RJ",35:"SP",41:"PR",42:"SC",43:"RS",50:"MS",51:"MT",52:"GO",53:"DF"};
    const ufFrom = (parent, ...blocos) => {
      for (const b of blocos) {
        const node = parent?.getElementsByTagName(b)?.[0];
        const uf = node && get(node,"UF");
        if (uf) return uf.toUpperCase();
      }
      const direct = parent && get(parent,"UF");
      return direct ? direct.toUpperCase() : "";
    };
    const ufFromIBGE = (code) => IBGE_UF[parseInt(code,10)] || "";
    let uf_origem  = ufFrom(emit, "enderEmit") || ufFromIBGE(get(ide,"cUF"));
    let uf_destino = ufFrom(dest, "enderDest") || ufFromIBGE(get(ide,"cUFDest") || get(ide,"UFDest"));
    const infAdic = doc.getElementsByTagName("infAdic")[0];
    const nota = {
      chave: inf?.getAttribute("Id")||"", numero:get(ide,"nNF"), serie:get(ide,"serie"),
      data_emissao:get(ide,"dhEmi")||get(ide,"dEmi"), natureza_operacao:get(ide,"natOp"),
      uf_origem, uf_destino,
      emitente_nome:get(emit,"xNome")||get(emit,"xFant"), emitente_cnpj:get(emit,"CNPJ"),
      destinatario_nome:get(dest,"xNome"), destinatario_cnpj:get(dest,"CNPJ")||get(dest,"CPF"),
      destinatario_ie:get(dest,"IE")||"", emitente_ie:get(emit,"IE")||"",
      info_complementar:get(infAdic,"infCpl"),
      info_adicional_fisco:get(infAdic,"infAdFisco"),
    };
    // Totais do XML (<ICMSTot>) — usados na conferência XML × cálculo.
    const tot = doc.getElementsByTagName("ICMSTot")[0];
    nota.totais_xml = {
      valor_produtos: parseFloat(get(tot,"vProd")||0),
      valor_frete: parseFloat(get(tot,"vFrete")||0),
      valor_seguro: parseFloat(get(tot,"vSeg")||0),
      valor_outras_desp: parseFloat(get(tot,"vOutro")||0),
      valor_desconto: parseFloat(get(tot,"vDesc")||0),
      base_icms: parseFloat(get(tot,"vBC")||0),
      valor_icms: parseFloat(get(tot,"vICMS")||0),
      base_icms_st: parseFloat(get(tot,"vBCST")||0),
      valor_icms_st: parseFloat(get(tot,"vST")||0),
      valor_ipi: parseFloat(get(tot,"vIPI")||0),
      valor_fcp: parseFloat(get(tot,"vFCP")||0),
      valor_total: parseFloat(get(tot,"vNF")||0),
    };
    const dets=doc.getElementsByTagName("det"), produtos=[];
    // Extrai valor decimal de um texto livre (xProd/infAdProd) procurando "PMC:218,74", "PMC 218.74", etc.
    const extrairValorTag = (texto, tag) => {
      if (!texto) return 0;
      const re = new RegExp(tag + "[\\s:=]*R?\\$?\\s*([0-9]{1,3}(?:[.\\s][0-9]{3})*(?:,[0-9]{1,4})|[0-9]+(?:[.,][0-9]{1,4})?)", "i");
      const m = texto.match(re);
      if (!m) return 0;
      const num = m[1].replace(/\s/g,"").replace(/\.(?=\d{3}(\D|$))/g,"").replace(",",".");
      const v = parseFloat(num);
      return isNaN(v) ? 0 : v;
    };
    for (let i=0;i<dets.length;i++) {
      const det=dets[i], prod=det.getElementsByTagName("prod")[0];
      const imp=det.getElementsByTagName("imposto")[0];
      const icms=imp?.getElementsByTagName("ICMS")[0]?.firstElementChild;
      const ipi=imp?.getElementsByTagName("IPI")[0];
      const xProd=get(prod,"xProd");
      const infAd=get(det,"infAdProd");
      const textoLivre = `${xProd} ${infAd}`;
      const vPMCTag = parseFloat(get(prod,"vPMC")||0);
      const pmpfTag = parseFloat(get(prod,"vPMpF")||get(prod,"vPmpf")||0);
      const vPMCFinal = vPMCTag || extrairValorTag(textoLivre,"PMC");
      const pmpfFinal = pmpfTag || extrairValorTag(textoLivre,"PMPF");
      const cstProd = get(icms,"CST")||get(icms,"CSOSN")||"";
      const permCST = interpretarCST(cstProd);
      produtos.push({
        seq:det.getAttribute("nItem")||(i+1).toString(),
        codigo:get(prod,"cProd"), descricao:xProd, ncm:get(prod,"NCM"),
        cest:get(prod,"CEST"), cfop:get(prod,"CFOP"), unidade:get(prod,"uCom"),
        cEAN:(get(prod,"cEAN")||"").replace(/^SEM GTIN$/i,""),
        ean:(get(prod,"cEANTrib")||get(prod,"cEAN")||"").replace(/^SEM GTIN$/i,""),
        quantidade:parseFloat(get(prod,"qCom")||0), valor_unitario:parseFloat(get(prod,"vUnCom")||0),
        valor_total:parseFloat(get(prod,"vProd")||0),
        valor_frete:parseFloat(get(prod,"vFrete")||0),
        valor_desconto:parseFloat(get(prod,"vDesc")||0),
        valor_seguro:parseFloat(get(prod,"vSeg")||0),
        valor_outras_desp:parseFloat(get(prod,"vOutro")||0),
        cst:cstProd,
        orig:get(icms,"orig")||"",
        base_icms:parseFloat(get(icms,"vBC")||0), aliquota_icms:parseFloat(get(icms,"pICMS")||0),
        valor_icms:parseFloat(get(icms,"vICMS")||0), valor_ipi:parseFloat(get(ipi,"vIPI")||0),
        valor_icms_st_ret:parseFloat(get(icms,"vICMSSTRet")||0),
        base_icms_st_xml:parseFloat(get(icms,"vBCST")||0),
        valor_icms_st_xml:parseFloat(get(icms,"vICMSST")||0),
        aliquota_icms_st_xml:parseFloat(get(icms,"pICMSST")||0),
        mva_xml:parseFloat(get(icms,"pMVAST")||0),
        reducao_bc_xml:parseFloat(get(icms,"pRedBC")||0),
        reducao_bc_st_xml:parseFloat(get(icms,"pRedBCST")||0),
        info_adicional: infAd,
        vPMC: vPMCFinal,
        pmc_origem: vPMCTag ? "tag" : (vPMCFinal ? "descricao" : null),
        pmpf: pmpfFinal,
        pmpf_origem: pmpfTag ? "tag" : (pmpfFinal ? "descricao" : null),
        permissoes_cst: permCST,
        analise:[],
      });
    }
    return {nota, produtos, erro:null};
  } catch(e) { return {nota:null,produtos:[],erro:"Erro ao processar o XML: "+e.message}; }
}
