/**
 * The zone table — the dense half of the console.
 *
 * Live-timing conventions throughout: one line per zone, fixed columns, tabular
 * figures, no wrapping, no truncation of the numbers. Forty rows of eleven
 * columns is the right amount of information for this screen; withholding a
 * column because the layout is tighter without it is how an operator ends up
 * asking for a number the system already had.
 *
 * The one editorial decision: zones with a reading and zones that have fallen
 * silent are always listed, while the ~1,800 zones the system has never seen sit
 * behind a toggle and a count. They are not hidden — the count is a permanent
 * row and it is large — but paging 1,800 rows of dashes past an operator every
 * second would bury the forty that matter.
 */
import type { TickEnvelope } from "@crowdflow/api/wire";
import { clear, el, stateCell } from "../dom";
import { NO_VALUE, fixed, integer, signed } from "../format";
import type { Sort, SortKey, ZoneRow } from "../model";
import { sortRows } from "../model";

interface Column {
  key: SortKey | null;
  label: string;
  title: string;
  numeric: boolean;
  cell(row: ZoneRow): HTMLElement | string;
}

function tone(row: ZoneRow): string {
  if (row.visibility === "unknown") return "unknown";
  if (row.visibility === "silent") return "silent";
  return row.band ?? "nominal";
}

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "ZONE",
    title: "zone name from the imported venue graph",
    numeric: false,
    cell: (row) => el("span", { class: "cell__name", text: row.name }),
  },
  {
    key: null,
    label: "KIND",
    title: "zone kind",
    numeric: false,
    cell: (row) => String(row.kind).toUpperCase(),
  },
  {
    key: "density",
    label: "STATE / PED·M²",
    title: "operational band and the density it was classified from",
    numeric: true,
    cell: (row) => stateCell(row.word, row.value, tone(row)),
  },
  {
    key: "flow",
    label: "FLOW",
    title: "ped/m/min — reported, never classified on",
    numeric: true,
    cell: (row) => fixed(row.flow, 1),
  },
  {
    key: null,
    label: "LOS",
    title: "Fruin grade A–F, from flow",
    numeric: true,
    cell: (row) => row.losGrade,
  },
  {
    key: "nodes",
    label: "NODES",
    title: "reporting devices — NOT people",
    numeric: true,
    cell: (row) => (row.visibility === "observed" ? integer(row.nodes) : NO_VALUE),
  },
  {
    key: "people",
    label: "EST PEOPLE",
    title: "devices scaled by the measured participation rate",
    numeric: true,
    cell: (row) => integer(row.people),
  },
  {
    key: null,
    label: "SPEED",
    title: "mean walking speed, m/s — falling speed at constant headcount is the early warning",
    numeric: true,
    cell: (row) => fixed(row.speed, 2),
  },
  {
    key: "net",
    label: "NET/MIN",
    title: "inflow minus outflow; sustained positive means filling",
    numeric: true,
    cell: (row) => signed(row.net, 1),
  },
  {
    key: "queue",
    label: "QUEUED",
    title: "people who do not fit at jam density, i.e. backed up behind",
    numeric: true,
    cell: (row) => integer(row.queue),
  },
  {
    key: "confidence",
    label: "CONF",
    title: "confidence in the estimate beside it; LOW means the contract says do not lean on it",
    numeric: true,
    cell: (row) =>
      row.confidence === null
        ? NO_VALUE
        : el(
            "span",
            { class: row.reportable ? "conf" : "conf conf--low" },
            fixed(row.confidence, 2) + (row.reportable ? "" : " LOW"),
          ),
  },
];

export class ZoneTable {
  private sort: Sort = { key: "density", descending: true };
  private showUnknown = false;
  private unknownSignature = "";
  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private readonly unknownBody: HTMLElement;
  private readonly footer: HTMLElement;
  private selected: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    tools: HTMLElement,
    private readonly onSelect: (zoneId: string) => void,
  ) {
    const table = el("table", { class: "zones" });
    this.head = el("thead");
    this.body = el("tbody");
    this.unknownBody = el("tbody", { class: "zones__unknown" });
    this.footer = el("tbody", { class: "zones__footer" });
    table.append(this.head, this.body, this.footer, this.unknownBody);
    clear(host).append(table);
    this.renderHead();

    const toggle = el("button", {
      class: "tool",
      type: "button",
      text: "SHOW UNKNOWN",
      title: "list every zone with no reporting device",
    });
    toggle.addEventListener("click", () => {
      this.showUnknown = !this.showUnknown;
      toggle.textContent = this.showUnknown ? "HIDE UNKNOWN" : "SHOW UNKNOWN";
      toggle.classList.toggle("tool--on", this.showUnknown);
      this.unknownSignature = "";
      if (!this.showUnknown) clear(this.unknownBody);
      // Repaint now rather than on the next tick. A paused or finished run
      // delivers no more ticks, and a control that appears to do nothing is
      // indistinguishable from a broken one.
      this.host.dispatchEvent(new CustomEvent("resort"));
    });
    clear(tools).append(toggle);
  }

  setSelected(zoneId: string | null): void {
    this.selected = zoneId;
    for (const tr of this.host.querySelectorAll("tr[data-zone]")) {
      tr.classList.toggle("is-selected", tr.getAttribute("data-zone") === zoneId);
    }
  }

  private renderHead(): void {
    const tr = el("tr");
    for (const column of COLUMNS) {
      const th = el("th", {
        class: column.numeric ? "num" : "",
        title: column.title,
        "data-sortable": column.key ? "yes" : "no",
      });
      th.append(column.label);
      if (column.key) {
        const key = column.key;
        th.classList.add("sortable");
        th.addEventListener("click", () => {
          this.sort =
            this.sort.key === key
              ? { key, descending: !this.sort.descending }
              : { key, descending: true };
          this.renderHead();
          this.host.dispatchEvent(new CustomEvent("resort"));
        });
        if (this.sort.key === key) {
          th.classList.add("is-sorted");
          th.append(el("span", { class: "sort", text: this.sort.descending ? "▼" : "▲" }));
        }
      }
      tr.append(th);
    }
    clear(this.head).append(tr);
  }

  onResort(handler: () => void): void {
    this.host.addEventListener("resort", handler);
  }

  update(envelope: TickEnvelope, rows: ZoneRow[]): void {
    const visible = sortRows(
      rows.filter((row) => row.visibility !== "unknown"),
      this.sort,
    );
    clear(this.body);
    for (const row of visible) this.body.append(this.renderRow(row));

    clear(this.footer).append(
      el(
        "tr",
        { class: "zones__count" },
        el("td", { colspan: String(COLUMNS.length) },
          el("span", { class: "state state--unknown" },
            el("span", { class: "state__word", text: "UNKNOWN" }),
            el("span", { class: "state__value", text: integer(envelope.coverage.unknown) }),
          ),
          el("span", {
            class: "zones__countnote",
            text: ` zones have no reporting device — not empty, not observed · ${integer(
              envelope.coverage.observed,
            )} observed of ${integer(envelope.coverage.zones_total)}`,
          }),
        ),
      ),
    );

    if (!this.showUnknown) return;
    const unknown = rows.filter((row) => row.visibility === "unknown");
    // Unknown rows carry no per-tick data, so they are rebuilt only when the set
    // itself changes. Re-rendering 1,800 identical rows every second would cost
    // more than everything else on the screen put together.
    // The full id set is the state. Length plus endpoints missed churn in the
    // middle and left a stale unknown list on the one panel devoted to honesty
    // about missing data.
    const signature = unknown.map((row) => row.id).sort().join("\u0000");
    if (signature === this.unknownSignature) return;
    this.unknownSignature = signature;
    clear(this.unknownBody);
    for (const row of sortRows(unknown, { key: "name", descending: false })) {
      this.unknownBody.append(this.renderRow(row));
    }
  }

  private renderRow(row: ZoneRow): HTMLElement {
    const tr = el("tr", {
      class: `row row--${tone(row)}${row.overCapacity ? " row--over" : ""}`,
      "data-zone": row.id,
      title: row.id,
    });
    if (row.id === this.selected) tr.classList.add("is-selected");
    for (const column of COLUMNS) {
      const td = el("td", { class: column.numeric ? "num" : "" });
      const content = column.cell(row);
      td.append(typeof content === "string" ? document.createTextNode(content) : content);
      tr.append(td);
    }
    tr.addEventListener("click", () => this.onSelect(row.id));
    return tr;
  }
}
