import { ChatKitClient, MessagesClient } from "./chatkit";
import type { Config } from "./config";
import { createConfig, type NormalizedConfig } from "./config";
import { SkillsClient } from "./skills";
import { McpClient } from "./tools";
import { SelfExtensionClient } from "./self-extension";

export class Client {
  readonly config: NormalizedConfig;
  readonly mcp: McpClient;
  readonly chatkit: ChatKitClient;
  readonly messages: MessagesClient;
  readonly skills: SkillsClient;
  readonly selfExtension: SelfExtensionClient;

  constructor(config: Config = {}) {
    this.config = createConfig(config);
    this.messages = new MessagesClient(this.config);
    this.mcp = new McpClient(this.config);
    this.chatkit = new ChatKitClient(this.config);
    this.skills = new SkillsClient(this.config);
    this.selfExtension = new SelfExtensionClient(this.config);
  }
}

export function createClient(config: Config = {}): Client {
  return new Client(config);
}
