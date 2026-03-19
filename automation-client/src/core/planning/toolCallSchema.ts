import { z } from 'zod';
import { browserActionSchema } from './planSchema';

export const toolCallContinueSchema = browserActionSchema.extend({
  status: z.literal('continue'),
});

export const toolCallDoneSchema = z.object({
  status: z.literal('done'),
  description: z.string().min(1).optional(),
  finalResult: z.string().optional(),
});

export const toolCallSchema = z.discriminatedUnion('status', [
  toolCallContinueSchema,
  toolCallDoneSchema,
]);

export type ToolCall = z.infer<typeof toolCallSchema>;

