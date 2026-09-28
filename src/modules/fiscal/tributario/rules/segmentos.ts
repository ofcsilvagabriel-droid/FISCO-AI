// Dicionário de segmentos tributários. Estrutura de dados pura —
// adicionar um segmento novo NÃO exige alteração de código.
export interface DefinicaoSegmento {
  segmento: string;
  subsegmentos: Record<string, string[]>; // subsegmento -> palavras-chave
  palavras: string[];
  capitulosNCM: string[];   // capítulos (2 díg.) típicos do segmento
  aliasLegais: string[];    // termos usados nos segmentos da base legal
}

export const SEGMENTOS: DefinicaoSegmento[] = [
  {
    segmento: "AUTOPECAS",
    subsegmentos: {
      MOTOR: ["pistao", "virabrequim", "biela", "junta", "cabecote", "vela", "correia"],
      FREIO: ["pastilha", "lona", "disco", "tambor", "fluido"],
      SUSPENSAO: ["amortecedor", "mola", "bandeja", "pivo", "bucha", "batente"],
      ELETRICA: ["bateria", "alternador", "motor", "partida", "farol", "lampada"],
      FILTRAGEM: ["filtro", "elemento", "purificador"],
      PNEUMATICO: ["pneu", "camara", "protetor", "aro"],
    },
    palavras: ["automotivo", "automotor", "veiculo", "carro", "caminhao", "moto", "peca", "acessorio", "retrovisor", "parachoque", "escapamento", "embreagem", "radiador"],
    capitulosNCM: ["40", "70", "84", "85", "87", "90"],
    aliasLegais: ["AUTOPEÇAS", "VEÍCULOS AUTOMOTORES", "PNEUMÁTICOS"],
  },
  {
    segmento: "FARMACEUTICO",
    subsegmentos: {
      MEDICAMENTO: ["comprimido", "capsula", "xarope", "pomada", "injetavel", "ampola"],
      CORRELATO: ["seringa", "agulha", "curativo", "gaze", "preservativo", "algodao"],
    },
    palavras: ["medicamento", "remedio", "farmaco", "generico", "similar", "vitamina", "soro", "antibiotico"],
    capitulosNCM: ["29", "30", "40", "90"],
    aliasLegais: ["MEDICAMENTOS", "PRODUTOS FARMACÊUTICOS"],
  },
  {
    segmento: "ALIMENTICIO",
    subsegmentos: {
      PANIFICACAO: ["biscoito", "bolacha", "pao", "bolo", "torrada", "massa"],
      CONFEITARIA: ["chocolate", "bombom", "bala", "chiclete", "doce", "achocolatado"],
      MERCEARIA: ["arroz", "feijao", "acucar", "sal", "farinha", "oleo", "molho", "conserva", "cafe"],
      CARNES: ["carne", "linguica", "salsicha", "presunto", "mortadela", "embutido"],
    },
    palavras: ["alimento", "alimenticio", "comestivel", "snack", "salgadinho", "cereal"],
    capitulosNCM: ["04", "07", "08", "09", "10", "11", "15", "16", "17", "18", "19", "20", "21"],
    aliasLegais: ["PRODUTOS ALIMENTÍCIOS", "RAÇÕES"],
  },
  {
    segmento: "LATICINIOS",
    subsegmentos: {
      QUEIJOS: ["queijo", "requeijao", "muçarela", "mussarela", "parmesao", "ricota"],
      LEITE: ["leite", "creme", "nata", "condensado", "iogurte", "bebida"],
      GORDURAS: ["manteiga", "margarina"],
    },
    palavras: ["laticinio", "lacteo", "cremoso"],
    capitulosNCM: ["04", "15"],
    aliasLegais: ["PRODUTOS ALIMENTÍCIOS", "LATICÍNIOS"],
  },
  {
    segmento: "BEBIDAS",
    subsegmentos: {
      ALCOOLICAS: ["cerveja", "chope", "chopp", "vinho", "vodka", "cachaca", "whisky", "licor"],
      NAO_ALCOOLICAS: ["refrigerante", "refri", "suco", "agua", "energetico", "isotonico", "nectar"],
    },
    palavras: ["bebida", "garrafa", "lata", "litro"],
    capitulosNCM: ["20", "22"],
    aliasLegais: ["CERVEJAS, CHOPE, REFRIGERANTES, ÁGUA E OUTRAS BEBIDAS", "BEBIDAS ALCOÓLICAS"],
  },
  {
    segmento: "COSMETICOS",
    subsegmentos: {
      HIGIENE: ["sabonete", "shampoo", "condicionador", "creme", "dental", "escova", "desodorante", "absorvente", "fralda", "papel"],
      MAQUIAGEM: ["batom", "rimel", "base", "po", "esmalte"],
    },
    palavras: ["cosmetico", "higiene", "pessoal", "toucador", "hidratante"],
    capitulosNCM: ["33", "34", "48", "96"],
    aliasLegais: ["PRODUTOS DE PERFUMARIA E DE HIGIENE PESSOAL E COSMÉTICOS"],
  },
  {
    segmento: "PERFUMARIA",
    subsegmentos: { PERFUME: ["perfume", "colonia", "deo", "fragrancia", "eau"] },
    palavras: ["perfumaria", "perfume"],
    capitulosNCM: ["33"],
    aliasLegais: ["PRODUTOS DE PERFUMARIA E DE HIGIENE PESSOAL E COSMÉTICOS"],
  },
  {
    segmento: "CONSTRUCAO",
    subsegmentos: {
      ESTRUTURA: ["cimento", "areia", "brita", "bloco", "tijolo", "telha", "viga", "vergalhao"],
      ACABAMENTO: ["tinta", "verniz", "massa", "argamassa", "rejunte", "porcelanato", "azulejo", "piso"],
    },
    palavras: ["construcao", "obra", "civil", "revestimento"],
    capitulosNCM: ["25", "32", "38", "39", "68", "69", "72", "73"],
    aliasLegais: ["MATERIAIS DE CONSTRUÇÃO E CONGÊNERES"],
  },
  {
    segmento: "MATERIAL_ELETRICO",
    subsegmentos: { INSTALACAO: ["fio", "cabo", "disjuntor", "tomada", "interruptor", "conduite", "quadro", "lampada", "reator"] },
    palavras: ["eletrico", "eletrica", "eletricidade", "energia", "voltagem"],
    capitulosNCM: ["83", "85", "94"],
    aliasLegais: ["MATERIAIS ELÉTRICOS"],
  },
  {
    segmento: "HIDRAULICO",
    subsegmentos: { TUBOS: ["tubo", "conexao", "joelho", "luva", "registro", "torneira", "sifao", "caixa"] },
    palavras: ["hidraulico", "hidraulica", "encanamento", "esgoto"],
    capitulosNCM: ["39", "73", "74", "84"],
    aliasLegais: ["MATERIAIS DE CONSTRUÇÃO E CONGÊNERES"],
  },
  {
    segmento: "INFORMATICA",
    subsegmentos: { HARDWARE: ["computador", "notebook", "monitor", "teclado", "mouse", "impressora", "hd", "ssd", "memoria", "placa"] },
    palavras: ["informatica", "digital", "usb", "wireless"],
    capitulosNCM: ["84", "85"],
    aliasLegais: ["PRODUTOS ELETRÔNICOS, ELETROELETRÔNICOS E ELETRODOMÉSTICOS"],
  },
  {
    segmento: "ELETRONICOS",
    subsegmentos: { ELETRODOMESTICO: ["geladeira", "fogao", "microondas", "liquidificador", "ventilador", "televisor", "celular", "radio"] },
    palavras: ["eletronico", "eletrodomestico", "eletroeletronico"],
    capitulosNCM: ["84", "85"],
    aliasLegais: ["PRODUTOS ELETRÔNICOS, ELETROELETRÔNICOS E ELETRODOMÉSTICOS"],
  },
  {
    segmento: "AGROPECUARIO",
    subsegmentos: { INSUMOS: ["fertilizante", "adubo", "semente", "defensivo", "herbicida", "racao", "calcario"] },
    palavras: ["agricola", "agropecuario", "lavoura", "plantio"],
    capitulosNCM: ["10", "12", "23", "31", "38", "84"],
    aliasLegais: ["RAÇÕES", "PRODUTOS AGROPECUÁRIOS"],
  },
  {
    segmento: "VETERINARIO",
    subsegmentos: { MEDICAMENTO: ["vermifugo", "vacina", "antipulgas", "carrapaticida"] },
    palavras: ["veterinario", "animal", "pet", "bovino", "suino", "equino"],
    capitulosNCM: ["23", "30"],
    aliasLegais: ["PRODUTOS FARMACÊUTICOS", "RAÇÕES"],
  },
  {
    segmento: "COMBUSTIVEIS",
    subsegmentos: { DERIVADOS: ["gasolina", "diesel", "etanol", "querosene", "glp", "lubrificante", "graxa"] },
    palavras: ["combustivel", "oleo", "aditivo"],
    capitulosNCM: ["27", "38"],
    aliasLegais: ["COMBUSTÍVEIS E LUBRIFICANTES"],
  },
  {
    segmento: "MAQUINAS",
    subsegmentos: { INDUSTRIAL: ["maquina", "motor", "compressor", "bomba", "torno", "prensa", "caldeira", "turbina", "gerador"] },
    palavras: ["industrial", "equipamento", "aparelho"],
    capitulosNCM: ["84", "85", "90"],
    aliasLegais: ["MÁQUINAS E APARELHOS INDUSTRIAIS"],
  },
  {
    segmento: "FERRAMENTAS",
    subsegmentos: { MANUAL: ["chave", "alicate", "martelo", "serra", "broca", "furadeira", "parafusadeira", "lixa", "trena"] },
    palavras: ["ferramenta", "ferramentaria"],
    capitulosNCM: ["82", "84", "85"],
    aliasLegais: ["FERRAMENTAS"],
  },
  {
    segmento: "TEXTIL",
    subsegmentos: { VESTUARIO: ["camisa", "calca", "blusa", "meia", "tecido", "malha", "toalha", "lencol", "cobertor"] },
    palavras: ["textil", "algodao", "poliester", "confeccao"],
    capitulosNCM: ["52", "54", "55", "60", "61", "62", "63"],
    aliasLegais: ["VESTUÁRIO", "PRODUTOS TÊXTEIS"],
  },
  {
    segmento: "CALCADOS",
    subsegmentos: { CALCADO: ["sapato", "tenis", "chinelo", "sandalia", "bota", "palmilha"] },
    palavras: ["calcado", "solado"],
    capitulosNCM: ["64"],
    aliasLegais: ["CALÇADOS"],
  },
  {
    segmento: "PAPELARIA",
    subsegmentos: { ESCOLAR: ["caderno", "caneta", "lapis", "borracha", "cola", "papel", "agenda", "mochila", "tesoura"] },
    palavras: ["papelaria", "escritorio", "escolar"],
    capitulosNCM: ["39", "48", "96"],
    aliasLegais: ["PAPÉIS, PLÁSTICOS, PRODUTOS CERÂMICOS E VIDROS", "MATERIAIS DE ESCRITÓRIO"],
  },
  {
    segmento: "LIMPEZA",
    subsegmentos: { SANEANTE: ["detergente", "sabao", "desinfetante", "agua", "sanitaria", "amaciante", "alvejante", "inseticida", "esponja", "vassoura"] },
    palavras: ["limpeza", "limpador", "saneante"],
    capitulosNCM: ["28", "34", "38", "39", "96"],
    aliasLegais: ["PRODUTOS DE LIMPEZA"],
  },
  {
    segmento: "MOVEIS",
    subsegmentos: { MOBILIARIO: ["mesa", "cadeira", "armario", "estante", "cama", "colchao", "sofa", "guarda"] },
    palavras: ["movel", "moveis", "mobiliario", "madeira", "mdf"],
    capitulosNCM: ["44", "94"],
    aliasLegais: ["MÓVEIS"],
  },
  {
    segmento: "BRINQUEDOS",
    subsegmentos: { BRINQUEDO: ["boneca", "boneco", "carrinho", "quebra", "jogo", "pelucia", "bola"] },
    palavras: ["brinquedo", "infantil", "recreativo"],
    capitulosNCM: ["95"],
    aliasLegais: ["BRINQUEDOS", "ARTIGOS DE PAPELARIA"],
  },
];

export const SEGMENTO_INDEFINIDO = "NAO_IDENTIFICADO";
