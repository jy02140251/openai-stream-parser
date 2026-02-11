/**
 * OpenAI Stream Parser
 * Lightweight parser for OpenAI streaming responses (SSE)
 */

export type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ContentEvent = { type: 'content'; content: string };
export type FunctionCallEvent = { type: 'function_call'; name: string; arguments: string };
export type ToolCallEvent = { type: 'tool_call'; id: string; name: string; arguments: string };
export type DoneEvent = { type: 'done'; usage?: Usage };
export type ErrorEvent = { type: 'error'; error: Error };

export type StreamEvent = 
  | ContentEvent 
  | FunctionCallEvent 
  | ToolCallEvent 
  | DoneEvent 
  | ErrorEvent;

interface Delta {
  content?: string;
  function_call?: { name?: string; arguments?: string };
  tool_calls?: Array<{
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }>;
}

interface Choice {
  delta: Delta;
  finish_reason?: string | null;
}

interface ChunkData {
  choices?: Choice[];
  usage?: Usage;
}

/**
 * Parse a single SSE line and extract the data
 */
function parseSSELine(line: string): ChunkData | null {
  const trimmed = line.trim();
  
  if (!trimmed || trimmed.startsWith(':')) {
    return null;
  }
  
  if (trimmed === 'data: [DONE]') {
    return { choices: [{ delta: {}, finish_reason: 'stop' }] };
  }
  
  if (trimmed.startsWith('data: ')) {
    try {
      return JSON.parse(trimmed.slice(6));
    } catch {
      return null;
    }
  }
  
  return null;
}

/**
 * Parse OpenAI streaming response
 * @param stream - ReadableStream from fetch response
 * @yields StreamEvent objects
 */
export async function* parseStream(
  stream: ReadableStream<Uint8Array> | null
): AsyncGenerator<StreamEvent> {
  if (!stream) {
    yield { type: 'error', error: new Error('Stream is null') };
    return;
  }

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  
  // Track tool calls state
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let functionCallName = '';
  let functionCallArgs = '';
  let lastUsage: Usage | undefined;

  try {
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) {
        // Process any remaining buffer
        if (buffer.trim()) {
          const data = parseSSELine(buffer);
          if (data) {
            yield* processChunk(data);
          }
        }
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const data = parseSSELine(line);
        if (data) {
          yield* processChunk(data);
        }
      }
    }

    // Emit done event
    yield { type: 'done', usage: lastUsage };

  } catch (error) {
    yield { 
      type: 'error', 
      error: error instanceof Error ? error : new Error(String(error)) 
    };
  } finally {
    reader.releaseLock();
  }

  function* processChunk(data: ChunkData): Generator<StreamEvent> {
    if (data.usage) {
      lastUsage = data.usage;
    }

    if (!data.choices?.length) {
      return;
    }

    for (const choice of data.choices) {
      const delta = choice.delta;

      // Handle content
      if (delta.content) {
        yield { type: 'content', content: delta.content };
      }

      // Handle function_call (legacy)
      if (delta.function_call) {
        if (delta.function_call.name) {
          functionCallName = delta.function_call.name;
        }
        if (delta.function_call.arguments) {
          functionCallArgs += delta.function_call.arguments;
        }
      }

      // Handle tool_calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const existing = toolCalls.get(tc.index) || { id: '', name: '', arguments: '' };
          
          if (tc.id) {
            existing.id = tc.id;
          }
          if (tc.function?.name) {
            existing.name = tc.function.name;
          }
          if (tc.function?.arguments) {
            existing.arguments += tc.function.arguments;
          }
          
          toolCalls.set(tc.index, existing);
        }
      }

      // On finish, emit function/tool call events
      if (choice.finish_reason === 'function_call' && functionCallName) {
        yield { 
          type: 'function_call', 
          name: functionCallName, 
          arguments: functionCallArgs 
        };
      }

      if (choice.finish_reason === 'tool_calls') {
        for (const [, tc] of toolCalls) {
          yield { 
            type: 'tool_call', 
            id: tc.id, 
            name: tc.name, 
            arguments: tc.arguments 
          };
        }
      }
    }
  }
}

/**
 * Helper: Collect all content from stream into a single string
 */
export async function collectContent(
  stream: ReadableStream<Uint8Array> | null
): Promise<string> {
  let content = '';
  for await (const event of parseStream(stream)) {
    if (event.type === 'content') {
      content += event.content;
    }
  }
  return content;
}

/**
 * Helper: Create a callback-based stream handler
 */
export function createStreamHandler(callbacks: {
  onContent?: (content: string) => void;
  onFunctionCall?: (name: string, args: string) => void;
  onToolCall?: (id: string, name: string, args: string) => void;
  onDone?: (usage?: Usage) => void;
  onError?: (error: Error) => void;
}) {
  return async (stream: ReadableStream<Uint8Array> | null) => {
    for await (const event of parseStream(stream)) {
      switch (event.type) {
        case 'content':
          callbacks.onContent?.(event.content);
          break;
        case 'function_call':
          callbacks.onFunctionCall?.(event.name, event.arguments);
          break;
        case 'tool_call':
          callbacks.onToolCall?.(event.id, event.name, event.arguments);
          break;
        case 'done':
          callbacks.onDone?.(event.usage);
          break;
        case 'error':
          callbacks.onError?.(event.error);
          break;
      }
    }
  };
}