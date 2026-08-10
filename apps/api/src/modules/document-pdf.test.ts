import { describe, it, expect } from "vitest";
import { renderujDokumentHtml, escapujHtml } from "./documents/service.js";
import type { DocumentBlockDto } from "@chatv2/shared";

// Skladanie dokumentu do HTML, z ktorego Gotenberg robi PDF. Chromium po tamtej
// stronie WYKONUJE skrypty, wiec escapowanie tresci jest tu warunkiem
// bezpieczenstwa, a nie kosmetyka.

function blok(data: DocumentBlockDto["data"], id = "b1"): DocumentBlockDto {
  return { id, position: 1000, version: 1, data, updatedById: null, updatedAt: new Date().toISOString() };
}

describe("dokument do PDF", () => {
  it("escapuje znaki o znaczeniu w HTML", async () => {
    expect(escapujHtml(`<script>alert("x")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"
    );
  });

  it("nie przepuszcza skryptu z tresci akapitu", async () => {
    const html = renderujDokumentHtml({
      title: "Zwykly tytul",
      icon: null,
      bloki: [blok({ type: "text", text: "<script>fetch('//zly.example')</script>" })]
    });
    expect(html).not.toContain("<script>fetch");
    expect(html).toContain("&lt;script&gt;");
  });

  it("nie przepuszcza skryptu z tytulu", async () => {
    const html = renderujDokumentHtml({
      title: "<img src=x onerror=alert(1)>",
      icon: null,
      bloki: []
    });
    expect(html).not.toContain("<img src=x");
  });

  it("nie przepuszcza skryptu z komorki tabeli", async () => {
    const html = renderujDokumentHtml({
      title: "Tabela",
      icon: null,
      bloki: [
        blok({
          type: "table",
          header: ["<b>Naglowek</b>"],
          align: ["left"],
          rows: [["<script>x</script>"]]
        })
      ]
    });
    expect(html).not.toContain("<script>x");
    expect(html).not.toContain("<b>Naglowek</b>");
  });

  it("zachowuje strukture tabeli", async () => {
    const html = renderujDokumentHtml({
      title: "Raport",
      icon: null,
      bloki: [
        blok({
          type: "table",
          header: ["Pozycja", "Kwota"],
          align: ["left", "right"],
          rows: [["Prowizja", "1200"]]
        })
      ]
    });
    expect(html).toContain("<th style=\"text-align:left\">Pozycja</th>");
    expect(html).toContain("<td style=\"text-align:right\">1200</td>");
  });

  it("oznacza wykonane pozycje listy zadan", async () => {
    const html = renderujDokumentHtml({
      title: "Lista",
      icon: null,
      bloki: [
        blok({
          type: "checklist",
          items: [
            { id: "1", text: "Zrobione", checked: true, checkedById: null, checkedAt: null },
            { id: "2", text: "Do zrobienia", checked: false, checkedById: null, checkedAt: null }
          ]
        })
      ]
    });
    expect(html).toContain("☑");
    expect(html).toContain("☐");
    expect(html).toContain('class="zrobione"');
  });

  it("zamienia zlamania linii w akapicie na przejscia", async () => {
    const html = renderujDokumentHtml({
      title: "Akapit",
      icon: null,
      bloki: [blok({ type: "text", text: "pierwsza\ndruga" })]
    });
    expect(html).toContain("pierwsza<br>druga");
  });

  it("sklada dokument bez zasobow zewnetrznych", async () => {
    // PDF ma powstawac bez siegania do sieci: zaden http(s) w wyjsciu.
    const html = renderujDokumentHtml({
      title: "Bez sieci",
      icon: "📄",
      bloki: [blok({ type: "divider" })]
    });
    expect(html).not.toMatch(/src=|href=|https?:\/\//);
  });
});
