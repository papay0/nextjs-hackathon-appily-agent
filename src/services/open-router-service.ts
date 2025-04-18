import OpenAI from "openai";

export class OpenRouterService {
  private openai: OpenAI;

  constructor() {
    if (!process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY not set');
    }
    this.openai = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        'HTTP-Referer': 'www.appily.dev',
        'X-Title': 'Appily',
      },
    });
  }

  getOpenAI() {
    return this.openai;
  }
}
