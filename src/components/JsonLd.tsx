/**
 * Structured data (schema.org JSON-LD) for the public pages. Search engines
 * read it for the site name, the product + price, and the help FAQ rich
 * result; nothing renders. `</script>` inside a string would close the tag
 * early, so it is escaped.
 */
export default function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
