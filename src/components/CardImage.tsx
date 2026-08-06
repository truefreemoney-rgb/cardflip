interface Props {
  src: string;
  alt: string;
  className?: string;
}

/**
 * TCGdex has no image data at all for the "ja" locale (confirmed directly —
 * the field is simply absent from the API response), so Japanese cards need
 * a graceful placeholder everywhere an English card would show a photo.
 */
export default function CardImage({ src, alt, className = "" }: Props) {
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center rounded-lg border border-dashed border-edge-strong bg-surface-2 text-2xl ${className}`}
        role="img"
        aria-label={alt}
      >
        🀄
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} />;
}
