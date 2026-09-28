import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { consultarDanfe, type ConsultaDanfeResult } from "@/modules/danfe/services/meudanfe.functions";

function extrairChaveDeXml(xml: string): string | null {
  const idMatch = xml.match(/Id\s*=\s*"NFe(\d{44})"/i);
  if (idMatch) return idMatch[1];
  const chMatch = xml.match(/<chNFe>\s*(\d{44})\s*<\/chNFe>/i);
  if (chMatch) return chMatch[1];
  const infMatch = xml.match(/infNFe[^>]*Id\s*=\s*"?NFe?(\d{44})"?/i);
  if (infMatch) return infMatch[1];
  return null;
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const byteChars = atob(base64);
  const bytes = new Uint8Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
  return new Blob([bytes.buffer], { type: contentType });
}

export interface UseDanfeState {
  chave: string;
  setChave: (v: string) => void;
  formatarChave: (v: string) => string;
  loading: boolean;
  error: string | null;
  result: ConsultaDanfeResult | null;
  blobUrl: string | null;
  arquivoXml: File | null;
  xmlContent: string | null;
  chaveExtraida: string | null;
  handleFile: (file: File | null) => Promise<void>;
  clearFile: () => void;
  canSubmit: boolean;
  consultar: () => Promise<void>;
  download: () => void;
  reset: () => void;
}

export function useDanfe(): UseDanfeState {
  const consultarFn = useServerFn(consultarDanfe);
  const [chave, setChaveRaw] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConsultaDanfeResult | null>(null);
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [arquivoXml, setArquivoXml] = useState<File | null>(null);
  const [xmlContent, setXmlContent] = useState<string | null>(null);
  const [chaveExtraida, setChaveExtraida] = useState<string | null>(null);
  const lastUrlRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    };
  }, []);

  const setChave = useCallback((v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 44);
    setChaveRaw(digits);
    setError(null);
  }, []);

  const formatarChave = useCallback((v: string) => {
    return v.replace(/\D/g, "").slice(0, 44).replace(/(.{4})/g, "$1 ").trim();
  }, []);

  const handleFile = useCallback(async (file: File | null) => {
    setError(null);
    if (!file) {
      setArquivoXml(null);
      setXmlContent(null);
      setChaveExtraida(null);
      return;
    }
    if (!/\.xml$/i.test(file.name)) {
      setError("Apenas arquivos .xml são aceitos.");
      return;
    }
    try {
      const text = await file.text();
      const extraida = extrairChaveDeXml(text);
      setArquivoXml(file);
      setXmlContent(text);
      setChaveExtraida(extraida);
      if (extraida) {
        setChaveRaw(extraida);
        toast.success("XML carregado — conversão GRATUITA disponível", { description: extraida });
      } else {
        toast.info("XML carregado. A conversão para PDF é gratuita.");
      }
    } catch (err) {
      setError("Erro ao ler o arquivo XML: " + (err as Error).message);
    }
  }, []);

  const clearFile = useCallback(() => {
    setArquivoXml(null);
    setXmlContent(null);
    setChaveExtraida(null);
  }, []);

  const canSubmit = useMemo(() => {
    if (loading) return false;
    // Apenas o fluxo GRATUITO (via XML) é permitido. Chave sozinha é PAGA e bloqueada.
    return !!xmlContent;
  }, [xmlContent, loading]);

  const consultar = useCallback(async () => {
    if (!xmlContent && !/^\d{44}$/.test(chave)) {
      setError("Envie um XML (grátis) ou informe uma chave de acesso válida (44 dígitos).");
      return;
    }
    setLoading(true);
    setError(null);
    setResult(null);
    if (lastUrlRef.current) {
      URL.revokeObjectURL(lastUrlRef.current);
      lastUrlRef.current = null;
      setBlobUrl(null);
    }
    try {
      const payload: { chave?: string; xml?: string } = xmlContent
        ? { xml: xmlContent }
        : { chave };
      const data = await consultarFn({ data: payload });
      const blob = base64ToBlob(data.base64, data.contentType);
      const url = URL.createObjectURL(blob);
      lastUrlRef.current = url;
      setBlobUrl(url);
      setResult(data);
      toast.success(
        data.gratuita ? "DANFE gerada (GRÁTIS)" : "DANFE recuperada com sucesso",
        { description: `${data.format.toUpperCase()} · ${(data.bytes / 1024).toFixed(1)} KB` },
      );
    } catch (err) {
      const msg = (err as Error).message || "Erro desconhecido ao consultar a API.";
      setError(msg);
      toast.error("Falha ao consultar DANFE", { description: msg });
    } finally {
      setLoading(false);
    }
  }, [chave, xmlContent, consultarFn]);

  const download = useCallback(() => {
    if (!result || !blobUrl) return;
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = result.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }, [result, blobUrl]);

  const reset = useCallback(() => {
    setChaveRaw("");
    setError(null);
    setResult(null);
    setArquivoXml(null);
    setXmlContent(null);
    setChaveExtraida(null);
    if (lastUrlRef.current) URL.revokeObjectURL(lastUrlRef.current);
    lastUrlRef.current = null;
    setBlobUrl(null);
  }, []);

  return {
    chave,
    setChave,
    formatarChave,
    loading,
    error,
    result,
    blobUrl,
    arquivoXml,
    xmlContent,
    chaveExtraida,
    handleFile,
    clearFile,
    canSubmit,
    consultar,
    download,
    reset,
  };
}
