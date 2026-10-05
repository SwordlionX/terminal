/**
 * Free-tier model cascade. Each Flash model has its own small daily quota (20 requests on the
 * current plan); the Lite models have larger ones. Requests start at the strongest model that
 * still has quota and fall to the next one when a model is exhausted or overloaded.
 */
export const CHAT_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
];
/** Google Search grounding has no free quota on Gemini 3 models; 2.5 keeps a search quota. */
export const RESEARCH_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite'];

export type ModelBlocks = Record<string, number>;

export function modelChain(configured: string | undefined, defaults: string[]): string[] {
  const chain = configured
    ? configured
        .split(',')
        .map(m => m.trim())
        .filter(Boolean)
    : defaults;
  if (!chain.length || chain.some(m => !/^gemini-[a-z0-9.-]+$/.test(m)))
    throw new Error('Asistan modeli yapılandırması geçersiz.');
  return chain;
}

export function availableModels(chain: string[], blocks: ModelBlocks, now = Date.now()): string[] {
  return chain.filter(model => !(blocks[model] > now));
}

/** Free-tier daily quotas reset at midnight Pacific time. */
export function nextPacificMidnight(now = Date.now()): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(now));
  const value = (type: string) => Number(parts.find(p => p.type === type)?.value ?? 0);
  const elapsed = value('hour') * 3600 + value('minute') * 60 + value('second');
  return now + (86400 - elapsed) * 1000;
}

/**
 * How long to skip a model after a provider error, or null when switching models cannot help
 * (bad key, permission, malformed request). "High demand" on the newest models tends to last for
 * a while; a short skip made every request start at the busy model again, so overloads and
 * timeouts skip it for 15 minutes.
 */
export function blockAfterError(status: number | undefined, message: string, now = Date.now()): number | null {
  if (status === 429) return /per ?day|PerDay|daily/i.test(message) ? nextPacificMidnight(now) : now + 60_000;
  if (status === 404) return nextPacificMidnight(now);
  if (status !== undefined && [500, 502, 503, 504].includes(status)) return now + 15 * 60_000;
  if (status === undefined && /timeout|timed out|aborted|fetch failed|network|ECONNRESET/i.test(message))
    return now + 15 * 60_000;
  return null;
}

/** Gemini 3 uses thinking levels; 2.5 models take a token budget instead. */
export function thinkingFor(model: string) {
  return model.startsWith('gemini-2.5') ? { thinkingBudget: 512 } : { thinkingLevel: 'LOW' as const };
}

/**
 * Thought signatures are model-specific. When a request continues on another model, earlier
 * signatures are replaced with the documented validator bypass so the new model accepts the history.
 */
export function portableHistory<T>(contents: T): T {
  if (!Array.isArray(contents)) return contents;
  return contents.map(content => {
    const parts = (content as { parts?: Record<string, unknown>[] }).parts;
    if (!parts) return content;
    return {
      ...content,
      parts: parts.map(part =>
        part.thoughtSignature ? { ...part, thoughtSignature: 'skip_thought_signature_validator' } : part,
      ),
    };
  }) as T;
}
