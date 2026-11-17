
interface Env {
  LIFI_API_KEY: string;
}

const ALLOWED_PARAMS = [
  "fromChain",
  "toChain",
  "fromToken",
  "toToken",
  "fromAmount",
  "fromAddress",
  "toAddress",
  "slippage",
  "allowBridges",
  "denyBridges",
  "allowExchanges",
  "denyExchanges",
  "prefer"
];

export const onRequestGet = async ({
  request,
  env
}: {
  request: Request;
  env: Env;
}) => {
  try {
    if (!env.LIFI_API_KEY) {
      return Response.json(
        { error: "LI.FI API key is not configured." },
        { status: 500 }
      );
    }

    const incoming = new URL(request.url);
    const params = new URLSearchParams();

    for (const key of ALLOWED_PARAMS) {
      const value = incoming.searchParams.get(key);

      if (value) {
        params.set(key, value);
      }
    }

    const required = [
      "fromChain",
      "toChain",
      "fromToken",
      "toToken",
      "fromAmount",
      "fromAddress"
    ];

    for (const key of required) {
      if (!params.has(key)) {
        return Response.json(
          { error: `Missing required parameter: ${key}` },
          { status: 400 }
        );
      }
    }

    const apiUrl =
      `https://li.quest/v1/quote?${params.toString()}`;

    const response = await fetch(apiUrl, {
      method: "GET",
      headers: {
        "x-lifi-api-key": env.LIFI_API_KEY,
        "Accept": "application/json"
      }
    });

    const data = await response.json();

    return Response.json(data, {
      status: response.status,
      headers: {
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    console.error("LI.FI Quote Error:", error);

    return Response.json(
      { error: "Unable to retrieve swap quote." },
      { status: 502 }
    );
  }
};
      
