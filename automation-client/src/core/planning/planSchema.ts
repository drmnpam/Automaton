import { z } from 'zod';
import {
  BrowserAction,
  ExtractStrategy,
} from '../execution/ActionTypes';

const extractStrategySchema = z.union([
  z.literal('inner_text'),
  z.literal('html'),
  z.literal('attribute'),
]).optional();

export const browserActionSchema: z.ZodType<BrowserAction> = z
  .object({
    action: z.union([
      z.literal('open_url'),
      z.literal('click'),
      z.literal('type'),
      z.literal('wait'),
      z.literal('extract'),
      z.literal('screenshot'),
    ]),
    selector: z.string().optional(),
    value: z.string().optional(),
    url: z.string().optional(),
    waitMs: z.number().int().positive().optional(),
    description: z.string(),
    extractStrategy: extractStrategySchema as any,
    attributeName: z.string().optional(),
  })
  .superRefine((val, ctx) => {
    const hasUrl = typeof val.url === 'string' && val.url.trim().length > 0;
    const hasValue = typeof val.value === 'string' && val.value.trim().length > 0;

    if (val.action === 'open_url') {
      if (!hasUrl && !hasValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: 'open_url requires value (URL) or url',
        });
      }
    }

    if (val.action === 'click') {
      if (!val.selector) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selector'],
          message: 'click requires selector',
        });
      }
    }

    if (val.action === 'type') {
      if (!val.selector) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selector'],
          message: 'type requires selector',
        });
      }
      if (!hasValue) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['value'],
          message: 'type requires value',
        });
      }
    }

    if (val.action === 'wait') {
      if (typeof val.waitMs !== 'number') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['waitMs'],
          message: 'wait requires waitMs',
        });
      }
    }

    if (val.action === 'extract') {
      if (!val.selector) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['selector'],
          message: 'extract requires selector',
        });
      }
    }
  });

export const actionPlanSchema = z.array(browserActionSchema);

