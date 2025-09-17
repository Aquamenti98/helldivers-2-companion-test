import { Server } from "@modelcontextprotocol/sdk/server";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio";
import {
  CallToolRequestSchema,
  type CallToolRequest,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from "@modelcontextprotocol/sdk/types";
import { z } from "zod";

const JSON_MIME_TYPE = "application/json";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RATE_LIMIT_MS = 2_000;

type GetAPIModule = typeof import("../../../lib/get");
type GetAPIParams = Parameters<GetAPIModule["getAPI"]>[0];

async function callGetAPI<TResponse>(params: GetAPIParams) {
  const module = (await import(
    new URL("../../../lib/get.ts", import.meta.url).href
  )) as GetAPIModule;

  return module.getAPI(params) as Promise<TResponse>;
}

const rateLimiter = new Map<string, number>();

function assertRateLimit(toolName: string, minIntervalMs: number) {
  const now = Date.now();
  const lastCall = rateLimiter.get(toolName) ?? 0;

  if (now - lastCall < minIntervalMs) {
    const waitTimeMs = minIntervalMs - (now - lastCall);
    throw new Error(
      `Rate limit exceeded for ${toolName}. Try again in ${Math.ceil(waitTimeMs / 1000)}s.`
    );
  }
}

function createJsonContent(uri: string, data: unknown) {
  return {
    type: "resource" as const,
    resource: {
      uri,
      mimeType: JSON_MIME_TYPE,
      text: JSON.stringify(data, null, 2),
    },
  };
}

function createSuccessResult(uri: string, data: unknown): CallToolResult {
  return {
    content: [createJsonContent(uri, data)],
    isError: false,
  };
}

function createErrorResult(message: string, details?: unknown): CallToolResult {
  return {
    content: [
      createJsonContent("urn:helldivers:mcp:error", {
        error: message,
        details,
      }),
    ],
    isError: true,
  };
}

function sanitizeDispatchMessage(message: string) {
  return message
    .replace(/<i=\d+>(.*?)<\/i>/g, "")
    .replace(/<span(.*?)>/g, "")
    .replace(/<\/span>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type JsonSchema = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

type ToolDefinition<TSchema extends z.ZodTypeAny> = {
  description: string;
  inputSchema: JsonSchema;
  schema: TSchema;
  minIntervalMs?: number;
  execute: (input: z.infer<TSchema>) => Promise<CallToolResult>;
};

type WarStatusResponse = {
  started: string;
  ended: string | null;
  now: string;
  clientVersion?: string;
  impactMultiplier?: number;
  factions?: unknown;
  statistics?: Record<string, unknown>;
};

type Dispatch = {
  id: number;
  published: string;
  type: number;
  message: string;
};

type Assignment = {
  id: number;
  progress: number[];
  title: string;
  briefing: string;
  description?: string | null;
  tasks: Array<Record<string, unknown>>;
  reward: Record<string, unknown> | null;
  rewards?: Array<Record<string, unknown>>;
  expiration: string;
};

type Campaign = {
  id: number;
  planet: {
    name: string;
    sector: string;
    biome?: { name: string; description?: string } | null;
    hazards?: Array<{ name: string; description?: string }>;
    currentOwner?: string;
    initialOwner?: string;
    maxHealth?: number;
    health?: number;
    regenPerSecond?: number;
    statistics?: Record<string, unknown>;
  };
};

const toolDefinitions = {
  getWarStatus: {
    description: "Fetches the latest status of the Galactic War, including optional aggregate statistics.",
    inputSchema: {
      type: "object",
      properties: {
        includeStatistics: {
          type: "boolean",
          description: "Whether to include global war statistics (defaults to true).",
        },
      },
      additionalProperties: false,
    },
    schema: z
      .object({
        includeStatistics: z.boolean().optional(),
      })
      .strict(),
    minIntervalMs: DEFAULT_RATE_LIMIT_MS,
    async execute(input) {
      const { includeStatistics = true } = input;

      const data = await callGetAPI<WarStatusResponse>({
        url: "/v1/war",
        revalidate: false,
        timeout: DEFAULT_TIMEOUT_MS,
      });

      const result: Record<string, unknown> = {
        started: data.started,
        ended: data.ended,
        now: data.now,
        clientVersion: data.clientVersion,
        impactMultiplier: data.impactMultiplier,
        factions: data.factions,
      };

      if (includeStatistics && data.statistics) {
        result.statistics = data.statistics;
      }

      return createSuccessResult("urn:helldivers:mcp:getWarStatus", result);
    },
  },
  getDispatches: {
    description: "Returns the latest dispatches from Super Earth High Command with optional HTML sanitization.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of dispatches to return (defaults to 5).",
        },
        sanitize: {
          type: "boolean",
          description: "Remove markup tags from messages (defaults to true).",
        },
      },
      additionalProperties: false,
    },
    schema: z
      .object({
        limit: z.number().int().min(1).max(50).optional(),
        sanitize: z.boolean().optional(),
      })
      .strict(),
    minIntervalMs: 3_000,
    async execute(input) {
      const { limit = 5, sanitize = true } = input;

      const dispatches = await callGetAPI<Dispatch[]>({
        url: "/v2/dispatches",
        revalidate: false,
        timeout: DEFAULT_TIMEOUT_MS,
      });

      const slice = dispatches.slice(0, limit).map((dispatch) => ({
        id: dispatch.id,
        published: dispatch.published,
        type: dispatch.type,
        message: dispatch.message,
        plainText: sanitize ? sanitizeDispatchMessage(dispatch.message) : undefined,
      }));

      return createSuccessResult("urn:helldivers:mcp:getDispatches", {
        total: dispatches.length,
        results: slice,
      });
    },
  },
  getMajorOrders: {
    description: "Lists currently active Major Orders, including objectives, rewards, and expiry information.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 10,
          description: "Maximum number of Major Orders to include (defaults to 3).",
        },
        includeTasks: {
          type: "boolean",
          description: "Include raw task data for each assignment (defaults to false).",
        },
      },
      additionalProperties: false,
    },
    schema: z
      .object({
        limit: z.number().int().min(1).max(10).optional(),
        includeTasks: z.boolean().optional(),
      })
      .strict(),
    minIntervalMs: 5_000,
    async execute(input) {
      const { limit = 3, includeTasks = false } = input;

      const assignments = await callGetAPI<Assignment[]>({
        url: "/v1/assignments",
        revalidate: false,
        timeout: DEFAULT_TIMEOUT_MS,
      });

      const now = Date.now();

      const results = assignments.slice(0, limit).map((assignment) => {
        const expirationDate = new Date(assignment.expiration);
        const expiresInSeconds = Math.max(
          0,
          Math.floor((expirationDate.getTime() - now) / 1000)
        );

        return {
          id: assignment.id,
          title: assignment.title,
          briefing: assignment.briefing,
          description: assignment.description,
          progress: assignment.progress,
          reward: assignment.reward,
          rewards: assignment.rewards,
          expiration: assignment.expiration,
          expiresInSeconds,
          tasks: includeTasks ? assignment.tasks : undefined,
        };
      });

      return createSuccessResult("urn:helldivers:mcp:getMajorOrders", {
        generatedAt: new Date(now).toISOString(),
        results,
      });
    },
  },
  getActiveCampaigns: {
    description: "Provides an overview of active planetary campaigns, optionally filtered by faction.",
    inputSchema: {
      type: "object",
      properties: {
        faction: {
          type: "string",
          description: "Filter campaigns by current planet owner (e.g., Humans, Terminids).",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 50,
          description: "Maximum number of campaigns to return (defaults to 10).",
        },
        includeStatistics: {
          type: "boolean",
          description: "Include mission statistics for each campaign (defaults to false).",
        },
      },
      additionalProperties: false,
    },
    schema: z
      .object({
        faction: z.string().optional(),
        limit: z.number().int().min(1).max(50).optional(),
        includeStatistics: z.boolean().optional(),
      })
      .strict(),
    minIntervalMs: 5_000,
    async execute(input) {
      const { faction, limit = 10, includeStatistics = false } = input;

      const campaigns = await callGetAPI<Campaign[]>({
        url: "/v1/campaigns",
        revalidate: false,
        timeout: DEFAULT_TIMEOUT_MS,
      });

      const filtered = campaigns
        .filter((campaign) => {
          if (!faction) {
            return true;
          }
          const currentOwner = campaign.planet.currentOwner;
          const initialOwner = campaign.planet.initialOwner;
          return (
            currentOwner?.toLowerCase() === faction.toLowerCase() ||
            initialOwner?.toLowerCase() === faction.toLowerCase()
          );
        })
        .slice(0, limit)
        .map((campaign) => ({
          id: campaign.id,
          planet: {
            name: campaign.planet.name,
            sector: campaign.planet.sector,
            biome: campaign.planet.biome?.name,
            hazards: campaign.planet.hazards?.map((hazard) => hazard.name) ?? [],
            currentOwner: campaign.planet.currentOwner,
            initialOwner: campaign.planet.initialOwner,
          },
          health: {
            current: campaign.planet.health,
            max: campaign.planet.maxHealth,
            regenPerSecond: campaign.planet.regenPerSecond,
          },
          statistics: includeStatistics ? campaign.planet.statistics : undefined,
        }));

      return createSuccessResult("urn:helldivers:mcp:getActiveCampaigns", {
        total: campaigns.length,
        results: filtered,
      });
    },
  },
} satisfies Record<string, ToolDefinition<z.ZodTypeAny>>;

const tools: Record<string, ToolDefinition<z.ZodTypeAny>> = toolDefinitions;

const toolList: Tool[] = Object.entries(tools).map(([name, definition]) => ({
  name,
  description: definition.description,
  inputSchema: definition.inputSchema,
}));

async function main() {
  const server = new Server(
    {
      name: "helldivers-mcp",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: toolList,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request: CallToolRequest) => {
    const { name, arguments: args } = request.params;
    const definition = tools[name];

    if (!definition) {
      return createErrorResult(`Unknown tool: ${name}`);
    }

    const minIntervalMs = definition.minIntervalMs ?? DEFAULT_RATE_LIMIT_MS;

    try {
      assertRateLimit(name, minIntervalMs);
    } catch (error) {
      if (error instanceof Error) {
        return createErrorResult(error.message);
      }
      return createErrorResult("Rate limit exceeded");
    }

    let parsedInput: unknown;
    try {
      parsedInput = definition.schema.parse(args ?? {});
    } catch (error) {
      if (error instanceof z.ZodError) {
        return createErrorResult("Invalid arguments", error.issues);
      }
      return createErrorResult("Failed to parse tool arguments");
    }

    try {
      rateLimiter.set(name, Date.now());
      return await definition.execute(parsedInput);
    } catch (error) {
      if (error instanceof Error) {
        return createErrorResult(error.message);
      }
      return createErrorResult("Unexpected error invoking tool");
    }
  });

  const transport = new StdioServerTransport();

  server.oninitialized = () => {
    console.log("[helldivers-mcp] Client connected to MCP server.");
  };

  await server.connect(transport);

  console.log("[helldivers-mcp] Server ready and listening on stdio.");
}

main().catch((error) => {
  console.error("[helldivers-mcp] Failed to start server", error);
  process.exit(1);
});
