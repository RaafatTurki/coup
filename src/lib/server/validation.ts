import { z } from 'zod';
import { GameError } from '$lib/server/coup-store';

function buildValidationMessage(error: z.ZodError) {
  const issue = error.issues[0];
  if (!issue) {
    return 'Invalid request payload.';
  }

  const path = issue.path.length ? `${issue.path.join('.')}: ` : '';
  return `${path}${issue.message}`;
}

function parseWithSchema<Schema extends z.ZodTypeAny>(
  payload: unknown,
  schema: Schema
) {
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw new GameError(buildValidationMessage(result.error), 400);
  }

  return result.data;
}

export async function parseJsonBody<Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema
){
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new GameError('Invalid JSON body.', 400);
    }
    throw error;
  }

  return parseWithSchema(payload, schema);
}

export function parseSearchParams<Schema extends z.ZodTypeAny>(
  url: URL,
  schema: Schema
){
  const payload: Record<string, string> = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (!value.trim()) {
      continue;
    }
    payload[key] = value;
  }

  return parseWithSchema(payload, schema);
}
