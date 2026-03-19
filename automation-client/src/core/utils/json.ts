export function extractFirstJsonArray(text: string): any[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON array found in LLM response');
  }
  const slice = text.slice(start, end + 1);
  return JSON.parse(slice) as any[];
}

export function extractFirstJsonObject(text: string): any {
  // 1) Prefer fenced JSON block if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  if (fenced) {
    try {
      return JSON.parse(fenced);
    } catch {
      // fallback to generic scanner below
    }
  }

  // 2) Find first balanced JSON object candidate and parse.
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') starts.push(i);
  }

  for (const start of starts) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === '\\') {
          escaped = true;
          continue;
        }
        if (ch === '"') inString = false;
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === '{') depth++;
      if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            break;
          }
        }
      }
    }
  }

  throw new Error('No JSON object found in LLM response');
}

