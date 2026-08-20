import type { LiveSnapshot, PeopleQueryResult, VenueGeometry } from "@crowdflow/api/wire";
import { clear, el, stateCell } from "../dom";
import { NO_VALUE, fixed, integer, signed } from "../format";
import { buildSectorRows, sortSectorRows, type SectorRow, type SectorSort, type SectorSortKey } from "../sectors";

interface Column {
  key: SectorSortKey | null;
  label: string;
  title: string;
  numeric: boolean;
  cell(row: SectorRow): HTMLElement | string;
}

function tone(row: SectorRow): string {
  if (row.visibility === "unknown") return "unknown";
  if (row.visibility === "silent") return "silent";
  return row.band ?? "nominal";
}

const COLUMNS: Column[] = [
  {
    key: "name",
    label: "SECTOR",
    title: "named circuit sector",
    numeric: false,
    cell: (row) => el("span", { class: "cell__name", text: row.name }),
  },
  {
    key: null,
    label: "ZONES LIVE",
    title: "source zones currently reporting inside this sector",
    numeric: true,
    cell: (row) => `${integer(row.observedZoneCount)}/${integer(row.zoneCount)}`,
  },
  {
    key: "density",
    label: "STATE / PED·M²",
    title: "highest live density in the sector and its operational band",
    numeric: true,
    cell: (row) => stateCell(row.word, fixed(row.density, 2), tone(row)),
  },
  {
    key: "flow",
    label: "FLOW",
    title: "device-weighted pedestrian flow across reporting zones",
    numeric: true,
    cell: (row) => fixed(row.flow, 1),
  },
  {
    key: null,
    label: "LOS",
    title: "worst live Fruin grade across the sector",
    numeric: true,
    cell: (row) => row.visibility === "observed" ? row.losGrade : NO_VALUE,
  },
  {
    key: "nodes",
    label: "DEVICES",
    title: "reporting devices in the sector",
    numeric: true,
    cell: (row) => row.visibility === "observed" ? integer(row.nodes) : NO_VALUE,
  },
  {
    key: "people",
    label: "LIVE CROWD",
    title: "exact current people from the live spatial feed",
    numeric: true,
    cell: (row) => integer(row.people),
  },
  {
    key: null,
    label: "SPEED",
    title: "device-weighted mean walking speed in metres per second",
    numeric: true,
    cell: (row) => fixed(row.speed, 2),
  },
  {
    key: "net",
    label: "NET/MIN",
    title: "sector inflow minus outflow per minute",
    numeric: true,
    cell: (row) => signed(row.net, 1),
  },
  {
    key: "queue",
    label: "QUEUED",
    title: "estimated people backed up across sector zones",
    numeric: true,
    cell: (row) => integer(row.queue),
  },
  {
    key: "confidence",
    label: "CONF",
    title: "device-weighted confidence across reporting zones",
    numeric: true,
    cell: (row) => row.confidence === null
      ? NO_VALUE
      : el("span", { class: row.reportable ? "conf" : "conf conf--low" }, fixed(row.confidence, 2) + (row.reportable ? "" : " LOW")),
  },
];

export class SectorTable {
  private sort: SectorSort = { key: "people", descending: true };
  private readonly head: HTMLElement;
  private readonly body: HTMLElement;
  private readonly footer: HTMLElement;
  private readonly status: HTMLElement;
  private selected: string | null = null;

  constructor(
    private readonly host: HTMLElement,
    tools: HTMLElement,
    private readonly onSelect: (zoneId: string) => void,
  ) {
    const table = el("table", { class: "zones sectors" });
    this.head = el("thead");
    this.body = el("tbody");
    this.footer = el("tbody", { class: "zones__footer" });
    this.status = el("span", { class: "sector-status", text: "WAITING FOR LIVE CROWD" });
    table.append(this.head, this.body, this.footer);
    clear(host).append(table);
    clear(tools).append(this.status);
    this.renderHead();
  }

  setSelected(zoneId: string | null): void {
    this.selected = zoneId;
    for (const tr of this.host.querySelectorAll("tr[data-zone]")) {
      tr.classList.toggle("is-selected", tr.getAttribute("data-zone") === zoneId);
    }
  }

  update(live: LiveSnapshot, geometry: VenueGeometry, grid: PeopleQueryResult | null): void {
    const rows = sortSectorRows(buildSectorRows(live, geometry, grid), this.sort);
    clear(this.body);
    for (const row of rows) this.body.append(this.renderRow(row));
    const reporting = rows.filter((row) => row.observedZoneCount > 0).length;
    this.status.textContent = `LIVE ${integer(grid?.matched_count ?? live.reporting_devices)} · ${integer(reporting)}/${integer(rows.length)} SECTORS`;
    clear(this.footer).append(
      el(
        "tr",
        { class: "zones__count" },
        el(
          "td",
          { colspan: String(COLUMNS.length) },
          el("span", { class: "state state--nominal" }, el("span", { class: "state__word", text: "LIVE CROWD" }), el("span", { class: "state__value", text: integer(grid?.matched_count ?? live.reporting_devices) })),
          el("span", { class: "zones__countnote", text: ` people across ${integer(rows.length)} sectors · ${integer(live.coverage.observed)}/${integer(live.coverage.zones_total)} source zones reporting` }),
        ),
      ),
    );
  }

  private renderHead(): void {
    const tr = el("tr");
    for (const column of COLUMNS) {
      const th = el("th", { class: column.numeric ? "num" : "", title: column.title, "data-sortable": column.key ? "yes" : "no" });
      th.append(column.label);
      if (column.key) {
        const key = column.key;
        th.classList.add("sortable");
        th.addEventListener("click", () => {
          this.sort = this.sort.key === key ? { key, descending: !this.sort.descending } : { key, descending: true };
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

  private renderRow(row: SectorRow): HTMLElement {
    const tr = el("tr", {
      class: `row row--${tone(row)}${row.overCapacity ? " row--over" : ""}`,
      "data-zone": row.id,
      title: `${row.name}: ${row.zoneCount} source zones`,
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
