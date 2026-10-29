import express from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { runChat } from './agent.ts';
import { McpUnavailableError } from './mcp-client.ts';

const PORT = Number(process.env.CHAT_PORT ?? 3001);

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1) }))
    .min(1)
    .refine((m) => m.at(-1)?.role === 'user', 'The last message must be from the user'),
});

const app = express();
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  const body = Body.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.issues.map((i) => i.message).join('; ') });
    return;
  }
  try {
    res.json(await runChat(body.data.messages));
  } catch (err) {
    console.error(err);
    if (err instanceof Anthropic.APIError) {
      res.status(502).json({ error: `The AI service returned an error (${err.status}). Please try again.` });
    } else if (err instanceof McpUnavailableError) {
      res.status(503).json({ error: 'Could not reach the people data server. Is it running?' });
    } else {
      res.status(500).json({ error: 'Something went wrong on the server.' });
    }
  }
});

app.listen(PORT, '127.0.0.1', () => console.log(`Chat API listening on http://localhost:${PORT}/api/chat`));
