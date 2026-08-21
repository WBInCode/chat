import { env } from "../config/env.js";

/**
 * Converts an office document (docx/xlsx/pptx) to PDF using Gotenberg's
 * LibreOffice route. Gotenberg runs LibreOffice headless in an isolated
 * container — arbitrary macros/formulas in the source document execute
 * there, never on the API host.
 */
export async function convertToPdf(buffer: Buffer, fileName: string): Promise<Buffer> {
  const form = new FormData();
  form.append("files", new Blob([new Uint8Array(buffer)]), fileName);

  const res = await fetch(`${env.GOTENBERG_URL}/forms/libreoffice/convert`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gotenberg conversion failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}

/**
 * Renderuje gotowy HTML do PDF (trasa Chromium). Używane do dokumentów
 * składanych z bloków — inaczej niż konwersja plików biurowych, tu źródłem
 * jest treść, którą sami generujemy.
 *
 * Cała zawartość musi być już zescapowana przez wywołującego: Chromium
 * wykonuje skrypty, a dokument tworzą użytkownicy.
 */
export async function convertHtmlToPdf(html: string): Promise<Buffer> {
  const form = new FormData();
  // Gotenberg wymaga dokładnie tej nazwy pliku dla strony wejściowej.
  form.append("files", new Blob([html], { type: "text/html" }), "index.html");
  form.append("marginTop", "0.6");
  form.append("marginBottom", "0.6");
  form.append("marginLeft", "0.6");
  form.append("marginRight", "0.6");

  const res = await fetch(`${env.GOTENBERG_URL}/forms/chromium/convert/html`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(60_000)
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gotenberg HTML conversion failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return Buffer.from(await res.arrayBuffer());
}
