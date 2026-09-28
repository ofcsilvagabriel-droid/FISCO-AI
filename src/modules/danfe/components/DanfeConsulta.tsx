import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { useDanfe } from "@/modules/danfe/hooks/useDanfe";

export default function DanfeConsulta() {
  const {
    chave,
    setChave,
    formatarChave,
    loading,
    error,
    result,
    blobUrl,
    arquivoXml,
    chaveExtraida,
    handleFile,
    clearFile,
    canSubmit,
    consultar,
    download,
    reset,
  } = useDanfe();

  const [dragOver, setDragOver] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) void handleFile(file);
    },
    [handleFile],
  );

  const doConsultar = useCallback(async () => {
    await consultar();
    // abre modal automaticamente se houver resultado
    setModalOpen(true);
  }, [consultar]);

  return (
    <div className="grid gap-5" style={{ gridTemplateColumns: "1fr 320px" }}>
      {/* CARD PRINCIPAL */}
      <div className="rounded-xl border border-white/10 bg-white/[0.03] p-5">
        <div className="text-sm font-bold text-white/90 mb-4 flex items-center gap-2">
          <span>📥</span> Consultar DANFE / XML via API MeuDanfe
        </div>

        {error && (
          <div className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
            ❌ {error}
          </div>
        )}

        {/* Dropzone XML */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-6 text-center transition ${
            dragOver
              ? "border-blue-400 bg-blue-500/10"
              : "border-white/15 bg-white/[0.02] hover:border-white/30"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".xml,text/xml,application/xml"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              void handleFile(f);
              if (inputRef.current) inputRef.current.value = "";
            }}
          />
          <div className="text-3xl mb-1">📄</div>
          <div className="text-xs text-white/70">
            Arraste um <strong>.xml</strong> aqui ou clique para selecionar
          </div>
          <div className="text-[10px] text-emerald-300 mt-1">
            ✨ Conversão via XML é <strong>100% GRATUITA</strong>
          </div>
          {arquivoXml && (
            <div className="mt-3 inline-flex items-center gap-2 rounded-md bg-emerald-500/15 px-3 py-1 text-[11px] text-emerald-300 border border-emerald-500/30">
              ✅ {arquivoXml.name}
              <button
                type="button"
                className="ml-1 text-emerald-200 hover:text-white"
                onClick={(e) => {
                  e.stopPropagation();
                  clearFile();
                }}
              >
                ✕
              </button>
            </div>
          )}
          {arquivoXml && !chaveExtraida && (
            <div className="mt-2 text-[10px] text-amber-300">
              ⚠️ Não foi possível extrair a chave — informe manualmente abaixo.
            </div>
          )}
        </div>

        {/* Chave (apenas exibição — consulta por chave é PAGA e está bloqueada) */}
        <div className="mt-4">
          <label className="text-[11px] font-semibold text-white/60 mb-1 block">
            Chave de Acesso (extraída do XML)
          </label>
          <input
            type="text"
            readOnly
            value={formatarChave(chave)}
            placeholder="A chave aparecerá aqui após o upload do XML"
            className="w-full rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-sm font-mono tracking-wider text-white/70 outline-none cursor-not-allowed"
          />
          <div className="mt-1 flex items-center justify-between text-[10px]">
            <span className="text-white/40">{chave.length}/44 dígitos</span>
            <span className="text-amber-300">
              🚫 Consulta apenas por chave é PAGA — bloqueada por política
            </span>
          </div>
        </div>

        {/* Ações */}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={doConsultar}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow disabled:cursor-not-allowed disabled:opacity-40 hover:bg-blue-500 transition"
          >
            {loading ? "⏳ Consultando..." : "🚀 Consultar DANFE"}
          </button>
          {result && (
            <button
              type="button"
              onClick={() => setModalOpen(true)}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold text-white/90 hover:bg-white/20 transition"
            >
              👁️ Visualizar novamente
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/70 hover:bg-white/5 transition"
          >
            Limpar
          </button>
        </div>

        {/* Loading skeleton */}
        {loading && (
          <div className="mt-5 space-y-2">
            <div className="h-3 w-2/3 animate-pulse rounded bg-white/10" />
            <div className="h-3 w-full animate-pulse rounded bg-white/10" />
            <div className="h-40 w-full animate-pulse rounded bg-white/10" />
          </div>
        )}

        {/* Resultado */}
        {!loading && result && (
          <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-200">
            ✅ Documento recebido — formato <strong>{result.format.toUpperCase()}</strong> ·{" "}
            {(result.bytes / 1024).toFixed(1)} KB ·{" "}
            <button className="underline hover:text-white" onClick={download}>
              baixar {result.filename}
            </button>
          </div>
        )}
      </div>

      {/* SIDE INFO */}
      <div className="space-y-4">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-bold text-white/90 mb-2">ℹ️ Como funciona</div>
          <ul className="space-y-2 text-[11px] text-white/60 leading-relaxed">
            <li>• Arraste o <strong>XML</strong> da NF-e ou cole a <strong>chave de 44 dígitos</strong>.</li>
            <li>• A consulta é feita no servidor com credenciais protegidas.</li>
            <li>• O DANFE (PDF) abre em um visualizador interno com opção de download.</li>
            <li>• Nomeação padrão: <code className="text-white/80">DANFE_&lt;chave&gt;.pdf</code></li>
          </ul>
        </div>
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
          <div className="text-sm font-bold text-white/90 mb-2">🔐 Segurança</div>
          <p className="text-[11px] text-white/60 leading-relaxed">
            A chave da API MeuDanfe é armazenada nas variáveis de ambiente do Lovable Cloud e
            nunca é exposta ao navegador — a requisição HTTP é executada no backend.
          </p>
        </div>
      </div>

      {/* MODAL */}
      {modalOpen && result && blobUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="flex h-[90vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-white/10 bg-neutral-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div>
                <div className="text-sm font-bold text-white">
                  {result.format === "pdf" ? "DANFE" : result.format.toUpperCase()} — {result.chave}
                </div>
                <div className="text-[10px] text-white/50">
                  {result.contentType} · {(result.bytes / 1024).toFixed(1)} KB
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={download}
                  className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 transition"
                >
                  ⬇️ Baixar {result.format.toUpperCase()}
                </button>
                <button
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 transition"
                >
                  Fechar
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto bg-neutral-950">
              {result.format === "pdf" ? (
                <object
                  data={blobUrl}
                  type="application/pdf"
                  className="h-full w-full"
                  aria-label={`DANFE ${result.chave}`}
                >
                  <div className="p-6 text-sm text-white/70 space-y-3">
                    <p>
                      Seu navegador bloqueou a pré-visualização do PDF.
                    </p>
                    <button
                      onClick={download}
                      className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 transition"
                    >
                      ⬇️ Baixar DANFE
                    </button>
                    <a
                      href={blobUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-block rounded-lg border border-white/20 px-4 py-2 text-xs text-white/80 hover:bg-white/10 transition"
                    >
                      🔗 Abrir em nova aba
                    </a>
                  </div>
                </object>
              ) : result.format === "xml" ? (
                <XmlPreview blobUrl={blobUrl} />
              ) : (
                <div className="p-6 text-sm text-white/70">
                  Formato não suportado para pré-visualização. Utilize o botão de download.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function XmlPreview({ blobUrl }: { blobUrl: string }) {
  const [text, setText] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    fetch(blobUrl)
      .then((r) => r.text())
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setText("Falha ao ler XML.");
      });
    return () => {
      cancelled = true;
    };
  }, [blobUrl]);
  return (
    <pre className="whitespace-pre-wrap break-all p-4 font-mono text-[11px] leading-relaxed text-emerald-200">
      {text || "Carregando..."}
    </pre>
  );
}
