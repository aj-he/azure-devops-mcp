#!/usr/bin/env node

// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import http from "node:http";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { getBearerHandler, WebApi } from "azure-devops-node-api";

import { createAuthenticator } from "./auth.js";
import { logger } from "./logger.js";
import { getOrgTenant } from "./org-tenants.js";
import { configureAllTools } from "./tools.js";
import { UserAgentComposer } from "./useragent.js";
import { packageVersion } from "./version.js";
import { DomainsManager } from "./shared/domains.js";

const PORT = parseInt(process.env.PORT ?? "3000", 10);
const orgName = process.env.AZURE_DEVOPS_ORG ?? "";
const orgUrl = `https://dev.azure.com/${orgName}`;

if (!orgName) {
  logger.error("AZURE_DEVOPS_ORG environment variable is required");
  process.exit(1);
}

const domainsManager = new DomainsManager(process.env.AZURE_DEVOPS_DOMAINS ?? "all");
const enabledDomains = domainsManager.getEnabledDomains();

function getAzureDevOpsClient(getAzureDevOpsToken: () => Promise<string>, userAgentComposer: UserAgentComposer): () => Promise<WebApi> {
  return async () => {
    const accessToken = await getAzureDevOpsToken();
    const authHandler = getBearerHandler(accessToken);
    const connection = new WebApi(orgUrl, authHandler, undefined, {
      productName: "AzureDevOps.MCP",
      productVersion: packageVersion,
      userAgent: userAgentComposer.userAgent,
    });
    return connection;
  };
}

// Map of session ID to active SSE transport
const sessions = new Map<string, SSEServerTransport>();

async function createMcpServer(): Promise<McpServer> {
  const server = new McpServer({
    name: "Azure DevOps MCP Server",
    version: packageVersion,
    icons: [
      {
        src: "https://cdn.vsassets.io/content/icons/favicon.ico",
      },
    ],
  });

  const userAgentComposer = new UserAgentComposer(packageVersion);
  server.server.oninitialized = () => {
    userAgentComposer.appendMcpClientInfo(server.server.getClientVersion());
  };

  const authType = process.env.AZURE_DEVOPS_AUTH_TYPE ?? "env";
  const tenantId = (await getOrgTenant(orgName)) ?? process.env.AZURE_TENANT_ID;
  const authenticator = createAuthenticator(authType, tenantId);

  configureAllTools(server, authenticator, getAzureDevOpsClient(authenticator, userAgentComposer), () => userAgentComposer.userAgent, enabledDomains);

  return server;
}

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/sse") {
    logger.info("New SSE connection established");

    const transport = new SSEServerTransport("/messages", res);
    const sessionId = transport.sessionId;
    sessions.set(sessionId, transport);

    transport.onclose = () => {
      sessions.delete(sessionId);
      logger.info("SSE connection closed", { sessionId });
    };

    try {
      const server = await createMcpServer();
      await server.connect(transport);
    } catch (error) {
      sessions.delete(sessionId);
      logger.error("Failed to connect MCP server", { sessionId, error });
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId") ?? "";
    const transport = sessions.get(sessionId);

    if (!transport) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Session not found" }));
      return;
    }

    await transport.handlePostMessage(req, res);
    return;
  }

  if (req.method === "GET" && url.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: packageVersion }));
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

httpServer.listen(PORT, () => {
  logger.info("Azure DevOps MCP SSE Server started", {
    port: PORT,
    organization: orgName,
    organizationUrl: orgUrl,
    version: packageVersion,
    enabledDomains: Array.from(enabledDomains),
  });
});
