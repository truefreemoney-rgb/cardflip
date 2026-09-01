"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import Spinner from "@/components/Spinner";
import {
  publishEbayDraft,
  pushEbayDraft,
  type EbayPostFailure,
  type EbayPushSuccess,
} from "@/lib/client/ebayApi";
import { uploadCardPhoto } from "@/lib/client/cardPhotoApi";
import { mtgFinishOf } from "@/lib/listing";
import type { ListingDraft, ScanItem } from "@/lib/types";

interface Props {
  item: ScanItem;
  listing: ListingDraft;
  price: number;
  /** Whether this seller has linked an eBay account (from the session user). */
  ebayConnected: boolean;
  onChange: (patch: Partial<ScanItem>) => void;
}

/**
 * The bottom of both editors: how this listing gets onto eBay.
 *
 * One road (09-01, Chris: the product IS the API connection — no off-site
 * escapes): "Publish on eBay" builds inventory item + offer + publish from
 * here, photo included (needs business policies on the account and the
 * seller's own photo). Errors are shown in eBay's own words. Not connected →
 * the button says so and links to /connect-ebay. The old side doors —
 * eBay's manual form (which can't take our photo), the My-eBay-drafts link,
 * copy-listing-text — were removed the same day; git has them if a
 * no-connection fallback is ever wanted again.
 * The manual "I posted this" checkpoint stays: a seller who listed on eBay
 * some other way still needs to tell the ledger.
 */
export default function EbayPostActions({ item, listing, price, ebayConnected, onChange }: Props) {
  const [busy, setBusy] = useState<"push" | "publish" | null>(null);
  const [failure, setFailure] = useState<EbayPostFailure | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [degraded, setDegraded] = useState<string[]>([]);
  // First publish on a fresh eBay account: eBay has no ship-from location,
  // so ask once for a ZIP and send it with the retry.
  const [askZip, setAskZip] = useState(false);
  const [shipZip, setShipZip] = useState("");
  const photoInput = useRef<HTMLInputElement>(null);
  // Publish opened the photo picker: carry on publishing once the photo's up.
  const resumeAfterPhoto = useRef<"publish" | null>(null);

  const canPost = ebayConnected && Boolean(item.serverId) && Boolean(item.card);
  const pushed = Boolean(item.ebayOfferId);
  // eBay's picture policy: the listing photo must be the seller's own shot of
  // this copy. A scanned item has one (item.file) and it uploads on the first
  // publish; a search-added or sealed item has nothing until they pick one.
  const hasPhoto = Boolean(item.photoAt || item.file);

  // Picking a photo is step one of publishing, not a separate chore: once
  // it's up, publishing carries on if that's what opened the picker.
  async function pickPhoto(file: File | undefined) {
    if (!file || !item.serverId) return;
    setBusy("push");
    setFailure(null);
    const uploaded = await uploadCardPhoto(item.serverId, file);
    if (!uploaded.ok) {
      setBusy(null);
      setFailure({ ok: false, code: "photo", message: uploaded.message, details: [] });
      return;
    }
    onChange({ photoAt: uploaded.photoAt });
    setBusy(null);
    if (resumeAfterPhoto.current === "publish") {
      resumeAfterPhoto.current = null;
      await publishDirect(true);
    } else {
      setNotice("Photo saved.");
    }
  }

  function draftInput() {
    return {
      cardId: item.serverId!,
      listing,
      card: {
        name: item.card!.name,
        englishName: item.card!.englishName,
        setName: item.card!.setName,
        number: item.card!.number,
        rarity: item.card!.rarity,
        imageLarge: item.card!.imageLarge,
        imageSmall: item.card!.imageSmall,
        typeLine: item.card!.typeLine ?? null,
      },
      game: item.game,
      finish: item.game === "mtg" ? mtgFinishOf(item) : null,
      kind: item.kind,
      condition: item.condition,
      grading: item.grading,
      firstEdition: item.firstEdition,
      productType: item.productType,
      language: item.language,
    };
  }

  /** Shared tail of an Inventory draft save: patch the item, explain what's next. */
  function afterPush(result: EbayPushSuccess, quiet = false) {
    onChange({
      ebayOfferId: result.offerId,
      ebayListingUrl: result.listingUrl,
      ...(result.photoAt ? { photoAt: result.photoAt } : {}),
    });
    setDegraded(result.degraded ?? []);
    const missing = [
      !result.attached.fulfillment && "shipping",
      !result.attached.payment && "payment",
      !result.attached.return && "return",
    ].filter(Boolean) as string[];
    if (missing.length || !result.attached.location) {
      setNotice(
        `Draft ${result.updated ? "updated" : "saved"} on eBay. Publishing needs ${
          missing.length ? `a ${missing.join(", ")} business policy` : ""
        }${missing.length && !result.attached.location ? " and " : ""}${
          !result.attached.location ? "an item location" : ""
        } on your eBay account — eBay will say exactly what's missing.`,
      );
    } else if (!quiet) {
      setNotice(
        `Draft ${result.updated ? "updated" : "saved"} on eBay — nothing is live yet. Publish it from here when you're ready.`,
      );
    }
  }

  /** The fast road: push + publish from here, no eBay form. */
  async function publishDirect(photoJustUploaded = false) {
    if (!item.card || !item.serverId) return;
    if (!hasPhoto && !photoJustUploaded) {
      resumeAfterPhoto.current = "publish";
      photoInput.current?.click();
      return;
    }
    if (!pushed) {
      const ok = await push(photoJustUploaded, true);
      if (!ok) return;
    }
    await publish();
  }

  async function push(photoJustUploaded = false, quiet = false): Promise<boolean> {
    if (!item.card || !item.serverId) return false;
    if (!hasPhoto && !photoJustUploaded) {
      photoInput.current?.click();
      return false;
    }
    setBusy("push");
    setFailure(null);
    setNotice(null);
    const result = await pushEbayDraft(
      draftInput(),
      item.photoAt || photoJustUploaded ? null : item.file,
    );
    setBusy(null);
    if (!result.ok) {
      setFailure(result);
      if (result.code === "needs_photo") photoInput.current?.click();
      return false;
    }
    afterPush(result, quiet);
    return true;
  }

  async function publish() {
    if (!item.serverId) return;
    setBusy("publish");
    setFailure(null);
    setNotice(null);
    let result = await publishEbayDraft(
      item.serverId,
      shipZip.trim() ? { postalCode: shipZip.trim() } : undefined,
    );
    // needs_push: the stored offer died on eBay (server already cleared the
    // stale id). Re-push and retry once, invisibly -- the seller clicked
    // Publish, not "debug my offer id" (08-27: a dead offer from a broken
    // session 404d every publish until re-pushed).
    if (!result.ok && result.code === "needs_push") {
      const repushed = await pushEbayDraft(draftInput(), item.photoAt ? null : item.file);
      if (repushed.ok) {
        afterPush(repushed, true);
        result = await publishEbayDraft(
          item.serverId,
          shipZip.trim() ? { postalCode: shipZip.trim() } : undefined,
        );
      }
    }
    setBusy(null);
    if (!result.ok) {
      setFailure(result);
      if (result.code === "needs_location") setAskZip(true);
      return;
    }
    onChange({
      status: "listed",
      listedPrice: price,
      listedAt: result.listedAt ?? Date.now(),
      ebayListingUrl: result.listingUrl,
    });
  }

  const ebayButton =
    "flex-1 rounded-full bg-ebay px-5 py-3 text-center text-sm font-semibold text-white transition hover:bg-ebay-hover disabled:opacity-60";
  const quietButton =
    "flex-1 rounded-full border border-edge px-5 py-3 text-sm font-semibold text-zinc-200 transition hover:bg-surface-2 disabled:opacity-60";

  return (
    <>
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          void pickPhoto(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {canPost && !hasPhoto && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <span>
            Publishing from here needs your own photo of this {item.kind === "sealed" ? "product" : "card"} — stock
            art isn&apos;t allowed on the listing.
          </span>
          <button
            type="button"
            onClick={() => photoInput.current?.click()}
            disabled={busy !== null}
            className="shrink-0 rounded-full border border-amber-300/40 px-3 py-1 font-semibold text-amber-100 transition hover:bg-amber-400/10 disabled:opacity-60"
          >
            Add photo
          </button>
        </div>
      )}
      {canPost && item.photoAt && !item.file && (
        <p className="-mt-1 text-[11px] text-zinc-500">
          Photo saved.{" "}
          <button
            type="button"
            onClick={() => photoInput.current?.click()}
            className="underline underline-offset-4 transition hover:text-zinc-300"
          >
            Replace
          </button>
        </p>
      )}
      <div className="flex flex-col gap-2">
        {/* One road only (09-01, Chris): publishing happens from here, over
            the API, photo included — no links out to eBay's form or drafts.
            The one exception is a Listing-API draft this card already has
            (ebayDraftUrl): that draft lives on eBay and can only be
            finished there. */}
        <div className="flex flex-col gap-2 sm:flex-row">
          {canPost ? (
            <button onClick={() => void publishDirect()} disabled={busy !== null} className={ebayButton}>
              <span className="inline-flex items-center justify-center gap-2">
                {busy !== null && <Spinner className="h-3.5 w-3.5" />}
                {pushed ? "Publish on eBay" : "Publish on eBay — photo included"}
              </span>
            </button>
          ) : (
            <Link href="/connect-ebay" className={ebayButton + " text-center"}>
              Connect eBay to publish from here
            </Link>
          )}
          {item.ebayDraftUrl && (
            <a href={item.ebayDraftUrl} target="_blank" rel="noopener noreferrer" className={quietButton + " text-center"}>
              Open draft on eBay ↗
            </a>
          )}
        </div>
      </div>

      <p className="-mt-3 text-[11px] text-zinc-600">
        {item.ebayDraftUrl
          ? "The draft is in My eBay › Drafts — finish and publish it there, or publish from here. Publishing means eBay's selling fees apply."
          : canPost
            ? pushed
              ? "This card has a saved draft on eBay — Publish lists it live, with your photo. eBay's selling fees apply."
              : "Publish creates the listing on your eBay account and puts it live, photo included — eBay's selling fees apply."
            : ebayConnected && item.card && !item.serverId
              ? "This card didn't save to your collection (a connection blip while scanning), so it can't be published yet — scan it again to retry."
              : "Connect your eBay account once and every ready card publishes from right here, photo included."}
      </p>

      {notice && (
        <p role="status" className="-mt-2 text-xs text-emerald-400">
          {notice}
        </p>
      )}
      {degraded.length > 0 && (
        <div role="status" className="-mt-2 rounded-lg border border-amber-400/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-200">
          <p>
            eBay wouldn&apos;t accept part of this item, so the draft was saved without:{" "}
            <span className="font-medium">{degraded.join(", ")}</span>. Add {degraded.length === 1 ? "it" : "them"} on eBay before publishing.
          </p>
        </div>
      )}
      {failure && (
        <div role="alert" className="-mt-2 rounded-lg border border-red-400/30 bg-red-500/5 px-3 py-2 text-xs text-red-300">
          <p>{failure.message}</p>
          {failure.details.filter((d) => d !== failure.message).slice(0, 3).map((d) => (
            <p key={d} className="mt-1 text-red-300/80">
              {d}
            </p>
          ))}
          {failure.code === "needs_reconnect" && (
            <Link href="/connect-ebay" className="mt-1 inline-block underline underline-offset-4">
              Reconnect eBay
            </Link>
          )}
          {failure.code === "not_connected" && (
            <Link href="/connect-ebay" className="mt-1 inline-block underline underline-offset-4">
              Connect eBay
            </Link>
          )}
          {failure.code === "needs_policies" && (
            <a
              href="https://www.ebay.com/sh/settings/business-policies"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-block underline underline-offset-4"
            >
              Open eBay business policies ↗
            </a>
          )}
        </div>
      )}
      {askZip && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (shipZip.trim()) void publish();
          }}
          className="-mt-2 flex items-end gap-2 rounded-lg border border-edge bg-surface-1 px-3 py-2.5"
        >
          <label className="flex flex-1 flex-col gap-1 text-xs font-medium text-zinc-300">
            Ship-from ZIP / postal code
            <input
              value={shipZip}
              onChange={(e) => setShipZip(e.target.value)}
              inputMode="numeric"
              autoComplete="postal-code"
              placeholder="e.g. 90210"
              className="rounded-md border border-edge bg-black/40 px-2.5 py-1.5 text-sm text-white outline-none focus:border-brand-400"
            />
          </label>
          <button
            type="submit"
            disabled={busy !== null || !shipZip.trim()}
            className="rounded-full bg-ebay px-4 py-2 text-xs font-semibold text-white transition hover:bg-ebay-hover disabled:opacity-60"
          >
            Save &amp; publish
          </button>
        </form>
      )}

      <p className="-mt-1 border-t border-white/5 pt-4 text-center text-[11px] text-zinc-600">
        Listed this on eBay yourself?{" "}
        <button
          onClick={() =>
            onChange({ status: "listed", listedPrice: price, listedAt: Date.now() })
          }
          className="underline underline-offset-4 transition hover:text-zinc-300"
        >
          Mark it as listed
        </button>{" "}
        so the ledger tracks it.
      </p>
    </>
  );
}
