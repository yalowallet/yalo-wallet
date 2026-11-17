
interface Env {
  LIFI_API_KEY: string;
}

interface PagesContext {
  request: Request;
  env: Env;
}

const INTEGRATOR_ID =
  "ebe5204e-0f71-4b09-9295-3f9c9de438be";

const YALO_FEE = "0.003";

const ALLOWED_CHAINS = [1, 8453];

const ALLOWED_OPTIONAL_PARAMS = [
  "toAddress",
  "slippage",
  "allowBridges",
  "denyBridges",
  "allowExchanges",
  "denyExchanges",
  "prefer"
];

function jsonResponse(
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}

export const onRequestGet = async ({
  request,
  env
}: PagesContext): Promise<Response> => {
  try {
    // Check API Key
    if (!env.LIFI_API_KEY) {
      return jsonResponse(
        { error: "LI.FI API key is not configured." },
        500
      );
    }

    const incoming = new URL(request.url);

    const fromChain = Number(
      incoming.searchParams.get("fromChain")
    );

    const toChain = Number(
      incoming.searchParams.get("toChain")
    );

    const fromToken =
      incoming.searchParams.get("fromToken");

    const toToken =
      incoming.searchParams.get("toToken");

    const fromAmount =
      incoming.searchParams.get("fromAmount");

    const fromAddress =
      incoming.searchParams.get("fromAddress");

    // Validate required parameters
    if (
      !Number.isInteger(fromChain) ||
      !Number.isInteger(toChain) ||
      !ALLOWED_CHAINS.includes(fromChain) ||
      !ALLOWED_CHAINS.includes(toChain)
    ) {
      return jsonResponse(
        { error: "Unsupported network. Use Base or Ethereum." },
        400
      );
    }

    const validAddress =
      /^0x[a-fA-F0-9]{40}$/;

    if (
      !fromToken ||
      !validAddress.test(fromToken) ||
      !toToken ||
      !validAddress.test(toToken) ||
      !fromAddress ||
      !validAddress.test(fromAddress)
    ) {
      return jsonResponse(
        { error: "Invalid token or wallet address." },
        400
      );
    }

    if (
      !fromAmount ||
      !/^[0-9]+$/.test(fromAmount) ||
      BigInt(fromAmount) <= 0n
    ) {
      return jsonResponse(
        { error: "Invalid token amount." },
        400
      );
    }

    // Build LI.FI quote parameters
    const params = new URLSearchParams();

    params.set("fromChain", String(fromChain));
    params.set("toChain", String(toChain));
    params.set("fromToken", fromToken);
    params.set("toToken", toToken);
    params.set("fromAmount", fromAmount);
    params.set("fromAddress", fromAddress);

    // YALO integration and commission
    params.set("integrator", INTEGRATOR_ID);
    params.set("fee", YALO_FEE);

    // Optional destination address
    const toAddress =
      incoming.searchParams.get("toAddress");

    if (toAddress) {
      if (!validAddress.test(toAddress)) {
        return jsonResponse(
          { error: "Invalid destination address." },
          400
        );
      }

      params.set("toAddress", toAddress);
    }

    // Optional parameters
    for (const key of ALLOWED_OPTIONAL_PARAMS) {
      const value = incoming.searchParams.get(key);

      if (!value) continue;

      if (key === "slippage") {
        const slippage = Number(value);

        if (
          !Number.isFinite(slippage) ||
          slippage <= 0 ||
          slippage > 0.05
        ) {
          return jsonResponse(
            { error: "Slippage must be greater than 0 and at most 5%." },
            400
          );
        }
      }

      params.set(key, value);
    }

    // Request quote from LI.FI
    const response = await fetch(
      `https://li.quest/v1/quote?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "x-lifi-api-key": env.LIFI_API_KEY,
          "Accept": "application/json"
        }
      }
    );

    const responseText = await response.text();

    let data: unknown;

    try {
      data = JSON.parse(responseText);
    } catch {
      return jsonResponse(
        { error: "Invalid response received from LI.FI." },
        502
      );
    }

    if (!response.ok) {
      return jsonResponse(
        {
          error: "LI.FI quote request failed.",
          details: data
        },
        response.status
      );
    }

    return jsonResponse(data, 200);

  } catch (error) {
    console.error("YALO LI.FI Error:", error);

    return jsonResponse(
      { error: "Unable to retrieve swap quote." },
      500
    );
  }
};
