import type {
  FieldDescriptor,
  FieldMapping,
  FillReport,
  PlanItem,
  PreviewResult,
  Profile,
  ProfileKey,
} from './types';

/**
 * Message protocol.
 *
 *   UI (popup / side panel)  --tabs.sendMessage-->     content script   (preview, fill)
 *   content script           --runtime.sendMessage-->  background       (LLM field mapping)
 *   UI (options page)        --runtime.sendMessage-->  background       (document extraction)
 *
 * LLM calls always run in the background service worker: it holds the host
 * permissions for the LLM endpoints, and page CORS rules do not apply there.
 */
export interface MessageMap {
  /** Scan the page, match fields against the profile, return a plan. Writes nothing. */
  'ff:preview': { req: { useLlm: boolean }; res: PreviewResult };
  /** Fill the given (user-approved) plan items in order. */
  'ff:fill': { req: { items: PlanItem[] }; res: FillReport };
  /** Remove the highlight outlines the preview added. */
  'ff:clear-highlights': { req: Record<string, never>; res: { ok: true } };
  /** Map unmatched field descriptors to profile keys. Sends field metadata only, never profile values. */
  'ff:llm-map': {
    req: { fields: FieldDescriptor[]; keys: { key: ProfileKey; label: string }[] };
    res: FieldMapping[];
  };
  /** Extract profile data from uploaded documents. */
  'ff:extract-profile': {
    req: { files: { name: string; mimeType: string; base64: string }[] };
    res: { profile: Partial<Profile>; notes: string[] };
  };
  /** Cheap connectivity check for the configured LLM. */
  'ff:llm-test': { req: Record<string, never>; res: { ok: boolean; detail: string } };
}

export type MessageType = keyof MessageMap;

export interface Envelope<T extends MessageType = MessageType> {
  type: T;
  payload: MessageMap[T]['req'];
}

/** Every handler replies with this shape so errors cross the boundary as data, not as lost rejections. */
export type Reply<T extends MessageType> =
  | { ok: true; data: MessageMap[T]['res'] }
  | { ok: false; error: string };

export class MessageError extends Error {}

export function unwrap<T extends MessageType>(reply: Reply<T> | undefined, type: T): MessageMap[T]['res'] {
  if (!reply) throw new MessageError(`No response to ${type}. Is the page still open?`);
  if (!reply.ok) throw new MessageError(reply.error);
  return reply.data;
}

export async function sendToBackground<T extends MessageType>(
  type: T,
  payload: MessageMap[T]['req'],
): Promise<MessageMap[T]['res']> {
  const reply = (await browser.runtime.sendMessage({ type, payload } satisfies Envelope<T>)) as Reply<T>;
  return unwrap(reply, type);
}

export async function sendToTab<T extends MessageType>(
  tabId: number,
  type: T,
  payload: MessageMap[T]['req'],
): Promise<MessageMap[T]['res']> {
  const reply = (await browser.tabs.sendMessage(tabId, { type, payload } satisfies Envelope<T>, {
    frameId: 0,
  })) as Reply<T>;
  return unwrap(reply, type);
}

/** Wrap an async handler so it always produces a Reply and never throws across the boundary. */
export async function toReply<T extends MessageType>(
  fn: () => Promise<MessageMap[T]['res']>,
): Promise<Reply<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
