// ============================================================
// MATRIZ DE PRODUTOS DA CESTA BÁSICA DA BAHIA (SEI — Salvador)
// ------------------------------------------------------------
// BASE DE PRODUTOS ≠ BENEFÍCIO FISCAL.
// Esta matriz apenas IDENTIFICA o produto (chave principal = NCM).
// O tratamento tributário (isenção, redução de base, alíquota
// reduzida) é determinado separadamente pela legislação vigente
// e por isso `tipoBeneficio`, `fundamentoLegal` e vigências
// permanecem nulos até serem preenchidos com a norma aplicável.
//
// Ordem de identificação:
//   NCM EXATO → SUBPOSIÇÃO → POSIÇÃO → DESCRIÇÃO FISCAL
//   → CARACTERÍSTICAS → CONDIÇÕES DA LEGISLAÇÃO
// ============================================================

/**
 * @typedef {Object} ItemCestaBasica
 * @property {string} codigo
 * @property {string} nome
 * @property {string} categoria
 * @property {string[]} ncm              NCMs completos (8 dígitos, sem pontos)
 * @property {string[]} [ncmFamilia]     Posições/subposições (4 ou 6 dígitos)
 * @property {string[]} [palavrasChave]  Apenas para SUGERIR análise
 * @property {string|null} tipoBeneficio
 * @property {boolean|null} geraICMS
 * @property {string[]} calculosProibidos
 * @property {string[]} ufOrigem
 * @property {string[]} ufDestino
 * @property {string[]} tipoOperacao
 * @property {string|null} fundamentoLegal
 * @property {string|null} vigenciaInicio
 * @property {string|null} vigenciaFim
 * @property {string[]} condicoes
 * @property {string[]} excecoes
 * @property {number} prioridade
 */

const BASE = {
  tipoBeneficio: null,
  geraICMS: null,
  calculosProibidos: [],
  ufOrigem: ["BA"],
  ufDestino: ["BA"],
  tipoOperacao: ["INTERNA"],
  fundamentoLegal: null,
  vigenciaInicio: null,
  vigenciaFim: null,
  condicoes: [],
  excecoes: [],
  prioridade: 100,
};

/** @type {ItemCestaBasica[]} */
export const MATRIZ_CESTA_BASICA_BA = [
  {
    ...BASE,
    codigo: "CESTA_BA_001",
    nome: "Feijão",
    categoria: "Leguminosas",
    ncm: ["07133319", "07133329", "07133399", "07133590"],
    ncmFamilia: ["0713"],
    palavrasChave: ["feijao", "feijao carioca", "feijao preto", "feijao fradinho"],
    condicoes: ["Verificar espécie/variedade e estado (seco, em grão) previstos na legislação."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_002",
    nome: "Arroz",
    categoria: "Cereais",
    ncm: [
      "10061091", "10061092", "10062010", "10062020",
      "10063011", "10063019", "10063021", "10063029", "10064000",
    ],
    ncmFamilia: ["1006"],
    palavrasChave: ["arroz"],
    condicoes: ["Benefício vinculado ao enquadramento fiscal efetivo, não a derivados de arroz."],
    excecoes: ["Preparações e derivados de arroz classificados fora da posição 10.06."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_003",
    nome: "Macarrão / Massas alimentícias",
    categoria: "Massas alimentícias",
    ncm: ["19021100", "19021900", "19022000", "19023000", "19024000"],
    ncmFamilia: ["1902"],
    palavrasChave: ["macarrao", "massa alimenticia", "espaguete", "lasanha", "nhoque", "raviole", "canelone", "cuscuz"],
    condicoes: ["Não aplicar por conter a palavra 'macarrão' — verificar o NCM efetivo (posição 19.02)."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_004",
    nome: "Farinha de mandioca",
    categoria: "Farinhas e derivados",
    ncm: ["11062000"],
    ncmFamilia: ["1106"],
    palavrasChave: ["farinha de mandioca", "farinha mandioca"],
    condicoes: ["Verificar descrição e condições específicas do produto na legislação."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_005",
    nome: "Carne bovina de primeira",
    categoria: "Carnes bovinas",
    ncm: [],
    ncmFamilia: ["0201", "020110", "020120", "020130", "0202", "020210", "020220", "020230"],
    palavrasChave: ["carne bovina", "alcatra", "coxao", "patinho", "file", "contra file", "picanha"],
    condicoes: [
      "Verificar espécie, estado (fresca/refrigerada/congelada), origem, abate e tipo de operação.",
      "Não classificar automaticamente todo NCM 0201/0202 como beneficiado.",
    ],
    prioridade: 90,
  },
  {
    ...BASE,
    codigo: "CESTA_BA_006",
    nome: "Carne bovina de segunda",
    categoria: "Carnes bovinas",
    ncm: [],
    ncmFamilia: ["0201", "020110", "020120", "020130", "0202", "020210", "020220", "020230"],
    palavrasChave: ["carne bovina", "acem", "musculo", "paleta", "costela", "peito bovino"],
    condicoes: [
      "A distinção 'primeira'/'segunda' é comercial e não define, isoladamente, o tratamento tributário.",
      "Classificar pelo NCM e pelas características fiscais da mercadoria.",
    ],
    prioridade: 90,
  },
  {
    ...BASE,
    codigo: "CESTA_BA_007",
    nome: "Carne seca / Charque (carne de sertão)",
    categoria: "Carnes conservadas",
    ncm: ["02102000", "02109900"],
    ncmFamilia: ["0210"],
    palavrasChave: ["carne seca", "charque", "carne de sol", "jabá", "jaba", "carne de sertao"],
    condicoes: ["Regra própria — não equiparar a carne bovina fresca/refrigerada/congelada."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_008",
    nome: "Linguiça calabresa",
    categoria: "Carnes preparadas / embutidos",
    ncm: ["16010000"],
    ncmFamilia: ["1601"],
    palavrasChave: ["linguica calabresa", "calabresa"],
    condicoes: ["A palavra 'calabresa' na descrição não basta — confrontar NCM, descrição e características."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_009",
    nome: "Frango congelado",
    categoria: "Aves",
    ncm: ["02071100", "02071200"],
    ncmFamilia: ["0207"],
    palavrasChave: ["frango", "galo", "galinha", "ave"],
    condicoes: [
      "Verificar: inteiro ou cortado; fresco/refrigerado/congelado; temperado ou não.",
      "Verificar origem, produção interna, abate e demais condições da legislação.",
    ],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_010",
    nome: "Ovos de galinha",
    categoria: "Ovos",
    ncm: ["04072100", "04071100"],
    ncmFamilia: ["0407"],
    palavrasChave: ["ovo", "ovos", "ovo de galinha"],
    condicoes: ["0407.21.00 — ovos frescos de aves da espécie Gallus domesticus."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_011",
    nome: "Óleo de soja",
    categoria: "Óleos vegetais",
    ncm: ["15079011", "15079019", "15079090", "15071000"],
    ncmFamilia: ["1507"],
    palavrasChave: ["oleo de soja", "óleo de soja"],
    condicoes: [
      "Não classificar automaticamente como ISENTO — na Bahia há tratamento de alíquota reduzida.",
      "tipoBeneficio deve ser determinado pela regra vigente aplicável à operação.",
      "1507.90.11 — óleo de soja refinado, em recipientes de até 5 litros.",
    ],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_012",
    nome: "Tomate",
    categoria: "Hortaliças",
    ncm: ["07020000"],
    ncmFamilia: ["0702"],
    palavrasChave: ["tomate"],
    condicoes: ["Verificar se fresco/refrigerado (in natura)."],
    excecoes: ["Produtos industrializados derivados de tomate (extrato, molho, polpa)."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_013",
    nome: "Cebola",
    categoria: "Hortaliças",
    ncm: ["07031011", "07031019", "07031090"],
    ncmFamilia: ["0703"],
    palavrasChave: ["cebola"],
    condicoes: ["Verificar estado natural e demais condições da legislação."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_014",
    nome: "Batata inglesa",
    categoria: "Raízes e tubérculos",
    ncm: ["07019000"],
    ncmFamilia: ["0701"],
    palavrasChave: ["batata inglesa", "batata"],
    condicoes: ["Diferenciar batata in natura de produtos industrializados."],
    excecoes: ["Batata pré-frita, congelada processada, chips e similares."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_015",
    nome: "Cenoura",
    categoria: "Hortaliças / raízes",
    ncm: ["07061000"],
    ncmFamilia: ["0706"],
    palavrasChave: ["cenoura"],
    condicoes: ["Verificar se fresca/refrigerada ou industrializada."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_016",
    nome: "Café moído",
    categoria: "Café",
    ncm: ["09012100"],
    ncmFamilia: ["0901"],
    palavrasChave: ["cafe moido", "cafe torrado", "cafe"],
    condicoes: [
      "Exigir NCM específico (0901.21.00) para aplicação automática do benefício.",
      "Não confundir com preparações à base de café classificadas em outras posições.",
    ],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_017",
    nome: "Açúcar cristal",
    categoria: "Açúcares",
    ncm: ["17011400", "17019900"],
    ncmFamilia: ["1701"],
    palavrasChave: ["acucar cristal", "acucar"],
    condicoes: ["Observar o tipo específico de açúcar; produto que apenas contém açúcar não se enquadra."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_018",
    nome: "Pão francês",
    categoria: "Panificação",
    ncm: ["19059090", "19012010", "19012090"],
    ncmFamilia: ["1905", "190120"],
    palavrasChave: ["pao frances", "pao"],
    condicoes: [
      "Verificar se o produto corresponde ao pão francês definido na legislação — nem todo pão se enquadra.",
      "1901.20.10 / 1901.20.90 aplicam-se a pré-mistura/massa para pão francês.",
    ],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_019",
    nome: "Flocão de milho",
    categoria: "Milho e derivados",
    ncm: ["11031300", "11022000", "11041900", "11042300"],
    ncmFamilia: ["1103", "1102", "1104"],
    palavrasChave: ["flocao", "flocao de milho", "farinha de milho flocada"],
    condicoes: ["NCM é a chave principal — a expressão 'flocão' isolada não enquadra o produto."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_020",
    nome: "Leite",
    categoria: "Leites",
    ncm: [
      "04011010", "04011090", "04012010", "04012090",
      "04014010", "04014090", "04015010", "04015090",
    ],
    ncmFamilia: ["0401"],
    palavrasChave: ["leite", "leite pasteurizado", "leite uht", "leite integral"],
    condicoes: [
      "Diferenciar leite cru, pasteurizado, UHT, concentrado, em pó e bebidas lácteas.",
      "Não aplicar a regra do leite pasteurizado a qualquer produto da posição 04.01.",
    ],
    excecoes: ["Bebidas lácteas e composto lácteo."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_021",
    nome: "Queijo prato / queijo lanche",
    categoria: "Queijos",
    ncm: ["04069090"],
    ncmFamilia: ["0406"],
    palavrasChave: ["queijo prato", "queijo lanche"],
    condicoes: ["Usar a posição 0406 como família; preferir o NCM específico cadastrado no produto."],
    excecoes: ["Demais derivados do leite que não sejam queijo."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_022",
    nome: "Queijo mussarela / muçarela",
    categoria: "Queijos",
    ncm: ["04061010"],
    ncmFamilia: ["0406", "040610"],
    palavrasChave: ["mussarela", "mucarela", "muçarela", "queijo mussarela"],
    condicoes: [],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_023",
    nome: "Manteiga",
    categoria: "Gorduras e derivados do leite",
    ncm: ["04051000"],
    ncmFamilia: ["0405"],
    palavrasChave: ["manteiga"],
    condicoes: ["Diferenciar de margarina, creme vegetal, gordura vegetal, ghee e outras preparações."],
    excecoes: ["Margarina, creme vegetal, gordura vegetal, ghee."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_024",
    nome: "Banana prata",
    categoria: "Frutas",
    ncm: ["08039000"],
    ncmFamilia: ["0803"],
    palavrasChave: ["banana", "banana prata"],
    condicoes: ["Verificar fruta fresca, espécie/tipo e estado natural."],
    excecoes: ["Produtos derivados/processados de banana."],
  },
  {
    ...BASE,
    codigo: "CESTA_BA_025",
    nome: "Maçã",
    categoria: "Frutas",
    ncm: ["08081000"],
    ncmFamilia: ["0808"],
    palavrasChave: ["maca", "maçã", "maca fuji", "maca gala"],
    condicoes: ["Verificar se fruta fresca/in natura ou produto processado."],
  },
];

export const CESTA_BASICA_BA_TOTAL = MATRIZ_CESTA_BASICA_BA.length;
