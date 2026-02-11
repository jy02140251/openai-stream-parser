# OpenAI Stream Parser

[![npm version](https://badge.fury.io/js/openai-stream-parser.svg)](https://www.npmjs.com/package/openai-stream-parser)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Lightweight, zero-dependency parser for OpenAI streaming responses (SSE). Perfect for building ChatGPT-like interfaces.

## Features

- Zero dependencies
- TypeScript support out of the box
- Works in Node.js and browsers
- Handles all OpenAI stream event types
- Automatic error handling and recovery
- Supports function/tool calls streaming

## Installation

```bash
npm install openai-stream-parser
# or
yarn add openai-stream-parser
# or
pnpm add openai-stream-parser
```

## Quick Start

```typescript
import { parseStream, StreamEvent } from 'openai-stream-parser';

const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
  },
  body: JSON.stringify({
    model: 'gpt-4',
    messages: [{ role: 'user', content: 'Hello!' }],
    stream: true,
  }),
});

for await (const event of parseStream(response.body)) {
  if (event.type === 'content') {
    process.stdout.write(event.content);
  }
}
```

## API Reference

### `parseStream(stream: ReadableStream): AsyncGenerator<StreamEvent>`

Parses an SSE stream from OpenAI and yields events.

### Event Types

```typescript
type StreamEvent = 
  | { type: 'content'; content: string }
  | { type: 'function_call'; name: string; arguments: string }
  | { type: 'tool_call'; id: string; name: string; arguments: string }
  | { type: 'done'; usage?: Usage }
  | { type: 'error'; error: Error };

type Usage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};
```

## Advanced Usage

### With React

```tsx
import { useState } from 'react';
import { parseStream } from 'openai-stream-parser';

function ChatComponent() {
  const [message, setMessage] = useState('');

  const sendMessage = async (prompt: string) => {
    const response = await fetch('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ prompt }),
    });

    setMessage('');
    
    for await (const event of parseStream(response.body)) {
      if (event.type === 'content') {
        setMessage(prev => prev + event.content);
      }
    }
  };

  return <div>{message}</div>;
}
```

### Error Handling

```typescript
try {
  for await (const event of parseStream(response.body)) {
    if (event.type === 'error') {
      console.error('Stream error:', event.error);
      break;
    }
    // handle other events
  }
} catch (error) {
  console.error('Parse error:', error);
}
```

## Browser Support

Works in all modern browsers with native `ReadableStream` support:
- Chrome 52+
- Firefox 65+
- Safari 10.1+
- Edge 79+

## License

MIT