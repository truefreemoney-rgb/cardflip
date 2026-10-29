import { Image } from "expo-image";
import { router } from "expo-router";
import { useRef, useState, type ReactElement } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import PrimaryButton from "~/components/PrimaryButton";
import Screen from "~/components/Screen";
import { writeIntroSeen } from "~/lib/introStore";
import { colors, fonts, radius, space } from "~/lib/theme";

/**
 * First open: three swipe cards, once per install, skippable (docs/APP-PLAN.md
 * "First open", Chris 10-29 1:51am). Each card is a still of the real thing
 * drawn with the app's own pieces (the scanner guide, the reveal, Inventory
 * rows) so a Blender clip can take a card's picture slot later without
 * touching the flow. The last card hands over to the next screen.
 */

const BRACKET = "#818cf8"; // the scanner guide's brand-400 corners (scan.tsx)
const FREE_SCANS = 5; // src/lib/pricing.ts PRICING.trial.scans

const umbreon = require("../../assets/images/intro/umbreon.webp");
const charizard = require("../../assets/images/intro/charizard.webp");
const latias = require("../../assets/images/intro/latias.webp");

type Page = { title: string; body: string; picture: () => ReactElement };

const PAGES: Page[] = [
  {
    title: "Scan any card",
    body: "Point your phone at a card. CardFlip finds the exact printing.",
    picture: () => <ScannerStill />,
  },
  {
    title: "See what it is worth in seconds",
    body: "Live market prices for Pokémon, Magic, Lorcana, One Piece and Yu-Gi-Oh!",
    picture: () => <RevealStill />,
  },
  {
    title: "Track your collection or sell on eBay",
    body: "Your whole binder's worth, added up. Selling? The eBay listing is written for you.",
    picture: () => <InventoryStill />,
  },
];

export default function Intro() {
  const insets = useSafeAreaInsets();
  const { width: WIDTH } = useWindowDimensions();
  const scroller = useRef<ScrollViewInstance>(null);
  const [page, setPage] = useState(0);
  const last = page === PAGES.length - 1;

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = Math.round(e.nativeEvent.contentOffset.x / WIDTH);
    if (next !== page) setPage(Math.max(0, Math.min(PAGES.length - 1, next)));
  }

  async function finish() {
    await writeIntroSeen();
    // Next: the "Scan Your First Card!" screen (APP-PLAN step 3). Until it exists, sign in.
    router.replace("/login");
  }

  function next() {
    if (last) return void finish();
    scroller.current?.scrollTo({ x: WIDTH * (page + 1), animated: true });
  }

  return (
    <Screen>
      <View style={[styles.top, { paddingTop: insets.top + space.sm }]}>
        <Text style={styles.logo}>CardFlip</Text>
        <Pressable onPress={finish} hitSlop={12} accessibilityRole="button">
          <Text style={styles.skip}>Skip</Text>
        </Pressable>
      </View>

      <ScrollView
        ref={scroller}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onScroll}
        onScroll={onScroll}
        scrollEventThrottle={64}
        style={styles.pager}
      >
        {PAGES.map((p) => (
          <View key={p.title} style={[styles.page, { width: WIDTH }]}>
            <View style={styles.still}>{p.picture()}</View>
            <Text style={styles.title}>{p.title}</Text>
            <Text style={styles.body}>{p.body}</Text>
          </View>
        ))}
      </ScrollView>

      <View style={[styles.bottom, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.dots}>
          {PAGES.map((p, i) => (
            <View key={p.title} style={[styles.dot, i === page && styles.dotOn]} />
          ))}
        </View>
        <Text style={styles.deal}>✓ {FREE_SCANS} free scans · No credit card · Real market prices</Text>
        <PrimaryButton label={last ? "Get started" : "Next"} onPress={next} />
      </View>
    </Screen>
  );
}

/** Card 1: the scanner guide with a card lined up in it, as scan.tsx draws it. */
function ScannerStill() {
  return (
    <View style={stills.frame}>
      <View style={stills.guide}>
        <Image source={umbreon} style={stills.guideCard} contentFit="cover" />
        <Corner at="tl" />
        <Corner at="tr" />
        <Corner at="bl" />
        <Corner at="br" />
      </View>
      <Text style={stills.hint}>{"Line the card's edges up with the corners"}</Text>
      <View style={stills.capture}>
        <Text style={stills.captureText}>Capture</Text>
      </View>
    </View>
  );
}

function Corner({ at }: { at: "tl" | "tr" | "bl" | "br" }) {
  const top = at[0] === "t";
  const left = at[1] === "l";
  return (
    <View
      pointerEvents="none"
      style={[
        stills.corner,
        top ? { top: -9 } : { bottom: -9 },
        left ? { left: -9 } : { right: -9 },
        {
          borderTopWidth: top ? 3 : 0,
          borderBottomWidth: top ? 0 : 3,
          borderLeftWidth: left ? 3 : 0,
          borderRightWidth: left ? 0 : 3,
          borderTopLeftRadius: top && left ? 8 : 0,
          borderTopRightRadius: top && !left ? 8 : 0,
          borderBottomLeftRadius: !top && left ? 8 : 0,
          borderBottomRightRadius: !top && !left ? 8 : 0,
        },
      ]}
    />
  );
}

/** Card 2: the reveal, money green, same order as the real one. */
function RevealStill() {
  return (
    <View style={stills.frame}>
      <Image source={umbreon} style={stills.revealCard} contentFit="cover" />
      <Text style={stills.price}>$2,209.75</Text>
      <Text style={stills.priceSub}>Alternate Art · Near Mint</Text>
      <Text style={stills.name}>Umbreon VMAX</Text>
      <Text style={stills.nameSub}>Evolving Skies · #215</Text>
    </View>
  );
}

/** Card 3: three Inventory rows and the total, as the Inventory tab shows them. */
function InventoryStill() {
  const rows = [
    { pic: charizard, name: "Charizard", set: "Skyridge · 146", price: "$2,999.99" },
    { pic: umbreon, name: "Umbreon VMAX", set: "Evolving Skies · 215", price: "$2,209.75" },
    { pic: latias, name: "Latias & Latios GX", set: "Team Up · 170", price: "$4,499.66" },
  ];
  return (
    <View style={[stills.frame, { justifyContent: "center" }]}>
      <View style={stills.total}>
        <Text style={stills.totalLabel}>Unsold</Text>
        <Text style={stills.totalValue}>$9,709.40</Text>
        <Text style={[stills.totalLabel, { marginLeft: space.md }]}>Sold</Text>
        <Text style={[stills.totalValue, { color: colors.money }]}>$0.00</Text>
      </View>
      {rows.map((r) => (
        <View key={r.name} style={stills.row}>
          <Image source={r.pic} style={stills.thumb} contentFit="cover" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={stills.rowName} numberOfLines={1}>
              {r.name}
            </Text>
            <Text style={stills.rowSet} numberOfLines={1}>
              {r.set}
            </Text>
            <View style={stills.badgeLine}>
              <View style={stills.badge}>
                <Text style={stills.badgeText}>Not Listed</Text>
              </View>
              <Text style={stills.rowSet}>Near Mint</Text>
            </View>
          </View>
          <Text style={stills.rowPrice}>{r.price}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: space.lg },
  logo: { color: colors.white, fontSize: 20, fontFamily: fonts.display, letterSpacing: -0.4 },
  skip: { color: colors.muted, fontSize: 16, fontWeight: "600", paddingVertical: 6 },
  pager: { flex: 1 },
  page: { flex: 1, paddingHorizontal: space.lg, paddingTop: space.md },
  still: {
    flex: 1,
    backgroundColor: colors.surface1,
    borderColor: colors.edge,
    borderWidth: 1,
    borderRadius: radius.xl,
    overflow: "hidden",
    marginBottom: space.lg,
  },
  title: { color: colors.white, fontSize: 28, lineHeight: 32, fontFamily: fonts.display, letterSpacing: -0.5, textAlign: "center" },
  body: { color: colors.muted, fontSize: 15, lineHeight: 21, textAlign: "center", marginTop: space.sm, paddingHorizontal: space.sm },
  bottom: { paddingHorizontal: space.lg, paddingTop: space.md },
  dots: { flexDirection: "row", justifyContent: "center", gap: 8, marginBottom: space.md },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.edgeStrong },
  dotOn: { width: 22, backgroundColor: colors.brandSoft },
  deal: { color: "#6ee7b7", fontSize: 13, fontWeight: "600", textAlign: "center", marginBottom: space.md },
});

const stills = StyleSheet.create({
  frame: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.lg },
  guide: { width: "58%", aspectRatio: 63 / 88, borderRadius: 10, overflow: "visible" },
  guideCard: { width: "100%", height: "100%", borderRadius: 10 },
  corner: { position: "absolute", width: 32, height: 32, borderColor: BRACKET },
  hint: { color: colors.foreground, fontSize: 13, marginTop: space.lg, textAlign: "center" },
  capture: { marginTop: space.md, backgroundColor: colors.brand, borderRadius: 999, paddingVertical: 10, paddingHorizontal: 44 },
  captureText: { color: colors.white, fontSize: 16, fontWeight: "700" },
  revealCard: { width: "52%", aspectRatio: 63 / 88, borderRadius: 12 },
  price: { color: colors.money, fontSize: 44, lineHeight: 50, fontFamily: fonts.display, marginTop: space.md, letterSpacing: -1 },
  priceSub: { color: colors.muted, fontSize: 14, marginTop: 2 },
  name: { color: colors.white, fontSize: 20, fontFamily: fonts.display, marginTop: space.sm },
  nameSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  total: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    alignSelf: "stretch",
    backgroundColor: "rgba(0,0,0,0.25)",
    borderColor: colors.edge,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    marginBottom: space.sm,
  },
  totalLabel: { color: colors.muted, fontSize: 14 },
  totalValue: { color: colors.white, fontSize: 18, fontWeight: "800" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    alignSelf: "stretch",
    paddingVertical: space.sm,
    borderBottomColor: colors.edge,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 42, height: 58, borderRadius: 4 },
  rowName: { color: colors.white, fontSize: 16, fontWeight: "600" },
  rowSet: { color: colors.muted, fontSize: 12, marginTop: 1 },
  badgeLine: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 3 },
  badge: { backgroundColor: "rgba(99,102,241,0.2)", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { color: colors.brand300, fontSize: 10, fontWeight: "700" },
  rowPrice: { color: colors.money, fontSize: 16, fontWeight: "800" },
});
