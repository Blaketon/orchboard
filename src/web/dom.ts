type Child = Node | string | null | undefined | false;

interface ElementProps {
  readonly className?: string;
  readonly text?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly on?: {
    readonly [K in keyof HTMLElementEventMap]?: (event: HTMLElementEventMap[K]) => void;
  };
}

/**
 * Creates an element. Text always goes through text nodes, never HTML parsing, so agent names
 * and transcript content can't inject markup.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: ElementProps = {},
  children: readonly Child[] = [],
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.text !== undefined) element.textContent = props.text;
  for (const [name, value] of Object.entries(props.attrs ?? {})) element.setAttribute(name, value);
  for (const [type, listener] of Object.entries(props.on ?? {})) {
    element.addEventListener(type, listener as EventListener);
  }
  for (const child of children) {
    if (child) element.append(child);
  }
  return element;
}

/** Finds an element from index.html, checking that it is the expected kind. */
export function byId<K extends keyof HTMLElementTagNameMap>(
  id: string,
  tag: K,
): HTMLElementTagNameMap[K] {
  const element = document.getElementById(id);
  if (element?.tagName.toLowerCase() !== tag) {
    throw new Error(`index.html is missing <${tag} id="${id}">`);
  }
  return element as HTMLElementTagNameMap[K];
}
