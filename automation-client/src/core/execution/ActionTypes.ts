export type BrowserActionType =
  | 'open_url'
  | 'click'
  | 'type'
  | 'wait'
  | 'extract'
  | 'screenshot';

export type ExtractStrategy = 'inner_text' | 'html' | 'attribute';

export interface BrowserAction {
  action: BrowserActionType;
  selector?: string;
  value?: string;
  url?: string;
  waitMs?: number;
  description: string;
  extractStrategy?: ExtractStrategy;
  attributeName?: string;
}

