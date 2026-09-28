import { createFileRoute } from "@tanstack/react-router";
import FiscoAI from "@/components/FiscoAI";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "FiscoAI — Análise de ICMS, ST e DIFAL" },
      { name: "description", content: "Análise automática de NF-e: ISENÇÃO, Redução BC, ICMS-ST e Antecipação BA com motor inteligente Convênio 142/18 e Protocolos 41/08 e 97/10." },
    ],
  }),
  component: FiscoAI,
});
