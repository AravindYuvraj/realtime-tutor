/* tslint:disable */
/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {GoogleGenAI, LiveServerMessage, Modality, Session } from '@google/genai';
import {LitElement, css, html, nothing} from 'lit';
import {customElement, state} from 'lit/decorators.js';
import {createBlob, decode, decodeAudioData} from './utils.js';
import './visual-3d.js';
import './addition-game.js';

// Helper to get the correct AudioContext constructor
const AudioContextConstructor = window.AudioContext || (window as any).webkitAudioContext;

interface Unit {
  id: string;
  title: string;
  description: string;
  icon: string; // Emoji or SVG path
  gameComponentTag: string | null;
  lessonsTotal: number; // e.g. for "Lesson X of Y"
  completionCriteria: {
    problemsToPass: number;
    totalProblemsInSession: number;
  };
}

interface UnitProgress {
  status: 'locked' | 'unlocked' | 'completed';
  lessonsCompleted: number;
  correctInCurrentSession: number;
  attemptedInCurrentSession: number;
  highScore?: number; // Optional: if we want to track best performance
}

type StudentProgress = Record<string, UnitProgress>;

const UNITS_DATA: Unit[] = [
  {
    id: 'unit1-addition',
    title: 'Unit 1: Addition Adventures',
    description: 'Master addition by solving fun number puzzles!',
    icon: '➕',
    gameComponentTag: 'gdm-addition-game',
    lessonsTotal: 1, // For now, one "session" completes the unit
    completionCriteria: { problemsToPass: 8, totalProblemsInSession: 10 },
  },
  {
    id: 'unit2-subtraction',
    title: 'Unit 2: Subtraction Safari',
    description: 'Explore the world of subtraction and find the differences!',
    icon: '➖',
    gameComponentTag: null, // No game component yet
    lessonsTotal: 1,
    completionCriteria: { problemsToPass: 8, totalProblemsInSession: 10 },
  },
  {
    id: 'unit3-shapes',
    title: 'Unit 3: Shape Detective',
    description: 'Become a detective and identify all the cool shapes!',
    icon: '🔷',
    gameComponentTag: null,
    lessonsTotal: 1,
    completionCriteria: { problemsToPass: 8, totalProblemsInSession: 10 },
  },
  {
    id: 'unit4-patterns',
    title: 'Unit 4: Pattern Magic',
    description: 'Discover the magic of sequences and patterns!',
    icon: '✨',
    gameComponentTag: null,
    lessonsTotal: 1,
    completionCriteria: { problemsToPass: 8, totalProblemsInSession: 10 },
  },
];


@customElement('gdm-live-audio')
export class GdmLiveAudio extends LitElement {
  @state() isRecording = false;
  @state() status = '';
  @state() error = '';
  @state() currentView: 'dashboard' | 'game' = 'dashboard';
  @state() activeUnitId: string | null = null;
  @state() units: Unit[] = UNITS_DATA;
  @state() studentProgress: StudentProgress = {};


  private client: GoogleGenAI;
  private session: Session;
  private inputAudioContext = new AudioContextConstructor({sampleRate: 16000});
  private outputAudioContext = new AudioContextConstructor({sampleRate: 24000});
  @state() inputNode = this.inputAudioContext.createGain();
  @state() outputNode = this.outputAudioContext.createGain();
  private nextStartTime = 0;
  private mediaStream: MediaStream;
  private sourceNode: AudioBufferSourceNode;
  private scriptProcessorNode: ScriptProcessorNode;
  private sources = new Set<AudioBufferSourceNode>();

  static styles = css`
    :host {
      display: block;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      font-family: 'Roboto', 'Arial', sans-serif;
      background-color: #f0f2f5; /* Light background for the whole app */
    }

    .app-container {
      display: flex;
      width: 100%;
      height: 100%;
    }

    /* Dashboard View Styles */
    .dashboard-view {
      width: 100%;
      height: 100%;
      padding: 30px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      overflow-y: auto;
    }
    .dashboard-header {
      font-size: 2.5em;
      color: #333;
      margin-bottom: 30px;
      font-weight: bold;
    }
    .units-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 25px;
      width: 100%;
      max-width: 1200px;
    }
    .unit-card {
      background-color: white;
      border-radius: 12px;
      padding: 20px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      transition: transform 0.2s ease, box-shadow 0.2s ease;
      cursor: pointer;
    }
    .unit-card:not(.locked):hover {
      transform: translateY(-5px);
      box-shadow: 0 8px 16px rgba(0, 0, 0, 0.15);
    }
    .unit-card.locked {
      background-color: #e9ecef;
      cursor: not-allowed;
      opacity: 0.7;
    }
    .unit-icon {
      font-size: 3em;
      margin-bottom: 15px;
    }
    .unit-title {
      font-size: 1.5em;
      font-weight: bold;
      color: #343a40;
      margin-bottom: 10px;
    }
    .unit-description {
      font-size: 0.95em;
      color: #6c757d;
      margin-bottom: 15px;
      flex-grow: 1;
    }
    .unit-status {
      font-size: 0.9em;
      padding: 6px 12px;
      border-radius: 15px;
      font-weight: 500;
    }
    .status-locked { background-color: #adb5bd; color: white; }
    .status-unlocked { background-color: #ffc107; color: #333; }
    .status-completed { background-color: #28a745; color: white; }
    .unit-progress-text {
      font-size: 0.85em;
      color: #495057;
      margin-top: 8px;
    }


    /* Game View Styles */
    .game-view-container { /* This will hold both chat and game */
      display: flex;
      width: 100%;
      height: 100%;
    }

    .chat-container { /* Existing styles adjusted */
      flex: 1;
      display: flex;
      flex-direction: column;
      position: relative;
      background-color: #100c14;
      overflow: hidden;
    }
    .game-container { /* Existing styles adjusted */
      flex: 1;
      padding: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      background-color: #f8f9fa;
      border-left: 1px solid #dee2e6;
      box-sizing: border-box;
      overflow-y: auto;
    }
     .back-to-dashboard {
        position: absolute;
        top: 20px;
        left: 20px;
        padding: 10px 18px;
        font-size: 1em;
        background-color: #6c757d;
        color: white;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        z-index: 110; /* Above controls and status */
        transition: background-color 0.2s ease;
      }
      .back-to-dashboard:hover {
        background-color: #5a6268;
      }


    #status {
      position: absolute;
      bottom: 20px;
      left: 20px;
      right: 20px;
      z-index: 100;
      text-align: center;
      color: white;
      font-family: 'Arial', sans-serif;
      padding: 8px 12px;
      background-color: rgba(0, 0, 0, 0.6);
      border-radius: 8px;
      font-size: 14px;
    }

    .controls {
      z-index: 100;
      position: absolute;
      bottom: 70px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 15px;
      button {
        outline: none;
        border: 1px solid rgba(255, 255, 255, 0.3);
        color: white;
        border-radius: 50%;
        background: rgba(255, 255, 255, 0.15);
        width: 60px;
        height: 60px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color 0.2s ease, transform 0.1s ease;
        box-shadow: 0 2px 5px rgba(0,0,0,0.2);
        svg {
           width: 28px;
           height: 28px;
           fill: white;
        }
        &:hover { background: rgba(255, 255, 255, 0.25); }
        &:active { transform: scale(0.95); }
      }
      button[disabled] { display: none; }
    }
  `;

  constructor() {
    super();
    this.loadProgress();
    this.initClient();
  }

  private loadProgress() {
    const savedProgress = localStorage.getItem('studentProgress');
    if (savedProgress) {
      this.studentProgress = JSON.parse(savedProgress);
    } else {
      // Initialize progress for all units
      this.studentProgress = this.units.reduce((acc, unit, index) => {
        acc[unit.id] = {
          status: index === 0 ? 'unlocked' : 'locked', // Unlock first unit
          lessonsCompleted: 0,
          correctInCurrentSession: 0,
          attemptedInCurrentSession: 0,
        };
        return acc;
      }, {} as StudentProgress);
    }
    // Ensure all units have progress entries after loading
    this.units.forEach((unit, index) => {
        if (!this.studentProgress[unit.id]) {
            this.studentProgress[unit.id] = {
                status: index === 0 && !Object.values(this.studentProgress).some(p => p.status === 'unlocked' || p.status === 'completed') ? 'unlocked' : 'locked',
                lessonsCompleted: 0,
                correctInCurrentSession: 0,
                attemptedInCurrentSession: 0,
            };
        }
    });
    this.saveProgress();
  }

  private saveProgress() {
    localStorage.setItem('studentProgress', JSON.stringify(this.studentProgress));
    this.requestUpdate(); // Trigger re-render to reflect progress
  }

  private initAudio() {
    this.nextStartTime = this.outputAudioContext.currentTime;
  }

  private async initClient() {
    this.initAudio();
    this.client = new GoogleGenAI({ apiKey: process.env.API_KEY });
    this.outputNode.connect(this.outputAudioContext.destination);
    this.initSession();
  }

  private async initSession() {
    const model = 'gemini-2.5-flash-preview-native-audio-dialog';
    try {
      this.session = await this.client.live.connect({
        model: model,
        callbacks: {
          onopen: () => {
            this.updateStatus('Connected! Select a unit or ask a math question! 🚀');
          },
          onmessage: async (message: LiveServerMessage) => {
            const audio = message.serverContent?.modelTurn?.parts[0]?.inlineData;
            if (audio) {
              this.nextStartTime = Math.max(this.nextStartTime, this.outputAudioContext.currentTime);
              const audioBuffer = await decodeAudioData(decode(audio.data), this.outputAudioContext, 24000, 1);
              const source = this.outputAudioContext.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(this.outputNode);
              source.addEventListener('ended', () => this.sources.delete(source));
              source.start(this.nextStartTime);
              this.nextStartTime = this.nextStartTime + audioBuffer.duration;
              this.sources.add(source);
            }
            const interrupted = message.serverContent?.interrupted;
            if(interrupted) {
              for(const source of this.sources.values()) {
                source.stop();
                this.sources.delete(source);
              }
              this.nextStartTime = 0;
            }
          },
          onerror: (e: ErrorEvent) => this.updateError(`Error: ${e.message}`),
          onclose: (e: CloseEvent) => this.updateStatus(`Session closed: ${e.reason || 'Unknown reason'}`),
        },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: {prebuiltVoiceConfig: {voiceName: 'Orus'}} },
          systemInstruction: {
            parts: [{ text: "You are Sparky, a friendly and encouraging math tutor for kids. You help students with various math topics presented in learning units like 'Addition Adventures'. I will send you text updates about their game play or unit progress, prefixed with 'GAME:' or 'UNIT:'. For example: 'GAME: Unit: Addition Adventures. Question: 2 + 3. Student answered: 5. Correct.' or 'UNIT: Student completed Addition Adventures!'. Use this information to guide the student. If they are stuck or get it wrong, offer simple explanations and praise effort. Keep your responses concise, positive, and focused. When they complete a unit, congratulate them enthusiastically!" }]
          }
        },
      });
    } catch (e) {
      console.error('Failed to initialize session:', e);
      this.updateError(`Failed to connect: ${(e as Error).message}`);
    }
  }

  private updateStatus(msg: string) {
    this.status = msg;
    this.error = '';
  }

  private updateError(msg: string) {
    this.error = msg;
    this.status = '';
  }

  private async startRecording() {
    if (this.isRecording) return;
    if (!this.session) {
      this.updateError('Session not initialized.');
      try { await this.initSession(); } catch (e) {
        this.updateError(`Failed to re-initialize session: ${(e as Error).message}`);
        return;
      }
    }
    this.inputAudioContext.resume();
    this.updateStatus('Requesting microphone...');
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.updateStatus('Microphone access granted.');
      this.sourceNode = this.inputAudioContext.createMediaStreamSource(this.mediaStream);
      this.sourceNode.connect(this.inputNode);
      const bufferSize = 256;
      this.scriptProcessorNode = this.inputAudioContext.createScriptProcessor(bufferSize, 1, 1);
      this.scriptProcessorNode.onaudioprocess = (audioProcessingEvent) => {
        if (!this.isRecording || !this.session) return;
        const inputBuffer = audioProcessingEvent.inputBuffer;
        const pcmData = inputBuffer.getChannelData(0);
        try {
          this.session.sendRealtimeInput({media: createBlob(pcmData)});
        } catch (e) {
          console.error("Error sending audio data:", e);
          this.updateError(`Error sending audio: ${(e as Error).message}`);
          this.stopRecording();
        }
      };
      this.sourceNode.connect(this.scriptProcessorNode);
      this.scriptProcessorNode.connect(this.inputAudioContext.destination);
      this.isRecording = true;
      this.updateStatus('🔴 Recording... Speak now or interact with the current unit!');
    } catch (err) {
      console.error('Error starting recording:', err);
      this.updateStatus(`Error starting recording: ${(err as Error).message}.`);
      this.stopRecording();
    }
  }

  private stopRecording() {
    if (!this.isRecording && !this.mediaStream && !this.scriptProcessorNode) return;
    this.updateStatus('Stopping recording...');
    this.isRecording = false;
    if (this.scriptProcessorNode) {
      this.scriptProcessorNode.disconnect();
      this.scriptProcessorNode.onaudioprocess = null;
      // @ts-ignore
      this.scriptProcessorNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      // @ts-ignore
      this.sourceNode = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
      // @ts-ignore
      this.mediaStream = null;
    }
    this.updateStatus('Recording stopped. Click Start to speak or continue with units.');
  }

  private async reset() {
    this.stopRecording();
    this.updateStatus('Resetting session...');
    if (this.session) {
      try { await this.session.close(); } catch (e) { console.warn('Error closing session:', e); }
      // @ts-ignore
      this.session = null;
    }
    for(const source of this.sources.values()) {
      try { source.stop(); } catch(e) {/*ignore*/}
      this.sources.delete(source);
    }
    this.nextStartTime = 0;
    if (this.outputAudioContext.state === 'suspended') await this.outputAudioContext.resume();
    if (this.inputAudioContext.state === 'suspended') await this.inputAudioContext.resume();
    await this.initSession();
    this.updateStatus('Session reset. Ready for new interactions!');
  }

  private handleUnitClick(unitId: string) {
    const progress = this.studentProgress[unitId];
    const unit = this.units.find(u => u.id === unitId);
    if (unit && unit.gameComponentTag && progress && progress.status !== 'locked') {
      this.activeUnitId = unitId;
      // Reset session scores for the unit when starting it
      this.studentProgress[unitId].correctInCurrentSession = 0;
      this.studentProgress[unitId].attemptedInCurrentSession = 0;
      this.saveProgress(); // Save reset session scores
      this.currentView = 'game';
      this.updateStatus(`Starting ${unit.title}...`);
    } else if (progress && progress.status === 'locked') {
      this.updateStatus(`${unit?.title || 'This unit'} is locked. Complete previous units to unlock!`);
       setTimeout(() => this.updateStatus('Connected! Select a unit or ask a math question! 🚀'), 3000);
    }
  }

  private handleGameEvent(event: CustomEvent) {
    const detail = event.detail;
    const unitId = this.activeUnitId;

    if (!unitId || !this.studentProgress[unitId]) return;

    const currentUnit = this.units.find(u => u.id === unitId);
    const unitProgress = this.studentProgress[unitId];

    if (!currentUnit || unitProgress.status === 'completed') return; // Don't process if unit already completed

    let aiMessage = '';

    if (detail.type === 'answer') {
      unitProgress.attemptedInCurrentSession++;
      if (detail.isCorrect) {
        unitProgress.correctInCurrentSession++;
      }
      aiMessage = `GAME: Unit: ${currentUnit.title}. Question: ${detail.question}. Student answered: ${detail.userAnswer}. ${detail.isCorrect ? 'Correct!' : `Incorrect. Correct answer was ${detail.correctAnswer}.`} Progress: ${unitProgress.correctInCurrentSession}/${currentUnit.completionCriteria.totalProblemsInSession}`;

      // Check for unit completion
      if (unitProgress.correctInCurrentSession >= currentUnit.completionCriteria.problemsToPass &&
          unitProgress.attemptedInCurrentSession >= currentUnit.completionCriteria.totalProblemsInSession) {
        unitProgress.status = 'completed';
        unitProgress.lessonsCompleted = currentUnit.lessonsTotal; // Mark all lessons as done
        
        const currentUnitIndex = this.units.findIndex(u => u.id === unitId);
        if (currentUnitIndex !== -1 && currentUnitIndex + 1 < this.units.length) {
          const nextUnitId = this.units[currentUnitIndex + 1].id;
          if (this.studentProgress[nextUnitId] && this.studentProgress[nextUnitId].status === 'locked') {
            this.studentProgress[nextUnitId].status = 'unlocked';
          }
        }
        this.sendAiTextMessage(`UNIT: Student has just completed ${currentUnit.title}! Congratulations! They can now move to the next unit if available.`);
        // Optionally, navigate back to dashboard or show a completion message here
        setTimeout(() => {
            this.currentView = 'dashboard';
            this.activeUnitId = null;
            this.updateStatus(`${currentUnit.title} completed! Well done! 🎉`);
        }, 2500); // Delay to allow AI to respond and player to see final feedback
      } else if (unitProgress.attemptedInCurrentSession >= currentUnit.completionCriteria.totalProblemsInSession) {
        // Session ended, but not passed
         this.sendAiTextMessage(`UNIT: Student has finished a session for ${currentUnit.title} but didn't pass. They got ${unitProgress.correctInCurrentSession} out of ${unitProgress.attemptedInCurrentSession}. Encourage them to try again!`);
         setTimeout(() => { // Give time for AI and game feedback
            this.currentView = 'dashboard';
            this.activeUnitId = null;
            this.updateStatus(`Session for ${currentUnit.title} ended. Keep practicing! You can try again.`);
        }, 2500);

      }
    } else if (detail.type === 'new_question') {
      aiMessage = `GAME: Unit: ${currentUnit.title}. New question: ${detail.question}. (Session: ${unitProgress.correctInCurrentSession}/${unitProgress.attemptedInCurrentSession} towards ${currentUnit.completionCriteria.problemsToPass}/${currentUnit.completionCriteria.totalProblemsInSession})`;
    } else if (detail.type === 'quit_game') {
        this.currentView = 'dashboard';
        this.activeUnitId = null;
        this.updateStatus('Returned to dashboard. Select a unit to continue learning!');
        aiMessage = `UNIT: Student returned to the dashboard from ${currentUnit.title}.`;
    }
    
    this.saveProgress();
    if (aiMessage) this.sendAiTextMessage(aiMessage);
  }

  private async sendAiTextMessage(text: string) {
    if (this.session) {
      try {
        await this.session.sendRealtimeInput({text});
      } catch (e) {
        console.error('Error sending text message to AI:', e);
        this.updateError(`Error sending update: ${(e as Error).message}`);
      }
    }
  }

  private navigateToDashboard() {
    if (this.activeUnitId) { // If a game was active, inform AI
        const currentUnit = this.units.find(u => u.id === this.activeUnitId);
        if (currentUnit) {
            this.sendAiTextMessage(`UNIT: Student is returning to the dashboard from ${currentUnit.title}.`);
        }
    }
    this.currentView = 'dashboard';
    this.activeUnitId = null;
    this.updateStatus('Welcome to your Learning Journey! Select a unit.');
  }

  renderDashboard() {
    return html`
      <div class="dashboard-view">
        <h1 class="dashboard-header">My Learning Journey 🗺️</h1>
        <div class="units-grid">
          ${this.units.map(unit => {
            const progress = this.studentProgress[unit.id] || { status: 'locked', lessonsCompleted: 0, correctInCurrentSession: 0, attemptedInCurrentSession: 0 };
            const isLocked = progress.status === 'locked';
            return html`
              <div 
                class="unit-card ${isLocked ? 'locked' : ''} ${progress.status === 'completed' ? 'completed-card' : ''}"
                @click=${() => this.handleUnitClick(unit.id)}
                role="button"
                tabindex="0"
                aria-label="${unit.title}. Status: ${progress.status}. ${isLocked ? 'Complete previous units to unlock.' : progress.status === 'completed' ? 'Completed.' : `Click to start.`}"
                @keydown=${(e: KeyboardEvent) => e.key === 'Enter' || e.key === ' ' ? this.handleUnitClick(unit.id) : null}
              >
                <div class="unit-icon">${unit.icon}</div>
                <div class="unit-title">${unit.title}</div>
                <div class="unit-description">${unit.description}</div>
                <div class="unit-status status-${progress.status}">
                  ${progress.status.charAt(0).toUpperCase() + progress.status.slice(1)}
                </div>
                ${progress.status === 'unlocked' && unit.completionCriteria ? html`
                  <div class="unit-progress-text">
                    Goal: ${unit.completionCriteria.problemsToPass}/${unit.completionCriteria.totalProblemsInSession} correct in a session.
                  </div>
                  ${progress.attemptedInCurrentSession > 0 ? html `
                    <div class="unit-progress-text">
                        Current session: ${progress.correctInCurrentSession}/${progress.attemptedInCurrentSession}
                    </div>` : ''}
                ` : progress.status === 'completed' ? html `
                    <div class="unit-progress-text">Unit mastered! 🎉</div>
                ` : isLocked ? html`
                    <div class="unit-progress-text">🔒 Locked</div>
                ` : nothing}
              </div>
            `;
          })}
        </div>
      </div>
    `;
  }

  renderGameView() {
    const unit = this.units.find(u => u.id === this.activeUnitId);
    if (!unit || !unit.gameComponentTag) {
      this.navigateToDashboard(); // Safety net
      return nothing;
    }
    const unitProgress = this.studentProgress[unit.id];

    return html`
      <div class="game-view-container">
         <button class="back-to-dashboard" @click=${this.navigateToDashboard} title="Back to Dashboard">⬅️ Dashboard</button>
        <div class="chat-container">
          <gdm-live-audio-visuals-3d
            .inputNode=${this.inputNode}
            .outputNode=${this.outputNode}
          ></gdm-live-audio-visuals-3d>
          <div id="status" role="status" aria-live="polite">
            ${this.error ? `Error: ${this.error}` : this.status}
          </div>
          <div class="controls">
             <button id="resetButton" aria-label="Reset AI Session" title="Reset AI Session" @click=${this.reset}>
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>
            </button>
            <button id="startButton" aria-label="Start Recording" title="Start Recording" @click=${this.startRecording} ?disabled=${this.isRecording}>
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px"><path d="M480-400q-50 0-85-35t-35-85v-240q0-50 35-85t85-35q50 0 85 35t35 85v240q0 50-35 85t-85 35Zm0 80q83 0 141.5-58.5T680-520v-240q0-83-58.5-141.5T480-960q-83 0-141.5 58.5T280-760v240q0 83 58.5 141.5T480-320ZM160-160v-165q-36-41-58-88t-22-97h80q0 38 15.5 71.5T204-488q28-28 64.5-44T340-548v-112q-95 26-157.5 100T120-360v200h40Z"/></svg>
            </button>
            <button id="stopButton" aria-label="Stop Recording" title="Stop Recording" @click=${this.stopRecording} ?disabled=${!this.isRecording}>
                <svg xmlns="http://www.w3.org/2000/svg" height="24px" viewBox="0 -960 960 960" width="24px"><path d="M320-320h320v-320H320v320Zm160-40q50 0 85-35t35-85v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80q0 50 35 85t85 35ZM160-160v-640h640v640H160Z"/></svg>
            </button>
          </div>
        </div>
        <div class="game-container">
          ${unit.id === 'unit1-addition' ? html`
            <gdm-addition-game 
                @gameevent=${this.handleGameEvent}
                .unitConfig=${unit}
                .unitProgress=${unitProgress}
            ></gdm-addition-game>
          ` : html`<p>Game for ${unit.title} coming soon!</p>`}
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="app-container">
        ${this.currentView === 'dashboard' ? this.renderDashboard() : this.renderGameView()}
      </div>
    `;
  }
}

declare global {
    interface Window { webkitAudioContext?: typeof AudioContext; }
}
