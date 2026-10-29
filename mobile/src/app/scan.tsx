import { CameraView, useCameraPermissions } from "expo-camera";
import { Image } from "expo-image";
import { SaveFormat, manipulateAsync } from "expo-image-manipulator";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Platform, Pressable, ScrollView, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { colors, radius, space } from "~/lib/theme";

/** A real card is 63×88 mm; the guide is one card, 82% of the camera's height (the website's CameraCapture). */
const GUIDE_RATIO = 63 / 88;
const GUIDE_HEIGHT = 0.82;
/** The read's clock on screen: the server answers inside 8 s, the app gives up at 20 s (lib/scan.ts). */
const READ_BAR_MS = 8_000;

type Phase =
  | { kind: "camera" }
  | { kind: "reading"; photo: string }
  | { kind: "miss"; photo: string; message: string; wrongGame: GameId | null; read: VisionCardRead | null; scanId: string | null; quota: boolean }
  | { kind: "result"; photo: string; found: Identified; card: PokemonCard; condition: Condition; variant: string | null; savedId: string | null; saving: boolean; picking: boolean };

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

/**
 * The scanner (docs/APP-PLAN.md step 4): the camera with a one-card guide,
 * a Capture button and nothing else — no auto-scan (Chris), no photo upload.
 * One tap = one read; the reveal shows the card, its market in green and the
 * copy's condition (starts Near Mint), and the row is already saved to My
 * Cards, as on the website. A miss says why, is given back, and offers the
 * other game when the photo was that game's card.
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
  const [bar] = useState(() => new Animated.Value(0));

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
      setPhase({ kind: "reading", photo });
      bar.setValue(0);
      Animated.timing(bar, { toValue: 1, duration: READ_BAR_MS, useNativeDriver: false }).start();

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
        setPhase({ kind: "miss", photo, message: found.error ?? "No match found — search by name to add it", wrongGame: found.wrongGame, read: outcome.read, scanId: outcome.scanId, quota: false });
        // Nothing found = not a scan (Chris 10-11). A wrong-game read with a switch on offer keeps its scan: the
        // switch reuses it; "Scan again" from there gives it back (below).
        if (!found.wrongGame && outcome.scanId) giveBackScan(outcome.scanId).then(applyBalance);
        return;
      }
      const condition: Condition = "Near Mint";
      setPhase({ kind: "result", photo, found, card: found.card, condition, variant: found.variant, savedId: null, saving: true, picking: false });
      const saved = await saveScan(found.card, as, condition, found.variant, outcome.scanId);
      setPhase((p) => (p.kind === "result" && p.photo === photo ? { ...p, savedId: saved?.id ?? null, saving: false } : p));
      if (!saved) setNote("Couldn't save — check your connection and scan again");
    },
    [bar, refresh, applyBalance],
  );

  const capture = useCallback(async () => {
    if (busy || !camera.current || !cameraReady) return;
    setBusy(true);
    setNote(null);
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
      setPhase({ ...phase, card, variant, picking: false, found: { ...phase.found, doubt: null } });
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
    else router.replace("/(app)/home");
  }, [refresh]);

  const top = insets.top + space.sm;
  const bottom = insets.bottom + space.lg;

  // ---------------------------------------------------------------- reveal
  if (phase.kind === "result") {
    const { card, condition, variant, found, savedId, saving, picking } = phase;
    const price = revealPrice(card, condition, variant);
    const lines = card.prices.filter((p) => p.currency === "USD" && p.market != null && p.market > 0);
    const showLines = lines.length > 1 ? lines : [];
    const options = printingOptions(card, found.candidates);
    return (
      <View style={[styles.screen, { paddingTop: top }]}>
        <View style={styles.topRow}>
          <Pressable onPress={close} hitSlop={12} style={styles.iconBtn}>
            <Text style={styles.iconText}>✕</Text>
          </Pressable>
          <Text style={styles.topTitle}>{saving ? "Saving…" : savedId ? "Saved to My Cards" : "Not saved"}</Text>
          <View style={styles.iconBtn} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: bottom + 80 }} keyboardShouldPersistTaps="handled">
          <View style={styles.revealPics}>
            <Image source={{ uri: phase.photo }} style={styles.shot} contentFit="cover" />
            <Image source={{ uri: pictureUrl(card.imageLarge || card.imageSmall) ?? undefined }} style={styles.catalogPic} contentFit="contain" />
          </View>
          <Text style={styles.cardName}>{card.englishName || card.name}</Text>
          <Text style={styles.cardSub}>
            {card.setName} · #{card.number}
            {card.rarity ? ` · ${card.rarity}` : ""}
          </Text>
          <Text style={styles.bigMoney}>{price.text ?? "—"}</Text>
          <Text style={styles.moneyLabel}>{price.note ?? price.label}</Text>
          {found.doubt ? <Text style={styles.doubt}>{found.doubt}</Text> : null}
          {note ? <Text style={styles.error}>{note}</Text> : null}

          <Text style={styles.section}>Condition</Text>
          <View style={styles.chips}>
            {CONDITIONS.map((c) => (
              <Pressable key={c} onPress={() => pickCondition(c)} style={[styles.chip, condition === c && styles.chipOn]}>
                <Text style={[styles.chipText, condition === c && styles.chipTextOn]}>{c}</Text>
              </Pressable>
            ))}
          </View>

          {showLines.length ? (
            <>
              <Text style={styles.section}>Printing</Text>
              <View style={styles.chips}>
                {showLines.map((p) => {
                  const active = p.variant === (variant ?? defaultVariantOf(card));
                  return (
                    <Pressable key={p.variant} onPress={() => pickVariant(p.variant)} style={[styles.chip, active && styles.chipOn]}>
                      <Text style={[styles.chipText, active && styles.chipTextOn]}>{p.label}</Text>
                    </Pressable>
                  );
                })}
              </View>
            </>
          ) : null}

          {options.length > 1 ? (
            <Pressable onPress={() => setPhase({ ...phase, picking: !picking })} style={styles.linkRow}>
              <Text style={styles.link}>{picking ? "Hide other printings" : "Not this card?"}</Text>
            </Pressable>
          ) : null}
          {picking
            ? options.map((c) => {
                const p = revealPrice(c, condition, null);
                return (
                  <Pressable key={c.id} onPress={() => pickCard(c)} style={[styles.row, c.id === card.id && styles.rowOn]}>
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
              })
            : null}
        </ScrollView>
        <View style={[styles.bottomBar, { paddingBottom: bottom }]}>
          <Pressable onPress={remove} hitSlop={8} style={styles.textBtn}>
            <Text style={styles.textBtnDanger}>Remove</Text>
          </Pressable>
          <Pressable onPress={scanAgain} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}>
            <Text style={styles.primaryText}>Scan another</Text>
          </Pressable>
          <Pressable onPress={close} hitSlop={8} style={styles.textBtn}>
            <Text style={styles.textBtnText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  // ------------------------------------------------------- reading / miss
  if (phase.kind === "reading" || phase.kind === "miss") {
    const missing = phase.kind === "miss";
    return (
      <View style={[styles.screen, { paddingTop: top }]}>
        <View style={styles.topRow}>
          <Pressable onPress={close} hitSlop={12} style={styles.iconBtn}>
            <Text style={styles.iconText}>✕</Text>
          </Pressable>
          <Text style={styles.topTitle}>{GAMES[game].label}</Text>
          <View style={styles.iconBtn} />
        </View>
        <View style={styles.shotWrap}>
          <Image source={{ uri: phase.photo }} style={styles.bigShot} contentFit="contain" />
        </View>
        {missing ? (
          <>
            <Text style={styles.missText}>{phase.message}</Text>
            <View style={[styles.bottomBar, { paddingBottom: bottom }]}>
              {phase.wrongGame ? (
                <Pressable onPress={switchGame} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}>
                  <Text style={styles.primaryText}>Switch to {GAMES[phase.wrongGame].label}</Text>
                </Pressable>
              ) : null}
              {phase.quota ? (
                <Pressable onPress={close} style={({ pressed }) => [styles.primary, pressed && { opacity: 0.85 }]}>
                  <Text style={styles.primaryText}>Done</Text>
                </Pressable>
              ) : (
                <Pressable onPress={scanAgain} style={({ pressed }) => [phase.wrongGame ? styles.secondary : styles.primary, pressed && { opacity: 0.85 }]}>
                  <Text style={phase.wrongGame ? styles.secondaryText : styles.primaryText}>Scan again</Text>
                </Pressable>
              )}
            </View>
          </>
        ) : (
          <View style={{ paddingHorizontal: space.lg, paddingBottom: bottom }}>
            <Text style={styles.readingText}>Reading the card…</Text>
            <View style={styles.barTrack}>
              <Animated.View style={[styles.barFill, { width: bar.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }]} />
            </View>
          </View>
        )}
      </View>
    );
  }

  // ---------------------------------------------------------------- camera
  const guide = view.w && view.h ? guideBox(view.w, view.h) : null;
  const granted = permission?.granted === true;
  const devTest = __DEV__ && Platform.OS === "web";
  return (
    <View style={styles.screen}>
      <View style={styles.cameraWrap} onLayout={onLayout}>
        {granted ? (
          <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" onCameraReady={() => setCameraReady(true)} animateShutter={false} />
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.permissionBox, { paddingTop: top + 100 }]}>
            <Text style={styles.permissionTitle}>CardFlip needs the camera</Text>
            <Text style={styles.permissionText}>Every card is scanned from a live camera — there is no photo upload. Allow the camera to start scanning.</Text>
            <Pressable onPress={() => requestPermission()} style={({ pressed }) => [styles.allow, pressed && { opacity: 0.85 }]}>
              <Text style={styles.primaryText}>Allow camera</Text>
            </Pressable>
          </View>
        )}
        {guide ? (
          <View pointerEvents="none" style={[styles.guide, { left: guide.x, top: guide.y, width: guide.w, height: guide.h }]}>
            <View style={[styles.corner, styles.cornerTL]} />
            <View style={[styles.corner, styles.cornerTR]} />
            <View style={[styles.corner, styles.cornerBL]} />
            <View style={[styles.corner, styles.cornerBR]} />
          </View>
        ) : null}
        <View style={[styles.topRow, styles.overTop, { paddingTop: top }]}>
          <Pressable onPress={close} hitSlop={12} style={styles.iconBtn}>
            <Text style={styles.iconText}>✕</Text>
          </Pressable>
          <Text style={styles.topTitle}>{scansLeft === null ? "Unlimited scans" : scansLeft === undefined ? "" : `${scansLeft} scan${scansLeft === 1 ? "" : "s"} left`}</Text>
          <View style={styles.iconBtn} />
        </View>
        {games.length > 1 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[styles.gameRow, { top: top + 44 }]} contentContainerStyle={styles.gameRowInner}>
            {games.map((g) => (
              <Pressable key={g} onPress={() => setGame(g)} style={[styles.chip, styles.chipDark, game === g && styles.chipOn]}>
                <Text style={[styles.chipText, game === g && styles.chipTextOn]}>{GAMES[g].label}</Text>
              </Pressable>
            ))}
          </ScrollView>
        ) : null}
        {guide ? (
          <Text style={[styles.hint, { top: guide.y + guide.h + space.sm }]}>{note ?? "Line the card's edges up with the corners"}</Text>
        ) : null}
      </View>
      <View style={[styles.captureBar, { paddingBottom: bottom }]}>
        {devTest ? (
          <Pressable onPress={devTestPhoto} disabled={busy} style={styles.textBtn}>
            <Text style={styles.textBtnText}>Test photo</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={capture} disabled={busy || !granted || !cameraReady} style={({ pressed }) => [styles.capture, (busy || !granted || !cameraReady) && { opacity: 0.4 }, pressed && { opacity: 0.85 }]}>
          {busy ? <ActivityIndicator color={colors.white} /> : <Text style={styles.captureText}>Capture</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const CORNER = 26;
const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  cameraWrap: { flex: 1, backgroundColor: "#000", overflow: "hidden" },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.md },
  overTop: { position: "absolute", left: 0, right: 0, top: 0 },
  iconBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 18 },
  iconText: { color: colors.white, fontSize: 18 },
  topTitle: { color: colors.foreground, fontSize: 14, fontWeight: "600" },
  gameRow: { position: "absolute", left: 0, right: 0, flexGrow: 0 },
  gameRowInner: { flexDirection: "row", gap: 6, paddingHorizontal: space.md, minWidth: "100%", justifyContent: "center" },
  guide: { position: "absolute", borderRadius: 10 },
  corner: { position: "absolute", width: CORNER, height: CORNER, borderColor: colors.white, borderWidth: 0 },
  cornerTL: { left: 0, top: 0, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: 10 },
  cornerTR: { right: 0, top: 0, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: 10 },
  cornerBL: { left: 0, bottom: 0, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: 10 },
  cornerBR: { right: 0, bottom: 0, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: 10 },
  hint: { position: "absolute", left: space.lg, right: space.lg, textAlign: "center", color: colors.foreground, fontSize: 14, fontWeight: "500" },
  captureBar: { backgroundColor: colors.background, paddingTop: space.md, alignItems: "center", gap: space.sm },
  capture: { backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 16, paddingHorizontal: 56, minWidth: 200, alignItems: "center" },
  captureText: { color: colors.white, fontSize: 17, fontWeight: "700" },
  permissionBox: { alignItems: "center", justifyContent: "flex-start", padding: space.xl },
  allow: { marginTop: space.lg, backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 14, paddingHorizontal: 32, alignSelf: "center" },
  permissionTitle: { color: colors.white, fontSize: 18, fontWeight: "700", textAlign: "center" },
  permissionText: { color: colors.muted, fontSize: 14, textAlign: "center", marginTop: space.sm },
  shotWrap: { flex: 1, margin: space.lg, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surface },
  bigShot: { flex: 1 },
  readingText: { color: colors.foreground, fontSize: 16, fontWeight: "600", textAlign: "center" },
  barTrack: { height: 4, backgroundColor: colors.surfaceRaised, borderRadius: 2, marginTop: space.md, overflow: "hidden" },
  barFill: { height: 4, backgroundColor: colors.brand },
  missText: { color: "#fcd34d", fontSize: 15, fontWeight: "600", textAlign: "center", paddingHorizontal: space.xl, marginBottom: space.md },
  bottomBar: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.md, paddingHorizontal: space.lg, paddingTop: space.md, backgroundColor: colors.background, borderTopColor: colors.edge, borderTopWidth: StyleSheet.hairlineWidth },
  primary: { flex: 1, backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  primaryText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  secondary: { flex: 1, borderColor: colors.edgeStrong, borderWidth: 1, borderRadius: 999, paddingVertical: 14, alignItems: "center" },
  secondaryText: { color: colors.foreground, fontSize: 16, fontWeight: "600" },
  textBtn: { paddingVertical: 10, paddingHorizontal: 6 },
  textBtnText: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  textBtnDanger: { color: colors.danger, fontSize: 15, fontWeight: "600" },
  revealPics: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: space.md, marginTop: space.md },
  shot: { width: 96, height: 134, borderRadius: 8, backgroundColor: colors.surface },
  catalogPic: { width: 172, height: 240, borderRadius: 10, backgroundColor: colors.surface },
  cardName: { color: colors.white, fontSize: 22, fontWeight: "700", textAlign: "center", marginTop: space.md, paddingHorizontal: space.lg },
  cardSub: { color: colors.muted, fontSize: 14, textAlign: "center", marginTop: 2, paddingHorizontal: space.lg },
  bigMoney: { color: colors.money, fontSize: 40, fontWeight: "800", textAlign: "center", marginTop: space.sm },
  moneyLabel: { color: colors.faint, fontSize: 13, textAlign: "center", marginTop: 0 },
  doubt: { color: "#fcd34d", fontSize: 13, fontWeight: "600", textAlign: "center", marginTop: space.sm, paddingHorizontal: space.lg },
  error: { color: colors.danger, fontSize: 13, textAlign: "center", marginTop: space.sm, paddingHorizontal: space.lg },
  section: { color: colors.muted, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5, marginTop: space.lg, marginBottom: 6, paddingHorizontal: space.lg },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, paddingHorizontal: space.lg },
  chip: { borderColor: colors.edge, borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  chipDark: { backgroundColor: "rgba(10,11,17,0.7)" },
  chipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  chipText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.white },
  linkRow: { marginTop: space.lg, paddingHorizontal: space.lg },
  link: { color: colors.brandSoft, fontSize: 15, fontWeight: "600" },
  row: { flexDirection: "row", alignItems: "center", gap: space.md, paddingVertical: 8, paddingHorizontal: space.lg, borderBottomColor: colors.edge, borderBottomWidth: StyleSheet.hairlineWidth },
  rowOn: { backgroundColor: "rgba(99,102,241,0.12)" },
  thumb: { width: 44, height: 62, borderRadius: 6, backgroundColor: colors.surfaceRaised },
  rowName: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
  rowSub: { color: colors.faint, fontSize: 12, marginTop: 1 },
  rowMoney: { color: colors.money, fontSize: 15, fontWeight: "700" },
});
