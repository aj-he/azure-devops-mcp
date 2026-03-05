import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { configureAllTools } from "./tools/index.js";
import { createAuthenticator } from "./authentication/index.js";
import { WebApi, getBearerHandler } from "azure-devops-node-api";

// 1. Setup Express
const app = express();
const transport = new SSEServerTransport("/messages", "/sse");

// 2. Setup the MCP Server
const server = new McpServer({
  name: "Azure DevOps MCP (Remote)",
  version: "1.0.0",
});

// 3. Connect to ADO (using Env Vars for the Service Account)
const orgUrl = process.env.AZURE_DEVOPS_ORG_URL || "";
const pat = process.env.AZURE_DEVOPS_PAT || "";

if (!orgUrl || !pat) {
  console.error("Missing AZURE_DEVOPS_ORG_URL or AZURE_DEVOPS_PAT");
  process.exit(1);
}

// 4. Reuse official tool configuration
// We mock the authenticator since we are using a fixed Service Account PAT
const authenticator = async () => pat;
const getClient = async () => {
    const authHandler = getBearerHandler(pat);
    return new WebApi(orgUrl, authHandler);
};

// Configure tools (importing logic from the official repo)
configureAllTools(
    server, 
    authenticator, 
    getClient, 
    () => "mcp-server-remote/1.0.0", 
    new Set(["core", "work-items"]) // Enable specific domains
);

// 5. Hook up the Transport
app.get("/sse", async (req, res) => {
  await transport.handlePostMessage(req, res);
});

app.post("/messages", async (req, res) => {
  await transport.handlePostMessage(req, res);
});

app.listen(3000, () => {
  console.log("ADO MCP Server running on port 3000");
});