import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import crypto from "crypto";
import { debug } from "../utils/logger.js";

interface ServiceAccount {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
  auth_provider_x509_cert_url: string;
  client_x509_cert_url: string;
}

interface FCMMessage {
  pushToken: string;
  title: string;
  body: string;
  customUrl?: string;
  imageUrl?: string;
}

const TOKEN_URL = "https://www.googleapis.com/oauth2/v4/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

async function createJWT(serviceAccount: ServiceAccount): Promise<string> {
  const header = { alg: "RS256", typ: "JWT" };

  const now = Math.floor(Date.now() / 1000);
  const exp = now + 3600;

  const claims = {
    iss: serviceAccount.client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    exp,
    iat: now,
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const claimsB64 = base64UrlEncode(JSON.stringify(claims));
  const jwtUnsigned = `${headerB64}.${claimsB64}`;

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(jwtUnsigned);
  sign.end();

  const signature = sign.sign(serviceAccount.private_key);
  const signatureB64 = signature
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${jwtUnsigned}.${signatureB64}`;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  token_type?: string;
}

interface CachedToken {
  token: string;
  expiresAt: number; // epoch ms
}

const TOKEN_CACHE_MARGIN_MS = 5 * 60 * 1000; // 5 minutes
const tokenCache = new Map<string, CachedToken>();

async function getAccessToken(serviceAccount: ServiceAccount): Promise<string> {
  const cacheKey = serviceAccount.client_email;
  const cached = tokenCache.get(cacheKey);

  if (cached && Date.now() < cached.expiresAt) {
    debug(`[FCM] Using cached token for ${cacheKey}`);
    return cached.token;
  }

  const jwt = await createJWT(serviceAccount);

  const params = new URLSearchParams();
  params.append("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer");
  params.append("assertion", jwt);

  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to get access token: ${error}`);
  }

  const data = (await response.json()) as TokenResponse;
  if (!data.access_token) {
    throw new Error("No access token in response");
  }

  const expiresInMs = (data.expires_in ?? 3600) * 1000;
  tokenCache.set(cacheKey, {
    token: data.access_token,
    expiresAt: Date.now() + expiresInMs - TOKEN_CACHE_MARGIN_MS,
  });
  debug(`[FCM] Cached new token for ${cacheKey}, expires_in=${data.expires_in}s`);

  return data.access_token;
}

function parseServiceAccount(json: string): ServiceAccount {
  try {
    const sa = JSON.parse(json) as ServiceAccount;
    if (!sa.private_key || !sa.client_email || !sa.project_id) {
      throw new Error(
        "Invalid Service Account JSON: Missing required fields (private_key, client_email, project_id)",
      );
    }
    return sa;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to parse Service Account JSON: ${msg}`);
  }
}

interface FCMSuccessResponse {
  name: string;
}

interface FCMErrorResponse {
  error?: Record<string, unknown>;
}

async function sendFCMMessageInternal(
  serviceAccount: ServiceAccount,
  message: FCMMessage,
): Promise<FCMSuccessResponse> {
  const accessToken = await getAccessToken(serviceAccount);
  const projectId = serviceAccount.project_id;

  const payload = {
    message: {
      token: message.pushToken,
      data: {
        _sid: "SFMC",
        _mediaUrl: message.imageUrl || "",
        _m: "test_message",
        alert: message.body,
        title: message.title,
        _od: message.customUrl || "",
        _ts: Date.now().toString(),
      },
      android: {
        priority: "HIGH" as const,
        notification: {
          title: message.title,
          body: message.body,
          click_action: "",
        },
      },
    },
  };

  const endpoint = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
    },
    body: JSON.stringify(payload),
  });

  const responseData = (await response.json()) as FCMSuccessResponse & FCMErrorResponse;

  if (!response.ok) {
    throw new Error(
      `FCM Error: ${JSON.stringify(responseData.error || responseData)}`,
    );
  }

  return responseData;
}

export function registerFcmTools(server: McpServer): void {
  server.registerTool("flipper_send_fcm", {
    description:
      "Envía notificaciones push FCM v1 a un dispositivo (formato Salesforce MobilePush). Requiere Service Account JSON.",
    inputSchema: {
      service_account_json: z
        .string()
        .describe(
          "Contenido completo del archivo JSON de la Service Account",
        ),
      push_token: z
        .string()
        .describe("Token FCM del dispositivo destino"),
      title: z.string().describe("Título de la notificación"),
      body: z.string().describe("Cuerpo del mensaje"),
      custom_url: z
        .string()
        .optional()
        .describe("Deep link URL (ej: meliaapp://fichahotel/0738)"),
      image_url: z
        .string()
        .optional()
        .describe("URL de la imagen a mostrar"),
    },
  }, async (args) => {
    try {
      const serviceAccount = parseServiceAccount(args.service_account_json);

      const message: FCMMessage = {
        pushToken: args.push_token,
        title: args.title,
        body: args.body,
        customUrl: args.custom_url,
        imageUrl: args.image_url,
      };

      debug(`[FCM] Sending to ${message.pushToken.substring(0, 15)}...`);
      const result = await sendFCMMessageInternal(serviceAccount, message);

      return {
        content: [
          {
            type: "text" as const,
            text: `Notification Sent Successfully!\nMessage ID: ${result.name}`,
          },
        ],
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [
          {
            type: "text" as const,
            text: `Error sending FCM: ${msg}`,
          },
        ],
        isError: true,
      };
    }
  });
}
