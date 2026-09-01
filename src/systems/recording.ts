import {
  createComponent,
  createSystem,
  Entity,
  eq,
  FollowBehavior,
  Follower,
  PanelDocument,
  PanelUI,
  UIKit,
  UIKitDocument,
} from "@iwsdk/core";
import { resumeAudioContext } from "../audio/context.js";
import { resolveLocalePath } from "../locale.js";
import { Task, ActiveTask, TaskCompleteRequested } from "./task.js";
import {
  PHONOGRAPH_CHAPTER_OFFSET_Y,
  PHONOGRAPH_CHAPTER_OFFSET_Z,
  PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH,
  TaskId,
} from "./task-config.js";
import { Phonograph, PhonographPart } from "./phonograph.js";
import { PopIn2D } from "./animation.js";
import { Billboard } from "./billboard.js";
import { hidePanelEntity, stripPanelSurface } from "./panel-lifecycle.js";

const RECORDING_PANEL_CONFIG = "./ui/{locale}/panels/recording-panel.json";
const RECORDING_STOP_HINT_CONFIG = "./ui/{locale}/panels/recording-stop-hint.json";
const RECORDING_PANEL_MAX_WIDTH = 0.175;
const RECORDING_PANEL_OFFSET: [number, number, number] = [0, 0.4, 0];
const RECORDING_STOP_HINT_OFFSET: [number, number, number] = [
  0,
  PHONOGRAPH_CHAPTER_OFFSET_Y,
  PHONOGRAPH_CHAPTER_OFFSET_Z,
];
const RECORDING_STOP_ARM_DELAY_MS = 5000;
const RECORDING_MAX_DURATION_MS = 60_000;

export const RecordingPanel = createComponent("RecordingPanel", {});
export const RecordingStopHintPanel = createComponent("RecordingStopHintPanel", {});

export const Recording = createComponent("Recording", {});
export const StartRecordingSession = createComponent("StartRecordingSession", {});
export const StartCarriageRecording = createComponent("StartCarriageRecording", {});
export const StartCarvingAmbience = createComponent("StartCarvingAmbience", {});
export const StopRecording = createComponent("StopRecording", {});
export const ClearRecording = createComponent("ClearRecording", {});
export const BrakeRecordingStopArmed = createComponent("BrakeRecordingStopArmed", {});

let recordedBuffer: AudioBuffer | null = null;
let audioContext: AudioContext | null = null;
let activeRecorder: MediaRecorder | null = null;
let activeStream: MediaStream | null = null;

function registerActiveRecording(
  recorder: MediaRecorder,
  stream: MediaStream,
): void {
  activeRecorder = recorder;
  activeStream = stream;
}

function clearActiveRecording(): void {
  activeRecorder = null;
  activeStream = null;
}

function stopRecording(): boolean {
  if (activeRecorder?.state === "recording") {
    activeRecorder.stop();
    return true;
  }
  return false;
}

function abortActiveRecording(): void {
  if (activeRecorder?.state === "recording") {
    activeRecorder.stop();
  }
  activeStream?.getTracks().forEach((track) => track.stop());
  clearActiveRecording();
}

function setRecordedAudio(
  ctx: AudioContext,
  buffer: AudioBuffer,
): void {
  audioContext = ctx;
  recordedBuffer = buffer;
}

function getRecordedAudio(): {
  ctx: AudioContext;
  buffer: AudioBuffer;
} | null {
  if (!audioContext || !recordedBuffer) return null;
  return { ctx: audioContext, buffer: recordedBuffer };
}

function clearRecordedAudio(): void {
  recordedBuffer = null;
  audioContext = null;
}

const CYLINDER_RPM = 130;
const CARVING_LOOP_SECONDS = 2.5;
const PLAYBACK_SURFACE_NOISE_GAIN = 0.28;
const RECORDING_CARVING_GAIN = 0.11;
const PLAYBACK_VOICE_GAIN = 1.85 * 1.5;
const PLAYBACK_DISTORTION_AMOUNT = 45;
const PLAYBACK_WOW_DEPTH = 0.012;
const PLAYBACK_HIGHPASS_HZ = 550;
const PLAYBACK_LOWPASS_HZ = 1900;
const PLAYBACK_HORN_RESONANCE_HZ = 1100;
const PLAYBACK_HORN_RESONANCE_GAIN_DB = 12;

export class RecordingSystem extends createSystem({
  activeRecordingSpeakNarrateTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
    where: [eq(Task, "id", TaskId.RecordingSpeakNarrate)],
  },
  activePlaybackTask: {
    required: [Task, ActiveTask],
    excluded: [TaskCompleteRequested],
    where: [eq(Task, "id", TaskId.PlaybackListen)],
  },
  phonograph: { required: [Phonograph] },
  brakePart: {
    required: [PhonographPart],
    where: [eq(PhonographPart, "id", "brake")],
  },
  stopRequested: { required: [StopRecording] },
  clearRequested: { required: [ClearRecording] },
  recording: { required: [Recording] },
  startRecordingSession: { required: [StartRecordingSession] },
  startCarvingAmbience: { required: [StartCarvingAmbience] },
  recordingPanels: { required: [RecordingPanel, PanelDocument] },
  recordingStopHintPanels: {
    required: [RecordingStopHintPanel, PanelDocument],
  },
}) {
  private recordingMaxDurationTimeout: ReturnType<typeof setTimeout> | null =
    null;
  private recordingStopArmTimeout: ReturnType<typeof setTimeout> | null = null;
  private recordingStartInFlight = false;
  private recordingGeneration = 0;
  private playbackGeneration = 0;
  private carvingGeneration = 0;
  private playbackCompleteTimeout: ReturnType<typeof setTimeout> | null = null;
  private playbackNodes: Array<{ stop?: () => void; disconnect: () => void }> =
    [];
  private carvingSource: AudioBufferSourceNode | null = null;
  private recordingPanelEntity: Entity | null = null;
  private recordingStopHintEntity: Entity | null = null;
  private pendingStartRecordingSession = false;
  private pendingRecordingComplete = false;
  private pendingPlaybackComplete = false;
  private pendingRecordingSessionCleanup = false;
  private pendingRecordingUiStart = false;

  init() {
    this.triggerEarlyPermissionPrompt();

    this.cleanupFuncs.push(
      this.queries.recordingPanels.subscribe("qualify", (panel) => {
        this.popInRecordingUiPanel(panel);
      }),

      this.queries.recordingStopHintPanels.subscribe("qualify", (panel) => {
        this.popInRecordingUiPanel(panel);
      }),

      this.queries.startRecordingSession.subscribe("qualify", () => {
        this.pendingStartRecordingSession = true;
      }),

      this.queries.startCarvingAmbience.subscribe("qualify", () => {
        this.world.sceneEntity.removeComponent(StartCarvingAmbience);
        void this.ensureCarvingAmbience();
      }),

      this.queries.activeRecordingSpeakNarrateTask.subscribe("disqualify", () => {
        this.pendingRecordingSessionCleanup = true;
      }),

      this.queries.activePlaybackTask.subscribe("qualify", () => {
        void this.startPlayback();
      }),

      this.queries.activePlaybackTask.subscribe("disqualify", () => {
        this.stopPlayback();
      }),

      this.queries.stopRequested.subscribe("qualify", () => {
        this.stopCarvingAmbience();
        stopRecording();
        this.world.sceneEntity.removeComponent(StopRecording);
      }),

      this.queries.clearRequested.subscribe("qualify", () => {
        this.recordingGeneration += 1;
        this.stopPlayback();
        this.stopCarvingAmbience();
        this.disarmRecordingStopHint();
        this.pendingRecordingComplete = false;
        this.pendingPlaybackComplete = false;
        this.pendingRecordingUiStart = false;
        this.recordingStartInFlight = false;
        abortActiveRecording();
        clearRecordedAudio();
        this.onRecordingStop();
        this.world.sceneEntity
          .removeComponent(ClearRecording)
          .removeComponent(Recording)
          .removeComponent(StopRecording)
          .removeComponent(StartRecordingSession)
          .removeComponent(StartCarriageRecording)
          .removeComponent(StartCarvingAmbience);
      }),
      () => {
        this.recordingGeneration += 1;
        this.clearRecordingMaxDurationTimeout();
        this.clearRecordingStopArmTimeout();
        this.stopPlayback();
        this.stopCarvingAmbience();
        this.recordingStartInFlight = false;
        abortActiveRecording();
      },
    );
  }

  update() {
    this.processPendingRecordingComplete();
    this.processPendingPlaybackComplete();
    this.processPendingRecordingSessionCleanup();
    this.processPendingRecordingUiStart();

    if (this.pendingStartRecordingSession) {
      this.pendingStartRecordingSession = false;
      this.world.sceneEntity.removeComponent(StartRecordingSession);
      if (activeRecorder?.state === "recording" || getRecordedAudio()) return;
      void this.ensureCarvingAmbience();
      void this.startRecording();
    }
  }

  private processPendingRecordingSessionCleanup(): void {
    if (!this.pendingRecordingSessionCleanup) return;
    this.pendingRecordingSessionCleanup = false;

    this.disarmRecordingStopHint();
    this.stopCarvingAmbience();
    if (activeRecorder?.state === "recording" || this.recordingStartInFlight) {
      this.recordingGeneration += 1;
      this.pendingRecordingUiStart = false;
      abortActiveRecording();
    }
    if (this.world.sceneEntity.hasComponent(Recording)) {
      this.onRecordingStop();
      this.world.sceneEntity.removeComponent(Recording);
    }
  }

  private processPendingRecordingUiStart(): void {
    if (!this.pendingRecordingUiStart) return;
    this.pendingRecordingUiStart = false;

    this.world.sceneEntity.addComponent(Recording);
    this.showRecordingPanel();
    this.armRecordingStopHint();
  }

  private async triggerEarlyPermissionPrompt() {
    try {
      const temporaryStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      temporaryStream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.error("Early microphone permission denied or failed:", err);
    }
  }

  private hasActiveRecordingSession(): boolean {
    return (
      activeRecorder?.state === "recording" ||
      this.world.sceneEntity.hasComponent(Recording)
    );
  }

  private async startRecording() {
    if (
      this.recordingStartInFlight ||
      this.hasActiveRecordingSession() ||
      getRecordedAudio()
    ) {
      return;
    }

    this.recordingStartInFlight = true;
    const generation = this.recordingGeneration;
    let acquiredStream: MediaStream | null = null;
    try {
      const ctx = await resumeAudioContext();
      if (
        generation !== this.recordingGeneration ||
        this.hasActiveRecordingSession()
      ) {
        return;
      }

      acquiredStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (
        generation !== this.recordingGeneration ||
        this.hasActiveRecordingSession()
      ) {
        acquiredStream.getTracks().forEach((track) => track.stop());
        return;
      }

      const chunks: BlobPart[] = [];
      const stream = acquiredStream;
      const recorder = new MediaRecorder(stream);
      registerActiveRecording(recorder, stream);
      this.pendingRecordingUiStart = true;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = async () => {
        if (generation !== this.recordingGeneration) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        this.clearRecordingMaxDurationTimeout();
        this.clearRecordingStopArmTimeout();
        clearActiveRecording();
        this.world.sceneEntity.removeComponent(Recording);
        this.onRecordingStop();
        stream.getTracks().forEach((t) => t.stop());

        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const arrayBuffer = await blob.arrayBuffer();
          if (generation !== this.recordingGeneration) return;

          const buffer = await ctx.decodeAudioData(arrayBuffer);
          if (generation !== this.recordingGeneration) return;

          setRecordedAudio(ctx, buffer);
          this.pendingRecordingComplete = true;
        } catch (error) {
          this.failRecording(generation, ctx, error);
        }
      };

      recorder.start();
      this.scheduleRecordingMaxDuration();
    } catch (err) {
      clearActiveRecording();
      acquiredStream?.getTracks().forEach((track) => track.stop());
      this.pendingRecordingUiStart = false;
      this.world.sceneEntity.removeComponent(Recording);
      this.onRecordingStop();
      this.failRecording(generation, undefined, err);
    } finally {
      this.recordingStartInFlight = false;
    }
  }

  private failRecording(
    generation: number,
    ctx: AudioContext | undefined,
    error: unknown,
  ): void {
    if (generation !== this.recordingGeneration) return;
    console.error("Recording failed; continuing with silent playback:", error);

    const fallbackContext = ctx ?? audioContext;
    if (fallbackContext) {
      setRecordedAudio(
        fallbackContext,
        fallbackContext.createBuffer(
          1,
          fallbackContext.sampleRate,
          fallbackContext.sampleRate,
        ),
      );
    }
    this.pendingRecordingComplete = true;
  }

  private scheduleRecordingMaxDuration(): void {
    this.clearRecordingMaxDurationTimeout();
    this.recordingMaxDurationTimeout = setTimeout(() => {
      this.recordingMaxDurationTimeout = null;
      if (activeRecorder?.state !== "recording") return;
      this.stopCarvingAmbience();
      stopRecording();
    }, RECORDING_MAX_DURATION_MS);
  }

  private clearRecordingMaxDurationTimeout(): void {
    if (this.recordingMaxDurationTimeout == null) return;
    clearTimeout(this.recordingMaxDurationTimeout);
    this.recordingMaxDurationTimeout = null;
  }

  private armRecordingStopHint(): void {
    this.clearRecordingStopArmTimeout();
    this.recordingStopArmTimeout = setTimeout(() => {
      this.recordingStopArmTimeout = null;
      if (activeRecorder?.state !== "recording") return;
      if (this.queries.activeRecordingSpeakNarrateTask.entities.size === 0) return;
      const brake = this.first(this.queries.brakePart.entities);
      if (brake) brake.addComponent(BrakeRecordingStopArmed);
      this.showRecordingStopHint();
    }, RECORDING_STOP_ARM_DELAY_MS);
  }

  private clearRecordingStopArmTimeout(): void {
    if (this.recordingStopArmTimeout == null) return;
    clearTimeout(this.recordingStopArmTimeout);
    this.recordingStopArmTimeout = null;
  }

  private disarmRecordingStopHint(): void {
    this.clearRecordingStopArmTimeout();
    for (const brake of this.queries.brakePart.entities) {
      brake.removeComponent(BrakeRecordingStopArmed);
    }
    this.hideRecordingStopHint();
  }

  private onRecordingStop(): void {
    this.clearRecordingMaxDurationTimeout();
    this.disarmRecordingStopHint();
    this.hideRecordingPanel();
  }

  private showRecordingPanel(): void {
    if (this.recordingPanelEntity?.active) return;

    const phonograph = this.first(this.queries.phonograph.entities);
    const phonographObj = phonograph?.object3D;
    if (!phonograph || !phonographObj) return;

    const panel = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PanelUI, {
        config: resolveLocalePath(RECORDING_PANEL_CONFIG),
        maxWidth: RECORDING_PANEL_MAX_WIDTH,
      })
      .addComponent(RecordingPanel)
      .addComponent(Follower, {
        behavior: FollowBehavior.NoRotation,
        target: phonographObj,
        offsetPosition: RECORDING_PANEL_OFFSET,
      })
      .addComponent(Billboard);

    panel.object3D!.scale.setScalar(0.001);
    panel.object3D!.visible = true;
    this.recordingPanelEntity = panel;
  }

  private showRecordingStopHint(): void {
    if (this.recordingStopHintEntity?.active) return;

    const phonograph = this.first(this.queries.phonograph.entities);
    const phonographObj = phonograph?.object3D;
    if (!phonograph || !phonographObj) return;

    const hintPanel = this.world
      .createTransformEntity(undefined, { parent: this.world.sceneEntity })
      .addComponent(PanelUI, {
        config: resolveLocalePath(RECORDING_STOP_HINT_CONFIG),
        maxWidth: PHONOGRAPH_CHAPTER_PANEL_MAX_WIDTH,
      })
      .addComponent(RecordingStopHintPanel)
      .addComponent(Follower, {
        behavior: FollowBehavior.FaceTarget,
        target: phonographObj,
        offsetPosition: RECORDING_STOP_HINT_OFFSET,
      })
      .addComponent(Billboard);

    hintPanel.object3D!.scale.setScalar(0.001);
    hintPanel.object3D!.visible = true;
    this.recordingStopHintEntity = hintPanel;
  }

  private hideRecordingStopHint(): void {
    this.disposeRecordingUiPanel(this.recordingStopHintEntity);
    this.recordingStopHintEntity = null;
  }

  private hideRecordingPanel(): void {
    this.disposeRecordingUiPanel(this.recordingPanelEntity);
    this.recordingPanelEntity = null;
    this.hideRecordingStopHint();
  }

  private popInRecordingUiPanel(panel: Entity): void {
    if (!panel.active) return;

    const doc = panel.getValue(PanelDocument, "document") as UIKitDocument | null;
    const root = doc?.getElementById("panel-root") as UIKit.Component | undefined;
    if (root) root.scale.setScalar(0.001);

    stripPanelSurface(panel);
    if (!panel.hasComponent(PopIn2D)) {
      panel.addComponent(PopIn2D);
    }
  }

  private disposeRecordingUiPanel(panel: Entity | null): void {
    if (!panel?.active) return;
    hidePanelEntity(panel);
    panel.dispose();
  }

  private async ensureCarvingAmbience(): Promise<void> {
    const generation = ++this.carvingGeneration;
    const ctx = await resumeAudioContext();
    if (generation !== this.carvingGeneration) return;
    this.startCarvingAmbience(ctx);
  }

  private startCarvingAmbience(ctx: AudioContext): void {
    this.stopCurrentCarvingSource();

    const bufferSize = Math.floor(ctx.sampleRate * CARVING_LOOP_SECONDS);
    const carvingBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = carvingBuffer.getChannelData(0);
    const samplesPerRevolution = Math.floor((60 / CYLINDER_RPM) * ctx.sampleRate);

    for (let i = 0; i < bufferSize; i++) {
      let sample = (Math.random() * 2 - 1) * 0.28;
      sample += (Math.random() * 2 - 1) * 0.12;

      const cyclePosition = i % samplesPerRevolution;
      if (cyclePosition < Math.floor(ctx.sampleRate * 0.018)) {
        if (Math.random() > 0.7) {
          sample += (Math.random() * 2 - 1) * 0.55;
        }
      }

      if (Math.random() > 0.996) {
        sample += (Math.random() * 2 - 1) * 0.9;
      }

      output[i] = sample;
    }

    const source = ctx.createBufferSource();
    source.buffer = carvingBuffer;
    source.loop = true;

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 900;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.value = 2400;
    bandpass.Q.value = 1.4;

    const gain = ctx.createGain();
    gain.gain.value = RECORDING_CARVING_GAIN;

    source.connect(highpass).connect(bandpass).connect(gain).connect(ctx.destination);
    source.start();
    this.carvingSource = source;
  }

  private stopCarvingAmbience(): void {
    this.carvingGeneration += 1;
    this.stopCurrentCarvingSource();
  }

  private stopCurrentCarvingSource(): void {
    if (!this.carvingSource) return;
    try {
      this.carvingSource.stop();
    } catch {
    }
    this.carvingSource = null;
  }

  private processPendingRecordingComplete(): void {
    if (!this.pendingRecordingComplete) return;
    this.pendingRecordingComplete = false;
    this.requestActiveTaskComplete(this.queries.activeRecordingSpeakNarrateTask.entities);
  }

  private processPendingPlaybackComplete(): void {
    if (!this.pendingPlaybackComplete) return;
    this.pendingPlaybackComplete = false;
    this.requestActiveTaskComplete(this.queries.activePlaybackTask.entities);
  }

  private requestActiveTaskComplete(entities: Iterable<Entity>): void {
    for (const entity of entities) {
      if (!entity.active || entity.hasComponent(TaskCompleteRequested)) continue;
      entity.addComponent(TaskCompleteRequested);
    }
  }

  private requestPlaybackComplete(generation: number): void {
    if (generation !== this.playbackGeneration) return;
    this.stopPlayback();
    this.pendingPlaybackComplete = true;
  }

  private stopPlayback(): void {
    this.playbackGeneration += 1;
    this.clearPlaybackCompleteTimeout();
    for (const node of this.playbackNodes) {
      try {
        node.stop?.();
      } catch {
      }
      try {
        node.disconnect();
      } catch {
      }
    }
    this.playbackNodes.length = 0;
  }

  private clearPlaybackCompleteTimeout(): void {
    if (this.playbackCompleteTimeout == null) return;
    clearTimeout(this.playbackCompleteTimeout);
    this.playbackCompleteTimeout = null;
  }

  private async startPlayback() {
    this.stopPlayback();
    const generation = this.playbackGeneration;
    this.pendingPlaybackComplete = false;

    const recorded = getRecordedAudio();
    if (!recorded) {
      console.error("No recorded audio available for playback");
      this.requestPlaybackComplete(generation);
      return;
    }

    const ctx = await resumeAudioContext();
    if (generation !== this.playbackGeneration) return;
    if (this.queries.activePlaybackTask.entities.size === 0) return;

    const source = this.playProcessedAudio(ctx, recorded.buffer);
    source.onended = () => {
      this.requestPlaybackComplete(generation);
    };

    const timeoutMs =
      (recorded.buffer.duration / (1 - PLAYBACK_WOW_DEPTH)) * 1000 + 400;
    this.playbackCompleteTimeout = setTimeout(() => {
      this.playbackCompleteTimeout = null;
      this.requestPlaybackComplete(generation);
    }, timeoutMs);
  }

  private playProcessedAudio(ctx: AudioContext, buffer: AudioBuffer) {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const wowLFO = ctx.createOscillator();
    const wowGain = ctx.createGain();
    wowLFO.frequency.value = 4.5;
    wowGain.gain.value = PLAYBACK_WOW_DEPTH;
    wowLFO.connect(wowGain);
    wowGain.connect(source.playbackRate);
    wowLFO.start();
    this.trackPlaybackNode(source);
    this.trackPlaybackNode(wowLFO);

    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = PLAYBACK_HIGHPASS_HZ;

    const lowpass = ctx.createBiquadFilter();
    lowpass.type = "lowpass";
    lowpass.frequency.value = PLAYBACK_LOWPASS_HZ;

    const hornResonance = ctx.createBiquadFilter();
    hornResonance.type = "peaking";
    hornResonance.frequency.value = PLAYBACK_HORN_RESONANCE_HZ;
    hornResonance.Q.value = 4.5;
    hornResonance.gain.value = PLAYBACK_HORN_RESONANCE_GAIN_DB;

    const distortion = ctx.createWaveShaper();
    distortion.curve = this.makeDistortionCurve(PLAYBACK_DISTORTION_AMOUNT);
    distortion.oversample = "4x";

    const voiceGain = ctx.createGain();
    voiceGain.gain.value = PLAYBACK_VOICE_GAIN;

    source
      .connect(distortion)
      .connect(highpass)
      .connect(lowpass)
      .connect(hornResonance)
      .connect(voiceGain)
      .connect(ctx.destination);

    this.playSurfaceNoise(ctx, source.buffer!.duration);

    source.start();
    return source;
  }

  private trackPlaybackNode(node: {
    stop?: () => void;
    disconnect: () => void;
  }): void {
    this.playbackNodes.push(node);
  }

  private playSurfaceNoise(ctx: AudioContext, duration: number) {
    const bufferSize = ctx.sampleRate * duration;
    const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);

    const rpm = CYLINDER_RPM;
    const samplesPerSec = ctx.sampleRate;
    const samplesPerRevolution = Math.floor((60 / rpm) * samplesPerSec);

    for (let i = 0; i < bufferSize; i++) {
      let noise = (Math.random() * 2 - 1) * 0.2;

      const cyclePosition = i % samplesPerRevolution;

      if (cyclePosition < Math.floor(samplesPerSec * 0.015)) {
        if (Math.random() > 0.85) {
          noise += (Math.random() * 2 - 1) * 1.8;
        }
      }

      if (Math.random() > 0.9997) {
        noise += (Math.random() * 2 - 1) * 1.5;
      }

      output[i] = noise;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;

    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = 1000;
    noiseFilter.Q.value = 2.0;

    const noiseGain = ctx.createGain();
    noiseGain.gain.value = PLAYBACK_SURFACE_NOISE_GAIN;

    noiseSource
      .connect(noiseFilter)
      .connect(noiseGain)
      .connect(ctx.destination);
    noiseSource.start();
    this.trackPlaybackNode(noiseSource);
  }

  private makeDistortionCurve(amount: number) {
    const k = typeof amount === "number" ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
      const x = (i * 2) / n_samples - 1;
      curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
  }

  private first(entities: Iterable<Entity>): Entity | undefined {
    for (const entity of entities) return entity;
    return undefined;
  }
}
