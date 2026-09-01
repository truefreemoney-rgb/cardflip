import "server-only";

/**
 * PSA Public API cert verification (publicapi.psacard.com). One method:
 * cert number → what PSA graded, so the editor can prefill the grade and
 * the seller can prove the slab is what the label says.
 *
 * The free tier is 100 calls/day for the whole app, so the route in front
 * of this keeps a global daily budget (LIMITS.psaCert* in rateLimit.ts) —
 * treat a lookup as precious, never poll.
 */

export interface PsaCertResult {
  certNumber: string;
  /** Numeric grade on PSA's ladder ("10", "8.5", "1.5") — null if unparsable. */
  grade: string | null;
  /** PSA's wording, e.g. "GEM MT 10". */
  gradeDescription: string;
  /** One display line: year, brand, subject, card number, variety. */
  label: string;
  totalPopulation: number | null;
  populationHigher: number | null;
}

export function psaConfigured(): boolean {
  return Boolean(process.env.PSA_API_TOKEN);
}

/** Thrown for "PSA answered but there is no such cert". */
export class PsaCertNotFound extends Error {
  constructor(cert: string) {
    super(`PSA cert ${cert} not found`);
  }
}

/** PSA answered with an error status — carried up so the route can say which. */
export class PsaApiError extends Error {
  constructor(readonly status: number) {
    super(`PSA API ${status}`);
  }
}

export async function lookupPsaCert(certNumber: string): Promise<PsaCertResult> {
  const token = process.env.PSA_API_TOKEN;
  if (!token) throw new Error("PSA_API_TOKEN not configured");

  const res = await fetch(
    `https://api.psacard.com/publicapi/cert/GetByCertNumber/${encodeURIComponent(certNumber)}`,
    {
      headers: {
        authorization: `bearer ${token}`,
        accept: "application/json",
        // PSA sits behind a WAF that 403s UA-less datacenter requests.
        "user-agent": "CardFlip/1.0 (cardflip.io)",
      },
    },
  );
  // PSA answers 204/empty bodies for unknown certs rather than a clean 404.
  if (res.status === 204) throw new PsaCertNotFound(certNumber);
  // Their docs: 500 usually means invalid credentials (a truncated paste
  // looks exactly like this), 4xx a bad path.
  if (!res.ok) throw new PsaApiError(res.status);
  const text = await res.text();
  if (!text) throw new PsaCertNotFound(certNumber);

  const data = JSON.parse(text) as {
    PSACert?: {
      CertNumber?: string;
      Year?: string;
      Brand?: string;
      Subject?: string;
      CardNumber?: string;
      Variety?: string;
      CardGrade?: string;
      GradeDescription?: string;
      TotalPopulation?: number;
      PopulationHigher?: number;
    };
  };
  const cert = data.PSACert;
  if (!cert?.CertNumber) throw new PsaCertNotFound(certNumber);

  const gradeText = cert.CardGrade ?? cert.GradeDescription ?? "";
  const grade = /(\d+(?:\.\d)?)/.exec(gradeText)?.[1] ?? null;
  const label = [cert.Year, cert.Brand, cert.Subject, cert.CardNumber && `#${cert.CardNumber}`, cert.Variety]
    .filter(Boolean)
    .join(" ");

  return {
    certNumber: cert.CertNumber,
    grade,
    gradeDescription: cert.GradeDescription ?? gradeText,
    label,
    totalPopulation: cert.TotalPopulation ?? null,
    populationHigher: cert.PopulationHigher ?? null,
  };
}
