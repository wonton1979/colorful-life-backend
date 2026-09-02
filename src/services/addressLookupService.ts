import { config } from "../config/index.js";

export type NormalizedAddress = {
  line1: string;
  line2: string | null;
  city: string;
  county: string | null;
  postcode: string;
  country: "United Kingdom";
};

export class AddressLookupProviderError extends Error {
  constructor() {
    super("Address lookup provider unavailable");
    this.name = "AddressLookupProviderError";
  }
}

type ProviderResponse = {
  code?: number;
  result?: Array<{
    line_1?: string;
    line_2?: string | null;
    line_3?: string | null;
    post_town?: string;
    county?: string | null;
    postcode?: string;
  }>;
};

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;
let fetcher: Fetcher = (input, init) => fetch(input, init);

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/\s+/g, " ");
  return normalized ? normalized : null;
}

function normalizeAddress(address: NonNullable<ProviderResponse["result"]>[number]): NormalizedAddress {
  const line2Parts = [clean(address.line_2), clean(address.line_3)].filter(
    (part): part is string => part !== null,
  );

  const line1 = clean(address.line_1);
  const city = clean(address.post_town);
  const postcode = clean(address.postcode);
  if (!line1 || !city || !postcode) {
    throw new AddressLookupProviderError();
  }

  return {
    line1,
    line2: line2Parts.length > 0 ? line2Parts.join(", ") : null,
    city,
    county: clean(address.county),
    postcode,
    country: "United Kingdom",
  };
}

async function fetchProviderAddresses(postcode: string, apiKey: string): Promise<ProviderResponse> {
  const url = new URL(`https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(postcode)}`);
  url.searchParams.set("api_key", apiKey);

  try {
    const response = await fetcher(url.toString());
    if (!response.ok) throw new AddressLookupProviderError();
    const body = await response.json() as ProviderResponse;
    if (body.code !== 2000 || !Array.isArray(body.result)) {
      throw new AddressLookupProviderError();
    }
    return body;
  } catch (error) {
    if (error instanceof AddressLookupProviderError) throw error;
    throw new AddressLookupProviderError();
  }
}

export async function lookupUkAddresses(postcode: string): Promise<NormalizedAddress[]> {
  const apiKey = config.IDEAL_POSTCODES_API_KEY;
  if (!apiKey) throw new AddressLookupProviderError();
  const response = await fetchProviderAddresses(postcode, apiKey);
  return response.result!.map(normalizeAddress);
}

export function setAddressLookupFetcherForTests(testFetcher: Fetcher): () => void {
  const previous = fetcher;
  fetcher = testFetcher;
  return () => { fetcher = previous; };
}
