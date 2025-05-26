import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

// Define interfaces for props if they become complex
interface UnitConfig {
  id: string;
  title: string;
  completionCriteria: {
    problemsToPass: number;
    totalProblemsInSession: number;
  };
}

interface UnitProgress {
  status: 'locked' | 'unlocked' | 'completed';
  correctInCurrentSession: number;
  attemptedInCurrentSession: number;
}

@customElement('gdm-addition-game')
export class GdmAdditionGame extends LitElement {
  @property({ type: Object }) unitConfig?: UnitConfig;
  @property({ type: Object }) unitProgress?: UnitProgress;

  @state() private num1 = 0;
  @state() private num2 = 0;
  @state() private userAnswer = '';
  @state() private feedback = '';
  // Score here means correct in current problem set for the unit session
  @state() private isAnswerChecked = false;
  @state() private isCorrect = false;
  @state() private currentCorrectAnswer = 0;
  @state() private problemsAttemptedThisGameSession = 0; // Internal counter for this game instance
  @state() private problemsCorrectThisGameSession = 0; // Internal counter

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 15px;
      padding: 20px;
      background-color: #ffffff;
      border-radius: 12px;
      box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
      width: 100%;
      max-width: 450px; /* Slightly wider */
      box-sizing: border-box;
      font-family: 'Roboto', 'Arial', sans-serif;
      color: #333;
    }
    .game-header {
        width: 100%;
        text-align: center;
        margin-bottom:10px;
    }
    h2 {
      font-size: 22px; /* Smaller for unit context */
      color: #2c3e50;
      margin: 0 0 5px 0;
      font-weight: 500;
    }
    .progress-info {
      font-size: 16px;
      color: #3498db;
      font-weight: 500;
      background-color: #eaf5ff;
      padding: 8px 15px;
      border-radius: 15px;
      margin-bottom: 15px;
    }
    .question {
      font-size: 38px;
      font-weight: bold;
      color: #8e44ad;
      margin: 5px 0;
      padding: 10px;
      background-color: #f9f3ff;
      border-radius: 8px;
    }
    input[type="number"] {
      padding: 14px;
      font-size: 22px;
      border: 2px solid #bdc3c7;
      border-radius: 8px;
      text-align: center;
      width: 120px; /* Wider */
      transition: border-color 0.2s ease-in-out, box-shadow 0.2s ease-in-out;
      box-sizing: border-box;
    }
    input[type="number"]:focus {
      border-color: #8e44ad;
      box-shadow: 0 0 0 3px rgba(142, 68, 173, 0.2);
      outline: none;
    }
    input[type=number]::-webkit-inner-spin-button, 
    input[type=number]::-webkit-outer-spin-button { 
      -webkit-appearance: none; 
      margin: 0; 
    }
    input[type=number] {
      -moz-appearance: textfield;
    }
    .buttons {
      display: flex;
      gap: 12px;
      margin-top: 5px;
    }
    button {
      padding: 10px 20px; /* Standardized */
      font-size: 15px;
      font-weight: 500;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: background-color 0.2s ease, transform 0.1s ease;
      color: white;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    button:active {
        transform: scale(0.96);
    }
    .check-button { background-color: #2ecc71; }
    .check-button:hover { background-color: #27ae60; }
    .check-button[disabled] { background-color: #95a5a6; cursor: not-allowed; }
    .next-button { background-color: #e67e22; }
    .next-button:hover { background-color: #d35400; }
    
    .feedback {
      font-size: 17px;
      font-weight: 500;
      min-height: 25px;
      margin-top: 8px;
      padding: 8px 15px;
      border-radius: 6px;
      width: 100%;
      text-align: center;
      box-sizing: border-box;
    }
    .feedback.correct { color: #27ae60; background-color: #e8f8f0; }
    .feedback.incorrect { color: #c0392b; background-color: #fdecea; }

    .session-completed-message {
        margin-top: 15px;
        padding: 15px;
        border-radius: 8px;
        background-color: #d4edda; /* Light green for success */
        color: #155724; /* Dark green text */
        font-weight: bold;
        text-align: center;
    }
    .session-failed-message {
        margin-top: 15px;
        padding: 15px;
        border-radius: 8px;
        background-color: #f8d7da; /* Light red for failure */
        color: #721c24; /* Dark red text */
        font-weight: bold;
        text-align: center;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this.resetGameForNewSession(); // Initialize or reset game state based on unit progress
  }

  // This method is called when the component is connected or when unitConfig/unitProgress might change
  // or when a new "session" for this unit starts.
  private resetGameForNewSession() {
    this.problemsAttemptedThisGameSession = this.unitProgress?.attemptedInCurrentSession || 0;
    this.problemsCorrectThisGameSession = this.unitProgress?.correctInCurrentSession || 0;
    
    if (this.isSessionOver()) {
        // If session is already over (e.g. re-entering a completed/failed session view)
        // No new question, just show status.
        this.feedback = ''; // Clear previous problem feedback
    } else {
        this.generateNewQuestion();
    }
  }

  private isSessionOver(): boolean {
    if (!this.unitConfig || !this.unitProgress) return false;
    return this.unitProgress.attemptedInCurrentSession >= this.unitConfig.completionCriteria.totalProblemsInSession;
  }

  private didPlayerPassSession(): boolean {
    if (!this.unitConfig || !this.unitProgress) return false;
    return this.unitProgress.correctInCurrentSession >= this.unitConfig.completionCriteria.problemsToPass;
  }


  private generateNewQuestion() {
    if (this.isSessionOver()) {
      // Don't generate new questions if the session goal is met or attempts exhausted
      this.feedback = this.didPlayerPassSession() ? "You've completed this session's goal! Great job!" : "You've completed all attempts for this session.";
      this.requestUpdate();
      return;
    }

    this.num1 = Math.floor(Math.random() * 10); 
    this.num2 = Math.floor(Math.random() * 10);
    this.currentCorrectAnswer = this.num1 + this.num2;
    this.userAnswer = '';
    this.feedback = '';
    this.isAnswerChecked = false;
    this.isCorrect = false;
    
    const questionText = `${this.num1} + ${this.num2}`;
    this.dispatchEvent(new CustomEvent('gameevent', {
      detail: { type: 'new_question', question: questionText },
      bubbles: true,
      composed: true
    }));
  }

  private handleInput(e: Event) {
    this.userAnswer = (e.target as HTMLInputElement).value;
  }

  private checkAnswer() {
    if (this.isSessionOver() || (this.isAnswerChecked && this.isCorrect)) {
        // If session is over, or if current question is correctly answered and waiting for "Next"
        return;
    }

    if (this.userAnswer.trim() === '') {
        this.feedback = "Hmm, haven't typed an answer yet! 🤔";
        this.isCorrect = false;
        this.isAnswerChecked = true; 
        // Not dispatching answer event for empty answer, or parent can decide
        return;
    }

    const answer = parseInt(this.userAnswer, 10);
    this.isCorrect = answer === this.currentCorrectAnswer;
    this.isAnswerChecked = true;
    // Increment internal counters before dispatching, parent will use its own source of truth from props
    this.problemsAttemptedThisGameSession++; 
    if (this.isCorrect) {
      this.problemsCorrectThisGameSession++;
      this.feedback = 'Correct! 🎉 Superstar!';
       // Auto-advance if they got it right and session isn't over
      setTimeout(() => {
        if (this.isCorrect && this.isAnswerChecked && !this.isSessionOver()) { 
            this.generateNewQuestion();
        }
      }, 1800);
    } else {
      this.feedback = `Not quite! The answer was ${this.currentCorrectAnswer}. Keep trying! 💪`;
    }
    this.dispatchAnswerEvent(); // Dispatch event for parent to update global progress
  }

  private dispatchAnswerEvent() {
    const questionText = `${this.num1} + ${this.num2}`;
    this.dispatchEvent(new CustomEvent('gameevent', {
      detail: {
        type: 'answer',
        question: questionText,
        userAnswer: this.userAnswer,
        isCorrect: this.isCorrect,
        correctAnswer: this.currentCorrectAnswer,
        // The parent (index.tsx) will manage overall unitProgress.
        // This component mainly signals the result of one attempt.
      },
      bubbles: true,
      composed: true
    }));
  }
  
  private handleNextQuestionClick() {
      if(!this.isSessionOver()){
          this.generateNewQuestion();
      }
  }


  render() {
    if (!this.unitConfig || !this.unitProgress) {
      return html`<p>Loading unit information...</p>`;
    }
    
    const sessionOver = this.isSessionOver();
    const playerPassed = this.didPlayerPassSession();

    const problemsGoal = this.unitConfig.completionCriteria.totalProblemsInSession;
    const problemsToPass = this.unitConfig.completionCriteria.problemsToPass;
    // Use unitProgress for display as it's the source of truth from parent
    const displayAttempted = this.unitProgress.attemptedInCurrentSession;
    const displayCorrect = this.unitProgress.correctInCurrentSession;

    return html`
      <div class="game-header">
        <h2>${this.unitConfig.title}</h2>
        <div class="progress-info">
            Goal: ${problemsToPass}/${problemsGoal} Correct | Current: ${displayCorrect}/${displayAttempted}
        </div>
      </div>

      ${!sessionOver ? html`
        <div class="question">${this.num1} + ${this.num2} = ?</div>
        <input 
          type="number" 
          .value=${this.userAnswer} 
          @input=${this.handleInput}
          @keyup=${(e: KeyboardEvent) => e.key === 'Enter' && !(this.isAnswerChecked && this.isCorrect) && this.checkAnswer()}
          aria-label="Your answer"
          placeholder="Answer"
          ?disabled=${this.isAnswerChecked && this.isCorrect}
        />
        <div class="buttons">
          <button 
              class="check-button" 
              @click=${this.checkAnswer} 
              ?disabled=${(this.isAnswerChecked && this.isCorrect) || sessionOver}>
              Check ✨
          </button>
          <button 
            class="next-button" 
            @click=${this.handleNextQuestionClick}
            ?disabled=${sessionOver}>
            Next ➡️
          </button>
        </div>
        ${this.isAnswerChecked && this.feedback ? html`
          <div class="feedback ${this.isCorrect ? 'correct' : 'incorrect'}">
            ${this.feedback}
          </div>
        ` : ''}
      ` : ''}

      ${sessionOver ? html`
        ${playerPassed ? html`
          <div class="session-completed-message">
            Excellent! You've completed this unit's goal! 🎉<br/>
            (${displayCorrect}/${displayAttempted} correct)
          </div>
        ` : html`
          <div class="session-failed-message">
            Session complete. You got ${displayCorrect}/${displayAttempted} correct.<br/>
            Keep practicing to reach ${problemsToPass} correct answers! You can do it!
          </div>
        `}
         <p>Returning to dashboard shortly...</p>
      ` : ''}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'gdm-addition-game': GdmAdditionGame;
  }
}
