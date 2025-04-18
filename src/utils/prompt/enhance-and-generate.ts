/**
 * Utilities for enhancing website prompts and generating improved text
 */
import { enhanceWebsitePrompt } from './website-prompt-enhancer';
import { OpenRouterService } from '../../services/open-router-service';
import { UserPrompt } from '../../types/user-prompt';

/**
 * Enhances a website prompt and generates improved text using the same model
 * 
 * @param prompt - The original user prompt
 * @param modelKey - The AI model to use (should match the one used for streaming)
 * @returns UserPrompt object containing both original and enhanced prompt
 */
export const getEnhancedPrompt = async (prompt: string, modelKey: string): Promise<UserPrompt> => {
  // Step 1: Enhance the prompt using the website prompt enhancer
  const enhancedPromptTemplate = enhanceWebsitePrompt(prompt);
  
  const openai = new OpenRouterService();
  
  const text = await openai.getOpenAI().chat.completions.create({
    model: modelKey,
    messages: [{ role: 'user', content: enhancedPromptTemplate }],
  });
  
  const enhancedPromptContent = text.choices[0].message.content || '';
  
  // Return a UserPrompt object with both original and enhanced prompts
  return new UserPrompt(prompt, enhancedPromptContent);
};
