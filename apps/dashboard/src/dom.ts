/**
 * Minimal element construction.
 *
 * No framework, no innerHTML. Zone names come out of OpenStreetMap, which is
 * to say out of a public wiki, and a console that interpolates them into markup
 * is one edited tag away from a surprise. `textContent` everywhere.
 */

type Attrs = Record<string, string | number | boolean | undefined | null>;
type Child = Node | string | number | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = String(value);
    else if (key === "text") node.textContent = String(value);
    else node.setAttribute(key, String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    node.append(typeof child === "object" ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** A word and its number, the console's atom.
 *
 *  Every state on this screen is rendered through here, which is how the
 *  "never colour alone" rule is enforced rather than remembered: there is no
 *  way to draw a status with this helper that does not carry both. */
export function stateCell(word: string, value: string, tone: string): HTMLElement {
  return el(
    "span",
    { class: `state state--${tone}`, title: `${word} ${value}` },
    el("span", { class: "state__word", text: word }),
    el("span", { class: "state__value", text: value }),
  );
}

export function clear(node: HTMLElement): HTMLElement {
  node.replaceChildren();
  return node;
}

export function must<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id} — index.html and the panels disagree`);
  return node as T;
}
