/**
 * Class representing a user prompt with both original and enhanced versions
 */
export class UserPrompt {
  private readonly _userPrompt: string;
  private readonly _enhancedPrompt?: string;
  private readonly _isFollowUp: boolean;

  /**
   * Create a new UserPrompt instance
   * @param userPrompt The original prompt provided by the user
   * @param enhancedPrompt Optional enhanced prompt created by AI
   * @param isFollowUp Whether this prompt is a follow-up to a previous conversation
   */
  constructor(userPrompt: string, enhancedPrompt?: string, isFollowUp: boolean = false) {
    this._userPrompt = userPrompt;
    this._enhancedPrompt = enhancedPrompt;
    this._isFollowUp = isFollowUp;
  }
  
  /**
   * Gets the original user prompt
   */
  get userPrompt(): string {
    return this._userPrompt;
  }
  
  /**
   * Gets the enhanced prompt if available
   */
  get enhancedPrompt(): string | undefined {
    return this._enhancedPrompt;
  }
  
  /**
   * Indicates if this prompt is a follow-up to a previous conversation
   */
  get isFollowUp(): boolean {
    return this._isFollowUp;
  }

  /**
   * Returns a formatted string containing both the original and enhanced prompts
   */
  get formattedPrompt(): string {
    let result = `# User Prompt:\n${this._userPrompt}`;
    
    if (this._enhancedPrompt) {
      result += `\n\n# Enhanced Prompt:\n${this._enhancedPrompt}`;
    }
    
    return result;
  }
}
