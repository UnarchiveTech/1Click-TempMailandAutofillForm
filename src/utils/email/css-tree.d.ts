declare module 'css-tree' {
  export interface CssNode {
    type: string;
    name?: string;
    property?: string;
    important?: boolean;
    prelude?: CssNode;
    block?: CssNode;
    value?: CssNode;
    children?: { toArray(): CssNode[] };
  }

  export interface ParseOptions {
    context?: 'stylesheet' | 'declarationList';
    positions?: boolean;
    onParseError?: (error: Error) => void;
  }

  export function parse(source: string, options?: ParseOptions): CssNode;
  export function generate(node: CssNode): string;
  export function walk(node: CssNode, callback: (node: CssNode) => void): void;
  export const ident: { decode(value: string): string };
}
