import { toReply, type Envelope, type MessageType, type Reply } from '../../shared/messages';
import { getSettings } from '../storage';
import { extractProfileFromDocuments, mapFieldsWithLlm, testLlm } from './index';

type Handler<T extends MessageType> = (payload: Envelope<T>['payload']) => Promise<Reply<T>>;

const handlers: { [T in MessageType]?: Handler<T> } = {
  'ff:llm-map': (p) => toReply<'ff:llm-map'>(async () => mapFieldsWithLlm(await getSettings(), p.fields, p.keys)),
  'ff:extract-profile': (p) =>
    toReply<'ff:extract-profile'>(async () => extractProfileFromDocuments(await getSettings(), p.files)),
  'ff:llm-test': () => toReply<'ff:llm-test'>(async () => testLlm(await getSettings())),
};

/** Returns a promise of a Reply for LLM messages, or undefined so other listeners can answer. */
export function routeMessage(message: unknown): Promise<unknown> | undefined {
  const type = (message as { type?: unknown } | null)?.type;
  if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) return undefined;
  const handler = handlers[type as MessageType] as Handler<MessageType>;
  return handler((message as Envelope).payload);
}
