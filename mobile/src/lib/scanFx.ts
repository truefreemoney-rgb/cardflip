import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from "expo-audio";
import * as Haptics from "expo-haptics";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * The website's scan feel (lib/client/scanFx.ts): a tick on capture, a rising
 * chirp on a match (longer for $100+, a run with a sparkle for $500+), a low
 * buzz on a miss, plus a haptic the phone can feel (the site's vibrate does
 * nothing on iPhone). Style B "Arcade", Chris 10-30. The WAVs in
 * assets/sounds are the site's synth rendered to files. Sounds mix with the
 * phone's music and stay quiet on the silent switch; "Reveal sounds" in
 * Scanner options turns them off (the haptics stay).
 */

export type RevealTier = "plain" | "nice" | "big" | "grail";

const KEY = "cardflip_sound";
let soundOn = true;
let players: Record<"capture" | "plain" | "big" | "grail" | "miss", AudioPlayer> | null = null;

/** Load the setting and the five sounds once, when the scanner opens. */
export async function loadScanFx(): Promise<boolean> {
  try {
    const raw = Platform.OS === "web" ? globalThis.localStorage?.getItem(KEY) : await SecureStore.getItemAsync(KEY);
    soundOn = raw !== "off";
  } catch {
    soundOn = true;
  }
  if (!players) {
    try {
      await setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" });
      players = {
        capture: createAudioPlayer(require("../../assets/sounds/capture.wav")),
        plain: createAudioPlayer(require("../../assets/sounds/plain.wav")),
        big: createAudioPlayer(require("../../assets/sounds/big.wav")),
        grail: createAudioPlayer(require("../../assets/sounds/grail.wav")),
        miss: createAudioPlayer(require("../../assets/sounds/miss.wav")),
      };
    } catch {
      players = null; // no audio: the haptics still play
    }
  }
  return soundOn;
}

export async function saveSoundOn(on: boolean): Promise<void> {
  soundOn = on;
  try {
    if (Platform.OS === "web") globalThis.localStorage?.setItem(KEY, on ? "on" : "off");
    else await SecureStore.setItemAsync(KEY, on ? "on" : "off");
  } catch {
    // The choice lasts until the app closes.
  }
}

function play(name: keyof NonNullable<typeof players>) {
  if (!soundOn || !players) return;
  try {
    const p = players[name];
    p.seekTo(0);
    p.play();
  } catch {
    // A sound that fails is just silent.
  }
}

function feel(run: () => Promise<void>) {
  if (Platform.OS === "web") return;
  run().catch(() => {});
}

export function fxCapture(): void {
  feel(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
  play("capture");
}

export function fxMatch(tier: RevealTier): void {
  feel(() => (tier === "big" || tier === "grail" ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success) : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)));
  play(tier === "plain" || tier === "nice" ? "plain" : tier);
}

export function fxMiss(): void {
  feel(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
  play("miss");
}
