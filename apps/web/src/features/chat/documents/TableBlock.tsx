import { useRef } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Plus,
  Trash2
} from "lucide-react";
import { TABLE_MAX_COLUMNS, TABLE_MAX_ROWS, type CellAlign, type TableBlockData } from "@chatv2/shared";
import { Icon } from "../../../components/Icon.js";

interface TableBlockProps {
  data: TableBlockData;
  editing: boolean;
  onChange: (data: TableBlockData) => void;
}

const ALIGN_CLASS: Record<CellAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right"
};

const ALIGN_ICON: Record<CellAlign, typeof AlignLeft> = {
  left: AlignLeft,
  center: AlignCenter,
  right: AlignRight
};

const ALIGN_ORDER: CellAlign[] = ["left", "center", "right"];

/**
 * Splits clipboard text pasted from a spreadsheet. Excel and Sheets both put
 * tab-separated cells and newline-separated rows on the clipboard, so a
 * multi-cell paste can fill the grid instead of dumping everything into one
 * cell. A paste without tabs or newlines is treated as ordinary text.
 */
function parseClipboardGrid(text: string): string[][] | null {
  if (!text.includes("\t") && !text.includes("\n")) return null;
  const rows = text.replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
  return rows.map((row) => row.split("\t"));
}

/** Table with editable cells, column and row controls, and spreadsheet paste. */
export function TableBlock({ data, editing, onChange }: TableBlockProps) {
  const width = data.header.length;
  const cellRefs = useRef(new Map<string, HTMLInputElement>());

  function setHeader(index: number, value: string) {
    onChange({ ...data, header: data.header.map((h, i) => (i === index ? value : h)) });
  }

  function setCell(rowIndex: number, colIndex: number, value: string) {
    onChange({
      ...data,
      rows: data.rows.map((row, r) =>
        r === rowIndex ? row.map((cell, c) => (c === colIndex ? value : cell)) : row
      )
    });
  }

  function addColumn() {
    if (width >= TABLE_MAX_COLUMNS) return;
    onChange({
      ...data,
      header: [...data.header, `Kolumna ${width + 1}`],
      align: [...data.align, "left"],
      rows: data.rows.map((row) => [...row, ""])
    });
  }

  function removeColumn(index: number) {
    if (width <= 1) return;
    onChange({
      ...data,
      header: data.header.filter((_, i) => i !== index),
      align: data.align.filter((_, i) => i !== index),
      rows: data.rows.map((row) => row.filter((_, i) => i !== index))
    });
  }

  function addRow() {
    if (data.rows.length >= TABLE_MAX_ROWS) return;
    onChange({ ...data, rows: [...data.rows, Array.from({ length: width }, () => "")] });
  }

  function removeRow(index: number) {
    onChange({ ...data, rows: data.rows.filter((_, i) => i !== index) });
  }

  function cycleAlign(index: number) {
    const current = data.align[index] ?? "left";
    const next = ALIGN_ORDER[(ALIGN_ORDER.indexOf(current) + 1) % ALIGN_ORDER.length]!;
    onChange({ ...data, align: data.align.map((a, i) => (i === index ? next : a)) });
  }

  /** Grows the grid as needed so a pasted block of cells lands intact. */
  function pasteGrid(startRow: number, startCol: number, grid: string[][]) {
    const neededWidth = Math.min(TABLE_MAX_COLUMNS, Math.max(width, startCol + (grid[0]?.length ?? 0)));
    const neededRows = Math.min(TABLE_MAX_ROWS, Math.max(data.rows.length, startRow + grid.length));

    const header = [...data.header];
    const align = [...data.align];
    while (header.length < neededWidth) {
      header.push(`Kolumna ${header.length + 1}`);
      align.push("left");
    }

    const rows: string[][] = [];
    for (let r = 0; r < neededRows; r++) {
      const existing = data.rows[r] ?? [];
      const row: string[] = [];
      for (let c = 0; c < neededWidth; c++) {
        const fromPaste =
          r >= startRow && c >= startCol ? grid[r - startRow]?.[c - startCol] : undefined;
        row.push(fromPaste ?? existing[c] ?? "");
      }
      rows.push(row);
    }
    onChange({ ...data, header, align, rows });
  }

  /** Tab and Enter walk the grid the way a spreadsheet does. */
  function onCellKeyDown(e: React.KeyboardEvent, rowIndex: number, colIndex: number) {
    let target: string | null = null;
    if (e.key === "Tab" && !e.shiftKey && colIndex < width - 1) target = `${rowIndex}:${colIndex + 1}`;
    else if (e.key === "Tab" && e.shiftKey && colIndex > 0) target = `${rowIndex}:${colIndex - 1}`;
    else if (e.key === "ArrowDown" && rowIndex < data.rows.length - 1) target = `${rowIndex + 1}:${colIndex}`;
    else if (e.key === "ArrowUp" && rowIndex > 0) target = `${rowIndex - 1}:${colIndex}`;
    else if (e.key === "Enter") {
      if (rowIndex === data.rows.length - 1) {
        addRow();
        return;
      }
      target = `${rowIndex + 1}:${colIndex}`;
    }
    if (!target) return;
    e.preventDefault();
    cellRefs.current.get(target)?.focus();
  }

  if (!editing) {
    return (
      <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--border)]/40">
              {data.header.map((cell, i) => (
                <th
                  key={i}
                  className={`border-b border-[var(--glass-border)] px-3 py-2 font-semibold ${ALIGN_CLASS[data.align[i] ?? "left"]}`}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r} className="border-b border-[var(--glass-border)] last:border-0">
                {row.map((cell, c) => (
                  <td key={c} className={`px-3 py-1.5 ${ALIGN_CLASS[data.align[c] ?? "left"]}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border border-[var(--glass-border)]">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-[var(--border)]/40">
              {data.header.map((cell, i) => (
                <th key={i} className="border-b border-[var(--glass-border)] p-1">
                  <div className="flex items-center gap-0.5">
                    <input
                      value={cell}
                      onChange={(e) => setHeader(i, e.target.value)}
                      maxLength={200}
                      aria-label={`Nagłówek kolumny ${i + 1}`}
                      className={`w-full min-w-24 rounded bg-transparent px-2 py-1 font-semibold outline-none focus:bg-[var(--glass)] ${ALIGN_CLASS[data.align[i] ?? "left"]}`}
                    />
                    <button
                      onClick={() => cycleAlign(i)}
                      title="Zmień wyrównanie kolumny"
                      aria-label={`Zmień wyrównanie kolumny ${i + 1}`}
                      className="shrink-0 rounded p-1 text-[var(--text-dim)] hover:bg-[var(--border)]/60 hover:text-[var(--text)]"
                    >
                      <Icon icon={ALIGN_ICON[data.align[i] ?? "left"]} size={12} />
                    </button>
                    <button
                      onClick={() => removeColumn(i)}
                      disabled={width <= 1}
                      title="Usuń kolumnę"
                      aria-label={`Usuń kolumnę ${i + 1}`}
                      className="shrink-0 rounded p-1 text-[var(--text-dim)] hover:bg-[var(--border)]/60 hover:text-[var(--danger)] disabled:pointer-events-none disabled:opacity-30"
                    >
                      <Icon icon={Trash2} size={12} />
                    </button>
                  </div>
                </th>
              ))}
              <th className="w-8 border-b border-[var(--glass-border)] p-1" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr key={r} className="border-b border-[var(--glass-border)] last:border-0">
                {row.map((cell, c) => (
                  <td key={c} className="p-1">
                    <input
                      ref={(el) => {
                        if (el) cellRefs.current.set(`${r}:${c}`, el);
                      }}
                      value={cell}
                      onChange={(e) => setCell(r, c, e.target.value)}
                      onKeyDown={(e) => onCellKeyDown(e, r, c)}
                      onPaste={(e) => {
                        const grid = parseClipboardGrid(e.clipboardData.getData("text/plain"));
                        if (!grid) return;
                        e.preventDefault();
                        pasteGrid(r, c, grid);
                      }}
                      maxLength={2000}
                      aria-label={`Wiersz ${r + 1}, kolumna ${c + 1}`}
                      className={`w-full min-w-24 rounded bg-transparent px-2 py-1 outline-none focus:bg-[var(--glass)] ${ALIGN_CLASS[data.align[c] ?? "left"]}`}
                    />
                  </td>
                ))}
                <td className="p-1">
                  <button
                    onClick={() => removeRow(r)}
                    title="Usuń wiersz"
                    aria-label={`Usuń wiersz ${r + 1}`}
                    className="rounded p-1 text-[var(--text-dim)] hover:bg-[var(--border)]/60 hover:text-[var(--danger)]"
                  >
                    <Icon icon={Trash2} size={12} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          onClick={addRow}
          disabled={data.rows.length >= TABLE_MAX_ROWS}
          className="flex items-center gap-1 rounded-lg border border-[var(--glass-border)] px-2 py-1.5 text-[var(--text-dim)] hover:border-[var(--accent)]/60 hover:text-[var(--accent)] disabled:opacity-40"
        >
          <Icon icon={Plus} size={12} /> Wiersz
        </button>
        <button
          onClick={addColumn}
          disabled={width >= TABLE_MAX_COLUMNS}
          className="flex items-center gap-1 rounded-lg border border-[var(--glass-border)] px-2 py-1.5 text-[var(--text-dim)] hover:border-[var(--accent)]/60 hover:text-[var(--accent)] disabled:opacity-40"
        >
          <Icon icon={Plus} size={12} /> Kolumna
        </button>
        <span className="text-[var(--text-dim)]">
          Wklej zakres z Excela, aby wypełnić wiele komórek naraz.
        </span>
      </div>
    </div>
  );
}
