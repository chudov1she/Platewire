import * as XLSX from "xlsx";
import { LEDGER_TRACKS } from "@/constants/ledger";
import type { F5OddsStage, NestLedgerEntry } from "@/types";

const SHEET_NAMES: Record<F5OddsStage, string> = {
  prematch: "Прематч",
  inn1: "1 ИНН",
  inn2: "2 ИНН",
};

/** Template length like «Статистика по халяве» — room to keep filling. */
const TEMPLATE_ROWS = 1000;

const HEADERS = ["#", "ПРОГНОЗ", "СТАВКА", "КФ", "Дата", "Статус", "Прибыль", "Банк"] as const;

function excelSerialDate(iso: string | null | undefined): number | string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  // Excel serial (UTC day), 1899-12-30 epoch used by Excel/Sheets
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(1899, 11, 30)) / 86400000);
}

function statusForSheet(row: NestLedgerEntry): string {
  if (row.excludedFromStats) return "";
  const s = row.resultStatus.toLowerCase();
  if (s === "win") return "WIN";
  if (s === "loss" || s === "lose") return "LOSE";
  if (s === "push") return "DRAW";
  return ""; // pending / unknown → profit formula stays 0
}

function pickLabel(row: NestLedgerEntry): string {
  if (row.action === "pass") return "pass";
  return row.pickLabel ?? `${row.pickMarket ?? ""}/${row.pickSide ?? ""}`.replace(/^\/$/, "");
}

function defaultStake(entries: NestLedgerEntry[]): number {
  const stakes = entries
    .filter((e) => e.action === "bet" && !e.excludedFromStats && e.stakeUnits != null)
    .map((e) => e.stakeUnits as number);
  if (!stakes.length) return 50;
  // mode / first settled stake
  return stakes[0] ?? 50;
}

function setCell(
  sheet: XLSX.WorkSheet,
  addr: string,
  cell: XLSX.CellObject,
) {
  sheet[addr] = cell;
}

/**
 * Bank tracker sheet in the «Статистика по халяве» layout:
 * A–H bets + running bank formulas, J–K summary panel with COUNTIF/SUM.
 */
export function buildBankTrackerSheet(
  entries: NestLedgerEntry[],
  startingBankroll: number,
  opts?: { stakeUnits?: number; padRows?: number },
): XLSX.WorkSheet {
  // Only real bets in the tracker (pass / excluded stay out of bank path).
  const bets = entries
    .filter((e) => e.action === "bet" && !e.excludedFromStats)
    .slice()
    .reverse(); // chronological

  const stake = opts?.stakeUnits ?? defaultStake(bets);
  const pad = opts?.padRows ?? TEMPLATE_ROWS;
  const lastDataRow = 1 + pad; // row 1 = header

  const sheet: XLSX.WorkSheet = {};
  const range = { s: { r: 0, c: 0 }, e: { r: lastDataRow - 1, c: 10 } };

  // Header row
  HEADERS.forEach((h, i) => {
    setCell(sheet, XLSX.utils.encode_cell({ r: 0, c: i }), { t: "s", v: h });
  });

  // Side panel labels + values / formulas (columns J=9, K=10)
  setCell(sheet, "J1", { t: "s", v: "Начальный банк" });
  setCell(sheet, "K1", { t: "n", v: startingBankroll });
  setCell(sheet, "J2", { t: "s", v: "Размер ставки" });
  setCell(sheet, "K2", { t: "n", v: stake });

  setCell(sheet, "J4", { t: "s", v: "Сумма ставок" });
  setCell(sheet, "K4", { t: "n", f: `COUNTIF(D2:D${lastDataRow},">0")`, v: 0 });
  setCell(sheet, "J5", { t: "s", v: "Выигрыши" });
  setCell(sheet, "K5", { t: "n", f: `COUNTIF(F1:F${lastDataRow},"WIN")`, v: 0 });
  setCell(sheet, "J6", { t: "s", v: "Проигрыши" });
  setCell(sheet, "K6", { t: "n", f: `COUNTIF(F1:F${lastDataRow},"LOSE")`, v: 0 });
  setCell(sheet, "J7", { t: "s", v: "Возвраты" });
  setCell(sheet, "K7", { t: "n", f: `COUNTIF(F1:F${lastDataRow},"DRAW")`, v: 0 });
  setCell(sheet, "J8", { t: "s", v: "Сумма ставок в бабках" });
  setCell(sheet, "K8", { t: "n", f: "K4*K2", v: 0 });
  setCell(sheet, "J9", { t: "s", v: "Банк" });
  setCell(sheet, "K9", { t: "n", f: "K1+K11", v: startingBankroll });
  setCell(sheet, "J10", { t: "s", v: "Ср. победный кф." });
  setCell(sheet, "K10", {
    t: "n",
    f: `IFERROR(SUMIF(G2:G${lastDataRow},">0",D2:D${lastDataRow})/K5,0)`,
    v: 0,
  });
  setCell(sheet, "J11", { t: "s", v: "Прибыль" });
  setCell(sheet, "K11", { t: "n", f: `SUM(G2:G${lastDataRow})`, v: 0 });
  setCell(sheet, "J12", { t: "s", v: "Профит" });
  setCell(sheet, "K12", { t: "n", f: "IFERROR(K11/K1,0)", v: 0, z: "0.00%" });
  setCell(sheet, "J13", { t: "s", v: "ROI" });
  setCell(sheet, "K13", { t: "n", f: "IFERROR(K11/K8*100,0)", v: 0 });

  setCell(sheet, "K16", { t: "s", v: "WIN" });
  setCell(sheet, "K17", { t: "s", v: "LOSE" });
  setCell(sheet, "K18", { t: "s", v: "DRAW" });

  // Data + empty template rows with live Excel formulas
  for (let i = 0; i < pad; i++) {
    const excelRow = i + 2; // 1-based
    const r = i + 1; // 0-based sheet row index
    const bet = bets[i];

    setCell(sheet, XLSX.utils.encode_cell({ r, c: 0 }), { t: "n", v: i + 1 });

    if (bet) {
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 1 }), { t: "s", v: bet.matchup });
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 2 }), { t: "s", v: pickLabel(bet) });
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 3 }), {
        t: "n",
        v: bet.decimalOdds ?? 0,
      });
      const serial = excelSerialDate(bet.gameDateUtc ?? bet.capturedAt);
      if (typeof serial === "number") {
        setCell(sheet, XLSX.utils.encode_cell({ r, c: 4 }), {
          t: "n",
          v: serial,
          z: "dd.mm.yyyy",
        });
      } else {
        setCell(sheet, XLSX.utils.encode_cell({ r, c: 4 }), { t: "s", v: String(serial) });
      }
      const status = statusForSheet(bet);
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 5 }), { t: "s", v: status });
    } else {
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 1 }), { t: "s", v: "" });
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 2 }), { t: "s", v: "" });
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 3 }), { t: "s", v: "" });
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 4 }), { t: "s", v: "" });
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 5 }), { t: "s", v: "" });
    }

    // Прибыль — same IF chain as the reference workbook
    setCell(sheet, XLSX.utils.encode_cell({ r, c: 6 }), {
      t: "n",
      f: `IF(F${excelRow}="WIN",$K$2*D${excelRow}-$K$2,IF(F${excelRow}="LOSE",-$K$2,IF(F${excelRow}="DRAW",0,0)))`,
      v: 0,
    });

    // Банк
    if (excelRow === 2) {
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 7 }), {
        t: "n",
        f: `K1+G${excelRow}`,
        v: startingBankroll,
      });
    } else {
      setCell(sheet, XLSX.utils.encode_cell({ r, c: 7 }), {
        t: "n",
        f: `H${excelRow - 1}+G${excelRow}`,
        v: startingBankroll,
      });
    }
  }

  sheet["!ref"] = XLSX.utils.encode_range(range);
  sheet["!cols"] = [
    { wch: 5 },
    { wch: 28 },
    { wch: 18 },
    { wch: 8 },
    { wch: 12 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 3 },
    { wch: 22 },
    { wch: 12 },
  ];

  return sheet;
}

function downloadWorkbook(workbook: XLSX.WorkBook, filename: string) {
  const buffer = XLSX.write(workbook, { bookType: "xlsx", type: "array", cellStyles: true });
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function safeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]]/g, "").slice(0, 31) || "Лист";
}

export function exportLedgerTrackXlsx(
  track: F5OddsStage | "all",
  entries: NestLedgerEntry[],
  startingBankroll: number,
) {
  const workbook = XLSX.utils.book_new();
  const sheetName = safeSheetName(track === "all" ? "Все" : SHEET_NAMES[track]);
  const sheet = buildBankTrackerSheet(entries, startingBankroll);
  XLSX.utils.book_append_sheet(workbook, sheet, sheetName);
  downloadWorkbook(workbook, `f5-ledger-${track}.xlsx`);
}

export function exportLedgerAllTracksXlsx(
  byTrack: Partial<Record<F5OddsStage, NestLedgerEntry[]>>,
  startingBankroll: number,
) {
  const workbook = XLSX.utils.book_new();
  for (const track of LEDGER_TRACKS) {
    const entries = byTrack[track.id] ?? [];
    const sheet = buildBankTrackerSheet(entries, startingBankroll);
    XLSX.utils.book_append_sheet(workbook, sheet, safeSheetName(SHEET_NAMES[track.id]));
  }
  if (!workbook.SheetNames.length) {
    XLSX.utils.book_append_sheet(
      workbook,
      buildBankTrackerSheet([], startingBankroll),
      "Пусто",
    );
  }
  downloadWorkbook(workbook, "f5-ledger-all.xlsx");
}
