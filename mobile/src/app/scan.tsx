import Ionicons from "@expo/vector-icons/Ionicons";
import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ActivityIndicator, Animated, Linking, Modal, Platform, Pressable, ScrollView, Share, StyleSheet, Switch, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { openSitePage } from "~/components/AppHeader";
import { useAuth } from "~/lib/auth";
import { GAMES, fetchCardById, pictureUrl, publicGames, type GameId, type PokemonCard } from "~/lib/catalog";
import {
  CONDITIONS,
  defaultVariantOf,
  giveBackScan,
  identify,
  maxEdgeFor,
  printingOptions,
  readFailureMessage,
  readPhoto,
  removeSavedCard,
  revealPrice,
  saveScan,
  swapSavedCard,
  updateSavedCard,
  type Condition,
  type Identified,
  type ScanQuota,
  type VisionCardRead,
} from "~/lib/scan";
import { colors, fonts, gradients, radius, space } from "~/lib/theme";

/** A real card is 63×88 mm; the guide is one card, 82% of the camera's height (the website's CameraCapture). */
const GUIDE_RATIO = 63 / 88;
const GUIDE_HEIGHT = 0.82;

/** The website's scanner colours (globals.css): the guide's brand-400 corners, the holo-pink sweep. */
const BRACKET = "#818cf8";
const HOLO_PINK = "#f0abfc";
const SURFACE_2 = "rgba(180,190,255,0.1)";

type Phase =
  | { kind: "camera" }
  | { kind: "reading"; photo: string; reread: GameId | null }
  | { kind: "miss"; photo: string; message: string; wrongGame: GameId | null; read: VisionCardRead | null; scanId: string | null; quota: boolean }
  | { kind: "result"; photo: string; found: Identified; card: PokemonCard; condition: Condition; variant: string | null; savedId: string | null; saving: boolean };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where the guide sits inside a camera view of this size. */
function guideBox(w: number, h: number): Box {
  let gh = h * GUIDE_HEIGHT;
  let gw = gh * GUIDE_RATIO;
  if (gw > w - space.lg * 2) {
    gw = w - space.lg * 2;
    gh = gw / GUIDE_RATIO;
  }
  return { x: (w - gw) / 2, y: (h - gh) / 2, w: gw, h: gh };
}

/**
 * The guide, in the picture's own pixels. The preview fills the view like
 * CSS "cover": the picture is scaled to the larger of the two ratios and
 * centred, so whatever pokes past the view is cropped off screen.
 */
function cropFor(view: { w: number; h: number }, pic: { w: number; h: number }, guide: Box) {
  const s = Math.max(view.w / pic.w, view.h / pic.h);
  const offX = (view.w - pic.w * s) / 2;
  const offY = (view.h - pic.h * s) / 2;
  const x = Math.max(0, Math.round((guide.x - offX) / s));
  const y = Math.max(0, Math.round((guide.y - offY) / s));
  const w = Math.min(pic.w - x, Math.round(guide.w / s));
  const h = Math.min(pic.h - y, Math.round(guide.h / s));
  return { originX: x, originY: y, width: Math.max(1, w), height: Math.max(1, h) };
}

/** Parses "$1,234.56" back to a number for the count-up; null when there is no number. */
function moneyValue(text: string | null): number | null {
  if (!text) return null;
  const n = Number(text.replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatMoney(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * The price, counted up from $0.00 the moment the card lands (the reveal is
 * the exciting part, Chris). A later change (condition, printing) shows the
 * new number at once; only a new card counts again.
 */
function CountUpMoney({ text, revealKey }: { text: string | null; revealKey: string }) {
  const [shown, setShown] = useState<string | null>(text);
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    const target = moneyValue(text);
    if (target == null || lastKey.current === revealKey) {
      setShown(text);
      return;
    }
    lastKey.current = revealKey;
    const start = Date.now();
    const ms = 700;
    let raf = 0;
    const tick = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t >= 1) {
        setShown(text);
        return;
      }
      setShown(formatMoney(target * eased));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [text, revealKey]);
  return <Text style={styles.bigMoney}>{shown ?? "—"}</Text>;
}

/** The website's .scan-sweep: a holo-pink band that runs down the guide while the card is being read. */
function Sweep({ height }: { height: number }) {
  const [y] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(y, { toValue: 1, duration: 2200, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [y]);
  const band = height * 0.22;
  return (
    <Animated.View pointerEvents="none" style={[styles.sweep, { height: band, transform: [{ translateY: y.interpolate({ inputRange: [0, 1], outputRange: [-band, height] }) }] }]}>
      <LinearGradient colors={["rgba(240,171,252,0)", "rgba(240,171,252,0)", "rgba(240,171,252,0.28)", "rgba(240,171,252,0.92)", HOLO_PINK]} locations={[0, 0.55, 0.88, 0.97, 1]} style={StyleSheet.absoluteFill} />
      <View style={styles.sweepEdge} />
    </Animated.View>
  );
}

/** The website's top-bar round button (40 px, bordered, surface-2). */
function RoundButton({ onPress, label, on, children }: { onPress: () => void; label: string; on?: boolean; children: ReactNode }) {
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} hitSlop={2} style={({ pressed }) => [styles.round, on && styles.roundOn, pressed && { opacity: 0.85 }]}>
      {children}
    </Pressable>
  );
}

/** The condition dot colours: the same ladder as the website's result card and options sheet. */
const DOT: Record<Condition, string> = {
  "Near Mint": "#34d399",
  "Lightly Played": "#38bdf8",
  "Moderately Played": "#fbbf24",
  "Heavily Played": "#fb923c",
  Damaged: "#f87171",
};

function Heading({ children, first }: { children: string; first?: boolean }) {
  return <Text style={[styles.heading, first && { marginTop: 0 }]}>{children}</Text>;
}

/** The site's options-sheet row: a label (and a hint) on the left, a switch or a button on the right. */
function Row({ label, hint, on, onChange, last, children }: { label: string; hint?: string; on?: boolean; onChange?: () => void; last?: boolean; children?: ReactNode }) {
  return (
    <View style={[styles.optRow, last && { borderBottomWidth: 0 }]}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.optLabel}>{label}</Text>
        {hint ? <Text style={styles.optHint}>{hint}</Text> : null}
      </View>
      {children ?? (onChange ? <Switch value={!!on} onValueChange={onChange} trackColor={{ false: SURFACE_2, true: colors.brand }} thumbColor={colors.white} ios_backgroundColor={SURFACE_2} /> : null)}
    </View>
  );
}

/**
 * The scanner (docs/APP-PLAN.md step 4), the website's phone scanner
 * (src/components/CameraCapture.tsx) built native: the top bar (Close, the
 * "Scanning Pokémon" pill, the light, ⋯ options), the viewfinder with the
 * one-card guide and its brand corners, the helper line and tips under it,
 * the game chips, and one big Capture button. No auto-scan (Chris), no photo
 * upload. One tap = one read; a miss says why in the chip under the
 * viewfinder and the camera stays live; the camera stays live while it
 * reads, with the site's sweep running down the guide.
 */
export default function Scan() {
  const insets = useSafeAreaInsets();
  const { user, refresh } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [view, setView] = useState({ w: 0, h: 0 });
  const [games, setGames] = useState<GameId[]>(["pokemon"]);
  const [game, setGame] = useState<GameId>("pokemon");
  const [phase, setPhase] = useState<Phase>({ kind: "camera" });
  const [scansLeft, setScansLeft] = useState<number | null | undefined>(user?.scans?.remaining);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"copy" | "pick" | null>(null);
  const [options, setOptions] = useState(false);
  const [torch, setTorch] = useState(false);
  const [tipsOn, setTipsOn] = useState(true);
  const [flash, setFlash] = useState(false);
  /** The condition new scans start as (the site's "New scans start as"); Near Mint unless changed in ⋯. */
  const [startCondition, setStartCondition] = useState<Condition>("Near Mint");
  /** This session's tally for the top pill: cards landed and their market total, as on the site. */
  const [tally, setTally] = useState({ count: 0, value: 0 });

  useEffect(() => {
    let live = true;
    publicGames().then((g) => {
      if (!live) return;
      setGames(g);
      setGame((cur) => (g.includes(cur) ? cur : g[0]));
    });
    return () => {
      live = false;
    };
  }, []);

  // The browser asks for the camera the moment the site's scanner opens; the app does the same.
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setView({ w: width, h: height });
  }, []);

  const applyBalance = useCallback(
    (usage: ScanQuota | null) => {
      if (!usage) return;
      setScansLeft(usage.remaining);
      // The last scan just went: the session's own flags (appAccess) follow (the site re-reads too).
      if (usage.remaining === 0) void refresh();
    },
    [refresh],
  );

  /** The read, the match, the save: one scan from a JPEG (base64, already cropped and shrunk). */
  const runScan = useCallback(
    async (base64: string, as: GameId, reuse?: { read: VisionCardRead; scanId: string | null }) => {
      const photo = `data:image/jpeg;base64,${base64}`;
      setPhase({ kind: "reading", photo, reread: reuse ? as : null });

      // "Switch to <game>": the wrong-game read already carries the card (name + number), so it is matched
      // under the other game instead of paying for a second read (Chris 10-22: one scan on the backend).
      const outcome = reuse ? { status: "done" as const, read: reuse.read, usage: null, error: null, scanId: reuse.scanId } : await readPhoto(base64, as);
      applyBalance(outcome.usage);
      if (outcome.status !== "done" || !outcome.read) {
        const quota = outcome.status === "quota";
        if (quota && outcome.usage?.remaining !== 0) void refresh();
        setPhase({ kind: "miss", photo, message: readFailureMessage(outcome), wrongGame: null, read: null, scanId: null, quota });
        return;
      }
      const found = await identify(outcome.read, as);
      if (!found.card) {
        setPhase({ kind: "miss", photo, message: found.error ?? "No match — line the card up in the guide and try again", wrongGame: found.wrongGame, read: outcome.read, scanId: outcome.scanId, quota: false });
        // Nothing found = not a scan (Chris 10-11). A wrong-game read with a switch on offer keeps its scan: the
        // switch reuses it; "Scan again" from there gives it back (below).
        if (!found.wrongGame && outcome.scanId) giveBackScan(outcome.scanId).then(applyBalance);
        return;
      }
      const condition: Condition = startCondition;
      const card = found.card;
      setPhase({ kind: "result", photo, found, card, condition, variant: found.variant, savedId: null, saving: true });
      setTally((t) => ({ count: t.count + 1, value: t.value + (moneyValue(revealPrice(card, condition, found.variant).text) ?? 0) }));
      const saved = await saveScan(card, as, condition, found.variant, outcome.scanId);
      setPhase((p) => (p.kind === "result" && p.photo === photo ? { ...p, savedId: saved?.id ?? null, saving: false } : p));
      if (!saved) setNote("Couldn't save — check your connection and scan again");
    },
    [refresh, applyBalance, startCondition],
  );

  const capture = useCallback(async () => {
    if (busy || !camera.current || !cameraReady) return;
    setBusy(true);
    setNote(null);
    setFlash(true);
    setTimeout(() => setFlash(false), 120);
    try {
      const shot = await camera.current.takePictureAsync({ quality: 0.92 });
      if (!shot?.uri) throw new Error("no frame");
      const crop = cropFor(view, { w: shot.width, h: shot.height }, guideBox(view.w, view.h));
      const maxEdge = maxEdgeFor(game);
      const actions = [{ crop }, ...(crop.height > maxEdge ? [{ resize: { height: maxEdge } }] : [])];
      const out = await manipulateAsync(shot.uri, actions, { compress: 0.9, format: SaveFormat.JPEG, base64: true });
      if (!out.base64) throw new Error("no jpeg");
      await runScan(out.base64, game);
    } catch {
      setNote("Couldn't capture that frame — tap again");
      setPhase({ kind: "camera" });
    } finally {
      setBusy(false);
    }
  }, [busy, cameraReady, game, runScan, view]);

  // Web in development only: the pane has no camera, so a catalog picture stands in for a shot. Never shipped.
  const devTestPhoto = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const card = await fetchCardById(game === "pokemon" ? "swsh10.5-010" : "", game);
      const url = pictureUrl(card?.imageLarge || card?.imageSmall);
      if (!url) throw new Error("no picture");
      const blob = await (await fetch(url)).blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      const out = await manipulateAsync(dataUrl, [{ resize: { height: maxEdgeFor(game) } }], { compress: 0.9, format: SaveFormat.JPEG, base64: true });
      if (!out.base64) throw new Error("no jpeg");
      await runScan(out.base64, game);
    } catch (err) {
      setNote(`Test photo failed: ${(err as Error)?.message ?? err}`);
    } finally {
      setBusy(false);
    }
  }, [busy, game, runScan]);

  const scanAgain = useCallback(() => {
    // Leaving a wrong-game miss without switching: that scan found nothing, so it is given back now.
    if (phase.kind === "miss" && phase.wrongGame && phase.scanId) giveBackScan(phase.scanId).then(applyBalance);
    setNote(null);
    setPhase({ kind: "camera" });
  }, [phase, applyBalance]);

  const switchGame = useCallback(() => {
    if (phase.kind !== "miss" || !phase.wrongGame || !phase.read) return;
    const to = phase.wrongGame;
    setGame(to);
    const base64 = phase.photo.split(",")[1] ?? "";
    if (phase.read.name && phase.read.cardNumber) void runScan(base64, to, { read: phase.read, scanId: phase.scanId });
    else void runScan(base64, to);
  }, [phase, runScan]);

  const pickCondition = useCallback(
    (condition: Condition) => {
      if (phase.kind !== "result") return;
      setPhase({ ...phase, condition });
      if (phase.savedId) void updateSavedCard(phase.savedId, phase.card, condition, phase.variant);
    },
    [phase],
  );

  const pickVariant = useCallback(
    (variant: string | null) => {
      if (phase.kind !== "result") return;
      setPhase({ ...phase, variant });
      if (phase.savedId) void updateSavedCard(phase.savedId, phase.card, phase.condition, variant);
    },
    [phase],
  );

  const pickCard = useCallback(
    async (card: PokemonCard) => {
      if (phase.kind !== "result") return;
      // The pick keeps the printing's default line; a Magic finish the read saw stays when the pick has it.
      const variant = phase.variant && (card.finishes ?? []).includes(phase.variant) ? phase.variant : null;
      setPhase({ ...phase, card, variant, found: { ...phase.found, doubt: null } });
      if (phase.savedId && !(await swapSavedCard(phase.savedId, card, phase.condition, variant))) setNote("Couldn't change the card — check your connection");
    },
    [phase],
  );

  const remove = useCallback(async () => {
    if (phase.kind !== "result") return;
    const id = phase.savedId;
    setPhase({ kind: "camera" });
    if (id && !(await removeSavedCard(id))) setNote("Couldn't remove it — it is still in My Cards");
  }, [phase]);

  const close = useCallback(() => {
    // Home's "Scans left" follows the session: re-read it so the number matches what the scanner showed.
    void refresh();
    if (router.canGoBack()) router.back();
    else router.replace("/(app)/cards");
  }, [refresh]);

  const share = useCallback(async () => {
    try {
      await Share.share({ message: "Scan a card, see what it is worth. https://cardflip.io", url: "https://cardflip.io" });
    } catch {
      /* closing the phone's share sheet is not a failure */
    }
  }, []);

  const top = insets.top + space.sm;
  const bottom = insets.bottom + space.lg;

  // ---------------------------------------------------------------- reveal
  if (phase.kind === "result") {
    const { card, condition, variant, found, savedId, saving } = phase;
    const price = revealPrice(card, condition, variant);
    const lines = card.prices.filter((p) => p.currency === "USD" && p.market != null && p.market > 0);
    const options = printingOptions(card, found.candidates);
    const activeVariant = variant ?? defaultVariantOf(card);
    return (
      <View style={[styles.screen, { paddingTop: top }]}>
        <View style={styles.topRow}>
          <Pressable onPress={close} hitSlop={12} style={styles.iconBtn}>
            <Text style={styles.iconText}>✕</Text>
          </Pressable>
          <Text style={styles.topTitle}>{scansLeft === null ? "Unlimited scans" : scansLeft === undefined ? "" : `${scansLeft} scan${scansLeft === 1 ? "" : "s"} left`}</Text>
          <View style={styles.iconBtn} />
        </View>
        <ScrollView contentContainerStyle={[styles.revealBody, { paddingBottom: space.lg }]} keyboardShouldPersistTaps="handled">
          <View style={styles.glowWrap}>
            <View style={styles.glow} />
            <Image source={{ uri: pictureUrl(card.imageLarge || card.imageSmall) ?? undefined }} style={styles.heroCard} contentFit="contain" transition={200} />
          </View>
          <CountUpMoney text={price.text} revealKey={card.id} />
          <Text style={styles.moneyLabel}>{price.note ?? `${price.label} · ${condition}`}</Text>
          <Text style={styles.cardName}>{card.englishName || card.name}</Text>
          <Text style={styles.cardSub}>
            {card.setName} · #{card.number}
            {card.rarity ? ` · ${card.rarity}` : ""}
          </Text>
          <View style={[styles.pill, !saving && !savedId && styles.pillOff]}>
            <Text style={[styles.pillText, !saving && !savedId && styles.pillTextOff]}>{saving ? "Saving…" : savedId ? "✓ Saved to My Cards" : "Not saved"}</Text>
          </View>
          {found.doubt ? <Text style={styles.doubt}>{found.doubt}</Text> : null}
          {note ? <Text style={styles.error}>{note}</Text> : null}

          <Pressable onPress={() => setSheet("copy")} style={({ pressed }) => [styles.copyRow, pressed && { opacity: 0.85 }]}>
            <View>
              <Text style={styles.copyLabel}>This copy</Text>
              <Text style={styles.copyValue}>
                {condition}
                {lines.length > 1 ? ` · ${lines.find((p) => p.variant === activeVariant)?.label ?? price.label}` : ""}
              </Text>
            </View>
            <Text style={styles.chev}>›</Text>
          </Pressable>
          <View style={styles.linkRow}>
            {options.length > 1 ? (
              <Pressable onPress={() => setSheet("pick")} hitSlop={8}>
                <Text style={styles.link}>Not this card?</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable onPress={remove} hitSlop={8}>
              <Text style={styles.textBtnDanger}>Remove</Text>
            </Pressable>
          </View>
        </ScrollView>
        <View style={[styles.revealBar, { paddingBottom: bottom }]}>
          <Pressable onPress={scanAgain} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}>
            <Text style={styles.primaryText}>Scan another</Text>
          </Pressable>
          <Pressable onPress={close} hitSlop={8} style={styles.doneBtn}>
            <Text style={styles.textBtnText}>Done</Text>
          </Pressable>
        </View>

        {/* "This copy": condition, and the printing when the card is priced in several. */}
        <Modal visible={sheet === "copy"} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
          <Pressable style={styles.scrim} onPress={() => setSheet(null)} />
          <View style={[styles.sheet, { paddingBottom: bottom }]}>
            <Text style={styles.sheetTitle}>This copy</Text>
            <Text style={styles.section}>Condition</Text>
            <View style={styles.chips}>
              {CONDITIONS.map((c) => {
                const p = revealPrice(card, c, variant);
                return (
                  <Pressable key={c} onPress={() => pickCondition(c)} style={[styles.chip, condition === c && styles.chipOn]}>
                    <Text style={[styles.chipText, condition === c && styles.chipTextOn]}>
                      {c}
                      {p.text ? ` ${p.text}` : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {lines.length > 1 ? (
              <>
                <Text style={styles.section}>Printing</Text>
                <View style={styles.chips}>
                  {lines.map((p) => {
                    const active = p.variant === activeVariant;
                    const rp = revealPrice(card, condition, p.variant);
                    return (
                      <Pressable key={p.variant} onPress={() => pickVariant(p.variant)} style={[styles.chip, active && styles.chipOn]}>
                        <Text style={[styles.chipText, active && styles.chipTextOn]}>
                          {p.label}
                          {rp.text ? ` ${rp.text}` : ""}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </>
            ) : null}
            <Pressable onPress={() => setSheet(null)} style={({ pressed }) => [styles.primary, { marginTop: space.lg }, pressed && { opacity: 0.85 }]}>
              <Text style={styles.primaryText}>Done</Text>
            </Pressable>
          </View>
        </Modal>

        {/* "Not this card?": every printing the catalog matched, the pick first. */}
        <Modal visible={sheet === "pick"} transparent animationType="slide" onRequestClose={() => setSheet(null)}>
          <Pressable style={styles.scrim} onPress={() => setSheet(null)} />
          <View style={[styles.sheet, styles.sheetTall, { paddingBottom: bottom }]}>
            <Text style={styles.sheetTitle}>Which card is it?</Text>
            <ScrollView style={{ flexGrow: 0 }}>
              {options.map((c) => {
                const p = revealPrice(c, condition, null);
                return (
                  <Pressable
                    key={c.id}
                    onPress={() => {
                      setSheet(null);
                      void pickCard(c);
                    }}
                    style={[styles.row, c.id === card.id && styles.rowOn]}
                  >
                    <Image source={{ uri: pictureUrl(c.imageSmall) ?? undefined }} style={styles.thumb} contentFit="cover" />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.rowName} numberOfLines={1}>
                        {c.englishName || c.name}
                      </Text>
                      <Text style={styles.rowSub} numberOfLines={1}>
                        {c.setName} · #{c.number}
                      </Text>
                    </View>
                    <Text style={styles.rowMoney}>{p.text ?? "—"}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Modal>
      </View>
    );
  }

  // ------------------------------------------------ camera / reading / miss
  // One screen, the website's: the camera stays live while a card is read
  // and after a miss; the chip under the viewfinder says what is happening.
  const guide = view.w && view.h ? guideBox(view.w, view.h) : null;
  const granted = permission?.granted === true;
  const blocked = permission != null && !permission.granted && !permission.canAskAgain;
  const asking = permission != null && !permission.granted && permission.canAskAgain;
  const devTest = __DEV__ && Platform.OS === "web";
  const reading = phase.kind === "reading";
  const miss = phase.kind === "miss" ? phase : null;
  const quotaNote = miss?.quota ? miss.message : null;
  const ready = granted && cameraReady;
  const captureLabel = quotaNote ? "Get More Scans" : `Capture ${GAMES[game].label} Card`;
  const captureDisabled = !quotaNote && (busy || reading || !ready);
  const hintTop = guide ? (guide.y >= 32 ? guide.y / 2 : guide.y + 18) : 0;
  const lightShown = Platform.OS !== "web";

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {/* Top bar: every control that is not Capture lives here, off the viewfinder (the site, 10-02). */}
      <View style={styles.bar}>
        <Pressable onPress={close} accessibilityLabel={tally.count > 0 ? "Done, close scanner" : "Close scanner"} hitSlop={2} style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.85 }]}>
          <Text style={styles.closeText}>{tally.count > 0 ? "Done" : "Close"}</Text>
        </Pressable>
        <View style={styles.barMid}>
          <View style={styles.tally}>
            {tally.count > 0 ? (
              <>
                <Text style={styles.tallyCount}>
                  {tally.count} {tally.count === 1 ? "card" : "cards"}
                </Text>
                {tally.value > 0 ? (
                  <>
                    <View style={styles.tallyDivider} />
                    <Text style={styles.tallyMoney} numberOfLines={1}>
                      {formatMoney(tally.value)}
                    </Text>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <View style={styles.liveDot} />
                <Text style={styles.tallyText} numberOfLines={1}>
                  Scanning <Text style={styles.tallyGame}>{GAMES[game].label}</Text>
                </Text>
              </>
            )}
          </View>
        </View>
        {lightShown ? (
          <RoundButton onPress={() => setTorch((t) => !t)} label="Camera light" on={torch}>
            <Ionicons name="flash" size={18} color={torch ? "#000" : "#e4e4e7"} />
          </RoundButton>
        ) : null}
        <RoundButton onPress={() => setOptions(true)} label="Scanner options">
          <Ionicons name="ellipsis-horizontal" size={20} color="#e4e4e7" />
        </RoundButton>
      </View>

      {/* The viewfinder. */}
      <View style={styles.cameraWrap} onLayout={onLayout}>
        {granted ? <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} onCameraReady={() => setCameraReady(true)} animateShutter={false} /> : null}
        {ready && guide ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            {/* The dimmed surround (the site's 9999px box-shadow), four rectangles around the guide. */}
            <View style={[styles.dim, { left: 0, right: 0, top: 0, height: guide.y }]} />
            <View style={[styles.dim, { left: 0, right: 0, top: guide.y + guide.h, bottom: 0 }]} />
            <View style={[styles.dim, { left: 0, width: guide.x, top: guide.y, height: guide.h }]} />
            <View style={[styles.dim, { right: 0, width: view.w - guide.x - guide.w, top: guide.y, height: guide.h }]} />
            <View style={[styles.guide, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}>
              {reading ? <Sweep height={guide.h} /> : null}
              <View style={[styles.corner, styles.cornerTL]} />
              <View style={[styles.corner, styles.cornerTR]} />
              <View style={[styles.corner, styles.cornerBL]} />
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
            {/* The line above the guide, in the dimmed band, never on the card (Chris 10-16). */}
            <View style={[styles.hintWrap, { top: hintTop }]}>
              <View style={[styles.hint, note && styles.hintAmber]}>
                <Text style={[styles.hintText, note && styles.hintTextAmber]} numberOfLines={1}>
                  {note ?? "Line the card's edges up with the corners"}
                </Text>
              </View>
            </View>
          </View>
        ) : null}
        {flash ? <View pointerEvents="none" style={styles.flash} /> : null}
        {granted && !cameraReady ? (
          <View pointerEvents="none" style={styles.starting}>
            <Text style={styles.startingText}>Starting camera…</Text>
          </View>
        ) : null}
        {!granted ? (
          // Over the viewfinder, with a way out: the site's blocked-camera panel, in the app's words.
          <View style={styles.errorPanel}>
            <Text style={styles.errorText}>
              {blocked
                ? "Camera access is blocked for CardFlip. Turn it on in Settings (Privacy & Security → Camera), then try again. Every listing needs a photo you take here, so there is no photo upload."
                : "CardFlip scans from a live camera only, so there is no photo upload. Allow the camera to start scanning."}
            </Text>
            <View style={styles.errorButtons}>
              <Pressable onPress={() => (blocked ? Linking.openSettings() : void requestPermission())} style={({ pressed }) => [styles.errorPrimary, pressed && { opacity: 0.85 }]}>
                <Text style={styles.errorPrimaryText}>{blocked ? "Open Settings" : asking ? "Allow the camera" : "Try the camera again"}</Text>
              </Pressable>
              <Pressable onPress={close} style={({ pressed }) => [styles.errorSecondary, pressed && { opacity: 0.85 }]}>
                <Text style={styles.errorSecondaryText}>Close</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </View>

      {/* The chip slot under the viewfinder: the how-to until the first scan, then the reading / miss chip. */}
      {quotaNote ? <Text style={styles.quotaNote}>{quotaNote}</Text> : null}
      <View style={styles.slot}>
        {reading ? (
          <View style={styles.toast}>
            <View style={styles.toastIcon}>
              <View style={styles.toastDot} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.toastKicker}>{phase.reread ? "SAME PHOTO" : "IDENTIFYING"}</Text>
              <Text style={styles.toastText}>{phase.reread ? `Reading it again as ${GAMES[phase.reread].label}…` : "Reading the card…"}</Text>
            </View>
          </View>
        ) : miss && !miss.quota ? (
          <View style={[styles.toast, styles.toastMiss]}>
            <View style={[styles.toastIcon, styles.toastIconMiss]}>
              <Text style={styles.toastQ}>?</Text>
            </View>
            <Text style={styles.toastMissText}>{miss.message}</Text>
            {miss.wrongGame ? (
              <Pressable onPress={switchGame} style={({ pressed }) => [styles.switchBtn, pressed && { opacity: 0.85 }]}>
                <Text style={styles.switchText}>Switch to {GAMES[miss.wrongGame].label}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={{ alignItems: "center" }}>
            <Text style={styles.howTo}>Fill the guide with one card, then tap Capture.</Text>
            {tipsOn ? (
              <View style={styles.tipsRow}>
                <Text style={styles.tipsText}>Lay It Flat · No Glare · Sleeves OK, No Slabs</Text>
                <Pressable onPress={() => setTipsOn(false)} accessibilityLabel="Hide camera tips" hitSlop={10} style={styles.gotIt}>
                  <Text style={styles.gotItText}>Got It</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        )}
      </View>

      {/* Which game the shot is read as (Chris 09-29): the site's compact toggle. */}
      {games.length > 1 ? (
        <View style={styles.toggleRow}>
          <View style={styles.toggle}>
            {games.map((g) => (
              <Pressable key={g} onPress={() => setGame(g)} accessibilityRole="radio" accessibilityState={{ checked: game === g }} hitSlop={{ top: 8, bottom: 8 }} style={[styles.toggleChip, game === g && styles.toggleChipOn]}>
                <Text style={[styles.toggleText, game === g && styles.toggleTextOn]}>{GAMES[g].label}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {/* Capture is the only big button down here: the one obvious action. */}
      <View style={[styles.captureBar, { paddingBottom: Math.max(space.md, insets.bottom) }]}>
        <Pressable
          onPress={quotaNote ? () => openSitePage("/pricing", "Scans") : miss ? () => { scanAgain(); void capture(); } : capture}
          disabled={captureDisabled}
          style={({ pressed }) => [styles.captureGlow, captureDisabled && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}
        >
          <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.capture}>
            <View style={styles.sheen} pointerEvents="none" />
            {busy || reading ? <ActivityIndicator color={colors.white} /> : <Text style={styles.captureText}>{captureLabel}</Text>}
          </LinearGradient>
        </Pressable>
        {devTest ? (
          <Pressable onPress={devTestPhoto} disabled={busy} style={styles.devBtn}>
            <Text style={styles.devBtnText}>Test photo</Text>
          </Pressable>
        ) : null}
      </View>

      {/* ⋯ Scanner options: the site's sheet (10-15): game, starting condition, light and tips, share, help. */}
      <Modal visible={options} transparent animationType="slide" onRequestClose={() => setOptions(false)}>
        <Pressable style={styles.scrim} onPress={() => setOptions(false)} />
        <View style={[styles.sheet, styles.optSheet, { paddingBottom: bottom }]}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>Scanner options</Text>
            <Pressable onPress={() => setOptions(false)} accessibilityLabel="Close" hitSlop={8} style={styles.sheetX}>
              <Ionicons name="close" size={20} color="#e4e4e7" />
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: space.md }}>
            {games.length > 1 ? (
              <>
                <Heading first>Game</Heading>
                <View style={styles.chips}>
                  {games.map((g) => (
                    <Pressable key={g} onPress={() => setGame(g)} style={[styles.chip, styles.chipSurface, game === g && styles.chipOn]}>
                      <Text style={[styles.chipText, game === g && styles.chipTextOn]}>{GAMES[g].label}</Text>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}
            <Heading first={games.length < 2}>New scans start as</Heading>
            <View style={styles.chips}>
              {CONDITIONS.map((c) => {
                const on = startCondition === c;
                return (
                  <Pressable key={c} onPress={() => setStartCondition(c)} style={[styles.chip, styles.chipSurface, styles.chipDotted, on && { borderColor: DOT[c], backgroundColor: `${DOT[c]}26` }]}>
                    <View style={[styles.dot, { backgroundColor: DOT[c] }]} />
                    <Text style={[styles.chipText, on && styles.chipTextOn]}>{c}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.optNote}>The photo can still change it, and you can change any card after.</Text>
            <Heading>Camera</Heading>
            {lightShown ? <Row label="Light" hint="For a dark room. Glare hurts more than dark on foils." on={torch} onChange={() => setTorch((t) => !t)} /> : null}
            <Row label="Tips under the camera" hint="Lay It Flat · No Glare · Sleeves OK, No Slabs" on={tipsOn} onChange={() => setTipsOn((t) => !t)} last />
            <Heading>Share</Heading>
            <Row label="Share CardFlip" hint="Send a friend the link" last>
              <Pressable onPress={share} style={({ pressed }) => [styles.optBtn, pressed && { opacity: 0.85 }]}>
                <Text style={styles.optBtnText}>Share</Text>
              </Pressable>
            </Row>
            <Heading>Help</Heading>
            <Row label="Scanning help" hint="How to scan, what it reads, what to do when it misses" last>
              <Pressable
                onPress={() => {
                  setOptions(false);
                  openSitePage("/app/help", "Help");
                }}
                style={({ pressed }) => [styles.optBtn, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.optBtnText}>Open</Text>
              </Pressable>
            </Row>
          </ScrollView>
          <Pressable onPress={() => setOptions(false)} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}>
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const CORNER = 32;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },

  // Top bar (the site: h-12, px-3, gap-1.5; 40px pills on surface-2).
  bar: { height: 48, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 12 },
  closeBtn: { height: 40, justifyContent: "center", paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: colors.edge, backgroundColor: SURFACE_2 },
  closeText: { color: "#e4e4e7", fontSize: 12, fontWeight: "600" },
  barMid: { flex: 1, minWidth: 0, alignItems: "center" },
  tally: { height: 40, flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: colors.edge, backgroundColor: SURFACE_2, maxWidth: "100%" },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.money, shadowColor: colors.money, shadowOpacity: 1, shadowRadius: 4, shadowOffset: { width: 0, height: 0 } },
  tallyText: { color: "#d4d4d8", fontSize: 12 },
  tallyGame: { color: colors.white, fontWeight: "600" },
  tallyCount: { color: colors.white, fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"] },
  tallyDivider: { width: 1, height: 12, backgroundColor: colors.edgeStrong },
  tallyMoney: { color: "#6ee7b7", fontSize: 12, fontWeight: "600", fontVariant: ["tabular-nums"], flexShrink: 1 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.edge, backgroundColor: SURFACE_2 },
  roundOn: { backgroundColor: colors.amber, borderColor: "rgba(252,211,77,0.6)" },

  // Viewfinder.
  cameraWrap: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  dim: { position: "absolute", backgroundColor: "rgba(0,0,0,0.45)" },
  guide: { position: "absolute", borderRadius: 12, overflow: "hidden" },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: BRACKET },
  cornerTL: { left: -1, top: -1, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 12 },
  cornerTR: { right: -1, top: -1, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 12 },
  cornerBL: { left: -1, bottom: -1, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 12 },
  cornerBR: { right: -1, bottom: -1, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 12 },
  sweep: { position: "absolute", left: 0, right: 0, top: 0 },
  sweepEdge: { position: "absolute", left: "4%", right: "4%", bottom: -1, height: 2, borderRadius: 2, backgroundColor: HOLO_PINK, shadowColor: HOLO_PINK, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
  hintWrap: { position: "absolute", left: 0, right: 0, alignItems: "center", marginTop: -13 },
  hint: { borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.15)", backgroundColor: "rgba(0,0,0,0.8)", paddingHorizontal: 12, paddingVertical: 5, maxWidth: "92%" },
  hintAmber: { borderColor: "rgba(251,191,36,0.4)" },
  hintText: { color: "#f4f4f5", fontSize: 12, fontWeight: "600" },
  hintTextAmber: { color: "#fde68a" },
  flash: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(255,255,255,0.7)" },
  starting: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  startingText: { color: colors.muted, fontSize: 14 },
  errorPanel: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: 16, padding: 24, backgroundColor: "rgba(11,13,19,0.95)" },
  errorText: { maxWidth: 384, textAlign: "center", color: "#d4d4d8", fontSize: 14, lineHeight: 20 },
  errorButtons: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 8 },
  errorPrimary: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 20, paddingVertical: 10 },
  errorPrimaryText: { color: colors.white, fontSize: 14, fontWeight: "600" },
  errorSecondary: { borderRadius: 999, borderWidth: 1, borderColor: colors.edge, backgroundColor: SURFACE_2, paddingHorizontal: 16, paddingVertical: 10 },
  errorSecondaryText: { color: "#e4e4e7", fontSize: 14, fontWeight: "500" },

  // The chip slot (the site: min-h-[4.25rem], px-3).
  quotaNote: { paddingHorizontal: 12, paddingBottom: 8, textAlign: "center", color: "#fca5a5", fontSize: 12, fontWeight: "600" },
  slot: { minHeight: 68, justifyContent: "center", paddingHorizontal: 12 },
  howTo: { textAlign: "center", color: colors.muted, fontSize: 14, lineHeight: 18 },
  tipsRow: { marginTop: 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8 },
  tipsText: { color: colors.brand200, fontSize: 12 },
  gotIt: { borderRadius: 999, borderWidth: 1, borderColor: colors.edge, paddingHorizontal: 8, paddingVertical: 4 },
  gotItText: { color: "#d4d4d8", fontSize: 12 },
  toast: { flexDirection: "row", alignItems: "center", gap: 12, borderRadius: 16, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)", backgroundColor: "rgba(0,0,0,0.75)", paddingHorizontal: 16, paddingVertical: 12 },
  toastMiss: { borderColor: "rgba(251,191,36,0.3)" },
  toastIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(99,102,241,0.2)" },
  toastIconMiss: { backgroundColor: "rgba(251,191,36,0.15)" },
  toastDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand300 },
  toastQ: { color: "#fcd34d", fontSize: 16, fontWeight: "700" },
  toastKicker: { color: colors.brand300, fontSize: 10, fontWeight: "600", letterSpacing: 2 },
  toastText: { color: "#e4e4e7", fontSize: 14, fontWeight: "500" },
  toastMissText: { flex: 1, minWidth: 0, color: "#fcd34d", fontSize: 14, fontWeight: "500" },
  switchBtn: { borderRadius: 999, backgroundColor: colors.brand, paddingHorizontal: 12, paddingVertical: 8 },
  switchText: { color: colors.white, fontSize: 12, fontWeight: "600" },

  // The compact game toggle (GameToggle compact: a bordered group on surface-1, 12px chips).
  toggleRow: { alignItems: "center", paddingHorizontal: 12, paddingBottom: 6 },
  toggle: { flexDirection: "row", borderRadius: 999, borderWidth: 1, borderColor: colors.edge, backgroundColor: colors.surface1, padding: 4 },
  toggleChip: { borderRadius: 999, paddingHorizontal: 6, paddingVertical: 6 },
  toggleChipOn: { backgroundColor: colors.brand },
  toggleText: { color: colors.muted, fontSize: 12, fontWeight: "500" },
  toggleTextOn: { color: colors.white },

  // Capture bar (the site: px-3, gap-3; the brand gradient button with its glow).
  captureBar: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 12 },
  captureGlow: { flex: 1, borderRadius: 999, shadowColor: "#7c5cf0", shadowOpacity: 0.45, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  capture: { borderRadius: 999, paddingVertical: 14, alignItems: "center", justifyContent: "center", overflow: "hidden", minHeight: 52 },
  sheen: { position: "absolute", left: 0, right: 0, top: 0, height: "48%", backgroundColor: "rgba(255,255,255,0.14)" },
  captureText: { color: colors.white, fontSize: 16, fontWeight: "600" },
  devBtn: { paddingVertical: 10, paddingHorizontal: 6 },
  devBtnText: { color: colors.foreground, fontSize: 13, fontWeight: "600" },

  // Options sheet.
  optSheet: { maxHeight: "85%" },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: space.md },
  sheetX: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.edge, backgroundColor: SURFACE_2 },
  heading: { marginTop: 20, marginBottom: 8, color: colors.faint, fontSize: 11, fontWeight: "600", letterSpacing: 1.6, textTransform: "uppercase" },
  chipSurface: { backgroundColor: SURFACE_2, paddingVertical: 8 },
  chipDotted: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  optNote: { marginTop: 8, color: colors.faint, fontSize: 12 },
  optRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.edge },
  optLabel: { color: colors.white, fontSize: 14, fontWeight: "500" },
  optHint: { color: colors.faint, fontSize: 12, marginTop: 1 },
  optBtn: { borderRadius: 999, borderWidth: 1, borderColor: colors.edge, backgroundColor: SURFACE_2, paddingHorizontal: 16, paddingVertical: 8 },
  optBtnText: { color: colors.white, fontSize: 14, fontWeight: "600" },

  // Reveal (layout A; the next pass makes it the site's result chip).
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  iconText: { color: colors.white, fontSize: 18 },
  topTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  primary: { flex: 1, backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  textBtnText: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  textBtnDanger: { color: colors.danger, fontSize: 15, fontWeight: "600" },
  revealBody: { alignItems: "center", paddingHorizontal: space.lg },
  glowWrap: { marginTop: 0, alignItems: "center", justifyContent: "center", width: 200 + 48, height: 280 + 48 },
  glow: { position: "absolute", width: 200 + 40, height: 280 + 40, borderRadius: 150, backgroundColor: "rgba(52,211,153,0.12)" },
  heroCard: { width: 200, height: 280, borderRadius: 10, backgroundColor: colors.surface, shadowColor: colors.money, shadowOpacity: 0.45, shadowRadius: 28, shadowOffset: { width: 0, height: 10 }, elevation: 12 },
  pill: { marginTop: space.md, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: "rgba(52,211,153,0.15)" },
  pillOff: { backgroundColor: "rgba(248,113,113,0.15)" },
  pillText: { color: colors.money, fontSize: 12, fontWeight: "700" },
  pillTextOff: { color: colors.danger },
  copyRow: { alignSelf: "stretch", marginTop: space.lg, backgroundColor: colors.surface, borderColor: colors.edge, borderWidth: 1, borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  copyValue: { color: colors.foreground, fontSize: 15, fontWeight: "600", marginTop: 3 },
  chev: { color: colors.muted, fontSize: 22 },
  revealBar: { paddingHorizontal: space.lg, paddingTop: space.sm, backgroundColor: colors.background },
  doneBtn: { alignItems: "center", paddingVertical: 12 },
  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.55)" },
  sheet: { backgroundColor: colors.surfaceRaised, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingTop: space.md, paddingHorizontal: space.lg },
  sheetTall: { maxHeight: "75%" },
  sheetTitle: { color: colors.white, fontSize: 18, fontWeight: "700", marginBottom: space.xs },
  cardName: { color: colors.white, fontSize: 24, fontFamily: fonts.displaySemi, letterSpacing: -0.3, textAlign: "center", marginTop: space.md, paddingHorizontal: space.lg },
  cardSub: { color: colors.muted, fontSize: 14, textAlign: "center", marginTop: 2, paddingHorizontal: space.lg },
  bigMoney: { color: colors.money, fontSize: 52, fontWeight: "800", textAlign: "center", marginTop: space.xs, letterSpacing: -1 },
  moneyLabel: { color: colors.faint, fontSize: 13, textAlign: "center", marginTop: 2 },
  doubt: { color: "#fcd34d", fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: space.sm, paddingHorizontal: space.lg },
  error: { color: colors.danger, fontSize: 13, textAlign: "center", marginTop: space.sm, paddingHorizontal: space.lg },
  section: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: space.lg, marginBottom: 6 },
  copyLabel: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderColor: colors.edge, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.muted, fontSize: 14, fontWeight: "500" },
  chipTextOn: { color: colors.white },
  linkRow: { alignSelf: "stretch", marginTop: space.sm, paddingVertical: 8, paddingHorizontal: 4, flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  link: { color: colors.brandSoft, fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8, paddingHorizontal: space.lg, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth },
  rowOn: { backgroundColor: "rgba(99,102,241,0.12)" },
  thumb: { width: 44, height: 62, borderRadius: 6, backgroundColor: colors.surfaceRaised },
  rowName: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  rowSub: { color: colors.faint, fontSize: 12, marginTop: 1 },
  rowMoney: { color: colors.money, fontSize: 15, fontWeight: "700" },
});
